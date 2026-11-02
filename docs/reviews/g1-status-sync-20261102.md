# G1 当前状态同步与提交后核证补记

> 2026-11-02｜基点 `40505eafc77e04f32c24c195f78a3cf943362380`。本记录补充最新状态与历史核证，不改写旧记录；实施状态唯一来源仍是[实施计划](../product/05-第一阶段实施计划.md)顶部总览。

## 范围与证据

用户要求先修正文档过期描述，再继续G1。文档同步按R1批量处理，一次fresh独立计划评审APPROVE／pass；只更新状态指针、当前使用说明和证据索引，不改产品01–04的目标能力、代码、迁移、依赖、应用标识或权限。

本轮实读当前代码、三个实际提交、三个exactHEAD报告与原full报告，核对它们均为当前HEAD祖先；`git ls-remote --exit-code origin refs/heads/main`的实际结果为当前基点。命令原文／exit／计数与原报告bytes／SHA见[精选核证摘要](g1-status-sync-20261102/post-commit-summary.json)。原始证据仍留`build/night-20261101-s35/`，未复制大日志、截图或私有路径。

| 已纠正描述 | 当前事实／依据 |
|---|---|
| README与产品首页仍写tracker／advisor试跑及MCP调用未实现 | N1／N2试跑、stdio／HTTP工具链路及N3今日建议已落地；分层边界分别保留 |
| README把HTTP一概拒绝、schema只写v3 | 支持Streamable HTTP（含其SSE响应），旧独立SSE transport仍拒绝；新根v3、显式MCP升级v4、显式今日建议升级v5 |
| 05首页仍以808e268和MCP未实现为当前状态 | 当前基点40505ea，最近功能提交083f3b7；S3.5受控收口，S3.6／S4／S5未完成 |
| N1–N3索引仍写提交／exactHEAD待 | 三个提交已存在且已发布，各有全新精确HEAD检出后的标准准备与必要聚焦核证 |

## 历史功能门禁与精确提交

下表均为当时真实执行的历史结果，本次没有重跑这些完整check、两包或功能测试。

| 子项／实际提交 | 原完整check | 提交后必要聚焦 |
|---|---|---|
| N1 `951d500` | exit0；Node688；Rust227＋2真实模型ignored；双特性17 | 标准准备后11条命令全0；域65、Runtime5、配置10、tracker宿主4 |
| N2 `c783c85` | exit0；Node811；Rust237＋2真实模型ignored；双特性17 | 标准准备及9条聚焦全0；域183、Runtime10、配置14、advisor6／tracker4／formal终态1 |
| N3 `083f3b7` | fullAttempt2 exit0／739.519s；Node842；Rust270＋3ignored；双特性17，另预算child1 | 标准准备及7条聚焦全0；域26、Runtime5、today存储／宿主33＋内部child入口ignored、原MCP恢复case1；type／docs／fmt0 |

N3普通／专用包资源557／560、deep strict签名通过，ad-hoc未公证，来源为[既有独立完整摘要](s35-today-20261102/independent-full-summary.json)。三个exactHEAD轮都没有重跑full或两包；适用关系由原报告中的冻结输入、commit blob、owner执行位及前后稳定检查建立，不把聚焦当全量。

N1准备前cold结构失败与后续标准准备通过分列保留；N3 fullAttempt1实际exit101、原失败证据与精确时序缺口保留。后续pass不回填旧失败，不声称已穷尽其历史根因。

## 当前边界与本轮验证

N1–N3仅签合成资料、本机受控模型／服务、临时根和各自层次；Vue合成IPC不代原生。生产MCP钥匙串保持关闭，真实用户根未操作。本轮真实模型请求0，不读取真实模型配置或旧预算。

S3.4剩余H3、S3.5原生／真实环境、S3.6整体验收、S4／S5以及历史G0／安装分发／CI／第二台机器等未验保持开放。本文不把G0、G1或同事试用版标完成，也不扩展本轮提交／推送授权。

文档验证已实际执行：`npm run check:docs` exit0（15文件／216本地链接），`npm run check:structure` exit0（19类＋8引用反例自测；182源码／397相对引用），`git diff --check` exit0。另核对7份修改文档与2份精选新文件；产品01–04自第1节起的目标正文逐字不变，索引34行，新增证据无本机私有路径。纯文档同步未重跑功能测试／完整门禁，尚无S3.6新验收结论。
