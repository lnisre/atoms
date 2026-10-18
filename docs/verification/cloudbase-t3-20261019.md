# CloudBase T3 临时内测交接准备

对应 [#93](https://github.com/lnisre/atoms/issues/93)，2026-10-19。用户当前目标是默认 HTTPS 域名的小范围邀请内测。正式域名、生产切流和至少 48 小时生产观察后补；现有 Vercel 正式入口保留。

## 本轮代码

- 完整源码构建的日志读取按 `Total / Delivered / More` 有界分页，只接受唯一的最终 push manifest digest，并保存每页脱敏摘要，避免只读首页遗漏镜像身份。
- 发布目标支持显式维护模式，以同一 digest 的配置版本禁止新生成和 WSS 升级，同时保留页面、Auth 和项目保存通道。该检查覆盖已打开页面的新请求。维护配置切换可能中断已有连接；没有增加后台续跑、请求重放或无损排空承诺。
- `/healthz` 报告维护状态；发布核验精确匹配它。回退执行要求当前远端维护版本、精确前版本和管理任务完成，默认仍只生成请求，未操作数据库。
- 发布说明补充内测维护、回退演练、恢复和资源停用流程。缩零与停用明确分开；不能把最小实例数零视为停止访问或零成本。

局部检查：Node 24.18.0 下发布、网关与既有 Vercel 发布回归共 **23 项通过**；包含真实网关进程的维护拒绝与其他路由透传、多个 Cookie、错误来源、进程组终止、日志末页 digest、分页停滞拒绝和回退维护门槛。修改的 JavaScript ESLint 与 `git diff --check` 通过。这些检查使用合成 API/HTTP 服务，不是 CloudBase 产品验收。

## 已完成的只读检查

2026-10-19 核对上海环境 `atoms-d9gdf8r2036664366`：套餐 `baas_personal`、状态 `NORMAL`、`EnableOverrun=false`。请求 ID `0a8e70a9-badb-4cc3-8e81-2c30de2b95ad`。当时服务清单只有归属 T1 的探针 `atoms-t1-probe-20261019`，待建内测名不存在；清单请求 ID `84ee1beb-eddf-4cf1-842d-0526d724e684`。实际发布前仍须重读，以避免覆盖同名服务。

T1 清理后，只读比较未建 beta 与已删除探针：服务详情均 `ResourceNotFound`；部署记录均 `InvalidParameter`，在内存精确匹配官方 manager 用于缺失服务的已知消息，未打印原始错误。请求 ID 分别为 `97e1b29f-1332-48fd-9602-b090d16e9ee3`、`3dc64e5d-9b73-4992-931d-5d58fd532c3a`。已核对[官方查询部署记录合同](https://cloud.tencent.com/document/api/1243/126759)与 `manager-node@5.9.1`，输入仅为 `EnvId / ServerName`，没有遗漏分页参数。此结果解释缺失服务时的返回，不证明存在服务的状态/核验已通过；真实成功读回仍待实际部署。

## 发布边界与待执行项

已准备独立服务 `atoms-beta-20261019`，保留生产名 `atoms-production`；资源为 1 CPU、2 GiB、最小 0 / 最大 1。复用现有 Auth/PG 与 `atoms` namespace，目标显式 `existing-account-data` 和 `sharedDataAuthorized=true`，不迁库、不初始化用户、不改 schema、不轮换密钥。

实际部署尚未执行：自动审批拒绝了“从 Vercel 读取解密运行配置，仅内存注入新 CloudBase 服务并创建云资源”动作，理由是当前直接可见的用户授权不足以覆盖这次敏感密钥转移。拒绝发生在命令启动前，没有执行密钥读取、上传或创建；未通过更换工具或拆分命令绕过。待主线程向用户展示最终冻结计划并取得该具体动作的直接确认。

计划复用的值为 `DEEPSEEK_API_KEY`、`QA_TOOL_SIGNING_KEY`、`CLOUDBASE_ENV_ID`、`ATOMS_AUTH_SECRET`、`ATOMS_ARTIFACT_SECRET`；origin 与 namespace 按目标设置。Vercel Token 和腾讯管理密钥只用于管理 API，不进入应用环境、源码、镜像、构建参数或记录。首次发布使用业务来源禁用的引导 origin；实际域名读回后，应复用同一已核验镜像 digest 更新精确 origin，完成第二轮身份核验才形成可交付入口。

本记录未调用 verify-atoms，未声称完整镜像构建、真实默认域名健康、邮箱登录、真实模型生成、跨账号/跨设备、八分钟任务、第二版本回退或资源测量通过。上述产品验收由主 agent 在全部实现之后统一执行。原 ticket 和父规格保持未完成，不以代码准备替代正式迁移。
