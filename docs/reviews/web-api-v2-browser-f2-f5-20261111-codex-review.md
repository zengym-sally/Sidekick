# MAYNE-38 客户端 F2/F5 限定复审

结论：**pass**。客户端候选 `329ea3f9fe3260963af71c6cfe69b071a4649869` / tree `845a8d9d3e2907fc1f2ec87f26b8546eae3b888f` 的 F2/F5 已关闭；本次修订未发现新增 P0–P3 问题。该结论只接收客户端候选，不签署整体 E/W1 完成。

## 范围与依据

- 任务：MAYNE-38「退出证据诚实呈现＋断线快照恢复」的第三轮评审；前轮受审 `653a23c5bce38c1b5b8d81bee0b4468996834bd5` / tree `ba4b7f704c0bb87e4fb23fbfbe23f49586f7e9e3`，结论 needs_revision。
- 本轮非批量，只读核验上述两个候选的三文件差分（+161/−23），生产差分仅 `src/components/TaskQueue.vue`（+46/−22）；另两文件是浏览器驱动与原作者记录。没有改候选源代码、测试或原记录。
- 冻结依据：`0c9febc5010015418a5778a49f76d4e0c01f7f9f:docs/engineering/web-api-contract-v2.md`，§3.1.1 的 attempt 身份、版本和不可逆证据，§3.2 的合法重试，§6.1 的跨 epoch 快照重装；依本卡明确范围，不重审冻结契约、不扩展后端写域。
- 本轮局部影响为队列世代/并发围栏，按 R2 聚焦复核；E 全链的跨进程保证与最终发布验收不由本轮签署。评审者未参与候选实现。
- 平台工作分支 `agent/codex/mayne-38`，起点与运行时 HEAD 均为 `d587ebabd35fb749276459d2399f73558021b462`。用 `git archive` 分别导出受审与修前树到被忽略的 `build/mayne38-r3-review/`，没有切换分支或建立 detached checkout。

## 发现项关闭

| 既有发现 | 修订位置与核实结果 | 独立证据 |
|---|---|---|
| P1 F5：确认不可逆规则跨 attempt 阻止合法重试，连带阻塞其它行 | `src/components/TaskQueue.vue:487`：先拒绝低版本及同版本异 attempt，再仅对相同 attempt 比较 verdict。新 attempt 的 active/null 不再被前次确认否决 | 上轮同字节 `generation-browser.mjs` 在旧候选复现两项 F5 失败；新候选合法重试安装和其它行更新均通过 |
| P1 F2：列表遗漏清空 ID 水位，旧 confirmed 可重新授权 resolve | `TaskQueue.vue:509`：普通列表保留所有见过 ID 的水位和最后安装行；回退读回被拒绝时恢复对应受保护行；仅 epoch 重装清空 | 同探针旧候选仍可打开旧恢复入口并发送合成 resolve POST，两项 F2 失败；新候选恢复原 unresolved 行、占槽且没有可用 resolve 入口 |

上轮同字节探针结果为旧候选 **2 过/4 失败，exit 1**，新候选 **5 过/0 失败，exit 0**。第六项是仅在旧恢复入口被错误启用时执行的 POST 反例，新候选没有该入口，因此不执行此条件分支；不能把两次观察数量的差异隐去。

`installedRows` 的行缓存和水位一同保留，终态行仍被显示集合过滤。补充真实 DOM 探针确认：同版本异 attempt 拒绝、同 attempt unresolved→null 拒绝、合法 unresolved→confirmed 接受、终态退出列表后遗漏不擦除水位、旧 unresolved 不复活、其它任务仍更新、新 epoch 可安装低版本及使用快照 token 重订阅，共 **9/9**。

原 F1/F3/F4 通过面保持：嵌套任务版本拒绝，argv 原因不变式校验，failed+confirmed 和 unresolved+pending 的独立只读披露。没有以更改断言或冻结预期关闭问题。

## 本轮实际执行

Node `v24.20.0`，npm `12.2.1`；使用本机已有依赖，经逐字核对候选与其依赖锁一致，没有安装或新增依赖。以下命令在候选导出根执行，独立探针在证据根执行，均保存原始输出和退出码：

| 命令或检查 | 结果 |
|---|---|
| `node --test --test-timeout=20000 tests/unit/web-api-v2-client.test.mjs tests/unit/web-api-v2-snapshot.test.mjs tests/integration/web-api-v2-task-evidence-browser.test.mjs` | **51/51**，exit 0；集成内作者 Chrome 驱动 **74/74**，不与 51 重复累加 |
| `node --test --test-timeout=20000 tests/unit/s2-client.test.mjs tests/unit/web-manual-items.test.mjs tests/unit/layout-domain.test.mjs` | **76/76**，exit 0 |
| `node --test --test-timeout=20000 independent-client.test.mjs` | **8/8**，exit 0；探针与上轮附件字节一致 |
| `node review-browser.mjs` | **5/5**，exit 0；探针与上轮附件字节一致 |
| `REVIEW_EXPORT=previous node generation-browser.mjs` / `REVIEW_EXPORT=candidate node generation-browser.mjs` | 修前 **2/4**，exit 1；修后 **5/0**，exit 0；同字节探针 |
| `node supplemental-browser.mjs` | **9/9**，exit 0；新增独立预期，只复用 CDP/HTTP 启停支架，不复制生产围栏算法 |
| `npm run typecheck` | exit 0 |
| `npm run check:docs` | exit 0，21 文件、513 本地链接；评审记录目录按现有守卫规则不做正文链接扫描 |
| `npm run check:structure`，修前/修后隔离索引及精确导出根 | 双方 exit 1，均为相同 3 条既有 `vendor/pi` dist 引用缺失；结构自测通过，零新增违规，**不记为整体通过** |
| `node --check`，本轮浏览器脚本和聚焦测试 | exit 0，详见附件命令清单 |
| `git diff --check 653a23c5 329ea3f9` / 工作区 `git diff --check` | exit 0 |

结构检查先用隔离 `GIT_INDEX_FILE` 装载对应树，`GIT_WORK_TREE` 指向导出根，原任务 HEAD/索引未动。首次检查暴露额外的评审环境 `node_modules` 符号链接根文件；将自建链接暂时移开后，重跑得到上述相同的三条原有失败，随后恢复链接。两次原始输出都保留，未修改守卫或生产树。

所有浏览器运行（包括预期失败的修前运行）均回收 Chrome、Vite、HTTP 和临时 profile，四项 cleanup 均为 true，单次执行含清理小于 20 秒。候选 640px 截图与遗漏反例修后截图已人工查看，证据范围句、pending 披露可读，无水平溢出。浏览器使用合成会话、输入和传输，不涉及真实模型、用户根或凭据。

## 字节与边界核对

- CandidateCard 与指定 D 来源 `d7688fbb` 字节相同；`web-api-client.ts`、`pairing.ts`、`organizer.ts` 与前轮受审树完全相同。
- 自有夹具的 16 份 frozen JSON 均与 `0c9febc5:tests/fixtures/web-contract-v2/` 对应文件字节相同。冻结规范和其它 55 样例不在本轮差分中。
- Face 6 仅将 cancelling 样例克隆为独立 taskId，原断言未动；原样例 ID 与先前确认行冲突且版本较低，修改后仍检查原定的暂存/取消呈现，水位反例由 Face 11/14 和独立探针覆盖。
- 实现符合本次原四个生产写域，不涉及 server/Rust/DDL/Runtime/vendor/package/依赖或公共状态索引的新增改动。
- 原始证据、可复跑探针、命令及退出码、源文件哈希与截图由本轮 issue 评论附件交付。附件日志中的本机路径已替换为占位符，哈希清单针对实际交付字节计算。

## 结论的实际限度

本轮可接收精确客户端候选，MAYNE-38 可按客户端范围进入 done。依据本卡明确停止边界，**不合 main、不创建远端 PR、不推送、不运行完整 `npm run check` 或 19 旅程**；完整门禁、真实后端/API2 组合、真实快照水位、Pi 进程保证及最终业务验收仍开放，由 MAYNE-34 收口。结构守卫的三条既有失败也未在本轮关闭。

跳过维度：本轮无变更的数据库迁移、宿主进程清扫、真实 OS 凭据、网络部署及真实模型。静态和夹具层结论不外推为这些面的通过。生产候选不写入评审分支；本分支仅新增本记录，原作者记录保持原字节。
