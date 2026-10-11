# CloudBase 管理能力实测（2026-10-10）

时间：2026-10-10 14:54–15:11（Asia/Shanghai）。目标环境：`atoms-d9gdf8r2036664366`，上海。由用户要求的 subagent 执行；认证来自本地 `tx.tokens`，未记录密钥、Auth 客户端 Secret 或完整响应。

## 结论与边界

| 能力 | 实测结果 | 不可扩大解释为 |
| --- | --- | --- |
| PG 管理读写 | 通过：独立表 DDL、合成记录增删改查、乐观版本条件更新、事务提交/回滚、清理 | 尚未验证普通用户 JWT、RLS 用户隔离、浏览器跨设备恢复或 Vercel 保存时延 |
| Auth 配置查询 | 通过：登录开关、默认 client、provider 列表 | 不代表邮箱验证码已启用或送达正常 |
| Auth 独立配置写入 | 通过：新增禁用 OAuth provider、修改、读回、删除 | 不代表全局 `ModifyLoginConfig`、默认 client 写权限或真实登录链路已测 |
| 容器托管 | 通过：开通、创建服务、源码上传、镜像构建、正式发布、日志查询、公网健康请求 | 未验证第二版本发布/历史版本回退或 Atoms 完整 Node＋Python＋WebSocket 运行 |
| 实际容器部署 | 版本 001 已 normal，100% 流量，健康端点 HTTP 200 且固定标记匹配；已删除且列表复查 Total=0 | 不能以健康服务代替完整应用验收；底座继续保持开通 |

数据库测试表及 Auth 临时 provider 已删除并复查。未读取已有用户业务记录，未创建真实用户，未发送验证码/邮件/短信，未改全局登录开关，未购买、升级或触碰现有 Vercel 部署；使用现有体验环境资源点开通了托管底座，并部署后清理独立健康服务。

## 方法与工具

从 npm 查询并在 `/private/tmp/atoms-cloudbase-capability` 安装官方 `@cloudbase/cli@3.8.5`（禁用安装脚本，不改项目依赖），检查其打包的 Manager SDK，确定 action、参数与 API 版本；真实调用使用复用的 TC3-HMAC-SHA256 签名 Node 脚本，直连腾讯云官方 API，地域 `ap-shanghai`。本次不是通过 CLI 命令或 MCP 会话执行，不能标作“CLI/MCP 已端到端验证”。

- PG / Auth：`tcb.tencentcloudapi.com`，版本 `2018-06-08`。
- 托管：`tcbr.tencentcloudapi.com`，版本 `2022-02-17`。
- 脚本显式投影非敏感响应字段，未打印 token、Secret、完整 provider Config。
- 脱敏执行结果和临时脚本保存在 `/private/tmp/atoms-cloudbase-capability/`；以下 RequestId 与结果摘要纳入仓库留档。

官方能力依据：[PG SQL 与迁移 CLI](https://docs.cloudbase.net/cli-v1/db/postgresql/management)、[MCP 管理工具规格](https://docs.cloudbase.net/ai/cloudbase-ai-toolkit/mcp-tools)、[AddProvider API](https://cloud.tencent.com/document/product/876/129357)、[云托管 API](https://cloud.tencent.com/document/product/876/126824)。

## PostgreSQL

开始只查 `information_schema.tables` 的 public 表数量，结果为 0，不读取应用业务表。首次按官方推荐指定 `Role=cloudbase_read_only_user` 查询失败：`FailedOperation.PGExecuteSqlError` / SQLSTATE `42501`，提示无权 SET ROLE 到该只读角色。RequestId：`ace7d96f-385a-4fda-a15e-24d409ff9251`。随后移除显式 Role，仅执行相同只读 SQL 成功（RequestId `f5f24e57-7cb2-4583-8094-7004ae52e34e`）。这说明该文档推荐角色在当前环境不可直接使用，不是整条 SQL 管理 API 被拒。

独立测试表：`public.atoms_capability_20261010_b5e7`，预先确认名字未占用。创建与 `ENABLE ROW LEVEL SECURITY` 放在同一 DO 块，只有合成记录，无授权给普通用户的 policy。管理角色访问成功不能用于证明 RLS 隔离。

测试核心：

```sql
-- 条件更新；首次影响 1 行，用旧 version=1 重试影响 0 行。
UPDATE public.atoms_capability_20261010_b5e7
SET value='two', version=version+1
WHERE id='synthetic' AND version=1;

-- 单个 DO 块原子执行两条写入。
DO $$ BEGIN
  UPDATE public.atoms_capability_20261010_b5e7
  SET value='three', version=3 WHERE id='synthetic';
  INSERT INTO public.atoms_capability_20261010_b5e7
  VALUES ('commit-marker','committed',1);
END $$;
```

回滚测试使用另一个 DO 块修改 version=4 并插入 rollback-marker，再主动 RAISE EXCEPTION。服务返回预期 SQLSTATE P0001；后续独立查询确认 version 仍为 3、value 仍为 three、commit-marker 存在、rollback-marker 不存在。因此既验证了成功提交，又验证了失败原子回滚，而非仅凭错误推断。

此管理 API 对 `INSERT/UPDATE/DELETE ... RETURNING` 实测 `Columns/Rows=null`、`AffectedRows` 有效；需要行内容时额外 SELECT 或选用运行时数据库/RPC 接口。初次本地 preflight 将 bool 字符串误按 t 解析，断言停止在只读查询；修正为接口实际 `"true"` 后才开始创建表，没有残留资源。

单次 API 往返主要约 136–367 ms，首次只读 351 ms；只是本机到管理 API 的小样本，不代表浏览器或 Vercel 业务保存性能。

| 本地时间 | 操作 | 结果 | RequestId |
| --- | --- | --- | --- |
| 14:56:17 | preflight | 成功；影响 0 行；["[\"true\"]"] | `daf6eea7-7558-4c9c-9f78-5311f2d3a6f0` |
| 14:56:17 | create-isolated-test-table | 成功；影响 0 行 | `566a8af9-2862-48aa-9af4-d3ed283d8b87` |
| 14:56:18 | insert | 成功；影响 1 行 | `9b29b898-c9e7-4be5-aaeb-d7354cc12902` |
| 14:56:18 | read-after-insert | 成功；影响 0 行；["[\"synthetic\",\"one\",\"1\"]"] | `07b300c9-5d7d-4905-a331-c58eece04a80` |
| 14:56:18 | conditional-update | 成功；影响 1 行 | `69da06e4-341b-41f9-87ea-204604467d17` |
| 14:56:18 | reject-stale-version | 成功；影响 0 行 | `ed84f354-683c-4676-8d13-44e05518ee36` |
| 14:56:18 | atomic-commit | 成功；影响 0 行 | `a86760cb-da35-4c16-9fbe-476f18647a78` |
| 14:56:18 | intentional-rollback | FailedOperation.PGExecuteSqlError | `6a6a4c11-434a-4b61-bbc1-fe891f7624e5` |
| 14:56:19 | verify-commit-and-rollback | 成功；影响 0 行；["[\"3\",\"three\",\"true\",\"true\"]"] | `93d13032-8a83-49ef-a455-4652641b52a8` |
| 14:56:19 | delete-test-rows | 成功；影响 2 行 | `99f181b6-9aa7-4741-8f47-28459ab3fa07` |
| 14:56:19 | drop-test-table | 成功；影响 0 行 | `d6e4985a-8efe-447a-a138-75fe7496bab4` |
| 14:56:19 | verify-cleanup | 成功；影响 0 行；["[\"true\"]"] | `5ed426b9-27bc-452e-bcc2-40a3b86efd10` |

最终再次查询 public 表数量为 0（RequestId `9e1d5e75-86d2-4d07-b790-b19fe27a0ac6`），表不存在验证为 true。

## Auth

查询结果：邮箱登录 false、匿名登录 false、用户名登录 true、手机登录 false。默认 client 查询成功，但其 Secret/凭据没有输出或写文件。初始 provider 只有 email/CUSTOM 两个逻辑入口，均为 On=FALSE（实际 ID 为 `email` / `custom`）。

独立 provider：`atomscap20261010b5e7`，类型 OAUTH，明确 `On=FALSE`，自动邮箱/手机号关联均 FALSE；使用保留 `.invalid` 域名与合成 ClientId/Secret，不进行 Discovery 或登录、不访问第三方、不注册用户。官方 API 明确 FALSE 会禁用并隐藏入口。新增后读回确认禁用，修改显示名称再读回，最后删除。没有修改原 provider、默认 client 或全局登录配置。

| 本地时间 | 操作 | 结果 | RequestId |
| --- | --- | --- | --- |
| 14:57:20 | provider-preflight | 成功 | `ed56d08d-5659-4b77-b614-4145477d2ce5` |
| 14:57:21 | create-disabled-isolated-provider | 成功 | `0113e970-f156-4b52-82d6-30874736192f` |
| 14:57:22 | verify-disabled-provider | 成功 | `699c776a-e729-481b-b2c1-d739e7ae9769` |
| 14:57:22 | modify-test-provider | 成功 | `da082246-0dae-4c82-a057-6f502817ea36` |
| 14:57:22 | verify-provider-update | 成功 | `82fb774c-dbd9-4ba2-b53e-914b1bf02a37` |
| 14:57:23 | delete-test-provider | 成功 | `93ab57cb-130f-46b4-8847-8840757a3210` |
| 14:57:23 | verify-provider-cleanup | 成功 | `2ee588e9-bebf-4767-acee-3d88f09abb8a` |

最终 provider 恢复原两项且 On 均 FALSE；全局登录开关再次查询与开始完全一致（RequestId `d863bcb0-60b4-4a9e-a6ce-e82ba0057ab9`）。

## 容器托管实测

初始 `DescribeCloudRunServers` 成功但服务数 0；`DescribeEnvBaseInfo.IsExist=false`。进一步核对官方 MCP `buildCreateCloudRunEnvParam`：在已存在 CloudBase 环境内传 `EnvId`、`EnvType=baas`、`PackageType=Trial`，没有购买、升级或更改超限计费调用。实际计费信息为 `baas_trial` / `PREPAYMENT` / `credits`，`EnableOverrun=false`、`IsAutoRenew=false`。因此在用户已授权测试的范围内，继续使用现有体验额度开通和测试，无需仅因“尚未开通”额外请求授权。[官方源码](https://github.com/TencentCloudBase/CloudBase-MCP/blob/main/mcp/src/tools/cloudrun.ts)、[开通 API](https://cloud.tencent.com/document/api/1243/75707)

15:03:10 开通成功，`TranId` 为空（无订单），RequestId `6f78ec57-bea4-4b11-bec1-83550b98520c`。随后状态 normal；开通前后套餐和超限开关一致。

测试服务 `atoms-capability-20261010`，源码 ZIP 493 字节，仅含 Dockerfile 和 Node HTTP 程序，基于 `node:22-alpine`；监听 `0.0.0.0:8080`，任何路径只返回固定 JSON，不回显请求头或环境变量，无业务依赖、无应用密钥。使用平台生成的 HTTPS 上传目标 `cloudbaserun-code-cos.cloudbase.net`；签名 URL 从未输出或落盘。

创建配置经服务端读回：0.25 核、0.5 GiB、MinNum=0、MaxNum=1、Port=8080、PUBLIC。通过 API 明确小规格，未采用 CLI 默认规格。CloudBase CLI 3.8.5 的 help 已实际运行（首次启动创建其本地配置目录），真实发布仍是与 Manager SDK 一致的官方 API 调用，不是 CLI 发布命令。

| 时间（上海） | 操作/结果 | 证据 |
| --- | --- | --- |
| 15:05:56 | 获取上传票据，493 字节 ZIP 上传 HTTP 200 | RequestId `0644fca2-2240-4545-a41a-c0a77d8d645e` |
| 15:05:58 | `CreateCloudRunServer` 成功，TaskId=2323885 | `a63688c1-ff77-4818-9325-9c6088634087` |
| 15:06:01 | 版本 001 开始构建，BuildId=2608443413 | RunId `multi_tenant_1xFR9cRh2HPY8E` |
| 15:06:57 | Docker 镜像构建并推送成功 | 镜像 digest `sha256:bfb705dfc94e8b8f72927ac6d1a99255ea92ea3b248753f26c2f72eb5ff0d69d` |
| 15:08:34 | 管理任务 finished，CreateVersion 137 秒，ReleaseVersion 4 秒 | `964b0d89-b93f-4493-a0d3-188a064622fe` |
| 15:08:56 | 版本 normal、100% 流量 | `d6d876c9-50e7-4993-bc79-e27bcd2e8ea1` |
| 15:08:57 | `/health` HTTP 200，715 ms，返回 `{"ok":true,"marker":"atoms-capability-v1"}` | `health-result.json` |
| 15:09:38 | 删除本次临时服务成功提交 | `1bbc8eee-8833-4133-841d-d269acd70bd1` |

构建日志 `DescribeCloudRunBuildLog` 与过程日志 `DescribeCloudRunProcessLog` 均成功，无需本轮人工开通 CODING。过程日志确认 create/check 容器服务成功。未做第二版/回退测试。

资源点用量接口成功，所查模块当时均为 0；这是异步用量尚未记账，不能说本轮没有资源消耗。CLI 的模块列表没有 PG 项，故也不能把其汇总视作 PG 在内的完整即时余额。[当前官方资源点价格](https://cloud.tencent.com/document/product/876/127357)列出体验版 3000 点/月，不能开启按量付费；CPU 55 点/核时、内存 32 点/GB时，流量、日志另计。当前规格假设运行 10 分钟的 CPU+内存约 4.96 点，仅供量级参考，不是完整账单上限。官方统计延迟可达 2 天。

清理保留事项：共享云托管底座保持 `normal` / `Trial`，未销毁整个环境。平台托管的构建源码包、镜像与日志保留周期未单独验证，不声称云端无任何构建痕迹。服务删除是异步操作；15:11:03 复查 `DescribeCloudRunServers` 返回 `Total=0`、`ServerList=[]`，RequestId `f5873c58-e09a-42d7-aa4c-d0b78dc90a96`，确认本次运行服务已清理。删除后计费复查仍 `baas_trial/PREPAYMENT/credits`，`EnableOverrun=false`、`IsAutoRenew=false`（RequestId `bd530d37-460a-4247-8a19-e8ec3a37f944`）。

本轮脚本和脱敏结果：`hosting-init.mjs`、`billing-read.mjs`、`usage-read.mjs`、`deploy.mjs`、`deploy-status.mjs`、`deploy-logs.mjs`、`health-check.mjs`、`deploy-cleanup.mjs`、`post-cleanup.mjs`，以及对应 `*-result.json`，均在 `/private/tmp/atoms-cloudbase-capability/`。`health/` 内是可复用的无密钥源码。

## 下一步

数据库管理与 Auth provider 管理已有真实可逆操作证据，具备进入登录/云端保存实现的基础。实现前仍需单独验证真实用户认证、邮箱送达及配额、按用户授权/RLS、运行时事务接口、旧数据迁移和 Vercel 到上海延迟。默认只读角色不可用与 DML RETURNING 无行内容是已发现的工具差异，应在 Agent 操作脚本中处理。

CloudBase 已具备 Agent 操作数据库、Auth provider 和容器发布的实测基础；后续仍需完整 Atoms 容器、长 WebSocket 连接、运行任务取消、发布/回退语义验收。本报告不更改当前部署决策，也不把管理权限测试当作 Atoms 登录功能验收。
