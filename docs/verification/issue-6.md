# Issue #6：明确采用、修改记录与重开恢复

日期：2026-09-29。状态：全部验收完成。父规格 [#4](https://github.com/lnisre/atoms/issues/4)，前置 [#5](https://github.com/lnisre/atoms/issues/5) 已关闭。固定生产地址：https://v0-test0-nine.vercel.app 。

## 实现与数据边界

- 用户点击“采用修改”后，`adoptCandidate` 在原 `projects` store 的单笔事务中读取原项目、替换当前代码并追加修改记录。记录含采用时间、本轮各次成功修改需求和简短采用结果；不保存各轮历史 HTML。只在事务 `complete` 后切换界面，项目 UUID 不变。
- 采用函数不接收试用状态，不写 `applicationData`。成功后重新挂载 iframe，绑定新 channel 和正式存储；新代码重新读取原正式数据。旧试用请求仍绑定内存副本，卸载后监听与队列作废，不能变成正式写入。
- 采用失败保留候选、当前对话与明确错误。旧代码、旧记录和正式数据仍可恢复，可检查存储后手动再次采用；没有后台重试或多阶段恢复系统。保存期间禁用生成、放弃和项目导航，并设置离开提示。
- `modificationRecords` 是旧项目的可选字段，缺失时按暂无记录显示。数据库仍为 `atoms-projects` v1，原 store 与固定平台源不变，没有清库或重新生成升级。
- 修改模型提示明确同一 HTML 会先试用再正式运行，应用内采用中性的更新反馈；当前数据用途和保存状态由平台展示，避免采用后仍硬编码“试用数据”。新增字段默认值由生成代码实现，真实交互验证兼容性。
- README 已补充采用流程、失败处理、恢复条件及边界。未增加回退、撤销采用、快照、试用写回、候选持久化或跨标签页冲突协调。

## 工程检查

Node.js 24.18.0，Next.js 16.3.6。写代码前已读取当前包内 `use-client`、Route Handlers 和部署指南。

| 检查 | 结果与证据 |
| --- | --- |
| lint / 类型检查 | [lint](assets/issue-6/lint.txt)、[typecheck](assets/issue-6/typecheck.txt) 通过 |
| 服务端测试 | [9/9](assets/issue-6/server-tests.txt)，包括完整基础代码与对话合同 |
| 本地浏览器 | [16/16](assets/issue-6/browser-local.txt)，包含 M1、保存时序和候选隔离回归 |
| 生产浏览器 | [16/16](assets/issue-6/browser-production.txt)，模型成功响应为明确受控夹具 |
| 本地默认构建 | [Turbopack 失败](assets/issue-6/build-default.txt)：CSS 编译子进程绑定端口 `Operation not permitted`，未记作通过 |
| 本地替代生产构建 | [Next.js Webpack 成功](assets/issue-6/build-webpack.txt)，未修改默认构建命令 |
| 远端生产构建 | [Vercel 默认 pnpm build / Turbopack 成功](assets/issue-6/deploy-first.txt) |

新增浏览器场景覆盖：多轮一次采用、稳定项目 ID、试用增删改不写回、历史记录累积、下一轮基础代码、放弃/刷新/重开记录保留、旧通道隔离、事务延迟期间未采用语义、事务中止后的候选保留与旧结果恢复、手动重试。

首次全套为 15/16，旧持久化用例一次首次鼠标点击未生效；单独复核在另一个首次鼠标操作复现。临时事件探针 8 次中 3 次事件只命中父页面 `IFRAME`，iframe 内没有收到事件，且 `body.inert=false`，是此前 M1/#5 也记录的 headless Chrome 首次命中时序问题。对应两处存储验证改用真实键盘 Space/Enter 激活，后续鼠标删除与其他业务点击仍保留；没有合成业务事件或绕过存储桥接。保留 [首轮失败](assets/issue-6/browser-local-first.txt)、[单独复核](assets/issue-6/persistence-recheck.txt)、[事件探针](assets/issue-6/click-probe.json)。最终本地与生产各 16/16。

## 真实模型与线上交互

使用原 Chrome 配置 `/private/tmp/atoms-m1-save-fix-live`、原始 M1 项目 `e5052705-847c-4858-be72-2b7d57d172c6`。原 HTML 哈希 `08d073287eb68695e1e5744d5ab764f1ee41fcfd2bbeff063577b7b31dbbe719` 与 #5 / M1 原始真实调用相同。原正式数据为已完成的“真实新产物第一条”。[部署前基线](assets/issue-6/before.json) 保留完整原记录；没有重新生成或导入项目，没有清除其他项目。

| 调用 | 用户需求 | HTTP / 模型耗时 | 验证 |
| --- | --- | --- | --- |
| 1 | 增加任务优先级与筛选 | 200 / 18.292s | 基于原 M1；原任务完成状态保留、默认中优先级；新增高优先级试用项、修改原完成状态 |
| 2 | 把筛选放到顶部 | 200 / 17.654s | 基础 HTML 哈希精确等于第一轮候选，携带前轮需求；保留试用数据和功能；实际筛选、完成、删除通过 |
| 3 | 允许直接修改已有任务优先级，保留现有功能与数据 | 200 / 19.710s | 基础 HTML 精确等于刚采用的第二轮；上下文重新开始；新增已有任务优先级操作并实际验证 |
| 4（手动重试的成功响应） | 将标题改为“未采用的关闭重开检查” | 200 / 19.045s | 基于第二次采用代码，供未采用关闭丢弃验收；没有采用 |

模型响应均为 `deepseek-flash`。原始 HTML 和 [调用元信息](assets/issue-6/calls.json) 保留，未拦截或替换真实成功响应，未手动修补模型 HTML。本轮已检查场景中前三次没有发现业务失败；不能据此承诺通用正确率。

共 **5 次浏览器真实请求尝试，4 次收到模型成功响应**。标题修改首次尝试出现 `Failed to fetch`，没有收到响应；是否到达上游不确定。界面结束等待并展示错误，数据库与此前保存结果精确相同。手动点击生成后收到上表第四个成功响应。保留 [网络失败记录](assets/issue-6/transport-failure.json) 和 [错误现场](assets/issue-6/fourth-attempt-timeout.json)，没有把它计作成功或受控故障。

1. 采用前，试用创建 `M2采用前-试用新增`，把原任务改为未完成，再删除原任务，完成试用新增项。高优先级筛选排除原中优先级任务，筛选在输入区上方。每轮精确比较正式项目及业务数据，均与基线一致。[检查](assets/issue-6/trial-checks.json)、[采用前状态和截图](assets/issue-6/trial-before-adopt.json)。
2. 点击采用后：项目 ID 不变，代码等于第二轮候选，记录包含两轮需求；正式业务记录与基线逐字段相等。原任务与已完成状态恢复，试用新增项消失，新增字段默认中优先级。用当前 iframe 发送旧试用 channel 的保存消息后刷新，正式数据仍不变。[检查](assets/issue-6/adoption-checks.json)、[采用结果](assets/issue-6/adopted.json)。
3. 正式使用：新增高优先级 `M2正式-高优先级保留`、新增并删除低优先级临时项、将原任务改为未完成、完成新增保留项；筛选按优先级生效。等待保存后刷新，正式数据、代码和记录精确恢复，无新增模型调用。[检查](assets/issue-6/official-checks.json)、[刷新](assets/issue-6/official-refresh.json)。
4. 完整关闭 Chrome，再以原配置启动，从首页项目列表进入：读取的整个数据库等于保存基线，记录包含两轮需求，生成请求数为 **0**。[关闭重开](assets/issue-6/close-reopen.json)。
5. 第三次真实生成基于刚采用的代码。在试用中将原任务优先级改为低，正式数据不变。随后明确注入一次受控 IndexedDB `put` 成功后事务中止：采用错误可见、候选保留、旧代码/记录/数据逐字段不变，另开页面仍恢复旧结果。该故障是受控存储失败，不记为真实模型失败。[失败检查](assets/issue-6/failure-checks.json)、[错误现场](assets/issue-6/adoption-failed.json)。
6. 手动再次采用成功，旧修改记录保留并追加第二条；试用改成的低优先级未写回。正式应用中将原任务优先级改为高，保存、刷新后恢复，两条修改记录仍在。[第二次采用与刷新](assets/issue-6/second-adopted-refresh.json)。

## 部署

已按项目凭据说明读取 Token，仅在内存与 CLI 子进程环境传入，不输出值或片段。原绑定 `v0-test0` / `prj_eErnQuAz4P719xKTyuT6XT2Qu5ab`，Node `24.x`，未改变服务端模型配置。

首次部署 `dpl_EMst4UqYQeURVixEdHDFrUrhc3kv` 为 READY / production，别名包括固定地址 `v0-test0-nine.vercel.app`。[元信息](assets/issue-6/deployment-first.json)、[构建部署日志](assets/issue-6/deploy-first.txt)。浏览器实际进入应用，无 Vercel 登录跳转。

第二次同源部署 `dpl_5TpHyRkVEeawb3sB1eJdZrhnuHfj` 同样 READY / production，固定地址、项目与 Node 版本不变，默认 Turbopack 构建通过。[元信息](assets/issue-6/deployment-second.json)、[日志](assets/issue-6/deploy-second.txt)。

第四个成功候选中新增 `M2最后一轮-不保存`，确认完整持久记录不变后关闭整个 Chrome。第二次部署完成后以原配置重启，从项目列表进入：整个数据库与第二次采用后保存基线精确相同；恢复第三个成功响应的代码、两条已采用记录、原任务高优先级与未完成状态、新任务高优先级与已完成状态。未采用标题、试用新增和本轮对话均消失。恢复生成请求 **0**。[关闭前](assets/issue-6/unadopted-before-close.json)、[重部署后关闭重开](assets/issue-6/redeployed-close-reopen.json)、[最终断言](assets/issue-6/final-checks.json)。390px 平台视口无横向溢出：[尺寸](assets/issue-6/mobile.json)、[截图](assets/issue-6/mobile-restored.png)。

## 逐项验收对应

| #6 条件 | 结果 |
| --- | --- |
| 明确采用、原 ID、事务成功后确认 | 真实采用检查 + 延迟事务浏览器回归通过 |
| 代码与多轮需求/结果一致保存、旧记录保留 | 真实两次采用累计两条记录，首次含两轮需求；事务中止全量回滚通过 |
| 只采用代码、旧数据/完成状态/默认值 | 采用前后正式业务记录逐字段相等，原已完成任务恢复、默认中优先级 |
| 旧试用消息隔离、正式自动保存 | 旧 channel 伪造保存后刷新数据不变；正式增删改保存通过 |
| 可识别试用增删改及新增/原功能可用 | 真实试用新增、删除原任务、改变完成状态、筛选及顶部布局均实际点击通过 |
| 正式优先级/完成状态保存、刷新/完整关闭/列表重开 | 两次采用后的正式操作及恢复通过；恢复生成请求 0 |
| 下一轮从刚采用代码继续 | 第三、第四个响应的基础代码哈希分别等于前一采用代码；新轮上下文为空 |
| 丢弃本轮不丢已采用记录 | 受控放弃/刷新通过；真实完整关闭丢弃第四个候选后两条记录保留 |
| 采用失败保全且保留候选 | 真实候选上注入事务中止；旧代码/记录/业务数据逐字段不变，候选留存并手动采用成功 |
| M1 无记录兼容 | 使用原 M1 项目直接升级与试用，没有迁移、清库或重新生成 |
| 固定源再次部署后恢复 | 第二次 READY 部署后完整重开全量记录一致 |
| 线上真实多轮闭环 | 5 次真实请求尝试、4 个成功模型产物；失败及复验如实留档 |
| 工程检查和文档 | lint/typecheck、9 个服务端和本地/生产各 16 个浏览器测试通过；Webpack 本地及 Turbopack 远端生产构建通过，默认本地限制另记 |
| 范围保持 | 无回退、快照、试用写回、候选持久化、复杂重试或 Agent 清理 |

## 交付状态与限制

#6 完成 M2 的明确采用闭环，父 #4 按用户要求保持打开。M2 主链路已由 #5 与本记录共同覆盖。仍限同一浏览器配置和固定源，清站点数据或浏览器回收后的找回、跨设备恢复、任意破坏性迁移和模型正确率保证均不在范围。

代码和证据保留于当前工作区；此前 M1/#5 未提交改动完整保留。本次没有提交或推送 Git。可核对 [源码清单](assets/issue-6/source-manifest.json)。
