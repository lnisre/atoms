# Issue #5：多轮候选修改与隔离试用

2026-09-29。状态：本地实现、生产部署、真实多轮模型及隔离试用验收完成。#5 已关闭；#4 与 #6 未完成。初次部署权限阻碍和模型产物失败均保留记录。

## 实现

- 原项目工作台新增追加需求、本轮成功对话、等待秒数、可手动重试的失败提示及放弃入口。生成时原预览仍可操作，后续失败保留已有候选。
- `/api/generate` 保留首次生成请求与输出合同，修改请求增加 `modification`、`baseHtml`、`context`。第一次使用已采用代码，后续使用最新候选。完整传递原需求、修改需求、基础代码及本轮成功修改需求，不向模型附带实际业务数据副本。
- 原需求和本次修改分别最多 4000 字符；基础 HTML 最多 500000 字符；上下文 JSON 最多 32000 字符；原始请求最多 3300000 字符。超限明确拒绝，没有截断或自动丢弃上下文。
- 修改提示要求保留既有功能和数据形状，为旧记录缺少的新字段提供默认值，使用既有 `window.atoms`，明确试用的会话边界。没有自动修复、预置成功、模型重试或 DeepSeek CLI。
- 候选代码、成功对话与试用副本仅保存在 React 会话中。第一轮成功后读取已提交的正式数据并复制；读取失败不开始空试用。后续修改保留试用副本。
- `AppPreview` 的数据用途由父页面绑定。正式预览继续使用原 IndexedDB；试用仅修改绑定原项目 ID 的内存副本。保留 `contentWindow`、opaque origin、随机 channel、读后写和串行请求保护。版本切换重新挂载 iframe，清理旧监听和队列；旧 channel 无法写入正式数据。
- 放弃或离开项目清空候选、试用数据与对话；刷新/重开从原存储读取已采用应用。没有新增正式项目、存储迁移或候选持久化。
- 未实现 #6 的采用与持久修改记录。试用更新不等于正式保存，界面明确暂不支持采用。

## 按验收项记录

| #5 条款 | 证据与结论 |
| --- | --- |
| 原项目追加修改、不另建正式项目 | 浏览器测试保持项目 URL，结束后列表仍为 1 个项目；线上两个项目各自保持原 ID |
| 原需求、本次修改、明确基础代码与上下文；长度边界 | 9 项服务端测试；浏览器请求断言；真实调用的第一轮 base 精确等于正式 HTML，第二轮精确等于第一轮候选 |
| 完整 HTML、固定状态接口、sandbox、服务端密钥 | 真实产物均为完整文档，通过原 sandbox 运行；受控合同与隔离回归通过；没有修补或替换模型产物 |
| 成功不覆盖正式代码/不持久保存对话 | 试用前后比较整个项目与业务数据记录完全一致；恢复后没有本轮对话 |
| 副本隔离与读取失败保全 | 试用增删改后正式快照不变；本地与生产受控复制读取失败后，原应用仍可用并可手动重试 |
| 旧 iframe/旧通道保护 | 放弃后新 iframe 使用旧候选 channel 发送保存消息，刷新后正式数据不变；跨源伪造和项目隔离回归通过 |
| 生成/错误/未采用/会话边界反馈 | 受控浏览器断言；真实截图展示“候选试用 · 未采用”和“试用数据已更新”，没有冒充正式保存 |
| 真实两轮优先级/筛选/顶部布局，原功能和默认值 | 原始 M1 真实生成项目两轮直接通过；旧已完成任务仍完成且默认中优先级；第二轮保留第一轮高优先级试用任务，筛选在输入区上方，添加/完成/删除/筛选均通过 |
| 真实试用增删改不影响正式代码/数据 | 两个生产项目逐次精确比较完整正式记录；新增标记、删除原任务、改完成状态后仍一致 |
| 放弃、刷新、关闭重开恢复原应用 | 真实候选中分别验证；完整关闭 Chrome 并用原配置重启，从已有项目进入，候选/试用数据/对话均不恢复，恢复请求数 0 |
| 失败/超时结束等待并保留已有候选、可重试 | 本地/生产受控 502 和客户端超时回归；线上向真实候选注入一次明确标注的受控 502，候选 srcdoc 不变，随后放弃恢复原应用 |
| 服务端、浏览器、M1/保存时序、lint/typecheck/build | 服务端 9/9；本地与生产浏览器各 14/14；lint/typecheck、Webpack 本地生产构建和 Vercel 默认 Turbopack 构建通过 |
| 固定生产地址真实验证与说明 | https://v0-test0-nine.vercel.app ，以下 READY 部署、真实调用与截图；README 已更新。#6 的采用未实现，M2 尚未完成 |

## 检查日志

Node.js 24.18.0；Next.js 16.3.6。

- `pnpm lint`：[通过](assets/issue-5/lint.txt)。
- `pnpm typecheck`：[通过](assets/issue-5/typecheck.txt)。
- `pnpm test`：9/9，[日志](assets/issue-5/server-tests.txt)。
- `pnpm exec next build --webpack`：[本地生产构建成功](assets/issue-5/build.txt)。默认 Turbopack 在本机遇到 CSS 编译子进程端口权限错误 `Operation not permitted`，沙箱外重试仍报错；没有把它记为本地通过，也没有修改默认构建命令。Vercel 的默认 `pnpm build` / Turbopack 构建成功，见部署日志。
- 本地 `TEST_BASE_URL=http://localhost:3105 pnpm test:e2e --workers=1`：最终 **14/14**，[日志](assets/issue-5/browser-local.txt)。
- 生产 `TEST_BASE_URL=https://v0-test0-nine.vercel.app pnpm test:e2e --workers=1`：**14/14**，[日志](assets/issue-5/browser-production.txt)。包括 M1 保存时序的真实旧产物回放，受控测试不替代下述真实模型调用。
- 最初几轮测试日志仍保留：新增测试最初匹配到 Next.js 空 route-announcer alert，已收窄到对话修改区域；夹具初始化的首次鼠标点击偶发只到达 iframe 元素，M1 既有事件诊断也记录过该 headless Chrome 首帧命中竞态。初始化添加改为真实键盘激活按钮；后续业务点击、完成/删除和保存锁断言仍保留。没有合成调用绕过桥接，也没有掩盖模型错误。首次/第二次/第三次及单项复核日志在同目录。
- 本地工作台在 390px 视口检查 `scrollWidth=390`，无水平溢出；[桌面夹具截图](assets/issue-5/local-candidate.png) / [移动端夹具截图](assets/issue-5/local-mobile.png)。

## 部署与权限

核对原绑定项目 `v0-test0` / `prj_eErnQuAz4P719xKTyuT6XT2Qu5ab`，Node `24.x`、框架 `nextjs`。部署前生产版本为 `dpl_MGPnkBGuHnGZks6ZNDh7SHRkuRm8`。凭据按项目说明解析，只在子进程环境中传入，未打印值、未进入产物或运行时配置。

第一次部署 `dpl_2jJpwyEciyYXkRPWT1KWEGDWsyHE` 返回 **BLOCKED / TEAM_ACCESS_REQUIRED**，当前提交作者没有部署权限，`isVerified=false`、`alwaysRefuseToBuild=true`。[原因](assets/issue-5/deployment-block.json)、[首次部署日志](assets/issue-5/deploy-blocked.txt)。当时向 #5 留下阻塞记录并保持打开。

用户随后回复“授权了”。重新部署成功：**`dpl_5dBLgx56rX12Tt5gPDRMqADijCAV` / READY / production**，固定别名包含 `v0-test0-nine.vercel.app`。[元信息](assets/issue-5/deployment-ready.json)、[部署与远端构建日志](assets/issue-5/deploy.txt)、[控制台](https://vercel.com/lnisres-projects/v0-test0/5dBLgx56rX12Tt5gPDRMqADijCAV)。没有更换作者、隐藏 Git 或绕过权限检查。线上浏览器直接打开应用，无 Vercel 登录跳转。

## 真实模型验收

### A. 原始真实生成、已有完成任务的 M1 项目（主要业务验收）

原项目 `e5052705-847c-4858-be72-2b7d57d172c6`，浏览器配置 `/private/tmp/atoms-m1-save-fix-live`。原需求为“做一个支持添加、完成、删除任务的待办应用。中文界面，清楚区分已完成和未完成任务，适配手机。”正式数据保留一条已完成的 `真实新产物第一条`。

原始生成来源见 [M1 调用记录](assets/m1-save-fix/new-generation.json)，本次读取的正式 HTML SHA-256 与该记录的 `08d073287eb68695e1e5744d5ab764f1ee41fcfd2bbeff063577b7b31dbbe719` 一致。未重新生成、导入或清理正式项目。[本次基线](assets/issue-5/native-m1/before.json)。

| 调用 | 需求 | 模型响应/耗时 | 结果 |
| --- | --- | --- | --- |
| 1 | 增加任务优先级与筛选 | deepseek-flash / 19.106s / HTTP 200 | 基于原正式 HTML；旧完成状态保留，新字段默认中；创建高优先级 `原生M1-试用新增` |
| 2 | 把筛选放到顶部 | deepseek-flash / 18.526s / HTTP 200 | 基础 HTML 精确等于第一轮候选；携带第一轮需求；高优先级试用任务与旧完成状态保留，筛选位于输入区上方 |

随后真实操作：高优先级筛选排除旧中优先级任务；切回全部；把原任务标记为未完成；完成试用新增任务；删除原任务；新增低优先级 `原生M1-第二轮新增`。各项行为成功，正式代码及 `{ tasks: [{ text: '真实新产物第一条', done: true, ... }] }` 始终与基线完全一致。

点击放弃后原应用、原任务与完成状态恢复，两条试用任务和本轮对话消失。

证据：[调用元信息与基础版本校验](assets/issue-5/native-m1/calls.json)、[第一轮 HTML](assets/issue-5/native-m1/candidate-1.html)、[第二轮 HTML](assets/issue-5/native-m1/candidate-2.html)、[交互结果](assets/issue-5/native-m1/behavior.json)、[通过截图](assets/issue-5/native-m1/passed.png)、[放弃恢复](assets/issue-5/native-m1/discard.json)。HTML 是原始响应，未直接修改。

### B. 旧 M1 真实产物回放项目（额外故障与会话边界验收）

项目 `fc75ddb2-400a-431d-b384-2cf57722bed7`，标题 `M1 修复前复现`，配置 `/private/tmp/atoms-m1-save-fix-before/browser-profile`。它在先前保存问题复现中载入了真实 M1 生成产物，因此原项目模型元信息为 `real-artifact-replay`；本次的候选修改全部真实调用生产模型，没有拦截生成成功响应。三条正式任务为 `关闭窗口第一条`、`旧项目修复第一条`、`旧项目修复第二条`，均未完成。[部署前基线](assets/issue-5/before.json)。

| 调用 | 需求/耗时 | 实际结果 |
| --- | --- | --- |
| 1 | 增加任务优先级与筛选 / 17.691s | 优先级、筛选、添加、完成可用；**删除失败** |
| 2 | 把筛选放到顶部 / 16.173s | 基于第一轮完整代码，布局与前轮功能/试用数据保留；**删除仍失败** |
| 3 | 界面明确追加“删除任务按钮没有真正删除记录…” / 16.777s | 模型修正删除；添加、完成、删除、筛选和顶部布局复测通过 |
| 4 | 放弃后重新提出增加优先级与筛选 / 17.889s | 基于原正式 HTML，上下文为空，旧记录默认中优先级 |
| 5 | 把筛选放到顶部 / 15.649s | 基于第 4 次候选；两轮业务场景完整通过，无额外修正请求 |
| 6 | 改标题为“关闭重开候选验收” / 13.731s | 刷新后基于原正式 HTML，生成用于关闭重开检查的明显候选标记 |

响应模型均为 `deepseek-flash`，HTTP 200；这不代表每次业务正确。前两次删除错误来自模型重赋临时状态对象的数组却未更新运行时数组。平台没有自动修复或自动重试，也没有修改生成 HTML；第 3 次通过可见追加需求重新真实调用。失败记录不删除，不将本次少量样本解释为成功率保证。

- 每次均精确比较整个正式项目与业务记录不变。第 3、5 次中试用新增、完成与删除成功，仍不写回正式数据。
- 在第 3 次真实候选上另行注入一次明确标注的受控 502，验证等待结束、错误可见、已有候选 srcdoc 不变。此错误不计为真实上游调用，见 [放弃与失败保全](assets/issue-5/discard.json)。
- 第 5 次候选中进行可辨识的试用增删改，刷新后恢复三条未完成原任务，试用新增、代码、对话均消失，生成请求为 0：[刷新记录](assets/issue-5/refresh.json)。
- 第 6 次候选中新增 `M2关闭前-试用新增`，完整关闭 Chrome，原配置重启后从已有项目列表进入。原代码与三条正式任务恢复，候选标题/试用任务/对话均消失，生成请求为 0：[重启记录](assets/issue-5/close-reopen.json)。

其他证据：[6 次调用记录](assets/issue-5/calls.json)、[重新开始的正式基础校验](assets/issue-5/restart-requests.jsonl)、[首轮失败](assets/issue-5/round-1-behavior.json)、[第二轮失败](assets/issue-5/round-2-behavior.json)、[第三轮通过](assets/issue-5/round-3-behavior.json)、[完整重做两轮通过](assets/issue-5/round-5-behavior.json)、[截图](assets/issue-5/round-5-passed.png)。

## 交付边界

总计 8 次真实候选调用，原始产物、耗时、失败和复测均已留存。客户端业务数据未附带给模型；模型凭据仅在服务端。源码快照哈希见 [source-manifest.json](assets/issue-5/source-manifest.json)。既有 M1 和规格的未提交工作保留，本次改动仍在本地工作区，未提交/推送 Git。

候选仍可能有模型逻辑错误；预览加载不能代替用户业务检查。本 ticket 没有采用、修改记录持久化、采用后回退、项目快照或候选后台恢复。#5 完成不等于 M2 完成；#6 继续负责明确采用和持久修改记录，父 #4 保持打开。
