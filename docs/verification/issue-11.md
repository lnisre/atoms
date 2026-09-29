# Issue #11：阅读记录真实闭环验收

2026-09-30（Asia/Shanghai）。[任务 #11](https://github.com/lnisre/atoms/issues/11) 的线上闭环通过，但首个模型产物有恢复后控件禁用的问题；通过一次真实对话修改修复并增加评分、筛选后完成复验。本次没有修改平台产品代码或服务端提示，没有重新部署。父规格 [#9](https://github.com/lnisre/atoms/issues/9) 保持打开。

## 基线与隔离

- 固定生产地址：[Atoms Demo](https://v0-test0-nine.vercel.app)。核对时绑定 `dpl_3c8byi7JK7THH8DGmB4LzLhNYvXf`，`production / READY / Node.js 24.x`，与 [#10 完成记录](https://github.com/lnisre/atoms/issues/10#issuecomment-5894422789) 一致。[部署证据](assets/issue-11/deployment-before.json)。
- [PR #12](https://github.com/lnisre/atoms/pull/12) 仍 OPEN，head `170828402e144dda0f9e87b2a5544e863a761913`，base `codex/m2-dialogue-review-fix`。[远端核对](assets/issue-11/pr-baseline.json)。部署元数据中的旧 `main / 3b586af` 带 `gitDirty=1`，不能据此将旧默认分支当作 M3；本地 21 个源码、测试和配置文件均与上述 M3 提交一致，且本轮结束没有变化：[基线哈希](assets/issue-11/source-baseline.json)、[保全结果](assets/issue-11/preservation.json)。
- 原主工作区保留在 `main`，既有未提交改动未整理、覆盖或切换。仅在以实际 M3 SHA 创建的独立工作树交付本次文档和证据，没有接管 M2 或合并 PR。
- 全新独立 Chrome 持久化配置 `/private/tmp/atoms-issue-11-reading-20260930`；未访问用户原浏览器或其他验收配置。实际业务操作视口 1440×900，候选阶段另查 1280×720。项目 ID `370fc6dc-723f-4329-b6d2-9af9c8e1b8f6`；该 ID 只标识此测试浏览器的本地项目，不提供跨浏览器共享。
- 原始模型 HTML 原样保存并运行，无请求替换、夹具响应、预置阅读模板、业务数据注入或手工 HTML 修改。只使用浏览器 UI 写数据；IndexedDB 查询和消息监听仅用于观察。模型凭据始终留在已有服务端，Vercel 凭据只在内存用于只读部署核对。

## 真实调用

完整需求、请求结构与时间见 [调用输入](assets/issue-11/call-inputs.json)，原始响应 HTML 见 [首次生成](assets/issue-11/model-1.html) 和 [候选修改](assets/issue-11/model-2.html)。

| 调用 | 用户需求 | 结果 | 服务端耗时 | 浏览器请求耗时 |
| --- | --- | --- | --- | --- |
| 1 | 中文阅读记录，书名、想读/在读/已读、添加、修改状态、删除、保存，初始无示例数据 | HTTP 200；基础操作成功，恢复后旧控件禁用，详见失败记录 | 13,155 ms | 14,251 ms |
| 2 | 同一项目增加未评分/1–5 分、状态和评分组合筛选；修复已观察到的恢复后控件禁用 | HTTP 200；候选与最终恢复复验通过 | 13,823 ms | 14,601 ms |

服务沿用请求标识 `deepseek-v4-flash`，两次 API 响应均为 `deepseek-flash`；未更换模型。第二次请求的 `baseHtml` 与第一次原始模型 HTML 完全一致，`context=[]`，请求未携带业务数据。没有自动重试或第三次模型调用。

## 条件逐项对应

| #11 条件 | 实际结果与证据 |
| --- | --- |
| 1. 新桌面固定地址真实生成阅读记录 | 通过，两次真实 HTTP 200；完整需求、模型标识、耗时和未修改产物均保存，见上表。 |
| 2. 两条记录、状态与基本功能，保存后恢复 | 添加“验收甲·三体”“验收乙·人类简史”；甲从想读改为已读，乙为在读；额外添加并删除“验收丙·删除验证”。五次正式保存成功。刷新后代码和数据逐项一致；首次产物恢复后编辑缺陷单独记录并修复。[保存](assets/issue-11/initial-saved-summary.json)、[刷新](assets/issue-11/initial-refreshed-summary.json)。 |
| 3. 同项目真实增加评分、筛选，旧功能与缺省值 | 两条旧记录都显示未评分，原状态保留，状态与删除控件已启用。给甲评分 5，按 5 分只显示甲；在读+5 为空，已读+5 显示甲；未评分显示乙。[缺省值](assets/issue-11/candidate-defaults-summary.json)、[筛选](assets/issue-11/candidate-filtered-summary.json)。 |
| 4. 试用增删改不影响正式数据 | 候选中给甲 5 分、新增“仅试用·不应写回”、将乙改为已读、删除甲。正式 project 与 applicationData 两条记录（包括时间、代码和原数据）与试用前完全一致。[隔离断言](assets/issue-11/trial-checks.json)、[试用快照](assets/issue-11/trial-mutated-summary.json)。 |
| 5. 只采用代码，随后正式使用与保存 | 点击采用并等待保存；最终 HTML 等于第二次原始响应，正式数据与采用前完全一致：甲/乙都在，甲已读、乙在读、两者未评分，试用新增消失。随后正式设甲 5 分、乙 3 分、乙想读；组合筛选实际可用，三次正式保存成功。[采用](assets/issue-11/adopted-original-data-summary.json)、[正式筛选](assets/issue-11/official-filtered-summary.json)、[断言](assets/issue-11/adoption-checks.json)。 |
| 6. 刷新、完整关闭重开、列表恢复，零生成 | 刷新后代码、状态、评分、修改记录逐项相同；关闭整个 persistent browser context 后，以同配置启动 Chrome，首页唯一项目可进入，恢复再次逐项相同。恢复过程中没有生成调用、没有业务保存调用。重开后还实际将乙改为已读再改回想读，分别保存，确认修复后可继续编辑。[恢复断言](assets/issue-11/recovery-checks.json)、[刷新](assets/issue-11/official-refreshed-summary.json)、[重开](assets/issue-11/complete-reopened-summary.json)、[重开后编辑](assets/issue-11/reopened-editable-summary.json)。 |
| 7. 桌面可达性与截图 | 1440×900 完成全部操作；1280×720 和 1440×900 的输入、iframe、采用、放弃及候选提示边界在视口内。查看截图确认无遮挡，低高度列表使用 iframe 内滚动。[边界](assets/issue-11/desktop-geometry.json)、[低高度候选](assets/issue-11/candidate-1280.png)、[1440 候选](assets/issue-11/candidate-1440.png)、[重开](assets/issue-11/complete-reopened.png)。 |
| 8. 真实失败记录与现有路径修复 | 首产物恢复后旧控件 disabled，实测 enabled 断言失败；数据保存恢复成功。通过追加修改请求让真实模型修复，没有手工替换产物或通用自动修复。[失败日志](assets/issue-11/failures.log)、[修复请求](assets/issue-11/request-modification.txt)。 |
| 9. 变更相应检查；无代码变更复用 T1 | 平台源码、提示和回归测试未改变。复用 [#10 工程与回归](issue-10.md#检查与失败记录)，不重复全套测试。此处手动追加的是应用修改需求，不是平台服务端提示变更。 |
| 10. 同源部署与请求计数、真实/受控区分 | 无重新部署，保持原生产域名与存储入口。本次没有受控模型调用；只引用 #10 已标明的受控回归证据。两次真实生成、10 次正式 save、4 次 trial save、6 次 load；恢复生成请求 0。[计数](assets/issue-11/request-counts.json)、[网络](assets/issue-11/network.json)、[消息](assets/issue-11/messages.json)。 |
| 11. 文档与边界 | 本报告及 README 补充操作说明。未加入阅读专用产品模块、后台、手机专项、快照、回退或新项目管理。父 #9 不关闭，不开始其他任务。 |

## 失败与复验边界

首次模型产物的 `initialize()` 先 `render()` 再 `enableEditing(true)`；`render()` 按当时 `appReady=false` 创建旧记录控件，而 `enableEditing` 只更新新增区，没有重绘列表。因此刷新后书名与状态正确恢复，但已有记录的状态/删除按钮禁用。这是实际生成应用逻辑缺陷，不是 iframe 鼠标事件未送达，也不是持久化失败。

第二次模型响应改为成功读取后先启用编辑再渲染。候选载入、采用重载、正式刷新、完整关闭重开均检查旧记录的状态/删除控件启用；重开后两次真实状态变化保存成功。首轮不能描述为全绿。平台没有自动识别或修复任意模型业务缺陷，用户仍需实际操作验收。

本轮正常鼠标添加、删除、采用均成功，未观察到 #10 的偶发首次 iframe 鼠标事件问题；不据此宣称该已知浏览器现象被修复。测试驱动启动时的非交互 stdin 提前退出、一次 REPL 顶层 await 语法错误、一次过长终端输入被清除，均发生在相关业务动作执行前；改用文件加载操作脚本继续，未重新生成或掩盖业务失败。没有运行时 `pageerror`。

## 计数与证据口径

[请求计数](assets/issue-11/request-counts.json) 来自被动监听。正式应用五次初始业务写入、三次采用后写入、两次重开后写入，共 10 次 `atoms:state/save`；候选四次保存只更新内存试用副本。六次 `load` 分别是初次生成、基础刷新、候选载入、采用载入、正式刷新和完整重开。IndexedDB 读证据的查询不计入应用接口请求，也不触发保存。两个模型请求是仅有的 `POST /api/generate`；项目首次保存与采用提交通过已保存 UI 和记录比较确认，不冒充额外网络保存请求。

原始调用包含业务代码但没有业务数据；产物 SHA-256 与最终存储 HTML 哈希一致。[调用摘要](assets/issue-11/calls.json)。纳入交付的 JSON 快照保留完整业务数据、可见文字及代码哈希，避免重复嵌入相同 HTML；原始完整响应、更多阶段截图和快照留在主工作区 `docs/verification/assets/issue-11/`。关键证据、脚本和操作日志随本报告提交，[清单](assets/issue-11/evidence-manifest.json) 可核对文件哈希。

复用 #10 的 lint、typecheck、服务端 10/10 和默认生产构建通过记录；其浏览器首跑和复验的差别仍成立（线上首跑 21/22，失败项单独复验 1/1）。这些是既有平台合同证据，不替代本次真实阅读记录操作，也不代表任意生成应用的成功率。

## 手动复现

1. 使用独立持久化浏览器配置打开固定生产地址，提交 [首次需求](assets/issue-11/call-inputs.json)，等待项目保存；使用实际模型生成页面，不复制本报告的 HTML 作为输入。
2. 添加两条带明确标识的书名，修改状态；可额外添加并删除临时记录。等待“应用数据已保存”后刷新，检查数据和控件都可用；模型出错时保留失败证据。
3. 在同一项目提交 [评分、筛选及实测修复需求](assets/issue-11/request-modification.txt)。检查旧记录未评分，实际操作评分和组合筛选。在候选增删改可识别的试用记录，确认平台提示试用不写回。
4. 点击采用并等待保存，确认试用变化消失且原记录保留；再在正式应用设置评分/状态并检验筛选，等待正式保存。
5. 刷新，然后完整关闭该测试浏览器，再用同一配置打开同一来源，从已有项目进入。检查代码功能、记录状态、评分与已采用修改记录，并在 Network 中确认此恢复阶段没有 `/api/generate`。

该样本证明一次经过手动纠正的阅读记录应用可以穿过当前平台闭环，不承诺任意需求的一次生成成功率、跨设备恢复或站点数据被清除后的找回。
