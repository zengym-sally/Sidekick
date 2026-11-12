# C4 候选 `1d09811` 独立独审（Hermes，2026-11-09）

派工：MAYNE-24 评论 `01a1bffb`（Codex）。对象：`1d09811c3b8023eaa1bd1e541f594d68a2160a4b`（tree `c9784b08…dc61`，父 `090872a`），恰 `src/lib/web-api-client.ts` +78/−4（blob `127c9da`→`b4899e2`）。本审未写该文件。冻结契约哈希本审复算吻合：web-api/1 `61863271a82f46ed…`、text-intake `5982c062…`（@`b190f7c`）。

## 结论

**不通过——限「分钟截断」面**：`pointFromInstant` 把显式毫秒**静默截断到分钟**（实测 …:31.250 → 持久化 …:31:00.000，相差 5 250 ms），其注释声称「截断是必需的、带秒的 at 会被拒绝」经真实 HTTP 反证**不成立**——服务器对带秒 `at` 照单全收且逐毫秒往返。其余面（HTTP 桥接形状、省略首锚、去重/重放、时区）通过。修复方向已登记。

## 关键证据：分钟截断无冻结契约依据（真实 HTTP 对照）

- **冻结契约**：web-api/1 时间规格＝「ISO 8601 UTC **毫秒**（如 `…T12:30:00.000Z`）」——无任何分钟粒度限制；text-intake 契约仅规定「`sourceAt` 缺省按首次录入时间」。`precision` 枚举（`minute|day`）来自服务端实现（manual-items-service `normalizePoint`），不是契约要求。
- **服务端实读（`0536a44` normalizePoint）**：`at` 按完整 ISO-UTC-**毫秒**正则校验并要求精确往返；分钟交叉检查仅在 `precision==='minute'` **且** `localText` 命中 `STRUCTURED_LOCAL`（`HH:mm`，无秒）时触发。
- **真实 HTTP 矩阵（同一显式时刻 `2026-06-29T04:31:05.250Z`）**：
  1. minute 精度＋分钟结构 localText＋带秒 at → **400 拒绝**（「时刻与本地表达不一致」——作者注释设想的那一形）；
  2. minute 精度＋**带秒 localText**＋带秒 at → **200 接受，`at` 逐毫秒精确往返**（STRUCTURED_LOCAL 不命中 → 交叉检查跳过）。
  即客户端完全可以渲染带秒 localText 并**原样保真 `at`**；截断并非被迫。
- **候选桥实测**：`pointFromInstant(…31.250)` → `at=…31:00.000`；经 `organize_text` shim 真实提交 → `read_import_batch` 映射回 store 的 `sourceAtMs`＝**截断值**（输入 1782707465250 → store 1782707460000）——显式时刻被静默替换，且读回把截断值当成本体交还 store，调用方无从得知。违反派工判据「显式 ms 不得仅因格式化 localText 就静默换成另一个时刻」。作者注释中「Truncation is required, not cosmetic」的论证以偏概全（只考虑了分钟结构 localText 这一形），属**事实失实**。

**修法方向（登记给作者）**：`pointFromInstant` 保留 `at` 全精度（`at`=确切瞬间的 ISO 毫秒；localText 可按已登记派生规则渲染——带秒渲染或自由文本均过交叉检查），或在确有粒度意图时对亚分钟显式毫秒**明确拒绝**（本地 400），二选一；不得静默改值。已核的其余面不受影响。

## 通过面（真实 HTTP，运行树＝`cbb04f7` 完整 I＋恰候选文件 overlay，登记二进制 `5311ffa3…`）

- **HTTP 桥接形状**：wire 读侧绑定首 task 不可变 `input_ref`（`0536a44` sourceWire 实读）；读回经既有 `toDomainPoint` 桥回内部 ms；**store/Tauri 形不扩张**——领域 `TextSource` 仍是 `sourceAtMs: number|null`，点字段（`localText`/`precision`/`at`）不泄漏进领域形状 ✓。
- **省略/首锚**：`sourceAtMs == null` 时字段**不上送**，服务端首次录入语义保留（`anchorAtMs`＝首次录入时刻，标签如实）✓。
- **去重/重放**：同指纹复用（`reused=true`）、同 operationId 重放（`replayed=true`）均折叠回**同一来源、同一首锚、同一点**（四次调用含两次重放仅得 1 个 source）✓。
- **时区面**：`at` 为绝对瞬间、跨时区恒等；`localText` 按请求时区渲染（UTC vs America/New_York 不同墙钟）；非法时区（`Mars/Olympus`）显式 400 拒绝、绝不静默回退 UTC ✓。

## 边界

探针 9/9（随附件：探针脚本＋原始输出＋身份清单＋SHA256SUMS）；不跑完整 gate；合成时刻/凭据；运行后 tmp root 残留 0；候选字节未改。同帖其余派工（Kimi 来源判据修订、Pi 第四例、tracker/advisor 配置 404 修补）不属本审。MAYNE-24 保持 `in_progress`。
