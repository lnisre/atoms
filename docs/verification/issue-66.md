# #66：登录与游客只读入口阶段交接

父规格 [#65](https://github.com/lnisre/atoms/issues/65)，阶段 [#66](https://github.com/lnisre/atoms/issues/66)。2026-10-10，本阶段代码已实现；**CloudBase 邮箱配置尚未启用，真实邮箱认证尚未验收，Issue 保持开放，不能发布为完整账号云端项目功能。**

## 实现范围

- 同站点 BFF：`POST /api/auth/code`、`POST /api/auth/verify`、`GET /api/auth/session`、`POST /api/auth/logout`。CloudBase HTTP Auth 负责发码、校验、注册/登录、校验当前用户及服务端退出。应用不接收密码或管理身份。
- 发码 target=ANY，登录 challenge 包含服务端绑定的邮箱、verification ID、是否已有用户及到期时间；浏览器不能覆盖这些字段。OTP 本身不存储。验证码错误/过期、邮件发送失败、服务商限流及 captcha_required 给出明确反馈。captcha_required 当前提示稍后重试/联系维护者，没有模拟额外验证通过。
- AES-256-GCM 会话/challenge Cookie，HttpOnly、SameSite=Lax、生产 Secure、无 Domain、no-store 响应。`ATOMS_AUTH_SECRET` 必须由部署提供，不能在实例中随机生成。有效会话恢复每次由 CloudBase `/user/me` 校验，拒绝匿名、未验证邮箱和 service_account。到期后重新邮箱登录；不存储 refresh token、不自动续期。CloudBase 返回令牌超过安全 Cookie 容量时明确失败，真实令牌大小列入最终验收。
- 所有公开 HTTP 生成协议（JSON、NDJSON、团队票据）和任务控制要求有效用户。WebSocket 升级先验证用户，启动再校验 Cookie 和票据归属；票据只能在原时限内消费一次。已启动 socket 的受控 heartbeat/cancel 使用原连接能力，保留现有任务预算，不因自然过期重开任务。项目归属与完整退出生命周期在 #68 接入。
- `ATOMS_APP_ORIGIN` 绑定外部源，避免网关重写 localhost/http 导致 Cookie 与来源校验错误；不采信浏览器提供的 userId/ownerId。匿名发布探针现在必须得到 401，带用户会话的部署主验收仍待 #69。
- 公共首页、固定小费计算器只读预览和真实来源说明；示例素材/hash 不变。iframe 捕获鼠标/键盘编辑事件、body inert、saveState 直接拒绝，父页面也独立拒绝原始数据桥写入。读取来自固定示例数据，不读写 IndexedDB。
- 登录弹窗保留需求，取消登录不清除输入；普通登录无待执行动作。`PendingLoginAction` 在调用消费者前 take 清除，同一意图只能消费一次，稳定 intent.id 供后续服务端幂等操作使用。
- 新入口没有枚举、迁移、认领、清空或初始化旧本地项目。旧工作台从路由移至未挂载的 `src/components/project-workbench.tsx`，供 #67/#68 改接云端后复用；不能直接重新挂载其旧初始化逻辑。当前账号的示例保存、真实生成消费者明确提示尚未接入，未调用旧存储/模型，也不宣称已保存。

## 本阶段执行的检查

环境：独立 managed worktree，最新远端 master `8b4d54ac6d9ac8b61b9c4b491f301dc95ecc119b`，Node 24，锁文件安装；本地 `http://localhost:3166`。原 checkout 未改动。没有部署、发邮件或真实模型调用。

| 检查 | 结果及边界 |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` | 通过 |
| `pnpm test` | 最终 82 项通过；包含既有模型协议、团队时限/停止、网关、认证与票据回归 |
| `node --import tsx --test tests/auth.test.ts tests/auth-gateway.test.mjs tests/generate.test.ts` | 补充会话过期/篡改、跨账号票据与消费去重后 25 项通过 |
| `TEST_BASE_URL=http://localhost:3166 pnpm exec playwright test tests/browser/account-access.spec.ts --workers=1` | 3 项通过，7.1 秒；游客鼠标/键盘/API/原始 bridge 写入拒绝、无项目库访问、错误输入保留、取消、重复提交、普通登录无副作用、有效会话展示、退出清理及旧库保全 |
| `pnpm build` | Next.js 生产构建通过；不是部署或真实认证证明 |
| 管理脚本只读 inspect | HTTP 200；邮箱登录/provider/代发均关闭；不读取用户数据 |

认证和邮件 HTTP 使用明确的 synthetic fixture；网关测试启动真实 gateway 进程但连接合成内部 Auth 服务，不访问真实邮箱、CloudBase 用户或模型。浏览器截图在 worktree `test-results/account-access-*/`，已经检查布局。首次浏览器测试修正了 Next route announcer 的严格定位、Playwright utility world 发消息问题及 Next devtools 自己的 IndexedDB 调用；最终监测的是 `atoms-projects` 项目库，不忽略项目读写。

旧浏览器用例依赖“匿名自动本地预置”和本地保存，尚未整体迁移到账号云端夹具。新规则由本阶段定向测试覆盖；相关生成/保存/候选用例随 #67/#68 移植，最后 #69 统一跑验收。没有把未运行的旧用例或完整 verify-atoms 标为通过。

## 云端配置当前状态与批准事项

自动审批审查拒绝了“开启邮箱并关闭其他登录方式”的写操作，原因是当前转交内容不足以证明共享环境配置变更授权。拒绝发生在命令执行前；没有修改云端或绕过拒绝。

只读复查：`atoms-d9gdf8r2036664366`、`ap-shanghai`，EmailLogin=false、email.On=FALSE、EmailConfig.On=FALSE，username=true、anonymous=false、phone=false。RequestId：`317f3563-abd3-4632-b3d8-5da47bbb2cea`（登录配置）、`821b8583-d6cb-4486-9c96-9c29e6999626`（provider）。

仓库脚本 `scripts/cloudbase/email-auth.mjs` 的默认行为仅查询。已准备更窄的待批准计划：**只开启邮箱验证码与内置代发，保留其他登录开关**，不购买、升级、改计费/域名或发送邮件。应用仍只提供邮箱 OTP 登录。授权后执行：

```sh
node scripts/cloudbase/email-auth.mjs \
  --credentials /Users/gaowenlong/Desktop/atoms/tx.tokens \
  --env atoms-d9gdf8r2036664366 --enable-email
```

去掉 `--enable-email` 即本次已执行的只读查询。脚本只输出投影开关、HTTP 状态和 RequestId，不输出 SMTP 配置/密钥/完整错误响应。原 `tx.tokens` 保留在原处；本分支 `.gitignore` 和 `.vercelignore` 已排除。

## #67 / #68 接口交接

- `src/lib/auth/server.ts`：`requireAccount(request)` 返回经服务商校验的 `{id,email}`；`requireIdentity(request)` 另外返回仅限服务端使用的普通用户 `accessToken`，供 #67 的运行时 PG/RLS 请求使用。不要返回给页面、放入日志/模型/下载副本，也不要用管理 token 替代。失败由 `authFailure(error)` 返回 401/403/429/503 等稳定类型。
- `src/lib/auth/contract.ts`：`LoginIntent` 的 generate / save-example、稳定 `id`、`PendingLoginAction`。在 `src/app/page.tsx` 的 `continueAction(intent, owner)` 替换阶段提示；#67 接个人示例保存与账号项目列表，#68 接真实生成。异步操作固定原 owner 和 intent.id；服务端幂等不能仅靠内存 take。
- 前端 `Account` 只用于展示。所有云端 owner 必须来自 `requireIdentity`；前端输入和 ticket.body 中 projectId/baseHtml 尚未证明项目访问权，#68 必须接云端归属验证。
- `AppPreview` 新增 readOnly/readOnlyState。游客示例保持这一模式，不能用 trial 替代；个人副本才使用正式云端桥，候选继续使用会话内 trial。
- `project-workbench.tsx` 保留原生成、候选与采用 UI，当前没有页面挂载它。移植后去掉 `listProjects/initializeHomeWorkspace` 旧本地启动逻辑及“同浏览器保存”文案，按账号和版本读云端。旧 IndexedDB 源码只作兼容保留，不作为账号项目来源。
- 三个服务端变量：`CLOUDBASE_ENV_ID`、`ATOMS_AUTH_SECRET`（64 位 hex）、`ATOMS_APP_ORIGIN`（精确公网 origin）。已写入 `.env.example`，未修改 Vercel 的环境变量。管理凭据不是应用运行变量。
- #68 接自然失效后的原账号成果保留、同账号再登录保存、主动退出停止任务/未保存内容下载/确认与迟到响应隔离。当前基础退出仅覆盖本阶段无生成成果的入口，不声明完整任务生命周期已经交付。

## 特意留到 #69 的验收

完整 verify-atoms、真实模型与邮件端到端主验收、获授权邮箱的注册/登录/收件/退出撤销、普通用户 JWT/PG/RLS 隔离、跨设备恢复、云端事务/并发冲突/响应丢失幂等、候选采用与试用数据隔离、自然失效和主动退出时的任务/保存竞态、真实 Vercel HTTPS/Cookie/公网网关及上海端到端保存延迟。邮件代发用量、验证码服务限制和 captcha_required 的真实行为也需核实。

真实邮箱未获本会话授权，因此未发送。配置写入批准和测试邮箱授权可以由协调方在 #69 前补齐；它们不阻止 #67 编写云端存储与测试。#65/#66 保持开放，汇总草稿 PR 不合并，后续会话在 `codex/account-cloud-projects` 追加提交。

## 官方接口依据

[邮箱代发配置](https://docs.cloudbase.net/api-reference/manager/node/login-config)、[邮箱登录](https://docs.cloudbase.net/authentication-v2/method/email-login)、[发送验证码](https://docs.cloudbase.net/http-api/auth/auth-send-verification)、[校验验证码](https://docs.cloudbase.net/http-api/auth/auth-verify-verification)、[注册](https://docs.cloudbase.net/http-api/auth/auth-sign-up)、[登录](https://docs.cloudbase.net/http-api/auth/auth-sign-in)、[当前用户](https://docs.cloudbase.net/http-api/auth/user-me)、[退出](https://docs.cloudbase.net/http-api/auth/auth-sign-out)。实现前已读取 Next 16.3.6 随包 Route Handler、Cookie 和认证文档。
