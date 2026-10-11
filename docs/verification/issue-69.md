# #69：单邮箱验收完成与 PR 合入记录

父规格 [#65](https://github.com/lnisre/atoms/issues/65)，阶段 [#69](https://github.com/lnisre/atoms/issues/69)，汇总 [PR #70](https://github.com/lnisre/atoms/pull/70)。2026-10-11（Asia/Shanghai）。

用户在真实单邮箱、独立浏览器主链路通过后明确决定：“不用第二个邮箱”，并确认“之前单邮箱已经测试通过，则验收就全完成，继续推进 pr 合入就好”。本轮据此收口验收并推进合入；第二真实账号不再是本轮合入门槛。没有将未执行项目改写为实测通过，也没有取消产品的账号私有与归属校验要求。

本记录替代 [隔离回归阶段报告](issue-69-isolated.md) 中“邮件关闭、真实模型为零、无隔离部署、不能合入”的阶段状态。**PR 合入与正式生产发布分别记录：当前生产域名仍指向旧部署，本轮未切换。**

## 实际环境与来源

- 工作区：`/Users/gaowenlong/.codex/worktrees/cloud-projects-69/atoms`；从集成分支 `codex/account-cloud-projects` 继续追加提交，未修改原 checkout 的未提交工作。
- CloudBase：`atoms-d9gdf8r2036664366` / 上海。001/002/003 迁移校验和保持不变；运行时通过普通邮箱用户令牌访问 PG RPC。管理 SQL 仅针对本轮明确的合成项目做只读旁证，不作为跨账号隔离证明。
- 用户授权后开启邮箱登录、邮箱 provider 和内置代发；其他登录配置保持原值。独立浏览器互相掉线的根因是服务商 `MaxDevice=1`，不是两小时自然过期。再次获明确授权后改为 `10`；AccessToken 7200 秒和 RefreshToken 2592000 秒保持不变。见 [邮件配置](assets/issue-69/live/email-auth-enabled.jsonl)、[会话配置](assets/issue-69/live/client-session-enabled.jsonl)。
- Node 24.18.0、pnpm 10.12.1、Next 16.3.6；服务端构建与受限原生团队沿用前阶段已核对的 Python/MetaGPT 环境。

| 部署 | 来源 | 实际检查与边界 |
| --- | --- | --- |
| [真实模型验收部署](https://v0-test0-e2y3aq44b-lnisres-projects.vercel.app/) `dpl_46tFPwSL48c6nqvQsXGQCSYAeLKg` | `54567695a44834b24ea4f3b0d36ae176fe84beaf` | READY；89 个源码文件及 container 输出一致；真实邮箱 Cookie、HTTP/WS、3 个模型任务及采用在此执行 |
| [冲突修复部署](https://v0-test0-pw8x5u2f9-lnisres-projects.vercel.app/) `dpl_2dkrjWVRmrR1ZLyGr6q94347HomT` | `8840a2ae05e486f2224b5af87ba2a96da75cb6e5` | READY；89 个源码文件及 container 输出一致；匿名生成 401；此部署未再执行模型任务，邮箱发码到达但末次登录未完成 |
| 现有生产入口 `v0-test0-nine.vercel.app` | `6f49a6416694b9a770cc0da6784cfb4f9df25e22` / `dpl_VK3bPMP6QkTj66NJKm51yQfPoiYA` | 仍为旧版本；合入前只读核对 Vercel 无 Git 关联，不会因本次合并自动发布 |

两个验收部署都是 `target=production` 的容器构建，使用 `autoAssignCustomDomains=false`，**不是 Preview，也未绑定或切换生产别名**。[首部署核验](assets/issue-69/live/vercel-stage.json)、[修复部署核验](assets/issue-69/live/vercel-final.json) 的 `pending` 字段仅是发布 CLI 的匿名探针结论；真实首部署业务证据另见下表。最后的邮箱格式提示和测试夹具修正由本地检查覆盖，未声称已进入上述两个部署。

## 真实验收结果

| 预期及规格来源 | 实际结果 | 证据与边界 |
| --- | --- | --- |
| 邮件注册/登录，错误与过期可重试（#65 Testing 1） | 授权单邮箱实际收件并完成注册/登录；用户确认 IAB、Chrome 均成功；普通登录没有自动创建项目；错误码反馈修复后可辨认 | CUA 公开 UI＋真实 Auth；服务端回归覆盖挑战绑定、令牌校验、退出撤销。第二部署最后一次 OTP 过期后未重复要求用户登录 |
| 个人示例与同账号跨设备恢复（2、3） | 显式保存示例；A 修改小费计算器，独立 Chrome 恢复 bill=86；后续真实重登重试保存成功 | 合成示例项目 `1bff6044-ed88-4c5a-a0da-31af121281bf`，普通登录 BFF→PG；非手工造 Cookie |
| 数据冲突保全（5、6、11） | 先保存 bill=110 后，旧 Chrome 的 bill=120 写入返回真实 `DATABASE_PT409`；修复后 UI 显示拒绝覆盖并提供下载/重载。下载保留 120；明确重载后读取 110 | [下载核验](assets/issue-69/live/conflict-download-check.json)：未保存、不可导入、有代码且无凭据字段；真实错误形态诊断未输出凭据 |
| 首次生成和正式数据修改（3、8、13） | 真实阅读应用生成成功；指针新增“验收书 A/B”，A 标记已读，删除 B；正式数据成为 A/finished，dataVersion=5 | 普通 Cookie/HTTP/WS 实际调用 DeepSeek；[模型与数据摘要](assets/issue-69/live/real-model-summary.json) |
| 两轮候选与明确采用（8） | 两轮真实候选保留评分试用值 4；正式数据始终无评分。采用一次后 codeVersion=2、dataVersion=5，1 条修改记录含 2 轮生成；正式评分恢复默认 0 | 同上；未把试用数据复制进正式数据，未手改生成 HTML 或审查结果 |
| 同账号恢复零生成（3） | 独立 IAB 通过正常认证读回 codeVersion=2、A/finished、默认评分 0 和两轮修改记录；没有启动第 4 个任务 | 精确项目 `22322cfb-f3bf-42ce-aab3-0c50e373bd4c`；跨浏览器主链路通过，不等同第二部署完整重新登录实测 |
| 独立业务检查（8、9） | 实际首次 HTML：3 个场景、55 条检查通过；实际最终 HTML：4 个场景、103 条检查通过，包括筛选、读取失败、保存失败、未知字段保留 | [首次检查](assets/issue-69/live/initial-real-independent.json)、[采用版本检查](assets/issue-69/live/adopted-real-independent.json)。真实生成代码＋隔离浏览器合成检查数据；不写正式业务数据、不追加模型调用 |
| 公网保存延迟（13） | Chrome Network 中一次删除 B 的数据保存 HTTP 200，Time=6.00 秒 | [单次观察](assets/issue-69/live/latency-observation.json)。含浏览器网络、Vercel BFF/Auth 和上海 PG 往返；不是中位数或各段延迟，未凭此声称性能稳定 |

用户批准最多 3 个合成模型任务，每任务最多 4 分钟/20 次模型请求。实际共 **3 个任务、23 次请求（7/8/8）**，耗时约 39.5/43.0/43.5 秒。额度已用完，未追加真实生成。第三轮原始 Reviewer 结论为 `issues`，仅有 `filter-empty-msg` 一般问题；其引用代码与实际筛选空态均为“没有符合筛选的记录。”。运行检查通过，原始问题保留，未伪称 Reviewer 全部批准。

## 验收中修复的实际问题

1. Auth v1 `/user/me` 实际不返回 `email_verified`。会话现在绑定服务端 OTP 挑战验证的邮箱、用户 ID 和设备，每次访问继续调用服务商重新验证身份；明确 false、service account、身份不匹配仍拒绝。旧结构会话需正常重登，不提供绕过。
2. 每个浏览器使用加密 HttpOnly `atoms-device`，透传 `X-Device-Id`；配合已授权 `MaxDevice=10` 支持独立会话并存。错误/过期验证码的真实 `invalid_argument` 400 映射为可操作提示；窄屏首页保留登录入口。
3. CloudBase 包装 SQLSTATE 为 `DATABASE_PT409`。仅识别固定错误词汇和匹配 HTTP 状态，保留冲突语义，不暴露 provider 文本。此前仅调整 message 结构的尝试未解决实际问题，失败记录保留。
4. 服务商拒绝带“+”的邮箱，未发送成功或创建别名账号。[拒绝证据](assets/issue-69/live/alias-send-rejection.json) 说明服务商限制；应用补充明确的邮箱格式错误提示。用户决定沿用单邮箱，不再寻找其他邮箱。
5. 隔离发布命令冻结源码、仅内存注入运行密钥、检查实际生产别名未变；网关使用经验证的 `VERCEL_URL` 生成部署 origin，继续拒绝不可信请求头推导的来源。

前阶段的工作台稳定源码阅读、长记录操作区、窄屏布局、游客示例源码和云端保存文案修复，以及浏览器驱动迁移，详见历史报告。

## 回归与未执行边界

最终检查记录见 [合入检查摘要](assets/issue-69/live/merge-checks.json)。前阶段 42 个不同浏览器场景、20 个离线原生团队测试通过记录继续有效；它们的 Auth/BFF/provider 为明确夹具，不冒充真实云服务。此次 Auth 页面再测 3/3；最终源码 `128eaa3b14eb6b5f8fa5cd66c9e3089cce2a396c` 的服务端测试 **85/85**，类型检查、lint、生产构建全部通过。未宣称全部旧匿名/IndexedDB 浏览器套件已迁移或全通过。

合入前完整回归保留了两次失败：旧冲突夹具将 PT409 配成 HTTP 400；更严格映射要求两者匹配，现按实测改为 409，并测试不匹配时安全返回不可用。另一次网关测试仅预留外层端口，相邻内层端口被占用；现在预检连续端口对。两者的原始失败与最终结果均有脱敏摘要。

以下没有真实目标端到端证据，按用户本轮单邮箱验收收口决定不再阻止合入：第二真实账号访问拒绝；主动控制在途任务的自然过期/换号及所有迟到响应组合；真实提交后刻意丢响应再重试；修复部署完整登录后恢复。已有服务端、UI 夹具和 SQL 合成 claims 的相应测试仍有效，但与真实普通用户测试分开说明。历史 iframe 首击竞态在本次真实主链路未复现，不据此声称所有环境均已根治。

## 清理与后续发布

本轮自有本地 gateway/Next 已核实归属后停止，3179/3180 均释放，见 [清理记录](assets/issue-69/live/cleanup.json)。没有删除用户已有数据；保留两个明确的合成项目与隔离部署供复核。保留既有 Vercel automation bypass、保护设置和 #68 artifact key；模型、管理、Auth/QA 密钥及 OTP 未写入归档报告、下载副本或提交。无套餐、计费、域名变更。

PR 合入按用户最新指令执行。正式生产发布仍需使用合入后的冻结源码、匹配的 Auth/QA/artifact 参数及明确的生产 origin；本次未调用生产 create/promote 或修改现有域名指向。#69 与父规格的正式发布状态应与这一事实保持一致，不能用“验收完成”冒充旧生产入口已升级。
