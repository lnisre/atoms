# #85 生成进度验收

规格：[实施 #85](https://github.com/lnisre/atoms/issues/85)、[父规格 #83](https://github.com/lnisre/atoms/issues/83)，ADR 0011、0015、0016。2026-10-12 完成；不关闭父规格。隔离工作区 `issue-85-generation-progress/atoms`，Node 24.18.0、pnpm 10.12.1、Chrome、Next 16.3.6。整合 master `319d8d4`（#84/#86/#87），实际应用执行上限 480 秒；本任务未调整预算、返工上限、采用门槛或存储 schema。

## 实现与事实边界

对话区滚动容器外固定摘要：整理需求、编写应用、代码审查、准备预览；明确完成、进行中和待完成。使用已有调用角色、经验证交付、代码身份和当前代码审查；完整 artifact 校验之后才确认编写完成，TeamLeader 协调保留上下文。两次整体返工分别计数，保留需求完成，旧审查不能覆盖新代码。

计时来自本页面任务开始/终止观察，结束后固定；不比较浏览器与服务器绝对时钟。30 秒无进展且仍有 started 模型请求才说明等待。控制心跳、应用数据变化与秒级渲染不刷新进展。时间文本不进入 live region。进度不持久化，历史重开没有新任务或补造耗时。

生成结束与云端保存、试用副本准备、iframe load/失败独立显示。首次保存失败保留重试入口；候选加载成功才显示“可试用，未采用”；阻断、加载/运行错误不称可试用。生成失败不再误报成执行记录保存失败。角色及调用详情可展开，平台执行记录默认折叠。预览 key、数据与采用规则未改变。

## 验收矩阵

| 预期及来源 | 实际观察 | 证据与结果 |
| --- | --- | --- |
| #85 首次/修改真实阶段、不提前完成 | call completed 尚未交付时不完成；Engineer delivery 未校验 artifact 时不完成；角色交接不回起点 | `generation-progress.spec.ts`，通过 |
| #85 一次/两次返工、当前代码复审 | 两次分别显示次数/上限，需求持续完成，新代码待复审 | 同上，首次完整路径通过 |
| #85 连续计时、终态冻结、新任务重置 | 阶段/返工不重置；保存期间冻结；下一任务重新计时 | 同上，通过 |
| #85 30 秒、心跳、真实新进展 | 29 秒无提示，30 秒出现；7 次真实客户端控制心跳不刷新；数据编辑不刷新；调用完成清除 | 同上与 [长等待截图](assets/issue-85/long-wait.png)，通过 |
| #85 连接、试用副本、保存、加载 | 分别受控等待，正确命名；执行结束后保存不继续模型计时；load 前不 ready；15 秒 load 故障明确 | 同上，通过 |
| #85 异常矩阵 | limit/failed/clarification/unsupported 无代码结束；limit/Reviewer failure 有完整代码保留；连接失败分别有/无代码；保存失败/运行错误/执行阻断 | 同上，通过 |
| #85 候选与审查区分 | 可试用不等于采用；有问题/不可采用策略保留；无 terminal proof 下载但不能采用 | 本任务及 cloud-generation/cloud-regressions，通过 |
| #85 长历史、输入/iframe/试用数据保全 | 滚轮上翻后新事件不改变位置；停止/展开详情保持原 iframe、输入和计数数据；1440×900、1280×720 摘要/输入/停止入口在边界内 | [1280](assets/issue-85/fixed-summary-1280.png)、[1440](assets/issue-85/fixed-summary-1440.png)，通过 |
| #85 原生停止与迟到结果 | 真实网关→Next→Python/MetaGPT→离线模型，在第二次 Reviewer 等待时停止；观察32秒，无 terminal result、无停止后帧、保存内容不变；重开无新调用 | `cloud-native-stop.spec.ts` 2/2，[首次](assets/issue-85/native-first-stopped.png)、[修改](assets/issue-85/native-modification-stopped.png) |
| #85 历史/隔离回归 | 重开不再生成；采用不带回试用数据；历史恢复/撤销、日志/保存重试、未知证明与源码/iframe 保全 | cloud-generation、cloud-regressions、cloud-history、preview-document，通过 |
| #85 可访问性 | 阶段有文字状态，停止有名称；秒级耗时与等待秒数不置于播报整段状态的 live region | 本任务浏览器断言，通过 |

## 实际运行与失败记录

- 本任务最终浏览器 **15/15**，无跳过：[汇总](assets/issue-85/progress-final.json)。测试从公开界面提交需求，用已有云端 Auth/BFF 夹具及受控 WebSocket 事件驱动真实客户端验证、页面与 iframe；不调用真实模型。
- 合并 #84 后联合场次 **40 项，37 首次通过、3 失败**：[原始汇总](assets/issue-85/browser-merged.json)。两项是已记录的 opaque iframe 首次鼠标点击竞态；原样复跑通过。另一项为 load 故障注入不稳定，改在原生 iframe load 监听边界抑制通知后通过。对应 [3/3 复核](assets/issue-85/browser-followup.json)。没有用 Enter 替代失败鼠标断言，也不宣称已根治浏览器竞态。
- 更早失败保留在 `/tmp/atoms-85-ui/attempt1..3`；[首次失败摘要](assets/issue-85/browser-first-attempt.json)记录 WebSocket 安装时机/关闭码、文字空白、滚动同步和鼠标竞态，后续修正的是夹具同步，不伪造产品阶段。
- 原生浏览器 **2/2**，无跳过：[汇总](assets/issue-85/native-stop.json)。模型使用现有 `tests/team/fixture_transport.py`，真实监督进程/取消路径；Auth/PG 用明确的 `offline-cloud-provider.mjs`，真实公开登录与项目接口，不证明 CloudBase 或真实邮件。第一场证据保留 `/tmp/atoms-85-native/browser`，APIRequestContext 未发送本机 Secure Cookie，改用浏览器正常 Cookie 的公开 GET 后通过。
- Node **112/112**；Python 原生 **20/20**；lint、typecheck、生产 webpack build 通过。Python 在独立 `/tmp/atoms-85-native/venv` 安装锁定依赖与 MetaGPT SHA `11cdf466d042aece04fc6cfd13b28e1a70341b1f`，应用仓库的可选 LanceDB 包装补丁；pip check 通过。
- 新旧 UI 实例分别为本工作区专属 3285 dev、3287/3288 gateway，Doctor 校验源码与进程归属；完整 trace 留在临时场次，选定截图、结果和原生 Doctor 已归档。真实供应商质量、真实邮件/JWT/PG 和跨账号不在本任务受控进度验收结论内。

## 重跑原生取消

先按 verify-atoms 完整构建/prepare，并完成 Python 前置校验。用测试包装器调用已有 fixture_transport.py；仅对该本地实例设置 `CLOUDBASE_ENV_ID=synthetic-auth`、合成 Auth/artifact/signing keys、`DEEPSEEK_API_KEY=offline-test-placeholder`，通过 `NODE_OPTIONS=--import=<本工作区>/tests/helpers/offline-cloud-provider.mjs` 提供离线认证/云存储边界。启动实际 gateway 后运行 `TEAM_FIXTURE=1 TEST_BASE_URL=<实例> pnpm exec playwright test tests/browser/cloud-native-stop.spec.ts --workers=1 --retries=0 --trace=on`。该环境拒绝真实 provider 配置，不能在生产使用或称为真实云端验收。

## 发布

生产前核对：固定 alias 为 `dpl_7ozqqenrpi5BtNAyaJs8jK7qDdQQ`，sourceCommit `319d8d46ac06dcac9249961f5945758997f1adbb`。最终 PR、合并提交、发布身份及生产页复核将在 Issue #85 的交付评论补充。

已有 #84 限制：Vercel 项目拒绝超过 300 秒的托管超时设置，应用 8 分钟可能先被宿主终止；本任务仅跟随应用实际配置、不调整套餐或编排。#14/#18 视觉参考验收与真实模型质量不在本次完成声明内。
