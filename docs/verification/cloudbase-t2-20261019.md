# CloudBase T2 代码交付与局部检查

对应 [#92](https://github.com/lnisre/atoms/issues/92)，2026-10-19。当前范围为默认 HTTPS 域名临时小范围内测；保留正式域名、正式切流与观察窗口的后补边界。本记录只覆盖 T2 代码及局部工程检查，未执行 verify-atoms，未创建、发布或修改云服务。

## 代码交付

- 通用冻结源码清单与 Vercel 发布身份最小解耦；原 Vercel 发布命令、完整 Docker 配方和远端校验行为保留。
- CloudBase `plan / stage / status / verify / promote / rollback`：冻结完整 Git 源码、每文件 SHA-256、确定性白名单 ZIP、唯一 Docker 配方映射和源码运行标记；不读取脏工作区打包。
- 真实 API 使用腾讯官方 TC3 签名、CloudRun package/image 输入、typed Items、精确服务与环境边界。上传 URL 只存在内存，响应只输出白名单字段。先落 attempt，再提交 mutation；未知结果不自动重试。
- 独立服务、个人版/超限关闭、单实例资源边界、精确 runtime 字段与现有 namespace/密钥格式校验。支持从可信操作进程环境仅注入所选运行值；管理凭据不进入应用配置或构建输入。
- 创建后才分配默认域名：引导 origin 禁止外部业务来源，首轮只核验源码/镜像 artifact，`deploymentVerified=false`；从 API 读回实际入口后，使用同一已核验 digest 与精确前版本更新 origin。一般核验必须绑定真实服务域名；任意 HTTPS origin、缺少 immutable 证据或并发版本变化均拒绝通过。
- 网关 `/healthz` 核对内部 Next 存活并返回冻结提交/摘要、协议、活动连接数与停止状态，不访问 Auth/PG/模型。生产精确 origin，保留可信 `VERCEL_URL` 回退；本地显式 loopback origin 可用于验证。只公开网关端口，内部 Next 为 loopback。
- 网关拥有独立 Next 进程组，Python 继承该组；收到停止信号后关闭连接、SIGTERM 所有组内进程，2 秒后 SIGKILL 并退出。Next 启动使用真实 30 秒 deadline。保留既有任务停止、480 秒/20 次模型请求/两次返工与每 worker 两任务合同。
- `promote` 只准备正式发布清单，拒绝实际生产 mutation。内测 `rollback` 默认展示请求，显式执行时只允许记录中的精确前版本，不回滚数据库、不自动重放任务。

操作方法与默认域名引导流程见 [CloudBase 发布说明](../cloudbase-release.md)。

## 已执行检查

运行时：Node 24.18.0。

- 局部 Node 测试：T1 hosting、T2 release、既有 release、auth-gateway 共 **23 项通过**。覆盖管理 API 白名单/签名/响应脱敏、错环境和运行配置拒绝、未知提交结果不重发、服务来源绑定、真实镜像 digest 证据、版本竞争、冻结 ZIP 复现、完整 Docker 输入、匿名/伪造 Cookie/错误 Origin 拒绝、多个 Set-Cookie 透传、原 WebSocket 透传，以及实际独立进程组与顽固后代的有界清理。后续收紧后又执行 T2 release、release、auth-gateway 共 **20 项通过**。
- 修改的 JavaScript 文件 ESLint 通过，无 warning；`git diff --check` 通过。
- 完整 `next build` 通过编译、TypeScript 与全部页面生成，standalone 配置保持有效。

API schema 核对的是官方 `@cloudbase/manager-node@5.9.1` CloudRun 实现和 Tencent `tcbr/v20220217` SDK。离线受控 API 返回仅用于测试本地编排的拒绝/提交边界，不是云端 API 运行证据。

## 尚未执行

Docker daemon 当前未运行，因此没有完整 Node＋Python 镜像构建结果或该镜像运行证据。代码中的 Python 锁定、固定 MetaGPT、pip check 和运行测试门禁仍由唯一配方保留；本地 Next 构建不能代替镜像门禁。

真实 CloudBase 服务创建/源码构建/digest 返回、默认域名与 Cookie/原生 WSS/完整八分钟、真实邮箱/真实模型、跨账号与跨设备项目合同、两任务资源测量、第二版本与回退均留待获得平台入口结论后执行，并由主 agent 在所有 ticket 代码完成后统一使用 verify-atoms。未关闭 #92；当前结果不表示父规格 #90 或原生产迁移全部完成。
