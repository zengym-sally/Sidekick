# W0 集成完整门禁补跑（R5）：`npm run check` exit 0 绿证取得（MAYNE-22，2026-11-07）

> 结论先行：按 Codex 2026-11-07 指派（评论 `01a1b5db-4239-7da5-aa6f-cb5645988096`），本次实际隔离树重新登记 admission，核实与已审候选 `8bd29c4724b6748cf2f2db80f8f552e5f4338ad3` 实现一致（集成补丁 sha256 逐字节复现，且与上轮交付附件 `integration-commit-8bd29c4.patch` 逐字节一致），随后按**原预算、串行单次**补跑完整 `npm run check`：**exit 0，1059s，35 组 968 测试全过、0 失败**。上轮 R1b/R2/R3 超时的 s32 长路径用例本轮实测 **8.83s**（预算 20s），证实既有「负载敏感、与改动无关」归因。上轮旧日志随旧树丢失，如实声明缺失，未伪造；本轮日志为全新原始记录。AUTH-GIT-1 拟批准条件已按指示收紧（完整门禁 exit 0 ✓ 且独立评审通过 ✓），授权包仍**仅备妥、未获批、未执行**；本轮不改已审实现、不快进 main、不 commit/push 共享分支、不晋级。本记录只补本项 `web-foundation-integration-*.md` 与 `build/` 证据，不改其他集成记录或索引。

## 1. 范围与唯一树（admission 重新登记）

- 执行者：OpenCode；候选质量独立评审：ZCode（2026-11-07 APPROVE，评论 `01a1b5d9-7256-7b99-8cd1-0bc391bd655b`）。本项保持 `in_progress`；W0 准出与晋级由 Codex/owner 收口。
- 唯一隔离树（运行前已登记 `build/web-foundation-integration/admission.json`）：
  - `pwd` = `…/ming-space-bc02289231eb/mayne-22-d47c0ad64526/worktree`（**新树**；上轮树 `mayne-22-431fe381e18a` 已不存在）
  - branch `agent/opencode/mayne-22`；HEAD = `8bd29c4`（即已审候选本身），tree `c6f20de7a5e92b6cc41268c8c254a24620388c6f`
  - 祖先核对 exit 0：`9ad2d61`（集成基座）、`85feb8a`（原始基线）、`2e580aa`（快进前 main）均为 HEAD 祖先；候选父提交 `eb431cb`
- 本轮允许写入清单（较上轮收窄）：本项 `docs/reviews/web-foundation-integration-*.md`（仅新增本记录）与 `build/`（本树，gitignored）。package.json/锁文件/AGENTS/生产 src/、schema/migrations、vendor、共享 main、其他树：零改动。

## 2. 与已审候选的实现一致性核对（全过）

| 核对项 | 结果 |
|---|---|
| HEAD == 候选 `8bd29c4`，tree == `c6f20de7…` | 一致 |
| 集成补丁 sha256（`git diff eb431cb 8bd29c4 \| shasum -a 256`） | `93506543f052cb55cf22cc7d72b331158cf298001de954cbda0e5555bab3745e`，与登记值一致 |
| 与上轮交付附件 `integration-commit-8bd29c4.patch` 逐字节比较（`cmp`） | exit 0，逐字节一致——本树候选即上轮已审对象 |
| 记录 §7 六个冻结文件 sha256（check-structure/architecture/runtime-metadata/task-flow.js/web-task-interaction/README） | 逐项一致，实现未被改动 |
| 工作区差异 | 仅 AGENTS.md 平台自动注入块（daemon 管理、不入提交）与未跟踪 `.multica/`、`.opencode/`（MAYNE-18 白名单内）；**本轮零实现改动** |

## 3. 旧证据缺失声明（如实）

上轮原始门禁日志 `full-check-r1/r1b/r2/r3.log`、`ui-repro-20261107.md`、`authorization-package.json` 原文件随上轮平台树删除**已不可恢复**，本轮如实声明缺失；未重新生成冒充原始记录。上轮核心声明（哈希、零差异、聚焦门禁、动态场景）已由 ZCode 独立重建（其评审记录与 `build/mayne22-review/`），本轮补的是**新树上的全新原始证据**。授权包按上轮记录 §6 的实质重建为 `build/web-foundation-integration/authorization-package.json`，并按本轮指示收紧 AUTH-GIT-1 条件。

## 4. 前置与完整门禁（原始命令、真实退出码）

前置（仓库既有命令，非新增依赖）：`npm ci --ignore-scripts`（exit 0）；`npm run probe:prepare-cli`（exit 0，lark-cli v1.0.98）；`npm run probe:prepare-pi`（exit 0，vendor/pi `ad702637`/tree `e89822b0d7a2baf5cc518d3baf568e8dceb73c68`，与登记一致）。

| 项 | 值 |
|---|---|
| 命令 | `npm run check`（串行单次；预算=package.json 原值，未改 `--test-timeout`，未重试） |
| 起止（UTC） | 2026-11-07T11:59:32Z → 12:17:11Z（耗时 1059s） |
| 退出码 | **0** |
| 原始日志 | `build/web-foundation-integration/fullgate-r5/full-check-r5.log`（190405 字节，sha256 `bb04e36f2871a77089325b4f5cf17626b5ea9124390c2aa690554e3a6382eaeb`） |
| 测试汇总 | 35 组 `node --test`：tests 968 / pass 968 / **fail 0** / cancelled 0 / skipped 0 |
| 双包构建 | `probe:bundle`、`bundle-smoke`、`build:s33-ui-verify`、`probe:app` 全部完成；Sidekick.app release 打包成功（末段 45.33s） |
| 环境 | macOS 27.0.1 arm64；node v24.20.0 / npm 12.2.1 / rustc+cargo 1.89.0 / python3 3.15.2；16 核 |
| 负载（30s 采样，`load-samples.txt`） | 起始 8.07 → 峰值 78.7（12:14:33Z，本门禁自身 release 编译/打包段）→ 结束 25.3 |

## 5. 关键用例测量与 R1b/R2/R3 归因闭合

- `tests/unit/s32-skills.test.mjs`「valid long-path packages…」本轮实测 **8827.05ms**（预算 20000ms），整组 28/28 pass。该用例即上轮 R1b/R2/R3 的唯一失败点（20.4–21.0s 超时，负载 5.8–14.3）。
- 三方数据互证：作者上轮「60s 预算隔离复跑 22.1–28.9s 且随负载变长」、ZCode 独立复跑「8.6–9.8s 完成」（load 6.3–8.4）、本轮绿证内 8.83s。结论：**该用例为纯文件系统负载敏感的既有抖动，与集成改动无关**；本轮未改任何预算即取得绿证，无需 stage 2 性能决策，该开放项就此闭合。
- 门禁后工作区核对：HEAD 仍为 `8bd29c4`，除平台注入 AGENTS.md 与未跟踪平台目录外无任何杂散文件，零实现改动。

## 6. 警告分类（无未分类新警告）

| 类别 | 数量 | 说明 |
|---|---|---|
| vite chunk 体积建议（>500 kB） | 2 | 两次生产打包（bundle-smoke / probe:app）既有的信息级建议，构建 exit 0；属已审候选固有，非本轮新增 |
| `npm notice`（脚本回显） | 134 | npm 12 生命周期回显，信息级 |
| cargo/clippy/rustc/tsc 编译警告 | 0 | 日志无 `warning:` 行 |
| 测试失败/取消 | 0 | — |

## 7. 授权包更新（仅备妥，未获批，未执行）

`build/web-foundation-integration/authorization-package.json`（重建+更新）：

- **AUTH-GIT-1**（本地 main `9ad2d61`→`8bd29c4` fast-forward）：拟批准条件按指示收紧为「完整门禁 exit 0 ✓（本轮证据）且独立评审通过 ✓（ZCode 2026-11-07）」——两项技术条件均已具证，**但仍需 owner 明确批准，本轮未执行**；main 未动。
- **AUTH-GIT-2**（可选 push）：未获批、未执行。
- **AUTH-DEP-1**（W1 HTTP 组装建议 `node:http` 零新增依赖）：决策建议不变。
- **AUTH-SCHEMA-1**（W1 队列持久化追加式迁移 005_*）：按本轮分工由并行任务产出逐表 DDL/回滚/验收提案（`web-foundation-integration-schema-authorization-20261107.md`），本项未代拟、未实施，schema/migrations 零改动。

## 8. 开放项与边界（更新后）

1. ~~完整 `npm run check` 绿证~~ **本轮闭合**（§4，exit 0，原预算）。
2. W0 准出、契约冻结与 MAYNE-23 晋级：由 Codex 依据 ZCode 评审结论、精确哈希与本轮证据收口；W1 保持 backlog。
3. AUTH-GIT-1/2、AUTH-DEP-1、AUTH-SCHEMA-1 均未获批；AUTH-SCHEMA-1 待并行 schema 提案齐备后再审。
4. Linux／Windows、共享 main 工作根、真实模型/凭据/真实工作根、部署：未验，与仓库现状一致，不外推。
5. P3 ×4 台账沿用上轮记录 §8，本轮无新增、未扩大修复范围。
6. 本记录为门禁补跑证据，不改上轮集成记录的任何结论；`docs/reviews/README.md` 索引本轮未动（按指示不扩索引写入）。

## 9. 交付物

- 本记录（入库提交，仅此一个文件；补丁随评论附件）。
- `build/web-foundation-integration/`：`admission.json`（重新登记）、`hashes-20261107-r5.json`（哈希清单）、`authorization-package.json`；`build/web-foundation-integration/fullgate-r5/`：`full-check-r5.log`（原始日志）、`gate-result.json`（退出码/环境/前置/警告分类/关键测量）、`environment.txt`、`load-samples.txt`、三个前置日志。
- 以上全部随最终评论附件打包交付。
