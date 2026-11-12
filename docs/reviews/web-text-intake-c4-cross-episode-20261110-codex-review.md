# MAYNE-30 C4 候选审查（2026-11-10，Codex）

结论：**needs_revision / BLOCK**。候选 `5623faeeb75fa48ce49dcd9eb4fc983533139c70` 仍违反任务明确要求的跨 attempt 围栏与歧义拒绝，不能进入 done 或合入 main。现有 54 面全绿成立，但新增受控交错可以再次打开 C4 旧请求重放窗口。

## 范围与身份

- 来源：MAYNE-30 正文、作者评论 `01a1c2f0-3a72-75b8-9734-20907ef03790`；父 MAYNE-24 的 C4 核证 `01a1c2af-5584-732d-b06b-bd4f1cf16d9d`、接收裁定 `01a1c2bf` 与接续派发 `01a1c2cf`。已核父子 active，本卡仅本次审查，父卡既有 UI run 继续。
- 基点 `25b7f69be3f4b605512f4e57203f61f5b5cd8ef5`；候选 tree `6de8f341eb66a75bd96f6c81a64a68648fa27566`。最小差分为 6 文件 +552/−30，其中 3 个授权生产文件；作者附件生产 patch 与提交 diff 逐字节相同，红绿 TAP 与附件 SHA 清单均命中。
- Inspect；非批量，审查单个候选。涉及恢复退出安全，按 R3 的限定正确性/安全审查面处理；本记录不签完整双面准出。本轮只写本人审查记录及忽略目录证据，不修改受审生产、测试、夹具或作者记录。
- 私有任务分支保持 `agent/codex/mayne-30`，起点 `3a82aed80a6d940a5b080968a2689daa36f27b26`；候选通过 `git archive` 导出到 `build/mayne30-codex-review/candidate/` 取证，无切枝、无 main 写入、无 push。
- 核对导出树 4659 个输入 blob：无意外漂移；两个未参与运行的 vendor Windows 脚本有 `.gitattributes` 指定的 CRLF 导出转换，规范化后与 blob 相同。受审生产、测试、夹具及冻结契约均与提交原字节一致。

## 发现项

### P1 — 迟到分类未绑定 attempt/版本，跨轮仍可插入 v1 并接受旧 HTTP 请求

位置：候选 `server/lib/task-recovery.mjs:132`、`:136`、`:150`；`server/lib/task-service.mjs:455`、`:466`、`:474`。

违反的不变量：任务正文要求条目、任务、attempt、事件同事务，绑定读取时的任务状态/版本和对应 attempt，晚到旧分类不能应用到新 attempt。当前 running UPDATE 只有 `task_id` + `state='running'`；needs_review 分支甚至只有 `task_id`。条目首次 INSERT 的 `expectChanges:1` 只证明插入成功，未证明提交时仍然无行；复用 UPDATE 也未绑定读取的 version。

真实存储、合成任务、无 SQL 状态注入的审查反例：

- **A**：保存 attempt A 的 running 扫描结果；合法 recover → resolve → claim attempt B；再 classify(A)。调用成功，把 B 的 `running/active/v5` 写为 `needs_review/exited_confirmed/v6`，条目 v2→v3，产生新事件；B 的 attempt 仍未退出。
- **B（跨事务交错）**：把 A 分类已组装的事务停在 stdio 提交前；另一合法分类/处置把原条目推进 v2，并 claim B；释放旧事务。`state='running'` 再次匹配，旧 INSERT 成功，留下 v2/resumed + 新 v1/pending；任务实际 v6，却追加 `object_version=3` 的旧事件。随后通过真实 HttpServer、配对/会话/CSRF，将第一轮相同请求 `{expectedVersion:1,decision:'resume',acknowledgedReceipts:[]}` 再发一次，**HTTP 202 / queued**，并关闭 B 的 attempt。预期应拒绝旧分类且零副作用，旧请求不能生效。
- **C（相邻同根因）**：保存 A 的 needs_review 扫描结果，合法处置并 claim B 后再分类 A，B 仍 running 却从 active 变为 exited_confirmed，发出与真实状态不符的 needs_review 事件。此无围栏分支是基点既有缺口，未当作新增代码回归；它仍违反本卡明确的晚到分类验收。

影响：旧退出观察污染新 attempt、提前释放槽位，C4 重放重新成立，事件版本与任务状态失配。A–C 归并为同一围栏缺口，不重复计数。X6 仅检查 `commitStagedResume` 的 attempt 参数，X4 仅检查同轮并发扫描，均未覆盖这些交错。

必需修正：在同一事务中校验扫描对应的当前 attempt、读取时任务状态/版本及条目读取前提（含首次不存在与复用版本），前提丢失时整事务拒绝。补上述跨 attempt/ABA 反例与真实 HTTP 正反控，保持合法新鲜请求可成功；不改 schema 或公开请求字段。

### P1 — 多条已处置历史行被按 rowid 选最新，未按要求拒绝歧义

位置：候选 `server/lib/task-service.mjs:457`、`:463`、`:475`。

违反的不变量：任务明确禁止通过“任选最新行”猜测归并，要求复用可证明对应行，缺失/歧义可见拒绝。实现仅拒绝存在 pending 的情况，全部已处置时无条件取 `rows[0]`，查询甚至不读取可证明 attempt 归属或版本的字段。

**D 反例**：第一轮合法停靠/处置，再以基点 `25b7f69` 原服务执行第二轮合法停靠/处置，构造真实可达的历史数据：两条不同 itemId、各 v2/resumed。第三轮交候选生产者停靠，实际成功，按 rowid 把后一条变成 v3/pending。没有 SQL 注入、删除历史或猜造双 pending。预期为 `state_conflict` 且任务/条目/事件零变更。

影响：旧数据上的权威选择没有证明，违反冻结单任务条目身份语义及本卡明确限制。必需修正：无法证明唯一对应行时可见拒绝；补“多条全部已处置”的回归，保留现有双 pending 拒绝面，不通过新增唯一约束或删除历史解决。

### P2 — 作者记录的测试 SHA 与提交字节不符

位置：候选 `docs/reviews/web-text-intake-c4-cross-episode-20261110-zcode.md:9`。

记录写测试 SHA 前缀 `6402bc51e66f021a…`；候选 git blob 原字节及本轮实跑文件的 SHA-256 均为 `1aaa8d059c339b7e8ad7bc22d04887d0f53b299874f8b835e3c80bbe137ae363`。应追加更正并绑定作者实际运行字节，不能继续把两值当同一身份。本轮独立重跑使用后者，结果另记，不反推作者旧 TAP 对应哪份源码。

## 实际验证

macOS arm64；Node v24.20.0 / npm 12.2.1。独立前置：在候选 `src-tauri/` 执行 `cargo build --release --bin web-backend-storage`，先创建本地空资源目录 `build/s0-runtime/`，exit 0，1m46s。存储二进制 SHA-256 `5311ffa3d3d26e19fa9ced89f611631268c24e0709e23296f945a4d2753232bd`，与作者登记精确相同。冻结契约 `61863271a82f46ed863025d20cbed7fa97acb8fbab17c98727477b1cab86f58d` 命中。

下表测试均使用 `node --test --test-timeout=20000 --test-reporter=tap <文件>`，串行执行，无 skip/cancel。原命令、退出码、时间、TAP、机器观察及来源哈希随证据包。

| 来源/文件 | 通过/失败 | exit | 秒 |
|---|---:|---:|---:|
| 候选 `web-text-intake-recovery-authority.test.mjs` | 54/0 | 0 | 3.092 |
| 基点生产 + 同一候选测试/夹具字节 | 44/10 | 1 | 1.893 |
| 候选 `web-text-intake-recovery.test.mjs` | 11/0 | 0 | 57.863 |
| 候选 `web-text-intake-events.test.mjs` | 11/0 | 0 | 0.614 |
| 候选 `web-text-intake-lifecycle.test.mjs` | 10/0 | 0 | 5.368 |
| 审查反例 A–D，断言拒绝/零副作用 | 0/4 | 1 | 0.233 |

基点的 10 个失败面恰为 B9、X1–X9，与作者红面一致；既有 C2/C3、ACK 正控、双 pending、事务回滚等面在候选保持绿。没有用这些计数覆盖 F1/W 来源争议、RA2 或其它既有未决项。

## 复跑与交付边界

附件 `review-probes.test.mjs` 放到 `build/mayne30-codex-review/`。在可取得上述本地对象的仓库中导出候选、基点服务；脚本仅依赖 tracked 服务/夹具和显式构建的存储二进制，不依赖作者遗留工作树。

```sh
mkdir -p build/mayne30-codex-review/candidate
git archive 5623faeeb75fa48ce49dcd9eb4fc983533139c70 | tar -x -C build/mayne30-codex-review/candidate
git archive 25b7f69be3f4b605512f4e57203f61f5b5cd8ef5 server shared | tar -x -C build/mayne30-codex-review
mkdir -p build/mayne30-codex-review/candidate/build/s0-runtime
cargo build --manifest-path build/mayne30-codex-review/candidate/src-tauri/Cargo.toml --release --bin web-backend-storage
node --test --test-timeout=20000 --test-reporter=tap build/mayne30-codex-review/review-probes.test.mjs
```

最后一条在受审版本预期 exit 1、四个具名断言红；B 同时记录第一轮 HTTP 202 和重放 HTTP 202。B 是确定性延迟存储提交的受控服务交错，HTTP 部分是真实 handler；不宣称启动时完整调度器/worker/Pi 并发已实测。

已检查：冻结规格、C2/C3/C4 正反控、事务/并发与退出隔离、clean export 输入可取得性、授权/依赖/schema 差分；本轮无新增依赖或迁移。本审查分支 `npm run check:docs` exit 0（21 文件、513 链接），`git diff --check` 与反例脚本 `node --check` 均 exit 0。明确未做：UI/a11y/19 旅程、真实 Pi/模型/凭据/用户根、部署/OS provider，以及卡内禁止的聚合、完整 `npm run check`、全量 cargo test。聚焦通过不替代整体准出。

证据原件在忽略目录 `build/mayne30-codex-review/`；附件包中的日志只替换本机绝对工作路径以脱敏，原件 SHA 与交付件 SHA 分别登记。按项目 workflow 退回 `started_2`（已驳回），待修订候选重审；MAYNE-24/唯一集成边界保持。
