# CloudBase 临时内测：实际部署与公开入口验证

关联 [#90](https://github.com/lnisre/atoms/issues/90)、[#91](https://github.com/lnisre/atoms/issues/91)、[#92](https://github.com/lnisre/atoms/issues/92)、[#93](https://github.com/lnisre/atoms/issues/93)，实现见 [PR #94](https://github.com/lnisre/atoms/pull/94)。2026-10-19，Asia/Shanghai。

## 结论与范围

[临时内测地址](https://atoms-beta-20261019-326112-8-1254675888.sh.run.tcloudbase.com)已部署。主线程收到用户对五项运行配置读取及内存传递的直接授权后，由 T3 subagent 完成真实发布；主 agent 按 verify-atoms 核对远端来源并驱动独立 Chrome，所选公开入口检查通过。用户选择“部署后我自己登录”，因此真实邮箱、账号数据与模型任务没有被自动执行或记为通过。

仅供少量受邀者测试，首次按平台提示正常点击“确定访问”。[官方默认域名规则](https://docs.cloudbase.net/service/alias)是开发测试边界。当前正式入口仍为原 Vercel 部署，正式域名、生产切流及 48 小时生产观察未完成。

## 发布身份

| 项目 | 实际值 |
| --- | --- |
| 上海环境 / 服务 | `atoms-d9gdf8r2036664366` / `atoms-beta-20261019` |
| 应用冻结提交 | `7113b8e1820ec8802bd64025662f1f6424402c4d` |
| 95 个应用输入的源码摘要 | `7b6dd02991c62594af20b4ada18f4029529e98d45bee8dfa2743c39a39962b8f` |
| 源码包 SHA-256 | `2f58492c6f972c3b7eee066bec5e906acb2049cf92e5c2c19611ef170d748345` |
| 完整 Linux 镜像摘要 | `sha256:7be7fef857fa9677bcf8eb3748708c20c74bab5f29b42c9ed45ea789325b03ff` |
| 当前版本 / 流量 | `atoms-beta-20261019-002` / 唯一 100% |
| 资源 | 1 CPU / 2 GiB，Min0 / Max1，公开网关 3000 |
| 数据 | 复用现有 Auth/PG 与 `atoms` namespace，不重建账号、不改 schema、不轮换密钥 |
| 最终平台读回 | 10:58:55，个人版 NORMAL / PREPAYMENT，超限关闭；1 个 Running Pod |

后续 `09b0e83`、`c59f6c7` 仅修改发布工具、测试和说明；重新计算确认应用输入摘要未变。镜像中的冻结身份仍为 `7113b8e`。[构建证明](assets/cloudbase-beta-20261019/source-build.json)、[部署核验](assets/cloudbase-beta-20261019/deployment.json)、[平台快照](assets/cloudbase-beta-20261019/platform.json)互相对应。

## 首次失败与恢复

源码构建 `BuildId=2608937894` 完成依赖安装、`pip check` 和 Python 原生测试，并推送了唯一镜像 manifest。首次 `TaskId=2395587` 的版本 001 创建超时，没有在线版本。[失败状态](assets/cloudbase-beta-20261019/initial-create-failed.json)保留；两次相隔约 26 秒的进程日志均只有相同的高层事件，没有足够信息确定调度、拉取或启动环节的具体根因，不能断言是 OOM 或健康检查延迟不足。

恢复工具把“源码镜像已构建”与“应用部署健康”分开记录，严格绑定原 attempt、提交任务、源码摘要、失败版本、构建 ID 和最终推送摘要。它只允许同一服务、已知失败任务、无在线版本且无其他发布时进行受审计的更新。没有删除 attempt 重发或重建源码。`TaskId=2396338` 直接使用同一 `@sha256` 镜像和 API 实际域名，版本 002 正常启动。部署核验同时检查精确运行配置、唯一流量版本、镜像和实际 `/healthz`；健康直接 HTTPS 返回通过。

官方[故障诊断说明](https://docs.cloudbase.net/ai/cloudbase-ai-toolkit/prompts/cloudrun-development)区分构建日志与运行日志，并说明仅出现超时不足以支持调大就绪延迟。本轮保持资源和 `InitialDelaySeconds` 原值，没有以增加资源或放松健康检查掩盖失败。

## verify-atoms 公开入口结果

11:00 前完成的最终浏览器记录使用真实 DOM、iframe 和同源接口，没有 Auth/PG/model fixture，没有注入平台确认 Cookie 或安全头。[最终结果](assets/cloudbase-beta-20261019/public-03.json)。

| 预期与依据 | 实际观察 | 结果 |
| --- | --- | --- |
| #90–#93：默认域名正常进入，实际运行来源可核对 | 正常倒计时确认后首页及脚本/CSS 为 200；实际健康为冻结提交/源码摘要、Next ready、maintenance=false | 通过 |
| ADR 0015：游客示例只读 | 打开小费示例，每人 ¥5.25；真实鼠标和键盘输入后账单仍为 20；源码视图及返回预览可用 | 通过 |
| ADR 0015：游客生成要求登录并保留输入 | 点击“开始生成”显示邮箱登录，关闭后需求仍在；没有发验证码或建立模型 WSS | 通过 |
| ADR 0015/0016：匿名无账号数据与生成权限 | 实际 `/api/auth/session`、`/api/projects`、`POST /api/generate` 均 401 / unauthenticated / no-store | 通过 |
| 默认域名刷新与项目深链 | 同一上下文刷新不再提示；合成 UUID 深链呈现应用登录入口 | 通过；不证明项目数据读取 |
| 真实邮箱 / 普通用户 PG / 付费模型 / 远端完整 480 秒任务 / 云端应用回退 | 未执行；用户选择自行登录。既有独立探针的 600 秒和本地长验不替代此项 | 未验证 |

首轮临时驱动把示例按钮名称过度限定，导致 selector 超时。[第一轮失败](assets/cloudbase-beta-20261019/public-01.json)保留。第二轮未等待账号初始化结束就点击示例，未打开预览；[第二轮](assets/cloudbase-beta-20261019/public-02.json)保留，未确定是否为首屏交互窗口。最终驱动等待可观察的“游客”和登录按钮启用后，单次点击完整通过；没有修改产品、使用 DOM click、force 或自动重试。此结果不能证明所有首屏点击窗口已消除。

截图：[平台提示](assets/cloudbase-beta-20261019/platform-reminder.png)、[首页](assets/cloudbase-beta-20261019/home.png)、[只读示例](assets/cloudbase-beta-20261019/readonly-example.png)、[登录入口](assets/cloudbase-beta-20261019/login-gate.png)。没有账号、验证码、Cookie 值或用户项目内容。浏览器异常为 0，实际邮件和真实模型调用均为 0；匿名保护探测有一次明确的拒绝型 POST，不是生成任务。

## 工程检查与保留资源

恢复工具改动后，完整 Node 回归 **132/132**，0 失败、0 跳过；后续只读 Pod API 范围补充由 owning agent 的 9 项发布测试、ESLint 和 diff check 验证。既有 lint/typecheck/build、固定 Python 20/20、本地 426 秒成功 / 480 秒截止及浏览器统计见[统一本地报告](cloudbase-migration-20261019.md)。[本次工程摘要](assets/cloudbase-beta-20261019/engineering.json)与[原始 Node 结果](assets/cloudbase-beta-20261019/node-post-recovery.tap)保留。

部署前后独立读取 Vercel 正式别名，均为 `dpl_A2xqy6cFfWTwo5UrwGph8d2kuhHE`、READY、production，见[发布前](assets/cloudbase-beta-20261019/vercel-before.json)和[发布后](assets/cloudbase-beta-20261019/vercel-after.json)。该次 API 未给源码字段，记录为 null，不据此伪造提交来源。

所有本轮独立浏览器已关闭；不再运行本地服务。beta 服务按授权保留，Min0 允许闲置缩零，不等于停用或零成本。计费快照只证明个人版及超限关闭，没有把异步记账推断成剩余额度。不得自动删除 beta、旧 Vercel、撤销凭据或将本次结果记为正式迁移完成。当前未演练对用户可用的应用回退；版本 001 的禁用业务 origin 和失败状态不能作为可交付回退点。

先前自动审批拒绝的配置转移已由主线程明确授权解决。后续“输出整份脱敏构建日志”的诊断命令被自动审批拒绝，原因是不能保证未知敏感内容已全部移除；该命令未执行，后续仅在内存提取固定状态/分类，未公开原始日志。公开证据不含运行密钥、管理凭据、签名上传 URL、fingerprint key 或凭据路径。
