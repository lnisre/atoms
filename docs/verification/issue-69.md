# #69：账号云端项目最终验收进展与发布准备

父规格 [#65](https://github.com/lnisre/atoms/issues/65)，[阶段 #69](https://github.com/lnisre/atoms/issues/69)，[汇总草稿 PR #70](https://github.com/lnisre/atoms/pull/70)。2026-10-11（Asia/Shanghai）。**当前不能合入或宣称发布完成：已执行现行账号流程的 verify-atoms 隔离验收并修复发现的回归；真实邮件、普通用户 JWT→PG、真实模型及目标 Vercel 验收仍未完成。** #65–#69 均不关闭，PR 保持草稿。

## 来源、代码与目标

- 从 `origin/codex/account-cloud-projects` 的 `79fbe37c97cff19aedcb156f4dcc15b563d989be` 创建本会话 managed worktree：`/Users/gaowenlong/.codex/worktrees/cloud-projects-69/atoms`。原 checkout 及 #68 工作区未改动。
- 本次产品/驱动修复冻结提交：`a709ddf409bd4e4d0e4db2b88d1b4ec3d1c20470`。报告及证据后续提交不改变已测试产品内容。Node 24.18.0、pnpm 10.12.1、Next 16.3.6；独立安装/build。本地 dev 3169，正式构建网关 3179/3180；每轮由 Doctor 核实目录、端口、源码及素材身份。
- 云端只读核对目标：`atoms-d9gdf8r2036664366` / `ap-shanghai`。001/002/003 已安装且校验和与前阶段一致；没有改旧迁移、重灌数据或再跑相同的高成本 SQL 故障矩阵。
- Vercel 目标项目仍为 `v0-test0` / `prj_eErnQuAz4P719xKTyuT6XT2Qu5ab`。只读现网身份：`dpl_VK3bPMP6QkTj66NJKm51yQfPoiYA`，production / READY，源提交 `6f49a6416694b9a770cc0da6784cfb4f9df25e22`，入口 `https://v0-test0-nine.vercel.app`。**不是本次源码的部署，未新建部署、改别名或生产参数。** 当前远端只有 production 的模型/QA key；账号运行参数尚未安装。

## 发现与修复

候选完成时，旧 CloudWorkbench 从 CloudProjectView 切换到另一棵组件树，导致 ResultViewer 重建，用户阅读源码时退回预览并丢失搜索状态。现保持同一 ResultViewer，仅替换版本与相应数据会话。保存历史、当前轮记录与修改操作分开显示，恢复 ConversationScroll，操作区不随长记录滚走；1280×720 不再强制 750px 工作台，736px 保持左右排列。尚无完整成果时保留禁用的代码入口和原因。

游客只读示例恢复原始源码阅读入口，保持 iframe 和只读桥不变；个人云端示例的保存说明不再声称只限本浏览器。没有改示例 HTML/hash、认证、SQL、任务预算或配额。

当前账号/预览/QA/跨应用驱动已改用真实页面、iframe 与公开 HTTP 边界。共享 Auth/BFF/provider 夹具明确标为合成；受限夹具改为 `draftResult`＋惰性 legacy result。新云端阅读工作流复用冻结独立检查计划，真实入口为 `tests/team/live-cloud-cross-app.ts`：默认仅打印计划；执行需已有的两个真实登录隔离 profile，禁止补造 Cookie。完整 Chrome 重启用例清理其独占 profile。

## 按规格选择的矩阵

来源为 #65 Testing Decisions 1–14、#69 验收、ADR 0015/0016；源码阅读另核对六个 verify-atoms feature。一次主状态覆盖登录/项目/采用，故障重跑只针对变更与未消除风险。以下“通过”均限定右列身份边界，不代表父规格整体验收。

| 预期与来源 | 实际结果 | 证据 | 状态/身份边界 |
| --- | --- | --- | --- |
| 1 注册/验证码错误/失败保留输入，普通登录无副作用，续接一次 | 当前 DOM 回归通过；邮箱登录/provider/代发仍为关闭 | account-access，email-inspect | UI 合成通过；真实收件、注册、过期码、令牌大小、退出撤销未验证 |
| 2 游客鼠标/键盘/API/原始 bridge 不可写，显式副本去重 | 游客只读及源码切换通过；显式保存响应丢失重试保持同 operationId | account-access、cloud-projects | Auth/BFF 合成通过；两个真实账号各建副本仍未验证 |
| 3 同账号恢复需求/代码/正式数据/记录，恢复零生成 | 独立 context 及完整 Chrome 进程重启通过；阅读应用 UI 新增/切换/删除及恢复通过 | cloud-cross-app、cloud-regressions restart | UI＋合成 BFF 通过；真实 JWT/PG/兼容重新部署未验证 |
| 4 跨账号拒绝项目/基础代码/任务控制，普通用户 RLS | 当前页面拒绝他人项目，服务端生成/票据/归属检查保持 80 项回归；复用 #67/#68 的 SQL 角色证据 | browser-summary、checks；前阶段报告 | UI、脚本身份及 SQL 合成 claims 分别通过；真实普通用户 JWT→PG/RLS 未验证 |
| 5 事务确认才显示已保存；读取失败不可当空数据写 | 延迟确认、失败内容下载、重试与失败读保护通过 | cloud-projects | 真实 DOM/iframe，合成 BFF；真实目标故障未验证 |
| 6 数据/代码旧版本冲突并保留、下载、重载 | 两 context 数据与候选冲突通过；重载期间新未保存内容保留 | cloud-projects、cloud-generation | UI 合成通过；真实 SQL 并发复用 #67/#68，非 JWT 网关证明 |
| 7 提交后丢响应不重复项目/采用/模型请求 | 副本、首次成果、采用、数据重试通过 | cloud-projects、cloud-generation | 合成 BFF 通过；真实网络链路未验证 |
| 8 多轮候选/放弃/失败保全正式数据，采用只换代码记录 | 计数器及阅读应用两轮；试用评分不进入正式 state；失败/停止保留候选输入、放弃/刷新只恢复正式版本 | cloud-generation、cloud-regressions、cloud-cross-app | 真实 UI、手写 provider 通过；真实模型首次＋多轮未验证 |
| 9 待验证限制可恢复，试用不正式化，无证明不能保存 | draft/阻断/启用及无证明仅下载通过；原生20项检查覆盖两次返工/预算，服务端测试覆盖策略/签名 | cloud-generation、cloud-regressions、python-native、checks | UI策略为显式合成；真实审查判断和原生UI风险继承链未验证 |
| 10 自然失效原任务收尾，同号重登可存；退出隔离迟到结果 | 合成自然失效重登、生成退出、首次提交未确定时退出、取消离开、停止候选均通过 | cloud-generation、cloud-regressions | UI 合成通过；真实过期、数据/采用/日志各在途退出组合仍待目标验证 |
| 11 未保存副本可下载且不含凭据/证明、不承诺导入 | 首次/候选/数据失败和无证明下载通过 | cloud-generation、cloud-projects、cloud-regressions | 合成内容通过 |
| 12 旧 IndexedDB 不读取/迁移/认领/删除 | 当前入口项目DB访问探针为零；已有旧 project 行保全 | account-access | 当前UI通过；不是旧升级功能验收，也未声称完整旧库字段矩阵 |
| 13 网关、公网 Cookie/HTTP/WS、上海保存时延、预算 | 本地正式构建网关 Doctor、8个匿名/跨源/WS探针和QA往返通过；原生20项、服务端80项通过 | doctor-production、gateway-probes、checks | 本地边界通过；Vercel公网Cookie、真实认证WS、Vercel→上海时延未验证 |
| 14 最终代码静态/相关回归、隔离后发布、范围一致 | lint/typecheck/build 通过；客户端13个JS文件没有实际秘密；已冻结89个源码上传文件白名单 | checks、client-secret-scan、release-manifest | 构建/准备通过；真实隔离验收和生产发布未完成 |
| #47/#18 源码阅读、长记录、预览及操作保留 | 代码模式跨候选保持、同版本 iframe 不卸载；1440/1280/736可达；示例源码、云端文案修正 | cloud-regressions、account-access、两张截图 | 当前UI回归通过；没有把布局断言说成原站视觉还原 |

## 执行证据与失败保留

[浏览器摘要](assets/issue-69/browser-summary.json) 保存每轮标题、结果与首次失败，不含全量请求/令牌。共 **42 个不同浏览器场景有通过证据**：37 个现行页面/QA场景，4 个独立 SourceVersion 搜索/剪贴板组件场景，1 个旧 snapshot CLI 序列化场景。最后一项仅证明历史驱动序列化，不能作为云端持久化证明。不是 `pnpm test:e2e` 的全部历史文件都通过；旧匿名/IndexedDB/native-browser 用例仍被明确隔离为历史配方。

- 初轮25项：21通过，4个旧 preview-document 驱动失败（匿名接口现在正确返回401、旧自动预置入口不存在）。迁移后4项通过。
- 回归基线6项：4通过；实测候选重置代码模式失败；另1项是迁移驱动仍断言“没有首次记录”，与新夹具已有真实结构不符，删去该旧种子前提。
- 工作台修复后22/22。补充失败/停止、无证明和长记录后21/21；真实鼠标替换原多轮测试中的 Enter 后通过。
- QA/跨应用首轮10/11：10项QA通过，云端驱动误用不受浏览器 route 夹具拦截的 APIRequestContext 得到401；改为页面公开 fetch 后局部1/1通过。完整浏览器重启1/1。正式构建网关QA另1/1。
- 一次驱动 typecheck 发现 `map(resolve)` 的回调签名错误，修复为单参闭包后最终 typecheck通过。一次 Doctor 使用PATH默认Node25被拒绝；改为要求的Node24通过，未驱动错实例。
- **历史 opaque iframe 首击竞态未宣称修复。** 3轮各6次新建/重载 frame 的真实鼠标首击全部通过；未引入手工 DOM click 替代。采样未复现无法证明竞态消失；前阶段失败证据保留，真实目标仍需指针检查。

[静态/构建/Doctor与80项服务端、20项原生摘要](assets/issue-69/checks.json)。80项在本阶段产品UI修复前执行，涉及服务器/SQL/监督器源文件未改；修复后执行相关浏览器、最终 lint/typecheck/build。原生环境 `/private/tmp/atoms-team-cancel-env-20261007/python-env/bin/python`，Python3.11.14，MetaGPT固定SHA由实际测试核对；`uv pip check --python ...`检查208包通过（该venv无pip模块）。先前报告的旧venv路径已不存在，未据此虚报环境可用。原生 provider 全部脚本化，真实模型请求0。

[736px候选](assets/issue-69/cloud-narrow.png)、[1280×720长记录](assets/issue-69/history-1280.png) 已人工查看。完整 trace/log 位于 `/private/tmp/atoms-69-evidence/`，不承诺临时路径长期保存；持久提交只保留脱敏摘要、必要截图及[文件hash](assets/issue-69/integrity.json)。

## 运行配置与发布续接

1. 前阶段 artifact key 仍只在 #68 受忽略的0600配置和私有数据库表中保存。此次通过可信 Node 进程在内存读取、查询布尔相等并注入本地gateway；**未输出值、未复制该key、未重新生成**。[相等校验](assets/issue-69/artifact-key-check.json)。本 worktree 的受忽略 `.env.local` 是本地独立 Auth/QA 配置、目标origin及Python路径；不能直接当生产配置使用。腾讯管理凭据一直只用于只读运维。
2. [邮件开关复查](assets/issue-69/email-inspect.jsonl) 仍关闭。#66自动审批曾拒绝共享环境认证配置写入，原因是转交内容不足以证明授权；本会话未重试/绕过。仍待协调方取得“仅开启邮箱验证码及内置代发、保留其他开关、不改套餐计费域名”的可信批准及授权测试邮箱。跨账号验收需两个获授权的独立测试身份；不向推测地址或别名发信。
3. 获批后按 email-auth 脚本进行配置，并实际收件登录；普通令牌通过应用BFF→PG/RLS完成验收，不能用管理SQL或手工签Cookie替代。两个独立profile完成真实登录后，查看 `node --import tsx tests/team/live-cloud-cross-app.ts` 的[零网络计划](assets/issue-69/live-cloud-manifest.json)，再按计划的3个有界任务执行；失败不自动重试增加费用。该驱动真实执行尚未发生。
4. 真实身份链路可用后准备隔离 Vercel 目标，配置同一 CloudBase 环境、独立Auth会话密钥、匹配artifact key、模型/QA key及精确公网origin。现有 `vercel-release.mjs create` **硬编码production**，不得拿它创建“隔离Preview”；当前只执行了 `plan`，还需落实明确Preview目标并核对返回target/实际生产alias不变，再测真实Cookie/WS/时延。官方API中Preview响应target为null，不能只信调用意图：[创建部署API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment)。
5. 完成上表真实身份/真实模型/目标故障组合后，才使用同一冻结源码白名单发布现有生产入口。部署READY、公网可达、普通用户业务通过分别记录。保留Vercel既有automation bypass，不轮换/撤销；未修改任何远端运行变量或计费。

维护技能结论为 **blocked（部分已修正）**：六个feature均完成来源/源码核对和当前可运行UI覆盖，旧匿名/IDB配方明确标为历史；当前阅读云端adapter已跑通，但真实目标及原生浏览器风险/停止完整链尚不能完成。没有扩大到历史恢复、完整容器迁移或新增配额。

## 清理

所有本轮Playwright context/浏览器均关闭；完整重启测试的独占临时profile已移除。仅停止本会话已核实归属的dev/gateway进程，3169、3179、3180端口释放记录见 cleanup.json。未写真实云端业务记录、未创建Auth用户、邮件/真实模型请求0；因此无本轮远端测试项目需要删除。#68密钥工作区、Vercel凭据/bypass、本工作区配置和必要证据均保留。原checkout未提交工作不动。
