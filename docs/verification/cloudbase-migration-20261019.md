# CloudBase 迁移：代码交付与最终验证

关联 [#91](https://github.com/lnisre/atoms/issues/91)、[#92](https://github.com/lnisre/atoms/issues/92)、[#93](https://github.com/lnisre/atoms/issues/93)，父规格 [#90](https://github.com/lnisre/atoms/issues/90)。2026-10-19，Asia/Shanghai。

## 结论

三个任务的代码已由 subagent 依次交付，随后使用 verify-atoms 完成统一本地验证。发现并修复了会让八分钟任务在约五分钟提前结束的内部 HTTP 流空闲超时；修复后，真实网关、Next、Python 与固定 MetaGPT 的离线长任务验证通过。

**完整 CloudBase 内测服务尚未部署，没有可交付的内测 URL。** 自动审批拒绝了读取现有 Vercel 解密运行配置并注入新 CloudBase 服务的动作，原因是侧边转交不足以授权这次敏感配置转移。主线程已请求用户直接确认，当前仍待回复。被拒的部署命令未执行；既有配置只做过内存中的只读可用性核对，没有向 CloudBase 传递运行密钥、上传应用包或创建完整内测服务。

当前目标按用户最新决定为“默认 HTTPS 域名、少量邀请内测”。正式域名切流和至少 48 小时生产观察后补，现有 Vercel 正式入口保持原样。原任务与父规格保留未完成，不以代码、本地验证或合成探针替代这些公网要求。

## 代码与来源

- `3ea3c5d`：只读 CloudBase 环境/计费审计、独立合成网页与 WSS 探针。
- `5b5da98`：冻结源码打包、独立服务发布/状态/核验/回退、可信 origin、版本健康及有界进程组清理。
- `872a759`：默认域名的实际入口、两轮完整 600 秒证据及资源清理记录。
- `e2a48a1`：内测维护模式、真实构建日志分页、回退维护门槛与交接说明。
- `ca903e6`：采用原因定位器漂移修复；普通业务指针检查沿用既有 hover 同步，直接首击探针未改。
- `7113b8e`：内部 NDJSON 空白保活、严格白名单错误诊断及取消/失联/截止回归。

最终应用源码冻结在 `7113b8e1820ec8802bd64025662f1f6424402c4d`，95 个应用输入文件，`sourceDigest=7b6dd02991c62594af20b4ada18f4029529e98d45bee8dfa2743c39a39962b8f`。新增文档与验证证据不改变这些应用字节。Node 24.18.0、pnpm 10.12.1、Python 3.11.14；MetaGPT 固定为 `11cdf466d042aece04fc6cfd13b28e1a70341b1f`，沿用仓库补丁与锁定依赖，独立环境 `pip check` 通过。

## 验收结果

| 预期与来源 | 实际观察 | 证据 | 结果 |
| --- | --- | --- | --- |
| #92/#93 工程门禁 | lint、类型检查、完整 Next standalone 构建通过；最终 Node 130/130、Python 原生调度 20/20，无跳过 | [工程摘要](assets/cloudbase-final-20261019/engineering-checks.json) | 通过 |
| verify-atoms 账号、生成、候选、云端冲突、历史、进度与预览 | 首轮 64 个场景为 61 通过、3 失败；随后串行定向复验 5/5，通过范围包括原 3 项及 2 项原生停止 | [完整统计与失败](assets/cloudbase-final-20261019/browser-results.json) | 所选场景有通过记录，保留首轮失败 |
| ADR 0016 / #92 长执行不被中间传输提前切断 | 离线供应商使 Engineer 实际等待 420 秒；完整任务约 426 秒成功，预览中真实指针加一并确认数据保存 | [原生长任务](assets/cloudbase-final-20261019/native-final.json)、[截图](assets/cloudbase-final-20261019/native-long-success.png) | 通过，本地离线 |
| #92 原 480 秒预算、两任务及停止清理 | 并发另一任务在 480 秒截止后约 87ms 进入 limit；第三任务返回繁忙且没有模型请求；结束后 Python 为 0，未重置预算 | 同上 | 通过，本地离线 |
| #93 维护版本拒绝新执行、保留账号与项目通路 | 普通公开 UI 登录可用；新生成 503、需求保留；项目读取 200，没有 WSS 或模型调用 | [维护结果](assets/cloudbase-final-20261019/maintenance-ui.json)、[截图](assets/cloudbase-final-20261019/maintenance.png) | 通过，本地合成 Auth/PG |
| #91 默认域名仅按测试用途正常访问 | 倒计时后正常点击确认；HTML、静态 JS、Cookie、刷新及原生 WSS 可用；Min1、Min0 各一轮三条活动连接约 601 秒正常结束，服务端时间配对 | [平台报告](cloudbase-default-entry-probe-20261019.md) | 通过，独立合成探针 |
| 完整 CloudBase Linux 镜像、真实账号与模型、实际资源峰值、应用第二版本及回退 | 因配置转移审批未执行完整服务部署；本地结果不扩展为公网或真实供应商结果 | [发布边界](cloudbase-t3-20261019.md) | 待授权后执行 |
| 正式域名迁移、切流及 48 小时生产观察 | 不在本轮已完成范围，Vercel 保留 | #90 / 最新范围评论 | 后补 |

本地浏览器的 Auth/PG 为明确的合成响应；原生长任务使用真实生产执行器和 MetaGPT 调度，但供应商由已有 fixture 加两种显式延时标记替代。真实模型调用及真实邮件发送均为 **0**。本地 Darwin 进程树 RSS 样本见原生摘要，不能视作 CloudBase Linux 容量验收。选定场景按新增风险复验，未宣称整个历史浏览器套件全量通过。

## 保留的失败与修复

1. **内部 HTTP 空闲超时是实际运行缺陷。** 修复前，两任务心跳/ACK 正常却约 306 秒收到连接错误。[失败记录](assets/cloudbase-final-20261019/native-before-fix.json)保留。独立 Node 24 对照确认静默 body 约 301 秒出现 `UND_ERR_BODY_TIMEOUT`，符合 [Undici 的 body 间隔超时合同](https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md)。当前复用原 500ms 看门狗，每 5 秒无输出时写空白行，网关吞掉空白；不新增模型进展、续租或任务时间，所有终态复用原清理。详见[因果对照与回归](cloudbase-internal-stream-idle-20261019.md)。
2. **验证定位器漂移。** 新进度提示与原采用禁用原因都含“执行阻断”，原宽定位器出现双匹配；现从按钮可访问描述验证精确原因。一次定向复验还因 Chrome context 初始化超时失败，随后串行 5/5 通过；失败记录保留。
3. **既有直接首击竞态仍未证明消除。** 首轮父页面收到目标为 `IFRAME` 的 pointerdown/up/click，子按钮计数未变。[事件](assets/cloudbase-final-20261019/direct-first-pointer-events.json)与[截图](assets/cloudbase-final-20261019/direct-first-pointer-failed.png)保留。未修改产品或直接首击探针；后续六次直接点击通过，只表示该观察窗口成功。普通业务试用流程采用已有的真实 hover 同步后一次 click，不用 Enter、DOM click、force 或自动重试代替。
4. **临时长任务驱动的两次文案定位错误。** 第一次繁忙文案匹配多个区域，另一次末尾将服务端原因误限定在进度区域；修正驱动后从新目录完整复验通过。[修复后仍带定位失败的原记录](assets/cloudbase-final-20261019/native-after-fix-driver-locator-failure.json)保留，其中真实执行与截止数据已正确，不改写为整段驱动通过。
5. **独立 CloudBase 探针首次共同 1006。** Min0 首轮约 274 秒共同中断，Pod 未退出，随后独立连接超过 420 秒；未找到确定根因。Min1、Min0 后续各通过 600 秒，不能因此把常驻实例称为必要修复，也不能将此平台/共同链路失败与已定位的应用内部 HTTP 问题混为一谈。

验证技能维护限定为 account-cloud 功能：补齐已存在的采用、进度和历史控制入口，并区分同步业务指针流程、直接首击、平台探针与完整原生执行。源阅读和现场复验已完成，维护结果为 changed；产品缺口与公网待验项按上表保留。

## 清理与继续条件

独立平台探针已删除并复查服务列表为空，个人版及超限关闭设置未改。所有本地测试浏览器已退出，网关与 Next 的归属先核对后停止，32315/32316 均释放，Python 无残留，见[清理结果](assets/cloudbase-final-20261019/local-cleanup.json)。仅保留独立依赖缓存、固定上游源码和验证证据，不影响用户原工作目录。

待直接确认的动作是：从原 Vercel 项目读取 `DEEPSEEK_API_KEY`、`QA_TOOL_SIGNING_KEY`、`CLOUDBASE_ENV_ID`、`ATOMS_AUTH_SECRET`、`ATOMS_ARTIFACT_SECRET`，只在可信进程内存中传入上海独立 `atoms-beta-20261019` 服务；1 CPU / 2 GiB、Min0 / Max1，复用现有 Auth/PG 和 `atoms` namespace，超限扣费保持关闭。管理凭据不进入应用，不改 Vercel 正式入口。

修复后的纯本地冻结计划位于 `/tmp/atoms-cloudbase-t3-20261019/final-verified-bootstrap/`，未提交部署；引导 origin 只是禁用业务来源的占位，不能交付给访客。获得授权后，用该计划构建并核验完整镜像，再以同 digest 绑定 API 读回的实际默认域名，完成公网普通登录、真实生成/修改及应用回退验收后才交付内测 URL。
