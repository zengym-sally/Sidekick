# II 配置前置修订：四套件的合法合成模型配置（OhMyPi，2026-11-09）

> 派工来源：评论 `01a1be44`。窄转交四套 `web-text-intake-*.test.mjs` 中**配置构造处**及新增 `tests/fixtures/web-text-intake/model-config.mjs` 的最小修订权限。
> 交付提交：`7f3322b`（恰 5 文件：1 新夹具 + 4 套件的配置构造处）。

## 1. 派工要求的证明顺序：先证夹具非法，再共用有效构造

派工明确要求「先对照冻结配置 DTO／既有规范化器证明夹具哪里非法，再共用有效构造；若是 I 拒绝合法配置则报生产缺口，不能迎合错误实现」。结论：**夹具非法，生产不拒合法配置**——不是生产缺口。

### 1.1 冻结 DTO（`server/lib/config-store.mjs`，取自生产 `ef0f0d4`）

```
PROVIDER_FIELDS = id, name, apiFormat, baseUrl, auth, enabled, network, extraHeaders
auth            = { type, apiKeyEnv?, apiKeyRef? }        (type 缺省 bearer)
MODEL_FIELDS    = id, providerId, apiModelId, name, description, enabled, status,
                  aliases, limits, capabilities, reasoning, defaultParams, pricing
models.json     = { models[], sidekick: { version, defaultModelId, revision } }
agents/<id>.json= { agentId, revision, modelId?, preferences, supplementalInstructions }
```

### 1.2 夹具非法之处（五处构造点完全相同）

| 夹具写的字段 | 裁定 |
|---|---|
| `authMode: 'api_key'` | **不在** `PROVIDER_FIELDS`；且它是 `listProviders()` 的**输出**字段（`provider.auth?.apiKeyRef ? 'api_key' : 'env'`） |
| `credentialRefs: [{ref,status}]` | **不在** `PROVIDER_FIELDS`；同样是**输出**字段（`listProviders()` 由存活 provider 派生 status） |
| 缺 `name` | 规范化器 `:99` 要求非空字符串 → `validation_failed: 供应商名称无效。` |
| `apiFormat: 'openai_compatible'` | 下划线写法；规范化器缺省为 `'openai-compatible'`（虽被原样接受，仍统一为连字符） |
| `models.json` 顶层 `defaultModelId` | 规范化器读 `modelsRaw.sidekick.defaultModelId`，顶层值被忽略 |
| `agents/organizer.json` 用 `input:{preferences,…}` + `expectedRevision` | `normalizeAgent` 读顶层 `revision` 与顶层 `preferences`；`input`/`expectedRevision` 均不被读取，且缺 `revision` 会抛 `配置修订无效。` |

### 1.3 实证（不是推断）

用生产 `ConfigStore` 直接读两种形状：

- **夹具原形状** → `readModelConfiguration()` 抛 `validation_failed - 供应商名称无效。`
- **合法形状**（本夹具所写）→ `readModelConfiguration()` OK，`defaultModelId=controlled-organizer-model`；`buildModelSnapshot()` OK，`revision=r1`、`modelId=controlled-organizer-model`
- **撤销语义**：`auth.apiKeyRef` 指向未知引用时 `listProviders()[0].credentialRefs` 返回 `[{ref:'env:ABSENT_SYNTHETIC_KEY',status:'unavailable'}]`，指回已知引用恢复 `available`——与旧断言期待的 available/missing/available 迁移一致，只是改用合法字段表达

因此：生产**接受**合法配置，旧夹具**被拒**；按派工不迎合错误实现，也未把生产缺陷当借口。

## 2. 修订内容（最小面）

1. **新增** `tests/fixtures/web-text-intake/model-config.mjs`：
   - `writeControlledModelConfig(root, baseUrl, credentialRef)` 写合法 provider/model/agent 三文件；
   - `setControlledCredentialRef(root, credentialRef)` 以合法 `auth.apiKeyRef` 复现撤销／恢复；
   - 头部注释完整记录非法字段、输出／输入之别与证明出处。
2. **四处配置构造点**改为调用共享夹具（`http` 1 处函数、`queue` 1 处、`controlled-model` 1 处、`static` 2 处内联）。
3. **http 套件 4 处 `providers[0].credentialRefs = [...]` 突变**改为 `setControlledCredentialRef(...)`（原写法在 DTO 下是 no-op，撤销用例会静默失效）。
4. `pointProviderAt`（写合法 `baseUrl`）保留不动。

**未动**：断言、合法缺省 `timeZone`、严格时限类型负例、故障配置用例（未修成有效输入）、其余夹具、生产、package。

## 3. 聚焦验证（fresh run，非沿旧值）

前置全部实跑重建：`npm ci --ignore-scripts` exit 0；Rust 取自生产 `ef0f0d4` 后 `cargo build` 得 **2649408 B、sha256 `42af54b5…490fc2`**（与既往登记逐字节相同）；`probe:prepare-pi` provenance `ad702637`/`e89822b0`；organizer `08f32db2…`（2515908 B）、node `9d050fd4…`（121911744 B）；`npm run build` + `build:backend` exit 0。运行树＝`a02af9e` 导出 + 生产 server/Rust + 本修订五文件原字节。

**前后对照（同一运行树、同一前置，只换五文件）**：

| 套件 | 修订前 | 修订后 |
|---|---|---|
| `web-text-intake-http` | 5 过 / 19 败 | **13 过 / 11 败** |
| `web-text-intake-queue` | 3 过 / 14 败 | **6 过 / 11 败** |
| `web-text-intake-controlled-model` | 5 过 / 11 败 | **6 过 / 10 败** |
| `web-text-intake-static` | 7 过 / 2 败 | 7 过 / 2 败（不变） |

**零新增失败**：四套件的「修订后失败用例名集合」均为「修订前失败用例名集合」的子集（`comm` 逐名核对，四套件均为空差集）。http 套件新增通过 8 例，含两条 T-3（缺失凭据、夹具撤销），二者此前连配置都构造不出来。

## 4. 发现（不代签、不绕）

- **http T-2 推进到一处既存形状不匹配**：修订前 `GET /api/models` 直接 400（`供应商名称无效。`）；修订后返回 200，套件进而断言顶层 `revision`／`providers`／`models`，而生产实际返回 `{contractVersion, configuration}`，`revision` 在 `configuration.sidekick.revision`。这是**先于本修订存在**的测试／生产形状分歧，不在本次窄授权内，已如实登记，未改断言迎合、未改生产。
- 其余 11+11+10+2 失败属四套件既存业务面（多数需真实模型应答脚本与浏览器面），本增量不代签。

## 5. 边界

- 只改四套件配置构造处 + 新夹具；未改生产、其余夹具、package、DDL/Runtime、守卫。
- 未整跑四套件以外的套件，未跑完整 `npm run check`。
- 不改 `after`、不删用例掩盖挂起；清理挂起归 I 装配修复（`432305b` 已派）。
- 时间预算：聚焦命令用 `--test-timeout=20000`；四套件整轮时长为多例累计，未当单例超时。

## 6. 证据

- 提交 `7f3322b`（分支 `agent/ohmypi/mayne-24`）。
- 原始证据（gitignored，平台会回收）：`build/iicfg/`（运行树）、`/tmp/ii-*.txt`（修订后四套件 TAP）、`/tmp/base-*.txt`（修订前四套件 TAP）、`/tmp/dto-check.mjs`、`/tmp/fixture-proof.mjs`、`/tmp/revoke-test.mjs`。
- 复跑命令：

```sh
npm ci --ignore-scripts
# 运行树：git archive a02af9e | tar -x -C <run-tree>；再覆盖生产 server/ 与 src-tauri/（ef0f0d4）
#         与本修订五文件原字节
cargo build --manifest-path <run-tree>/src-tauri/Cargo.toml --release --bin web-backend-storage
npm run probe:prepare-pi && npm run build && npm run build:backend
node --test --test-reporter=tap --test-timeout=20000 tests/integration/web-text-intake-http.test.mjs
```
