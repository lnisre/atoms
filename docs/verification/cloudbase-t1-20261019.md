# CloudBase T1：实际账号盘点与入口探针准备

关联 [#91](https://github.com/lnisre/atoms/issues/91)，父规格 [#90](https://github.com/lnisre/atoms/issues/90)。核对日期：2026-10-19（Asia/Shanghai）。源码基线：`6c4a54feeb5bf4ec1fb9460b1947151db8396778`。

## 结论与执行边界

**尚未证明 CloudBase 满足正式迁移要求，#91 保持未完成。** 当前有有效个人版环境和已开通的容器托管底座，但没有自定义域名，也没有现存容器服务。用户明确答复“暂无”域名，随后同意“先完成代码和本地验证，域名后补”。据此可以顺序准备 #92、#93 的代码与本地检查；这项授权不将公网验收、生产切流或 48 小时观察视为完成。

本次只进行了 CloudBase 只读查询及本地合成探针检查。没有部署、绑定域名、改 DNS、改 Auth/数据库、购买/升级套餐、开启超限计费或修改现有 Vercel 部署。用户主目录的未提交内容未改动。

## 实际目标与计费读回

脱敏证据：[inventory.json](assets/cloudbase-t1-20261019/inventory.json)。该文件由仓库的只读工具生成，包含 9 次成功 API 的 RequestId；没有原始响应、密钥、headers、用户记录或签名 URL。

| 核对项 | 实际结果 |
| --- | --- |
| 环境 | `atoms-d9gdf8r2036664366`，`ap-shanghai`，`NORMAL` |
| CloudBase 计费 | `baas_personal` / 个人版，`PREPAYMENT`，`credits`；有效期到 `2026-11-15 23:59:59` |
| 扣费开关 | `EnableOverrun=false`，`IsAutoRenew=false` |
| 当前计费周期 | `2026-10-15 00:51:59` 至 `2026-11-15 23:59:59` |
| 当前可售同名套餐 | `DescribeEnvPlans` 返回月 40,000 点、目录价 39.9 元、QPS 500；这是目录信息，不是本账户实付账单 |
| 已记账用量 | 1983.69 点；其中 PostgreSQL 1981.12、APIInvocation 2.57、EKS 0、其余查询模块 0 |
| 托管底座 | `IsExist=true`、`normal`，`tcbr` 仍返回 `PackageType=Trial`；该字段不覆盖 `tcb` 当前个人版计费结果 |
| 托管服务 | `Total=0`，无服务、版本或已选容器规格可读回 |
| HTTP 网关域名 | 2 个，均 `IsDefault=true`；静态域名和 `ap-shanghai.app.tcloudbase.com` 默认入口，无自定义域名 |

40,000 − 1983.69 = **38,016.31 点账面剩余额度估算**。用量最多可延迟 2 天，此数不是实时可用余额；不据此承诺费用上限。没有查询或更改账号现金余额。

当前只读管理权限已通过；创建/更新容器、指定 1 核 2 GiB、镜像仓库及构建配额权限本次尚未验证。10 月 10 日的历史健康容器发布只能作为历史背景，不能替代这次读回。

## 成本与资源选择

[现行资源点价格](https://cloud.tencent.com.cn/document/product/876/127357)列上海云托管 CPU 55 点/核时、内存 32 点/GiB 时，1000 点对应 1 元。1 核 2 GiB 单实例常驻 30 天的运行量为 `(55 + 2×32) × 720 = 85,680` 点（85.68 元等值），未计发布并存、PG、流量、网关、构建/镜像、日志、Auth、域名/证书和直接 DeepSeek API。此计算不是新增账单或获准开销。

该常驻运行量已超过当前 40,000 点月额度；不能在关闭超限按量的情况下保证持续一个月运行。隔离测量仍建议从 **1 核 2 GiB、min=0/max=1** 起步，规格和完整容器双任务峰值必须实测。生产选择 min=1 需要先确认预算及额度补充方式；不自动升级套餐、开按量或扩大实例数。按当前单价，一小时该隔离规格运行量约 119 点，不是全费用上限。

## 域名与超时门槛

[默认域名规则](https://docs.cloudbase.net/service/alias)限制测试用途；浏览器导航中间页或下载头不能通过伪造客户端请求头绕过。用户尚无域名，所以默认入口不作为正式网站、登录或 600 秒 WSS 验收入口。

[资源点能力表](https://cloud.tencent.com.cn/document/product/876/127357)列个人版自定义域名额度为 1。首选后续在同一额度上受控串行验证隔离与正式入口，而非为两个名称自动升级。仍需落实归属/DNS 权限、大陆备案和接入条件、TLS、已有绑定占用；切正式后重新测试最终正式域名。

[自定义域名说明](https://docs.cloudbase.net/service/custom-domain)对可选边缘加速列 300 秒 WebSocket 超时；[云托管限制页](https://docs.cloudbase.net/run/limitation)另列 60 秒请求超时。它们分属不同层且未完整说明空闲/绝对 WSS 时限，不能互相替代或推导全链路保证。计划采用容器托管、首版不开启边缘加速；全链路时限仍待同类自定义域名实测，不调整产品 480 秒预算。

## 可复用工具及本地检查

只读盘点：`scripts/cloudbase/audit-hosting.mjs`。显式传凭据文件和目标环境，校验凭据绑定环境，调用固定 Describe 白名单、限制单次请求 30 秒，按字段投影输出；错误只留错误码与 RequestId，不回显原始错误。输出使用新文件名，拒绝覆盖已有证据。

```sh
node --use-env-proxy scripts/cloudbase/audit-hosting.mjs \
  --credentials /absolute/path/to/credential-dotenv \
  --env atoms-d9gdf8r2036664366 \
  --out /absolute/path/to/new-inventory.json
```

`scripts/cloudbase/hosting-probe/` 是独立合成服务：两个 HttpOnly Cookie、原生浏览器 WebSocket、严格 Origin/路径/子协议/合成会话校验；并行观察两条正常消息连接、一条业务静默但持续心跳连接及一条完全空闲连接。每条主动观察 600 秒，服务最多 8 条连接并在 630 秒封顶。浏览器连接与关闭握手都有截止时间，不自动重连；正常通过须主动完成观察、正常关闭码及持续心跳/双向消息。完全空闲连接只记录平台策略。探针仅使用合成身份，不宣称真实邮箱登录通过。

配置 `ATOMS_PROBE_ORIGIN` 为精确公开 origin、`ATOMS_PROBE_VERSION` 为 `v1`/`v2`，只向隔离服务部署该目录的 Dockerfile。在浏览器打开 `/probe` 并点击开始。结果在页面及 `window.__atomsHostingProbe`；服务仅记录版本、匿名连接 ID、模式、持续时间与关闭码。后续版本发布时以这些 ID 关联已有连接/退出观察；本轮未执行云端版本切换或回退。

局部测试（Node 24.18.0）：`node --test tests/cloudbase-hosting.test.mjs`，3 项通过。覆盖只读限制、环境错配、字段脱敏、周期时区、两个 Set-Cookie、来源/路径/会话拒绝、真实 WS 双向消息及 1012 退出。

本地 Chrome 使用原生 WebSocket 进行 **1100 毫秒**短验：正常两条及静默心跳共三条正常关闭；主动注入 1011 后三条均判失败；idle 均只记 observed。浏览器无 pageerror。[本地结果](assets/cloudbase-t1-20261019/local-probe-v2.json)明确标记为 loopback 短验；`active600SecondGate=unverified-short-local-check`。初版短验证据也予保留。不构成 600 秒、CloudBase 或产品验收，未调用 verify-atoms。

## 尚未验证与后续顺序

- 自定义域名、备案、证书、最终公网导航/Cookie/原生 WSS，以及至少两次 600 秒连接：尚未验证，域名为已确认的外部输入缺口。
- 当前账号可选 CPU/内存/构建配额、实际 Linux 架构、完整 Node 24＋Python 3.11 容器及远端 Docker Hub/GitHub/npm/PyPI/Auth/PG/DeepSeek 网络：尚未验证。不能把本机可访问或历史 node:22 健康镜像当作本次证明。
- 云端第二版发布、流量读回、已有连接是否排空、SIGTERM 和回退：尚未验证。
- 生产预算、常驻实例与总费用：尚未确认；上面仅为当前单价下的资源量测算。
- 本轮没有创建云端资源，因此没有云端探针待清理；本地临时服务已关闭，独立浏览器已退出。

按用户最新授权，继续 #92 的代码实现和本地检查，再 #93 的代码准备；全部代码完成后统一使用 verify-atoms。正式入口及平台门槛保留待域名具备后补验，不关闭未满足验收条件的 ticket。

## 已纠正的调查失败

临时探索曾将 `DescribeHTTPService`（不存在的 action）、`DescribePublicGwCustomDomains`（缺少其要求的网关参数）和套餐参数 `PackageId` 用于 `DescribeBaasPackageList`，分别收到 `InvalidAction` / `MissingParameter` / `UnknownParameter`。检查官方 Manager 5.9.1 定义后改为 `DescribeHTTPServiceRoute`、`DescribeEnvPlans(PackageId)` 及合法用量参数；正式审计 9 项全部成功。它们是查询方法错误，不是平台承载失败，也未触发任何写操作。
