# #47 代码查看器集中验收

2026-10-09（Asia/Shanghai）。依据 [#47](https://github.com/lnisre/atoms/issues/47) 最新全文和 #49/#53/#54/#57 交付记录，执行项目 `verify-atoms`。本轮负责完整 PRD 验收、集成 PR 及验证后合入 master。

## 最终基线与边界

独立工作区 `source-browser-verify/atoms`，分支 `codex/source-browser-acceptance`，起点 `b37a1885a165cf59057acc1550a05ab528d238de`。其祖先包含 T1 `948387d`、T2 `dfc02c1`、T3 `6a03fe1` 和集成提交 `e42cb67`。验收时最新 origin/master 为 `1d4d81791b3b48c51e0311f1af7e842a13d9cd1f`，是此分支祖先，无主线冲突或未验证的合并改动。**本轮产品代码未改动**；仅补验收驱动、修复旧驱动漂移、更新验证地图及记录。主目录其他会话的 CONTEXT.md、示例 ADR、experiments 未触碰。

Node 24.18.0、pnpm 10.12.1、Next 16.3.6、Playwright 1.63.0、已安装 Google Chrome；独立 node_modules/.next，端口 3247。首次和失败后 Doctor 均通过，确认进程归属、源文件身份、HTTP 和示例 hash。详见 [Doctor](assets/issue-47/doctor.json)、[复验 Doctor](assets/issue-47/doctor-retry.json)、[最终源码和驱动 hash](assets/issue-47/source-and-driver-hashes.json)。

所有生成/审查响应均为受控协议夹具，真实 DOM、iframe 数据桥接、Clipboard API 和 IndexedDB；存储失败在既有浏览器 API 边界注入。多文件仅通过公开 `SourceVersion` 输入的明确标识承载页提供。不调用真实付费模型，不声称真实 Reviewer 质量、原生团队路由或 #48 多文件生成运行通过；不执行生产部署。

## 执行与首次失败

- 首轮 39 项：35 通过、4 失败、0 跳过。旧 persistence 保存失败定位匹配左右两条正确提示；改为限定“项目成果”。T1 三视口拖选仍使用无行号时的坐标，现落在不可选的行号边距；改为取得首行文本几何位置后用真实鼠标拖选。断言未削弱。仅复验这 4 项，4/4 通过。
- 补充 3 项：首次 2 通过、1 失败。新增数据风险用例错误等待“生成候选”重新启用，但成功后输入会清空，按钮应禁用；改为等待可见候选轮次。仅复验失败项，1/1 通过。
- **42 个不同浏览器用例最终全部有通过证据；合计 47 次执行含 5 次首次失败，无跳过。** 没有重跑已通过的大范围矩阵以制造单轮全绿。
- 最终 `pnpm typecheck`、`pnpm lint`、`pnpm test`（56/56）、`pnpm build`、`git diff --check` 通过。生产构建在 dev 停止后执行。
- `maintain-verification-skill` 的限定维护结果为 **changed**：workbench 地图补入 #47 及五个 source 驱动；旧定位与拖选漂移在主验收任务修复并复验。没有重审不相关 feature map。

完整用例、各次状态和错误见 [attempts.json](assets/issue-47/attempts.json)。操作与原始 trace 身份见 [trace-index.json](assets/issue-47/trace-index.json)；完整 trace 位于本机 `/tmp/atoms-verify-47/`，不作为唯一归档证据。关键截图、存储观察和请求计数已归档本目录。工程日志和证据校验见 [files.sha256.json](assets/issue-47/files.sha256.json)。

## 验收矩阵

下表 US 编号均指 #47 User Stories；T4 来源同时对应 #57 Acceptance criteria。证据中的 S1=source-browser、S2=source-reading、S3=source-version、S4=source-recovery、S5=source-acceptance，具体用例、状态与附件见 attempts.json。

| 预期及来源 | 实际观察 | 证据 | 状态 |
| --- | --- | --- | --- |
| 工作台切换、左对话右成果、返回预览；US1–3 | 三桌面宽度均维持左右结构，鼠标/键盘切换可达 | S1 三视口；source-1440/1280/736.png | 通过 |
| 原始唯一 index.html、不虚构文件；US4/34 | 受控真实工作台与固定示例逐字符读取原始 HTML，无运行注入，不补造示例生成史 | S1 真实/示例；S4 跨项目 | 通过 |
| 目录、选中、完整路径、默认入口；US5–8 | 合成根/嵌套/同名/长路径/空文本可浏览，目录折叠及键盘选择正确 | S1 公开输入；synthetic-files-narrow.png | 通过 |
| 高亮、行号；US9 | 人工检查 HTML/JS 与 TS 截图，语法色彩和连续行号可见；未知语言和空文本可读 | source-1280.png、reading-desktop.png；S2；source-code 底层测试 | 通过 |
| 文件内查找、数量、前后/无匹配、切换文件；US10–11 | 明示当前文件；多次/无匹配、Enter/Shift+Enter、同名切换重新计算，长行可定位 | S2 当前文件搜索；S5 真工作台 | 通过 |
| 原文复制、失败反馈及手动选取；US12–13 | 真实剪贴板逐字符一致，不带行号/标记/注入；拒绝和不可用如实报错；未完成/迟到写入不提前成功 | S2 三复制分支；S1 三视口拖选复验 | 通过 |
| 只读且文本不执行；US14 | 查看器无编辑入口，标签/脚本按文本出现，恶意文本未执行；选文件后修改仍传完整 baseHtml | S1 多文件及真实工作台；S2 原文 | 通过 |
| 同版本 iframe、未提交输入与运行保全；US15–16/31 | 原 iframe 仍连接，实例 ID 不变，内存计时及示例时钟在代码模式继续，应用/对话输入、目录和滚动保留 | S1 三视口/示例；S2；S5 | 通过 |
| 纯阅读无生成/采用/存储副作用；US17/35 | 正式与试用搜索复制前后项目、正式业务行逐值相等，试用输出保持；请求不增，采用状态不变 | S1 read-only 附件；S5 reading-side-effects 附件 | 通过 |
| 修改期间保留旧完整代码；US18 | 门控响应释放前旧代码可读，不展示半成品 | S3 候选同步；S5 迟到分支 | 通过 |
| 新候选同步并提示，不退出代码模式；US19/22 | 两轮候选都更新完整源码和预览，显示“源码已更新”及“候选版本 · 未采用” | S3 候选同步 | 通过 |
| 保留有效路径/目录/位置；移除回入口说明；US20–21 | 更新/新增/缩短/移除/重加公开文件集合后选择与有效位置正确，无旧文件复活；查询重新计算 | S3 两合成版本用例 | 通过 |
| 整版采用/放弃；US23 | 两轮候选按最新候选为基础，放弃整版恢复原代码；采用保留正式数据、排除试用 | S3；S4 多轮；candidate 回归 | 通过 |
| 采用待保存及失败保全；US24 | 真实事务保持时仍未采用，中止后候选可重试；重开只恢复上次成功代码/数据 | S3 采用事务；S4 多轮；candidate/save-race | 通过 |
| 修改失败/停止/迟到/阻断保全；US25 | 失败和阻断均不替换已有候选；停止后释放迟到响应仍保留旧源码/预览，刷新恢复正式版本 | S5 failed-modifications 附件；candidate 停止/超时 | 通过 |
| 待验证原始源码及采用限制；US26 | draftResult 原文与复制一致、非兼容页；数据风险在代码模式仍禁采用，当前代码修复后才允许，试用数据不写回 | S4 unknown；S5 risk-adoption；reviewer-preview | 通过 |
| 首次禁止执行仍可读；US27 | 原始阻断源码可搜索复制，首次/刷新/重开无 iframe，无使用入口；代码模式显示限制 | S4 fatal；S1 阻断 | 通过 |
| 无完整成果禁用、读取错误如实报告；US28；#57 | 首次等待/失败入口禁用；持续读取故障不显示空成功，恢复后重试可读原代码 | S1 无成果；S4 读取失败 | 通过 |
| 保存失败内存成果可复制且明确未保存；US29 | 736px 显示仅保留本页及刷新风险，待验证成果不能使用；刷新不出现未保存项目 | S4 保存失败；persistence 修复后复验；unsaved-code-736.png | 通过 |
| 刷新/重开/跨项目默认预览入口；US30/34 | 搜索/位置重置，采用两轮后恢复最新代码，失败采用和未采用候选重开恢复此前成果，切示例不串源码 | S1；S4；candidate/persistence | 通过 |
| 窄桌面目录与操作；US32 | 默认收目录、展开只覆盖成果区；搜索复制/长路径/长源码/错误/采用放弃可达 | S1/S2/S4；736px 截图 | 通过 |
| 键盘阅读流程；US33 | Enter/Space 切换、Tab 到目录/查找/复制/源码、目录文件键盘选择、搜索前后及键盘复制成功 | S1；S2；S5 | 通过 |
| 相关工作台/存储回归；#47 Testing Decisions | 消息滚动与输入保全、保存竞争、候选副本隔离、存储读写失败及审查限制均通过 | workbench-stream 2、save-race 1、candidate 6、persistence 5、reviewer-preview 5 | 通过 |

## 限制与清理

实际恢复覆盖刷新、返回首页重开、同 BrowserContext 关闭页面后重开、跨项目；本轮未额外执行整个 Chrome 进程重启，既有示例该级恢复证据见 #40。未重跑原生 Python/team gateway、真实模型质量、手机专项、#15/#18 像素还原、#48 或生产部署；这些不是 #47 本轮通过条件。部分 iframe 业务数据准备沿用 Enter 激活，不能据此声称所有生成应用鼠标行为都已验证；平台查看器的鼠标和键盘流程均实际执行。

所有 Playwright 运行结束，自有服务器 PID 35317 与 listener 35343 已退出，3247 端口释放；独立依赖及构建缓存保留。证据在清理后仍存在，见 [cleanup.json](assets/issue-47/cleanup.json)。本报告记录已验证的功能基线，实际 PR 和合并状态以 #47/#57 最终交付评论及 GitHub PR 为准。
