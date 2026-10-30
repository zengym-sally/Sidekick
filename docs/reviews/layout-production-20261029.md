# 配置页生产改造已落地，原生 GUI 补验保留

2026-10-29 开始，2026-10-30 收尾。版本0.3.0。范围来自owner已确认的[布局原型](../../design/layout-review/index.html)与[实施计划§14](../product/05-第一阶段实施计划.md)。本轮未提交、未推送；未改品牌，未提前做S3.2或S4，目录迁移继续S5。

## 1. 公共表单和三类配置页已接到真实代码

| 范围 | 本轮结果 |
|---|---|
| 公共表单 | `src/components/ui/`提供13个Vue公共组件及控件关联适配：输入／密码／多行、下拉、日期时间、数字、复选／开关、路径、按钮、字段／禁用域／保存栏。TDesign复用与语义HTML结合，不引入表单引擎 |
| 日期时间 | UTC civil日历与独立小时／分钟，按应用时区解析；避开设备时区的DST规范化。中文、仅日期、清空／取消／确定、键盘与焦点恢复统一 |
| 设置 | 紧凑标题与页签，短分组行，当前对象固定保存／放弃。个人昵称和称呼独立；路径尾部选择／打开图标组成一体，选择明确未开放 |
| 统一时区 | 复用`config/app.json`的timeZone，冲突保护、原子保存、写后读回。已有UTC时刻不平移；仅日期保留civil日期。新输入／整理／修改／试跑在日期规则未确认时受阻；来源重试保留原快照 |
| 模型服务 | 多供应商／多模型GUI、内联模型编辑、独立草稿与未保存模型列表入口。移除JSON导入UI；保留双层文件、未知非秘密元数据和凭据引用。版本校验在写新Key前执行 |
| 模型调用 | 测试当前所选的已保存模型，不改全局默认。上下文／输出、采样和推理参数接入实际Runtime；区分服务默认、明确关闭和具体强度，不支持的组合明确报错。价格只作本地记录 |
| 智能体 | 三角色紧凑切换、配置／隔离试跑双栏、底部保存。恢复默认先成当前角色草稿；结果绑定已保存快照，脏配置不可试跑。另两角色试跑仍未开放 |
| 现有动线 | 手工、文本、候选编辑、筛选及Inbox批次使用同一公共控件；批次与整理按钮同高。AI候选仍经签收才入正式事项，未重写签收／去重契约 |

原先45处分散表单声明已迁入公共组件或按已确认需求移除；当前生产页面直接`select/input/textarea`声明均为0，组件内部保留语义HTML，见[迁移盘点](layout-production-20261029/controls-migration.json)。

普通控件38px、圆角8px，局部紧凑操作30px；入口浅琥珀，提交实心琥珀，错误砖红，焦点墨蓝。多行占位字也统一为现有muted令牌，消除Tailwind默认50%透明度的差异。无新增生产依赖、数据库迁移或vendor改动。

配置就绪与产品权限是不同概念：本轮仅阻止使用未知配置的新任务，没有增加外发授权／权限管理功能。根配置是当前时区权威来源，bootstrap中的初始时区副本不反向覆盖它；冷启测试已覆盖。

## 2. 先失败、修复、独立复核，再运行最终门禁

实施方案独立首轮提出civil控件被设备时区改写、Pi默认推理被转成关闭两项Major；修订后APPROVE。交付首轮BLOCK，发现时区未知仍调用、草稿被读回覆盖、冲突缺恢复入口、新模型草稿不可回入、auth元数据丢失、ARIA空值，共1项P1／5项P2。全部补反例并修复，第2轮APPROVE。

第3轮定点检查TDesign数字控件的默认SVG重复ID：通过公开globalConfig.icon复用原有加／减图标，不改第三方。独立SSR验证两个数字控件的重复ID为0，APPROVE，业务结论继续有效。

最后浏览器补出“冲突后放弃草稿会清空错误文字”的展示边界：恢复入口改由未就绪状态决定，错误文字为空仍可读回；同时修正占位字令牌。这些局部展示修正做了定点浏览器、类型及最终构建自检，不把作者自检称为新增独立业务评审。

## 3. 实际命令与结果

| 检查 | 真实结果 |
|---|---|
| `npm run test:layout-domain` | 14/14通过；含时区未知屏障／重读／冲突、首建未知结果恢复、元数据及实际Vue renderer的ARIA更新 |
| `npm run test:s1-store` | 48/48通过；含新增时区持久化／读回／冷启、修订检查、指定模型准备、嵌套auth文件往返与旧事务 |
| `npm run test:layout-runtime` | 2/2通过；包含OpenAI兼容／DeepSeek三态共6组最终请求及上下文预算不足反例 |
| `npm run check` | exit 0，JS84＋Rust51通过，2项真实模型测试按原配置ignored；类型、fmt、Clippy、工具链与bundle smoke通过 |
| `npm run build`／最终原生beforeBuild | exit 0；最终JS602.28kB（gzip195.07kB），CSS148.97kB（gzip19.90kB） |
| `npm run build:layout-verify` | exit 0，生成隔离macOS arm64验收包，版本0.3.0、`com.sidekick.layout.verify` |
| `codesign --verify --deep --strict` | exit 0；ad-hoc签名，未公证，不作为正式推广发行结论 |
| 文件与链接检查 | 无新增依赖；锁文件／品牌tokens与本轮起始哈希一致。最终指纹与检查见本目录证据 |

新增测试取得过预期失败：缺实现、遗漏Temperature、未知首建恢复、未知时区调用／草稿覆盖、冲突就绪及auth丢失。通过结果均来自实际执行，不使用旧S3.1的116项结果替代本轮门禁。

原始记录：[check.log](layout-production-20261029/check.log)、[native-build.log](layout-production-20261029/native-build.log)、[原生产基线](layout-production-20261029/start-hashes.json)、[原生包元数据](layout-production-20261029/native-artifact.json)。构建有单chunk超过500kB提示；本轮未扩展拆包优化。未访问真实模型／飞书业务服务，不把本地受控HTTP当作真实厂商实测。

## 4. 浏览器验证的是生产Vue，IPC资料全部合成

使用项目`npm run dev:profile-ui`，不是HTML原型。九组矩阵覆盖通用／模型服务／智能体与1440×1000、1240×820、640×900：均无页面／内容横向溢出、保存栏可见、DOM重复ID为0；本轮浏览器warn／error为0。详情：[browser-observations.json](layout-production-20261029/browser-observations.json)。

实际走查：首个供应商＋模型、第二个服务／模型、参数保存与当前模型测试；跨供应商返回未保存模型；角色模型覆盖、隔离结果、脏配置禁试跑；手工日期保存与上海→东京17:00→18:00显示转换；日历方向键／Esc分层／焦点恢复；时区未知阻止新输入及试跑、放弃后仍可读回；模型冲突放弃／读回／重存；文本→3候选→人工签收→3正式事项。隔离试跑后正式事项仍为3，没有借预览入库。

Inbox批次及入口按钮均38px、底边相同，不再重复时区提示。公共控件也用于现有事项页面；本轮未扩大为候选卡片信息密度的全面重排。

截图均为合成夹具，不能用图片中的“连接通过”证明真实模型：

- [通用1440](layout-production-20261029/general-1440.jpg)、[模型服务1440](layout-production-20261029/models-1440.jpg)、[智能体1440](layout-production-20261029/agents-1440.jpg)
- [模型1240](layout-production-20261029/models-1240.jpg)、[模型640](layout-production-20261029/models-640.jpg)、[智能体640](layout-production-20261029/agents-640.jpg)
- [日期弹层](layout-production-20261029/date-time-1280.jpg)、[未知结果](layout-production-20261029/settings-unknown-1240.jpg)、[冲突恢复](layout-production-20261029/model-recovered-1240.jpg)、[候选页](layout-production-20261029/inbox-1440.jpg)

## 5. 原生启动证据和未验分开保留

最终包已验签并启动；setup诊断声明mainVisible=true，进程运行。原生工具抓取界面返回ScreenCaptureKit -3811（捕捉流无法开始），未取得本轮原生GUI证据；[native-startup.json](layout-production-20261029/native-startup.json)明确标注未观察。没有用窗口API成功、浏览器替身或Rust单测冒充原生操作验收。

以下继续待验，不关闭原有表项：原生WebView下的日期／下拉完整键盘动线、原生GUI密钥输入与替换、配置页完整冷启恢复与取消／强退；以及历史S0／S1／S2／S3.1留下的多屏、全屏空间、通知、桌宠等缺项。此前已经取得的S3.1原生证据仍保留，不因本轮捕获失败而改写。

隔离包不会打开普通包的工作指针；本轮未自动读取或迁移用户真实根。为原生联调准备的1493本地合成服务已停止，未据此宣称完成原生模型联调。验收包保持开发用途，真实模型需在GUI配置。

## 6. 交付边界

原S3.1未提交改动完整保留；本轮变化清单及新增来源在[changed-paths.json](layout-production-20261029/changed-paths.json)，最终源码／证据指纹见[artifact-hashes.json](layout-production-20261029/artifact-hashes.json)。没有修改原v0.2，没有新增AGENTS，没有提交／推送，没有新增Skills或MCP产品接线。

本轮结果：生产改造与分层验证完成，带上述原生补验限制。S3.2、S4、S5和可推广发行验收仍按原计划推进。
