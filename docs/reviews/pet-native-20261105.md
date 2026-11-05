# 桌宠交互、动效与菜单栏修复实施记录

基点 `0762613b3e7bfc5c23f7dd4e22e5acd1668f843e`。owner 在[设计 v2](../engineering/pet-interaction-design.md)两面评审通过后明确要求：“那是否可以开始实施了，如果可以就开始改代码吧。”本轮因此授权本地实施及设计内的隔离探针；未授权提交、推送、生产身份/依赖/schema/真实根或凭据变更。之前“只交付文档”的记录保留其历史含义，不作为本轮新的限制。

## 1. 当前范围与停点

按已评审的 R3 设计、D1–D6 与 P0 闸门推进。原生探针实际只枚举到一个 scale=2 的显示器；owner 随后明确回复“目前无法连接外屏”。多屏混合缩放、接缝及拔屏矩阵保持未验证，不能以纯函数或单屏通过替代。

另两次自动按住/拖动操作的探针命令处理时读到按钮已经松开，尚未取得可靠的受控拖动完成矩阵。没有证据将其归为环境问题。P0 **未准出**，不进入依赖它的正式半隐/动画/事件接线；当前 PetWindow 常驻栏仍未调整。没有把原生 API 可用当成用户体验已通过。

本轮先完成可独立验证的菜单栏图标修复，并留下后续可继续使用的隔离探针。这是执行顺序调整：图标不依赖 P0 的拖动、穿透或多屏结论，不改变已批准体验/验收；其余实施项未关闭。

## 2. 已实现的有界改动

### 2.1 图标

- 根因：普通/专用两条托盘装配均把相同 `[31,58,95,255]` 像素铺满 16×16。先把既有像素构造提取到两处共用的 `app::tray_icon::image`，保持旧表现，建立回归后再替换。
- 复用班班标志的身体、眼睛、笑脸和马甲，派生透明底单色 SVG；附带 18×18 和 36×36 RGBA PNG，编译期嵌入 2×资源，两条装配都启用 `icon_as_template(true)`。不改 Dock 图标、应用身份、专用路由或生产桌宠显隐规则。
- 锁定 tray-icon 0.24.2 的 macOS 装配将图像按比例设为 18pt；36px 输入可供 2×显示。新增图标无需运行时图片解码 feature 或新增依赖。

资源可用本机已有 rsvg-convert 重建（普通构建直接消费仓库中的 PNG，不要求安装它）：

```sh
rsvg-convert --width 36 --height 36 --output src/assets/brand/sidekick-tray@2x.png src/assets/brand/sidekick-tray.svg
rsvg-convert --width 18 --height 18 --output src/assets/brand/sidekick-tray.png src/assets/brand/sidekick-tray.svg
```

### 2.2 P0 载体

`pet-native-probe` 为显式 feature 门控的独立 Rust example：不调用生产 run/setup、LocalState、RuntimeState 或 app-data/bootstrap API；无生产命令或模型/工具插件，只开合成底层点击窗与透明宠窗，WebView 使用非持久模式。资产/脚本来自 tests/fixtures，主进程仅用内存状态。探针代码不会因普通包启动而执行。

读取实际 SVG alpha 生成命中掩码，宿主做窗口裁切和系统指针归一化；按 H 启用穿透检查。右键/Shift+F10 打开探针菜单，可选择左右半隐或隐藏，底层“显示班班”恢复。隐藏通过条件变量停止工作循环，退出唤醒清理；探针有最长十分钟生命周期。菜单关闭以 popup_menu 返回作为证据，选中仍由白名单事件处理。

拖动仅在本次左键按下已观察到时启动；使用 macOS CoreGraphics 的 `CGEventSourceButtonState(0,0)` 查询本次拖动松手，不注册全局输入监听、不记录指针轨迹、不申请输入监控权限。它只证明按钮状态，不证明窗口移动或取消原因，仍需 P0 实测。

新脚本名：`probe:pet-native` 构建隔离载体，`test:pet-native` 执行非 GUI 计算用例，`check:pet-native` 检查该 feature；后两项加入完整 check。原脚本名与测试过滤器不改。探针包复用既有 Profile Verify 测试身份，生产 tauri.conf.json/identifier 不改；构建后的载体和原始日志位于 build/pet-native-20261105，不入库。

## 3. 实际检查点与边界

| 检查 | 实际结果 | 证明范围 |
|---|---|---|
| 图标回归红证 `npm run test:tray-icon` | exit 101，0 passed/1 failed；明确报 `tray background is an opaque square` | 旧像素构造确实没有透明背景 |
| 同一回归修复后 | exit 0，1 passed/0 failed | 新图形有透明/不透明像素、单色黑通道、36×36尺寸及透明留白；不替代深浅菜单栏人工观察 |
| 探针裁切反例 | exit 101，2 passed/1 failed，`!shape.hit(-1.0,50.0)` 失败；加窗口边界后3/0 | 屏内裁切不能命中窗外像素，透明像素不命中；不是实际多屏/穿透通过 |
| `npm run probe:pet-native` | 两次实际编译、ad-hoc 签名完成并启动自有载体 | 不等于整个 P0 成功 |
| `check:pet-native` 初轮 | 三条 Clippy 错误（两处赋值排版、一处可合并 if），修订后 exit 0 | 不绕过 lint；终态以最终新鲜检查为准 |
| 聚焦回归 | 探针3/0、桌面宿主2/0；默认 check:rust exit 0 | 当前有界检查，后续源码修改后必须重跑 |
| 结构与类型初检 | structure exit 0：19类/8引用负例、199源/446引用；typecheck实际执行 | 最终结果另列，不以此替代完整门禁 |

单屏原生观察：真实窗口/AX 与图像可取得；首段 trace 有 mask-ready、transparent、hit-restored、底层点击以及 menu-open→Esc→menu-closed(ok=true)。同段另观察到 buttonDown=true 的 drag-start、仍为 true 的 API 返回、之后 false 的 drag-released；但没有完成所有受控拖动/取消断言，不以此关闭 H1。第二段两次自动操作记录 drag-request(buttonDown=false)，保持拒绝；不据此放宽安全判断。

这些交互来自探针的调试中间版本，后续补了左右裁切与清理；不冒称最终冻结源码已经走完原生动线。两段自有进程已退出，确认 PID 不存活。最终源码重建、独立交付评审、完整门禁及冻结结果待追加。

### 3.1 交付候选冻结 v1

12个源/配置/资产文件冻结在 `build/pet-native-20261105/source-freeze-v1.json`，清单 SHA-256 为 `70894c30c19a3a280be45ff66c307a17d32502f0b6d87fc749322aa0e0cecb9b`。设计v2与原调研字节未改；前轮文档改动保留。新一轮 `test:pet-native` 3/0、`check:pet-native` exit0、`check:rust` exit0；`typecheck` exit0，`check:docs` exit0（16文件/275链接），`git diff --check`及两份新JS语法检查exit0。

本轮代码按两面独立交付复核：`pet_impl_review_a` 检正确性/回归及范围，`pet_impl_review_b` 检架构/权限/数据/生命周期及载体隔离；二者为全新上下文、只读，不参与实现。正式结论及发现项处置待返回后追加；尚未运行最终完整门禁。

### 3.2 首轮发现与候选 v2

首轮 A/B 均 needs_revision，各一条 P2，没有 P0/P1：

| 面 | 发现 | 本轮处置 |
|---|---|---|
| A | 坐标读取失败时原生 ignore=false，但 shape.ignored 未同步；primary_monitor 失败也未恢复，之后 outside 样本可能跳过切换 | 采纳。统一几何 Option 与实际命中更新函数；读数/原生设置失败停止命中测试，恢复完整可交互姿态；成功的原生恢复同步缓存。新增“已穿透→读数不可用→outside”与设置失败回归 |
| B | 同一 poll 线程经排队 AppHandle::exit 不能保证菜单长开/原生 getter 阻塞时的600秒上限 | 采纳。独立 watchdog 在598秒请求正常退出，600秒仍未退出则仅终止当前探针进程。计时监督不调用窗口 getter，也不在监督线程等待日志或退出回调；阻塞正常退出的真实自有子进程验证强制退出码124 |

两条来源为独立静态复核；没有声称在原生GUI自动复现冻结v1的异常分支。补测实际调用修订后的恢复函数和 watchdog，不把新测试的首次语法编译错误算成行为红证。修正语法后，`test:pet-native`实际为6 passed/0 failed＋1 ignored，ignored仅是由父用例显式运行的子进程入口，不另计通过；`check:pet-native` exit0。

12源候选 v2 冻结清单 SHA-256：`02f40242281843eb13aa55c9d84d523f67abfaab3cac9c112b40909595ea92aa`，原件 `build/pet-native-20261105/source-freeze-v2.json`；较v1只有独立example变化，图标及生产接线字节未改。v1源副本另在 `source-v1/` 原样留存。两面复评及最终完整门禁待返回。

### 3.3 v2 复评与候选 v3

A 面 v2 复评 pass，坐标恢复 P2 在实际函数及回归层关闭；独立运行6/0＋1ignored。B 面仍 needs_revision：监督安装在初始化窗口/getter/日志之后，且“停止轮询”标志会取消硬期限，不能等同进程退出。属于同一生命周期 P2 的未闭合路径，不改写首轮或v2结论。

v3 将监督线程移到 main 的首段、generate_context/窗口/原生读取之前；正常退出请求使用以后才填入的 AppHandle，硬期限与 Probe.stop/暂停状态完全分离。主进程正常结束会自然结束监督线程；只停止轮询或退出请求卡住不能撤销600秒上限。补了真实自有子进程的“初始化主线程阻塞”和“停止轮询后退出仍阻塞”两条反例，连同正常退出与回调永久阻塞一起验证。

v3 实际 `test:pet-native` 为8 passed/0 failed＋1 ignored，耗时0.81秒；ignored仍是被父用例显式运行的子入口。`check:pet-native` exit0。12源清单 SHA-256 为 `f744cf141ec58f25357f10c20719f4635d40e992a53a906affd8d1df7118e43d`，文件 `build/pet-native-20261105/source-freeze-v3.json`；仍只有example较v1变化，生产图标接线不变。第三轮两面复评待返回，最终完整门禁未运行。

### 3.4 v3 两面通过与原生启退检查

A/B 第三轮均 pass。A 独立运行 `test:pet-native` exit0（8/0＋1ignored，0.80秒），核实际恢复函数和四个父用例；B 独立核 main 首段监督、不可被停止poll撤销的期限及OnceLock仅服务软退出，生命周期P2关闭。二者核12源完全匹配v3，未发现新增P0–P3；A的坐标恢复P2和B的期限P2均在代码/回归层关闭，未外推原生P0准出。

源码冻结后实际再次执行 `npm run probe:pet-native`，构建/签名成功。启动前原生inventory无既有Profile Verify/探针实例；按本轮生成的确切bundle路径启动，观察到本轮标题/AX、ready及mask-ready（112×112、opaque5866），仍仅一个2×显示器。选择本轮App菜单中的Quit，工具随后返回procNotFound，后台核本次ready PID确实不存活。此只签冻结源码的单屏启退冒烟，不签拖动/穿透/隐藏/多屏矩阵。

对应自有探针可执行文件 SHA-256：`f317d7b24b80f6647675dda8146bc93f9a0f6ec25f94920236fe45252ccfea9e`；源冻结前后未变。独立验证者 `pet_full_verification` 已获准只执行一次原始完整 `npm run check`，当前结果待返回；不在其运行期间修改12源。

### 3.5 首次完整门禁：fail；构建产物签名排查

独立验证者实际仅运行一次 `npm run check`，exit1；北京时间2026-11-05 09:04:22–09:08:16，234.098秒。在 `prepare-s33-lifecycle.mjs:17` 查询随包Node版本时，子进程SIGKILL/status=null。原件 `full-check.log` SHA-256 `546575a7fc412a0bfd2cc7f314943a66af5db09004727e79798661cfbea8ac6c`（99079bytes/1243行），计数与未执行清单在 `full-check-summary.json`，没有覆盖/修剪原件。

该次完成19组Node 801pass/0fail/0skipped、pet Rust8/0＋1ignored、verification37/0；typecheck、默认/探针/双验证特性Clippy、结构/文档守卫已通过。6条esbuild体积提示为既有基线。生命周期测试主体及后续runtime/native/Keychain/两包构建、排除、签名均未执行。12源/设计v2在该次验证前后一致，未因子集绿色把完整命令记为通过。

排查同一子进程PID的系统崩溃元信息，signal明确为 `SIGKILL (Code Signature Invalid)`；只提取该PID的诊断字段，不归档个人崩溃原文。原路径重复版本查询exit137；磁盘codesign验证通过，字节相同的新副本却能正常启动。普通新副本同inode重复复制的小实验未复现该失败，不能声称所有copyFile都会失败。

按[Apple更新可执行文件的指导](https://developer.apple.com/documentation/security/updating-mac-software)将**已忽略的本地构建产物**用同字节临时文件原子替换：inode从289185747变为300247375，SHA-256前后均为 `9d050fd455b56426e25d4d603c7c501cbb2630348e836cf221dcce748e90588a`；原版本查询恢复exit0（Node v24.20.0/arm64），原失败的生命周期准备命令也exit0。详细对照在 `node-signature-refresh.json`。旧inode签名缓存不一致是结合系统元信息和Apple机制的归因，不推断旧产物怎样进入该状态；没有改构建脚本、重签Node或关闭系统安全保护，也不把该产物刷新冒称源代码修复。完整门禁仍须在后续稳定版本重新验证。

### 3.6 owner 批准单屏/多屏分阶段

owner 明确选择“a：分单屏、多屏两阶段推进”：先补齐单屏拖动/穿透/菜单可靠证据，再实现当前设备可验功能，多屏/拔屏仍是最终验收必测，未完成不关闭S4/G1或对外发布。D1–D6不变，D7只改变实施前置顺序；[设计](../engineering/pet-interaction-design.md)修订v3、待两面独立评审。本段不提前把P0-S或后续正式功能记为完成。

### 3.7 单屏手动证据、拖离缺陷与独立准入

自动输入诊断PID59701两条记录均为页面buttons0、系统buttonDown=false、消息耗时1ms；不能当物理拖动。owner随后实际手动操作，前三条指定拖动均buttons1、CGtrue、API返回仍true、松手false且位置变化；第一条保持2459ms。额外还有一条真实手动轨迹，分段计数不与前三条混淆。

owner在PID79907的完整单屏矩阵发现“靠左/右隐藏后拖到中间仍隐藏一半”，原截图只含合成页面，原件留在 `detached-half-before.png`。根因是释放后保留旧dock，移出时再次按旧模式裁切。先从旧路径提取保留模式的释放决策，`test:pet-native`实际8pass/4fail＋1ignored（左/右拖离、32px解除边界、20px新吸附反例失败）；再按当前工作区重算dock、保持松手时形象位置并恢复完整布局，修后12/0＋1ignored，feature Clippy0。没有把未使用字段编译warning当作行为红证或通过。

owner在最新PID96373重测，明确确认“左右拖离后都保持完整”。独立核实者 `pet_single_gate_audit` 只读取真实日志、当前源码/锁定依赖和owner反馈后给 **pass，仅限P0-S当前单屏技术准入**：

| 项目 | 独立核实结果 |
|---|---|
| 最新拖动/取消 | 17开始、17 API返回、16真实松手＋1按住期间取消；取消代次后无旧释放/命中轮询 |
| 左/右拖离 | 左generation3物理x0→1044且dock0；右generation4物理x2640→1504且dock0，与owner视觉确认一致；后续有重复拖离dock0 |
| 穿透与重入 | 旧完整矩阵32下层点击/56恢复，最新10下层点击/22恢复；按钮/select点击不计入下层；实际源窗口点击和系统指针恢复共同取证 |
| 四态静态掩码 | 旧矩阵真实mask-ready：idle/found/remind/done opaque5866/5967/6285/6115；同一112²、alpha>16算法及宿主消费。remind/done区间未逐个记录下层点击，不声称四态逐个点击全通过 |
| 菜单 | 旧6组开闭（4组选择、2组取消），新2组开闭及左右各1选择；关闭后穿透/操作继续。生产三个动作及完整键盘矩阵待P1 |
| 坐标/恢复 | 仅单屏2×，物理工作区(0,66)/3024×1774；分别归一后的同屏坐标及越界回工作区有轨迹，不外推多屏 |

审计逐函数比较确认Shape::hit/refresh、button_down、layout和菜单机制与旧已留存源码一致，旧静态掩码/透传/取消证据仅复用未受影响部分；释放分类、位置及完整布局只签最新新鲜证据。3条系统诊断与JSON事件分开，不计通过或擅自归为当前缺陷。

当前P0-S另冻源/包清单 `p0-single-freeze.json` SHA-256 `68f151f34adce08275781c5a0b859a97116d3fce83bf2fcd15dfae30f2140664`，实际probe源码SHA `f501e1b7294379951e3483001bd28168da97a17a423d5c42c4d731c7d102b882`，对应包内可执行文件 `c233418f30cd366d303b376ae820f36f6d345bf943a6dc3bc38520a896aab715`。旧source-freeze-v3只覆盖早期候选，不覆盖本轮后续变化，保留原义。

该准入不签V2/V4/V8整项完成，也不签新动画动态命中、生产业务接线、完整门禁、安装/资源或多屏。依已批准阶段可进入P1，S4/G1保持开放。

### 3.8 构建替换与独立纯规则

后续为消除构建中原地覆写可执行文件的签名缓存风险，将原copy/chmod语义提取到实际两处调用的copyExecutable，再建立快速临时文件回归。旧语义exit1（3pass/1fail），明确失败“executable inode was overwritten in place”；改为同目录独占临时文件→0755→rename，修后4/0。输入缺失或发布失败保留旧目标并清理暂存；Runtime Node及本轮探针都使用该实际函数。生产二进制字节/依赖/identifier不因该构建方式改变。

一次试图通过重复完整构建检查inode的新增测试超时，未到达目标断言，不计为该缺陷红证；该未交付重型测试已移除，改用上述实际复制函数的四条确定性测试并加入完整check。未通过的旧full结果仍保留。

等待原生准入期间只实现了未接线的pet纯规则：候选静态标记、动效阻挡条件、根/版本/播放代次及领取期限/往返耗时。新增模块前命令因缺模块exit1，不冒称运行断言红；模块实现后 `test:pet-domain` 6/0、typecheck0。这些不计作生产PetWindow或业务接线完成。

## 4. 未验证与继续条件

- P0-S仅当前单屏技术准入已pass。新动画/生产窗口接线、完整菜单键盘/失败与隐藏矩阵、资源、混合缩放/负坐标/接缝/拔屏仍缺，不按原P0整项或V2/V4/V8整项通过。
- 菜单栏图标的实际深浅/选中/Retina安装包视觉、非开发机与全屏 Space 验收仍开放；SVG/PNG预览和像素用例不关闭这些项目。
- 正式待机/事件动画、右键独占操作入口、半隐与业务快照/反馈接线尚未实施；按owner已批准D7和v3.1准入继续P1。正式UI隔离载体新增规范v3.2待评审，不改变D1–D7或降低最终验收。
- 原生探针只用自有合成页面，无真实模型、飞书、生产钥匙串或用户工作根操作。原调研和已评审设计核心保留，S4/G1不关闭。

### 4.1 P1/P2 正式接线进行中

owner确认P0修复版“左右拖离后都保持完整”，作为该源版本的受控人工回归结果保留。正式接线已开始：store内部提交收据及权威pending查询、LocalState同锁排序观察、锁外投递、前端订阅/快照/单次领取和取消代次、固定pet窗口IPC、原生半隐/命中/菜单及真实Vue组件。生产无提醒来源，未加入模拟提醒或数量。

初步聚焦证据：`test:pet-store`5/0、`test:pet-state`4/0、`test:pet-client`5/0、`typecheck`及`check:rust`exit0。后续代码仍在变化，这些不是最终源冻结/全量门禁。客户端首轮4/1失败来自测试fixture只有setter却读取getter，改为保留deferred局部引用后5/0；不把该错误称为产品缺陷复现。Rust载体首轮编译发现实际API字段不符，仍在修订，不计为通过。

P0之后冻结的几何参数：112图案/192视口、20吸附阈值、32脱离阈值、450ms移出延迟；收放过渡由待验180ms调为即时布局＋绘制确认，避免可见轮廓与原生命中在中间帧错位。只对内部眼睛/胸前细节/图案笔画做CSS动效，不移动外轮廓；四个静态SVG仅追加命名分组，保留原视觉。此为规范允许P0后调节的初值，不改变D1–D7；原生新动画和资源证据仍待验。

构建辅助发现 `.gitignore` 的 `build/` 同时忽略新 `scripts/build/copy-executable.mjs`，现限为根 `/build/`，以使新测试和生产打包依赖能随干净检出取得。未stage/commit/push。

### 4.2 首轮生产接线评审与修订

A面为APPROVE_WITH_CHANGES：实际合成复现了在途领取失效未取消、渲染失败后残留成功姿态两条竞态；补失败用例后修复为7/0，随后补“已播放致意＋失效通知＋补读挂起”失败反例并修复为8/0，候选持续标记用例后9/0。A另指出候选标记被done替换、键盘焦点收起及菜单错误吞掉；现静态候选标记独立叠在不含本子的姿态中，键盘focus-visible通过有序policy归口，失败走恢复输入/完整姿态再暂停的统一入口。CloseRequested只在hide返回成功时改变状态；show成功即同步实际visible，后续focus失败不误记hidden。

原生输入写入进一步统一到UI线程：锁定tauri-runtime-wry2.11.4的setter在主线程内直接调用、其他线程排消息且不等实际执行；因此不在不同线程分别排输入消息再写缓存。所有生产set_ignore_cursor_events现只有一个UI线程入口，检查当前view序号再同步native调用和ignored缓存，旧回调不能开启穿透。角色几何/光标getter仍在状态锁外读取。新增旧输入回调和失败恢复单元反例；这不等于注入过真实OS API故障。

B面为APPROVE_WITH_CHANGES：新Pin遗漏mode/uid/nlink与config目录身份、菜单失败后仍穿透以及普通包排除负例缺失。权限反例在修前13/1失败（0777 config仍被接受），补私有0700目录/0600单链接文件/euid与config pin后14/0；菜单降级单元在新入口加入后通过；私有feature main、额外路径参数、S33混用的实际子进程拒绝两项通过且未创建新合成根。普通/S33发布资产标记排除和普通flag负例已纳入最终两包后的门禁，尚待运行；不会执行未经早拒绝标记核对的旧普通二进制。

### 4.3 正式UI第一轮原生有限证据

`probe:pet-ui`实际构建exit0；首次脚本误假设esbuild可直接解析（ERR_MODULE_NOT_FOUND），改复用项目已声明Vite，不新增依赖。宏初稿在库中两次generate_context造成_EMBED_INFO_PLIST重复，现普通/载体共享一个上下文生成函数；feature普通main仍在Builder前拒绝，独立载体注册最小handler。

本轮原生进程PID75360，真实Vue/CSS/SVG＋生产desktop/IPC＋新鲜合成SQLite；对应源码/包清单`build/pet-ui-20261105/source-v1.json` SHA256 `2d6b155c938b734696550613cbf6c9974a653034a71832dc89a276d6d712def3`，该副本保留于source-v1。只验了本轮动作：pet真实截图无操作栏；发布候选后权威pending0→1且UI本子/可访问名称出现；Shift+F10和右击均打开三个原生项；Esc关闭后焦点仍在角色；选快速录入后真实QuickEntry已加载，粘贴合成标题并保存后窗口收起。随后通过结束验收按钮退出，应用清单不再运行。主工作台入口在此载体仅为console，不将其记为工作台业务内容已验。

该轮原始日志15个可解析事件、短feedback0：不能据此宣称found/done动画已播。控制台获得焦点时需进一步核pageVisible阻挡；后续载体新增固定3秒后真实提交的有限场景，供先手动显示/聚焦角色再观察，不伪造pet状态或业务反馈。P1拖动/半隐/命中和新动画仍待后续真实操作；此前P0-S证据不自动关闭它们。证据源版本后又有守卫/失败恢复/焦点修订，不能把本节当最终版本全路径通过。

### 4.4 后续复评与冻结版本

A复评又指出松手计算后未在UI执行点复核generation，旧set_position可能覆盖新拖动；对应回调反例先7/1失败，后将位置setter集中为固定pet的UI闭包并核generation/dragging/stop及actual visible或明确Show预检意图。隐藏会撤销意图并增加代次。输入setter及失败降级也仅在UI线程同步更新缓存，几何getter不在状态锁中。普通window key焦点不能代替角色键盘焦点；现policy结合focus-visible、document.hasFocus及window focus/blur，鼠标开始拖动前先确认清除键盘焦点。

B复评的压缩资产正控实际证明旧检测无效：真实carrier rawMarker=false、HTML/JS key=true，直接断言明文标记会失败。修后entries第三项从受跟踪fixture现场编译压缩资产正控并检出两键，3/0；artifacts先检正控，再拒绝普通/S33任一标记或资产键，最后才做普通私有flag拒绝。该时点未运行最终两包负例，不据正控替代它们。

真实启动排查再补“初始化期间可见性变化”反例9/1，修为最后应用最新policy；同layout旧policy回滚反例10/1，修为policySequence也单调防旧响应。现client13/0含prepare/paint/native-start顺序及快速松手静默取消；host9/0含旧位置回调和主动隐藏不被系统观察恢复；隔离feature pet_18/0（这些组含重叠，不相加宣称独立总数）。native实际可见期始终运行穿透重入检查，不因WebKit pageVisible停止；pageVisible仍阻止装饰和前端校正。非拖动时观察原生隐藏并暂停，Focus可恢复wanted=true且实际重新可见的窗口，主动HidePet不会恢复。

最终A面APPROVE/pass，无新P0–P2；B面APPROVE/pass，无新P0–P3。两面均仅签代码与实际执行的合成反例；GUI/完整门禁/最终矩阵另验。A独立client13/0、state9/0；B独立entries3/0、正控选择用例1/0、root18/0、client13/0、结构211源/460引用及守卫负例通过，未自行启动普通GUI、访问真实根/凭据/模型。

当前原生包revision `0b9f8cd1-caca-4774-864b-c3ae0d9ec000`；准备脚本在编译前后核153项生产前端/Rust/配置/fixture输入，漂移0。manifest SHA256 `cb0f0d1f0e35349fe84cdc3774a4dd3e64337062a5a5865ca7036dc92d0a1c72`，包内可执行SHA256 `bc484f6f0dbf0d71b5d45c8e8120ddf22480a7884cf9575e5a6785b57629203a`。4种静态姿态的独立候选标记叠加区域（8×11，72/77）rsvg栅格alpha最小值均1，说明该固定区域在底图内部；不是WebKit/原生动态命中通过。

本版本进程PID3814：控制台实际显示clientReady=true、pageVisible=true、reducedMotion=false、painted=true；固定延迟候选提交成功，原始记录确有一次found notice（commitRevision2/playEpoch7），不能只据notice宣称CSS短动画被看见。当前透明点击计数0；自动坐标调用不能作为物理穿透证据。原生菜单的自动选项/Return组合曾让角色显示暂不可操作，Esc后主控制台实际打开；仍以物理菜单反馈核对，不静默计为原生全通过。owner已收到冻结正式包的拖动/透明、致意/持续标记、隐藏不重显及当前菜单栏外观复核请求，等待实际结果；CUA此阶段暂交控制，未结束验收。

独立完整门禁已于05:03:11.238 UTC启动一次，日志另存`full-check-v2.log`；冻结2551源码/配置/scripts/tests/fixture输入（含29未跟踪），SHA256 `fbfab8a5eabffac137d8a27a225b1918e0c103164d5bc4ae94822d9a48912349`，文档另列。执行期间生产代码未修改。已越过原签名失败准备点并进入原生Rust全库，最终两包/签名/资产检查与完整退出码仍待返回。旧full-check.log未覆盖。

### 4.5 独立完整门禁第二轮：测试预检失败

命令`npm run check`仅执行一次，13:03:11–13:15:01北京时间，710.735s，exit1；原始日志`full-check-v2.log` SHA256 `b0d2d884d123c1d04575a11cfea4ffdbf305aab51727e2d65ea8cd1c859271e4`（158605字节/2050行）。源码/config/scripts/tests/fixture2551项前后全部一致，文档变化已单列；旧full-check.log原样保留。

首败是`test:pet-ui-artifacts`第三项启动前预检要求完整flag字节。真实普通与S33 release均为flagRaw=false、Pet拒绝message=true；这里只确认实际字节布局，不直接归因为编译优化。失败发生在spawn之前，没有启动普通应用。前两项压缩正控与普通/S33无console通过，S33原生资产排除2/0、两包deep strict签名均通过；最后`test:mcp-native-launcher`未到。全链不能计pass。

实际分组统计：Node34组891pass/1fail/0skip；Rust6组375pass/0fail/4ignored（其中重复过滤组不当成独立测试总数），默认库294pass/0fail/3ignored。ignored为两个真实模型入口及Today/pet父用例使用的子入口；无真实模型请求。nonce synthetic Keychain只签合成读回/清理，不签生产凭据。工具链探针沿用已知host包装器；既有Runtime体积14条及Vite chunk2条已分类，无新增未解释警告。类型、默认/pet/S33 Clippy、生命周期与各运行时组实际已通过；完整组明细在full-check-v2-summary.json。

预检修订仅改测试，不改生产代码：先核Pet与已有MCP两条早拒绝message，再带Pet＋S33兜底flag执行，必须报告Pet早拒绝才继续单独Pet flag负例。旧普通包缺Pet message时在spawn前停止；忽略Pet而只走既有S33 guard时预检不满足，不运行Pet-only。不再要求被审阅分支的参数必须连续存于字节中。当前真实两包focused`test:pet-ui-artifacts`3/0，退出均在Builder/appData之前；测试修订独立复核及新完整门禁待执行。不会以本次focused通过抹去完整fail。

### 4.6 测试复评与第三轮完整门禁

B对测试预检小修订独立APPROVE/pass：实际artifacts3/0、语法与diff0；内存反例证实缺Pet marker零spawn、Pet未命中而S33兜底/超时时仅一次预检就停止，只有Pet预检命中才执行Pet-only，后者仍须exit2＋Pet拒绝信息。测试SHA256 `ea45de060c240906c7a742805b1f8cd8537f2e20f955ce0e076d8c55a970d13d`。生产模块与上一轮代码复评相同。

独立新完整`npm run check`于05:20:54.188 UTC启动，PID42366，日志`full-check-v3.log`；2551项输入冻结SHA256 `365135d2692f34549e5cab76914d1067d9fd56af9cc57eaf596bb285edf172e2`，与v2唯一源码差异是上述测试预检。当前已通过default Rust294/0＋3ignored及后段runtime，最终两包/入口/launcher及整体退出码待返回；本记录不预签通过。

### 4.7 P4已确认实现偏差与原生边界

作者补查geometry的选屏锚点后，A面独立计算确认：当前按192视口中心`windowX+96`选目标屏；left/right展开时角色真实中心分别为`windowX+56/+136`，应按`artworkLeft+56`计算。相邻等缩放工作区A=[0,1000]、B=[1000,2000]，left且windowX920时角色中心976在A，当前公式1016选B；right且windowX880时角色中心1016在B，当前公式976选A，非平局，current_monitor偏好不纠正。这里只是计算反例，不是真实多屏实测。

独立判断：这是P4明确待修项，不阻断D7当前单屏阶段（只有一个工作区时不会改变目标屏选择），不撤销限定单屏的代码评审。P4必须修正公式、补相邻屏/姿态反例并完成真实混合缩放/接缝验证后才能关闭，不得仅记成“缺硬件验证”；当前不签跨屏选屏符合规范。生产源保持冻结，未在本轮完整门禁期间修订。

四种静态资产另与HEAD逐一用同一rsvg112×112渲染比较，PNG字节完全一致，证明添加命名分组未改变静态像素；动态样式和原生命中仍须原生证明。当前已将正式包交给owner做物理检查，未收到结果，不能写成通过。

### 4.8 第三轮完整门禁通过与本轮收口

独立验证者完整执行一次`npm run check`，13:20:54–13:32:58北京时间，724.266s，exit0，执行到最后native-launcher76/0。Node35组968pass/0fail/0skip；Rust过滤组分别为pet-store5/0、pet-state9/0、pet-ui-root18/0、pet-native12/0＋1ignored、verification37/0、默认全库294/0＋3ignored；过滤组存在重叠，不将合计375当成375项不同Rust用例。4个ignored仍是两个真实模型入口及两个受父用例调用的子入口，未计pass；无真实模型请求。

类型、默认/pet/S33特性Clippy、结构19类/8引用负例（211源/460引用）、两包ad-hoc构建与deep strict签名均通过。普通MCP资源排除、普通/S33桌宠console资产排除、压缩正控、安全双flag预检后的普通Pet-only exit2均实际通过。nonce synthetic Keychain仅覆盖合成项。既有Runtime体积14条、Vite chunk2条及主机LINKEDIT包装器边界保留，没有新未解释警告。

2551源码/config/scripts/tests/fixture输入前后无增删和变化，冻结清单SHA256仍为 `365135d2692f34549e5cab76914d1067d9fd56af9cc57eaf596bb285edf172e2`；含29个未跟踪交付输入，新增ignored源码0。文档并发记账单列；末态文档另执行check:docs和diff检查。普通包可执行SHA256 `9afb314a294c416179000ba4e484718c6e5c22996745ccda7cd3fea69ff266bd`，S33 `7102376f17d09fa04f392c6de7cf2153e81b1343eea82e6df8dc946be2eeb927`。

完整原始日志`full-check-v3.log`（165153字节/2120行）SHA256 `25235dd64b27509cfaaac99ee2753099a8435f1b68800901e179ecae703b4f4c`；明细/前后核对在同目录full-check-v3-summary/before/after.json。前两轮失败日志未覆盖，不将focused修复结果冒称旧完整通过。无commit/push。

原生当前收口：PID3814的合成会话创建1851秒后检查已无该进程，官方CUA也确认应用已不运行；原始该段仍为13事件、1次found notice、下层点击0，未回收owner物理结果。不能称正式版拖动/穿透、动画目视与隐藏矩阵通过，后续需在相同源版本或说明差异的新包继续；每次启动会创建新合成根，原根保留，未删除。此前P0左右拖离保持完整的owner确认继续仅覆盖该原探针版本。第4.7节已知多屏选屏偏差、混合缩放/接缝/拔屏、1×/菜单栏深浅与选中、安装/全屏、进程树资源比较与clean checkout仍开放。机械pass和单屏代码评审不关闭S4/G1或对外发布。

## 5. 当前全部改动的提交前复核（2026-11-05）

owner本轮明确要求“审阅，并提交推送当前的所有改动，然后看下当前G1的遗留内容还有哪些”。本次授权包括全部53个非忽略的修改/新增文件，含原始动画调研；不包括发布、安装到真实使用环境、操作真实根/凭据或关闭S4/G1。模式为审阅后Git交付，非批量：一个已实现的桌宠纵向切片及配套证据，单提交可整体撤回；跨进程按R3复核。

提交前重新核实，当前2551项源码/config/scripts/tests/fixture与full-check-v3逐项相同，完整日志SHA相同，未用旧测试证明新源码。A面独立APPROVE/pass，仅签单屏阶段提交资格；实际新跑domain6/0、client13/0、state9/0、store5/0、copy4/0、typecheck、结构211/460、docs与diff检查通过。B面未发现本次提交阻断；实际root18/0、tray1/0、copy4/0及结构/docs/diff检查通过，并核对完整冻结、构建产物和私有入口/隔离边界；改动文本未发现真实密钥或个人绝对路径，保护区/依赖锁/迁移/应用身份无变更。

B面另发现P2非阻断限制：prepare-pet-ui.mjs的局部153项清单未包含package/lock、Vite配置、index.html、shared、准备脚本与profile identity fixture等实际输入，不能将“已列153项稳定”外推为全部原生构建/包装输入都已绑定。采纳该建议，列为下次原生构建与物理补验前的待补条件，须补齐输入及前后文件集合检查。本次源码交付以独立完整2551项冻结为依据，原生验收仍未完成；不据局部清单签GUI或clean checkout。该限制不改变正常生产代码行为。索引中过期的“P0未准出/尚未接线”说明已更新，历史记录原段保留；当前G1遗留归入产品05同一权威来源。

按main已配置上游origin/main操作，提交前安全fetch成功；远端无领先、本地此前4个提交尚未推送。本次将与新提交一起正常快进推送，不force、不改Git配置，也不自动向其他远端镜像发布。当前仅完成审阅与暂存前核对，提交/推送实际结果由后续Git命令核实，不在此预写成功。

提交前复评收口：B首轮APPROVE_WITH_CHANGES且无提交阻断，在上述P2限制准确记账后，限定阶段复核为APPROVE/pass，明确无需本轮先改脚本；问题本身仍未修复，不撤销下次原生构建前的补齐要求。A另独立核当前G1遗留表与既有规格/代码，APPROVE/pass，未发现阶段错分、完成状态夸大或新增承诺。末态文档check:docs16文件/277链接通过，代码/测试未变化。
