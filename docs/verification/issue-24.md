# Issue #24：QA 通路资格验证

实现基线为已合并 M4 `471a2c6b906817864df4b9cad51ced7efe5611f8`（PR #22），在隔离分支中工作，共享主目录未修改。只实现 #24；没有模型调用、四角色生成、自动修复或新候选交付。手写待办/阅读记录与确定性任务均在界面明确标注。

## 使用与接入

Node 24、`pnpm install --frozen-lockfile`、`pnpm dev`，打开 `/qa`，选择应用和场景后点击“开始检查”。页内显示当前任务、代码/计划 SHA-256、实际步骤、每项实际值和终态；详情可展开查看原请求与完整结果。可在等待中停止，关闭页面也会清理执行。不会创建正式项目或写入业务存储。

生产构建需要服务端 `QA_TOOL_SIGNING_KEY`（32 字节随机值建议），所有函数实例使用同一值。不能加 `NEXT_PUBLIC_`；模型与部署密钥不进入 HTML、工具请求或结果。开发服务使用当前进程的随机 key，重启会使旧签名失效。环境配置见 `.env.example`。

`POST /api/qa` 的 `start` 只接受服务端注册的资格夹具名、变体和任务 UUID，返回签名工具请求。浏览器 `runQualificationTask` 发起任务、调用 `runBrowserCheck`、核对返回并自动发出 `complete`。`complete` 验证签名、任务/请求/代码/计划、必检项顺序、命令、预期和实际值，再返回同一任务的终态。没有外部脚本手工填团队结果；Playwright 测试只操作页面并观察真实 API 往返。

后续 #25 可直接 await `runBrowserCheck(request, host, signal, onProgress)`，向它提供经过验证的 HTML、不可变检查计划和**合成**样本，使用同一任务的请求/继续适配器。不能传入 `TrialData`、`SavedProject`、IndexedDB adapter 或真实数据。资格接口故意不接受任意用户 HTML 上传；团队后端应在可信层签发自己的代码和计划，而不是扩展夹具枚举来冒充真实生成。

## 工具和结果合同

`src/lib/qa/contract.ts` 定义 `atoms-qa/1`：任务 ID、工具请求 ID、HTML SHA-256、计划 SHA-256、绝对截止时间、场景与必检项。每场景拥有新的 iframe 和深复制合成数据。工具输入限制 HTML 500 KB、场景 12 个、每场景 100 项、单次等待 2.5 秒、延迟注入 2 秒、选择器 300 字符、输入 8000 字符、任务最多 4 分钟。资格任务使用 20 秒，超时探针缩短为 300 ms，未假称等待了完整 4 分钟。

| 命令 | 行为及边界 |
| --- | --- |
| observe | CSS selector + text/value/count/disabled/inert；返回真实读取值，文本最多 8000 字符 |
| input | 原生 input/textarea/select setter + input/change；拒绝 disabled/inert 控件 |
| click | HTMLElement.click；普通模式拒绝 disabled/inert；`probeWhileInert` 仅用于保存锁合规探针，实际尝试合成点击 |
| wait | 有界实际等待，不解释为业务通过 |
| assert | 读取当前 DOM 属性并与原计划的 JSON 预期比较；除 count 外必须唯一匹配 |
| data | 父页面核对合成 JSON 路径，包括数组项/长度，不读项目存储 |
| bridge | 核对真实保存请求数、拒绝数、提交数 |

每项结果包含 scenario/check ID、原命令、预期、实际、开始/结束时间和 passed/failed/tool-error/not-run。顶层终态为 passed/failed/cancelled/timeout/tool-error。代码或计划不符、缺项、乱序、降低预期、未执行、工具异常都不能通过。尚未执行的项目显式保留 not-run；取消/超时后销毁 iframe、关闭端口，不开始下一项。父桥延迟回调检查 disposal/signal/deadline，不能继续写检查状态。

源与通道校验沿用 M4；QA 另以私有 MessagePort 接收执行器结果，不接收窗口自称通过的消息。QA 父桥只处理合成数据，并在保存到达时核对已经成功读取（不会因保存排在未完成读取之后而取得权限）。正式/试用路径未被重构。自动 API 等待另有 15 秒上限，不能无限挂起请求或继续调用。

## 计划范围

两类应用有不同 input/button selector、集合名称与字段：待办 title/done；阅读记录 name/status/rating。各自检查旧数据/缺省字段、添加、完成或读完、数据结果、读前控件禁用、保存中 inert/提示、保存中实际再次点击不产生第二次写入、读失败提示与禁用及零保存、保存失败提示/回退及数据保全。

故意违规夹具在正常条件先通过，再在读取失败 catch 中启用控件并保存，或在保存失败 catch 中宣称已保存；相同计划发现失败。父桥拒绝非法保存且保全种子与应用交互失败分别记录，不能互相代替。没有预写修复，也没有把缺陷检测冒充四角色返工。

三类隔离测试在同一浏览器同时保留正式页面、已经新增内容的候选试用和 QA 页面，检查 QA 请求体没有正式/试用哨兵、QA 没改变现有页面、重开仍是正式数据、采用也没有写回试用/QA 数据。

## 重复运行

先启动应用，再运行：

```sh
QA_EVIDENCE_DIR=/tmp/atoms-qa-evidence pnpm exec playwright test tests/browser/qa.spec.ts --workers=1 --timeout=60000
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

测试使用本机 Chrome；外层 60 秒包含开发服务编译和页面导航，工具内部期限没有放宽。可通过 `TEST_BASE_URL` 指向同一代码的目标部署。受保护部署需要已有的授权浏览器登录或获准的自动化访问，不能把登录页面 HTTP 200 当通过。原始证据可放在指定目录；提交只保留选定关键结果与摘要。

本次用户已明确要求保留自动化凭据。它保存在 Vercel 项目 `prj_eErnQuAz4P719xKTyuT6XT2Qu5ab`，备注为 **`Atoms QA automation (user retained)`**，scope 为 `automation-bypass`。后续 agent 按 `docs/agents/vercel.md` 读取项目访问 Token，通过 `GET /v9/projects/{projectId}?teamId=team_brlKMv4xsRX1SFiSIq5cMbfj` 在内存中按上述备注定位 `protectionBypass`，再把对应值仅作为测试进程的 `QA_PROTECTION_BYPASS` 环境变量传入。不要打印完整项目响应、把值写入命令参数/文件/URL/日志、重复创建或擅自撤销。它可访问该项目的受保护部署；本测试仅向 `TEST_BASE_URL` 的同源请求添加头。没有修改生产别名或关闭 Vercel Authentication。

线上协议拒绝探针也通过浏览器 `fetch` 发出；不要假定 Node 的 APIRequestContext 与浏览器共用系统代理。授权头由 Playwright 路由在目标源边界附加，不进入页面 JavaScript 或生成 HTML。

## 实际运行记录与限制

最终本地验证使用 Next.js 16.3.6 的生产构建、Node 24.18.0、本机真实 Chrome，测试串行运行。全部 **50 个浏览器测试通过**（其中 QA 10 个），生成接口 **15 个测试通过**，lint、typecheck、本地 webpack 生产构建与 Vercel 默认 Turbopack 构建通过。增强的“迟到但声称 passed”协议探针另行通过；它是合成回执拒绝测试，不冒充实际浏览器检查结果。

| 实际资格运行 | 结果 |
| --- | --- |
| 待办 | 39/39 passed；代码 `8d653c7127ffc28673aafef61588cd9b1d10a1a33a39278b3eee08124c03086d` |
| 阅读记录 | 40/40 passed；代码身份见原始结果 |
| 读取失败仍编辑并保存 | 35/39，四项失败：两个控件启用、保存尝试 1、父桥拒绝 1；提交 0，旧数据保全 |
| 保存失败仍显示已保存 | 38/39，错误提示断言失败；未提交 |
| DOM 原型覆盖＋窗口结果伪造 | 39/39，实际观察仍为旧待办文本，未接受 forged 文本或窗口自称成功 |
| 无执行器结果 | tool-error，0/39，所有项目 not-run |
| 300 ms 截止 | timeout，0/40，所有项目 not-run |
| 等待中用户停止 | cancelled，0/40，未发 complete；下一任务独立通过 |
| 正式、试用、检查数据隔离 | 真实 M4 候选/采用路径与 QA 同时打开；请求体无正式或试用哨兵，采用仍只用正式数据 |

[逐项真实结果](assets/issue-24/qualification.json)、[页面截图](assets/issue-24/todo.png)、[执行代码源码哈希](assets/issue-24/source-sha256.json)。生成 HTML 可由对应固定源码中的 `qualificationFixture` 重建，再核对记录内 SHA-256；没有修改已经通过的原始结果。

首次失败与修正保留如下：

1. 首轮 QA 页面已实际通过，但测试用 `innerText` 读取折叠详情得到空字符串，9 个外层测试失败；改为 `textContent`。没有把这轮测试标成通过。
2. 最初将“干扰探针”误期待为失败。实际捕获的原生读取抵抗了方法覆盖，健康应用仍正确运行；测试改为核对真实旧记录文本且不存在 forged 观察，随后通过。这不是降低业务预期。
3. M4 多轮候选首次在开发服务并行运行时超过 30 秒，单独重跑 18.7 秒通过。另两处旧测试在 React 初始化/IndexedDB 建表前接管时钟或写入，已改为等待真实就绪 UI，不改产品保存逻辑。
4. 后续并行开发验证出现 `/qa` 导航超时、检查尚未开始时采集到 null，以及旧预览操作超时。修复检查页的 SSR/客户端就绪保护；最终转到生产构建串行运行，50/50 通过。未把受干扰轮次删除或算作完整通过。
5. 就绪保护初版直接在 effect 中 setState，被 lint 拒绝；改为 `useSyncExternalStore` 的服务器/客户端快照，最终检查通过。
6. 尝试用现有 Chrome 会话打开受保护 Preview 的 CUA 调用超时，没有取得可用登录态或线上执行证据。

最终 [Preview](https://v0-test0-l5zm5773h-lnisres-projects.vercel.app/qa) 对应 `dpl_98ybMX8Q9MdAvjKSPSU6FocaeL4P`，READY，`target=null`（Preview）。2026-09-30 22:28–22:33（Asia/Shanghai）实际完成目标部署的浏览器 → Vercel API → 同一浏览器任务往返。浏览器从该部署加载页面和受限执行器，签发及回传 API 均为云端真实函数；未 mock `/api/qa`。本机 Playwright 只负责驱动页面，实际 QA 仍为选定的页内执行路径。

线上 10 项测试均已取得通过证据：完整场次先通过 9 项；协议测试的 Node 直接请求通道超时，改为浏览器 `fetch` 后单独复跑通过。不能将首轮写成 10/10。两类应用分别 39/39、40/40，读失败缺陷 35/39、保存失败误报 38/39；无结果/超时/用户停止均为非成功终态，停止后新任务独立通过。线上三类数据隔离和 M4 候选采用测试通过（生成接口仅用明确标注的受控 HTML，QA API 为真实请求）。

[线上逐项证据与控制场景](assets/issue-24/cloud-qualification.json)、[线上截图](assets/issue-24/cloud-todo.png)、[首轮 9 通过/1 失败日志（已脱敏）](assets/issue-24/cloud-first-test.log)、[协议复跑通过](assets/issue-24/cloud-protocol-retest.log)、[云端访问与部署核对](assets/issue-24/cloud-deployment.json)、[凭据保留核对](assets/issue-24/credential-retention.json)。已核对生产源码与此前 `source-sha256.json` 全部一致；本次只修改测试适配和证据文档，复用本地 50 项浏览器、15 项接口和构建证据，lint/typecheck 再次通过。

历史访问阻塞仍保留在[最初部署记录](assets/issue-24/deployment.json)：匿名访问 302 到 Vercel 登录，自动审批最初拒绝创建持久凭据；用户随后明确授权创建，并明确要求保留供后续 agent 使用。首次创建参数被 API 400 拒绝且无凭据产生；第二次创建后已获得 HTTP 200，但本地启动脚本引用不存在的 pnpm 绝对路径而失败。修复为 Node 直接启动 Playwright 后，原监督进程又因用户要求保留凭据而被中断，避免执行旧撤销逻辑；该中断场次不算完整通过。最终复用同一凭据完成上述线上验证，没有额外创建第二枚。请求失败日志已脱敏。

凭据当前保留且授权访问仍返回 HTTP 200；生产仍为 `dpl_68LXQuH7oBNajTAM7JJKZMpVAJRH`，保护开关未变。目标部署往返门槛现已满足，#24 可按完成记录关闭；PR 转为可评审，不代表已经合并或完成 #25–#28。

工具当前使用绝对截止时间，系统时钟偏差可能造成提前拒绝；服务端独立检查签名期限并拒绝迟到成功。没有把跨执行方时间当作统一事件排序依据。

路径选择与限制见 [ADR 0007](../adr/0007-browser-qa-tool.md)。没有验证恶意无限循环的强制终止、可信物理输入、任意 JS 干扰、所有浏览器、所有历史数据或模型生成质量。没有运行云端 Chromium；本机 Playwright 是页面驱动与证据观察工具，实际被选中的 QA 执行器始终在页面内部。
