# #67：个人云端项目与可靠保存阶段交接

父规格 [#65](https://github.com/lnisre/atoms/issues/65)，阶段 [#67](https://github.com/lnisre/atoms/issues/67)，汇总草稿 [PR #70](https://github.com/lnisre/atoms/pull/70)。2026-10-10 实施，2026-10-11 交接，本阶段代码与必要检查已完成。**真实邮箱登录、普通用户 JWT 到 PG 网关、完整跨设备端到端主验收仍留到 #69；不能把本记录当作父规格最终验收。** #65/#66/#67 保持开放，PR 不合并。

## 实现

- 登录用户明确保存固定小费示例后获得个人项目；普通登录只读列表，不预置项目。登录续接使用原 `LoginIntent.id`；双击、响应丢失重试都沿用原操作 ID。素材由迁移安装，RPC 不接受客户端 HTML、来源、owner 或预览策略；来源记录仍为示例自身的真实来源，不冒充用户模型任务。
- 首页、个人列表与 `/?project=<UUID>` 读取云端。打开代码、正式数据和来源记录均不调用模型。账号头部与只读代码查看器保留；云端读取错误不会退回本地或空项目。
- `AppPreview` 继续校验 opaque iframe 来源和随机 channel。账号项目传入绑定 owner/project/codeVersion 的 `CloudDataSession`；生成应用不能选择账号、项目或数据库。游客保持只读；受限代码只接会话试用数据/禁止执行。
- 首次读取成功才允许正式数据保存。保存同时检查代码版本、数据版本，原子提交 state、has_data、data_version、updated_at 和去重回执。保存中保持处理中，只有合法提交回执才显示已保存；缺字段的“成功”响应同样按失败处理。
- 平台内存保留失败操作的 JSON、原版本、操作 ID，不依赖示例自行缓存。失败后禁止新写入替换待处理内容，提供原保存重试、下载未保存副本和明确重新载入；重新载入读取成功才替换旧页面，读取失败仍可下载旧内容；若读取期间产生新未确认保存，也保留原页面。超限 JSON 也保留下载出口。
- 重试返回已提交操作的原回执，优先于版本冲突判断；更换相同操作的 payload 则拒绝。另一个页面写入的新状态、另一代码版本都会使真正旧写入冲突，重试不改变预期版本，不调用模型。
- 下载只投影需求、代码、对应业务状态，标明未保存/不支持导入；不包含 Cookie、令牌或管理配置。未确认保存时，返回列表/首页、重新载入、退出会提示并提供下载；刷新/关闭有 beforeunload 提示。没有离线队列或持久本地草稿。
- `X-Atoms-Account` 只是旧页面账号与当前会话的**不一致拒绝条件**，不是授权来源。实际身份来自 `requireIdentity`。自然失效可重新登录原邮箱后重试；退出会废弃数据会话和迟到响应，成功提交不会撤销。完整生成任务/候选/账号切换生命周期仍由 #68 接入。
- 未挂载的旧 `project-workbench.tsx` 与旧 `project-store.ts` 仍保留，当前账号路由不枚举、初始化、导入或删除 IndexedDB。#68 不能直接挂回旧初始化路径。

## 数据库与运维

目标 `atoms-d9gdf8r2036664366` / `ap-shanghai`，现有体验环境。未购买、升级或调整超限计费；未修改 Auth/provider/邮箱设置，未发送邮件。应用运行时只转发当前普通用户的 access token 到官方 PG RPC，管理凭据只供迁移/隔离测试进程在内存读取。

`db/migrations/001_account_projects.sql`：

| 对象 | 职责 |
| --- | --- |
| `public.atoms_projects` | UUID、owner_id、document（SavedProject 内容/预览限制/记录）、state、has_data、code_version、data_version、created_at、updated_at |
| `atoms_private.templates` | 固定、hash 校验的受控示例包，仅迁移写入 |
| `atoms_private.operations` | `(owner_id, operation_id)` 唯一；规范化请求 hash 和原提交回执，与写入同事务 |
| `atoms_private.migrations` | 版本与 SHA-256 校验和；重跑幂等，漂移失败，不能改旧迁移后强行覆盖 |

项目表启用并强制 RLS：authenticated 仅 SELECT 自己的行；匿名无权限。所有普通用户没有直接 INSERT/UPDATE/DELETE 权限，不能绕开版本化 RPC。私有 schema/table 没有普通用户权限。当前管理角色具备 BYPASSRLS、没有 CREATEROLE，所以 RPC 采用固定 search_path 的 SECURITY DEFINER，**每个公开函数都先验证 `auth.role()='authenticated'`、非空 `auth.uid()`，每次读取/更新都显式限定 owner**；不依赖函数拥有者的 RLS，也不把函数入口可达性当权限。

官方文档特别指出 CloudBase RPC 网关不能仅依赖 GRANT EXECUTE；函数内角色检查是必须保留的边界。函数授权仍收紧。无动态用户 SQL；所有运行参数都是命名参数/类型化值。

迁移命令（Node 24，凭据路径不属于应用环境变量）：

```sh
node --import tsx --use-env-proxy scripts/cloudbase/migrate.mjs \
  --credentials /Users/gaowenlong/Desktop/atoms/tx.tokens \
  --env atoms-d9gdf8r2036664366 --apply
```

不带 `--apply` 仅检查安装状态；带该参数在**一个 DO 事务**中执行 DDL、固定素材和版本记录。第一次成功 RequestId `39132869-7003-454c-bbf1-6a7d0d0131be`。校验和 `337a7e9b42fe2646c6793644794a27f11be470be3b561220d64aec6b9141085e`；重复安装成功，未重建表或重灌项目，[脱敏记录](assets/issue-67/migration-replay.jsonl)。后续变更必须新增迁移并扩展 runner，不能改 001 的校验和来绕过漂移检查。

应用没有新增密钥配置，仍使用 `CLOUDBASE_ENV_ID`、`ATOMS_AUTH_SECRET`、`ATOMS_APP_ORIGIN`。未部署到 Vercel。共享环境邮箱仍受 #66 已记录的批准阻塞；本阶段没有重试或绕过该拒绝。

## 检查与证据

工作目录 `/private/tmp/atoms-cloud-projects-67`，detached HEAD 从 `e6c1563c81291118bccea5818bfb476c50f16c21` 续接。桌面 create_worktree 返回“Not a git repository”，attach_worktree 返回“not a managed worktree”，因此采用独立普通 Git worktree，未占用前一会话的 managed worktree。原 checkout 的未提交设计没有改变。Node 24.18.0，Next 16.3.6，锁文件安装，独立 node_modules/.next。

| 检查 | 结果与实际边界 |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` | 通过，无 lint warning |
| `pnpm test` | 首次 89 项中 88 通过，1 项网关因沙箱禁止 localhost listen (`EPERM`) 无法执行；该文件在允许本地端口后单独重跑 1/1 通过 |
| 最后 `tests/cloud-projects.test.ts` | 9/9 通过（原 7 项加两项失败保护）；认证和 PG HTTP 为合成响应，覆盖路由认证、跨源拒绝、普通令牌转发、owner 不一致拒绝、版本/输入、失败状态和回执校验、重试、迟到响应和下载投影 |
| 6 项定向 Playwright | account-access 3 项 + cloud-projects 3 项通过，25.5 秒；随后数据桥失败保护调整，仅重跑 cloud-projects 3/3 通过，20.9 秒；另补 1 项重新载入与新编辑竞态测试通过，12.4 秒 |
| `scripts/cloudbase/verify-projects.mjs` | 真实上海 PG：已提交复制/写入重试、版本冲突、原子状态/时间、强制回滚、直接写表拒绝、跨 owner RLS、旧代码拒绝、真正并发同版本一成一败、JSON null、待验证代码正式数据拒绝；仅本次合成记录，清理确认 0 行 |
| `pnpm build` | 生产构建通过；首次受限构建停在编译阶段，停止本次进程后允许本地构建子进程重跑通过。不是部署证明 |
| 迁移重跑 | 已有校验和一致、幂等通过；未改变用户数据 |

浏览器检查通过真实页面、iframe 与平台会话状态驱动，但 Auth/BFF 云端响应是共享的合成夹具。两个独立 BrowserContext 的同账号恢复和另一个账号拒绝证明 UI 流程，不单独证明真实 JWT/RLS。数据库检查从管理接口 `ExecutePGSql` 设置 `request.jwt.claims` 并 `SET LOCAL ROLE authenticated`，是**普通 SQL 角色/RLS 与事务验证，不是普通用户邮箱令牌或 PG 网关认证验收**。

数据库记录见 [pg-tests.jsonl](assets/issue-67/pg-tests.jsonl)。真实并发：RequestId `6347d272-9744-4225-a1e6-bdce260fcd1d` 提交；`f3d2fae0-e00c-4e1c-aac0-a08df0ec7952` 返回 SQLSTATE PT409。夹具清理 `275bfad4-a815-4422-ad07-a3f8845c6fc0`，清理复核 `4c20c823-bb7e-457c-8a26-5a71711df98b`。测试脚本每次新建唯一合成 owner，不创建真实 Auth 用户，不改变登录配置。

已查看 [保留失败内容截图](assets/issue-67/retained-save.png) 和 [读取失败截图](assets/issue-67/read-failed.png)。1280×720 下保存提示与三个出口可见；示例可能自行回滚输入，但下载仍包含平台收到的原保存值。完整 trace/Doctor/日志在 `/private/tmp/atoms-67-evidence/`，临时路径不承诺归档。两次本地开发实例均已按 PID 核实后停止，3167 端口释放。仓库只保留脱敏关键证据。没有执行完整 verify-atoms、旧的匿名 IndexedDB 全量用例、真实模型或邮件。

## #68 接口交接

| 应用 HTTP | SQL RPC | 输入与返回 |
| --- | --- | --- |
| `GET /api/projects` | `atoms_list_projects()` | 当前身份的 ProjectSummary[]，不包含全部 HTML/state |
| `GET /api/projects/:id` | `atoms_get_project(p_project_id)` | `{project, version:{code,data}, state, hasData}`；包含已保存限制/记录；受限项目不给正式 state |
| `POST /api/projects/example` | `atoms_copy_example(p_operation_id)` | 仅 `{operationId}`；返回 CommitReceipt，素材与归属服务端确定 |
| `GET /api/projects/:id/data?codeVersion=n` | `atoms_get_data(p_project_id,p_code_version)` | 检查运行代码版本及正式资格；返回 DataSnapshot |
| `PUT /api/projects/:id/data` | `atoms_save_data(p_project_id,p_operation_id,p_code_version,p_data_version,p_state)` | `{operationId,expected:{code,data},state}`；返回 CommitReceipt |

`CommitReceipt = {projectId, version:{code,data}, updatedAt}`。`PT409` → HTTP409/code=`conflict`；`PT422` → 422/`operation_mismatch`；`PT404` →404；`PT403` →403；`PT401`/认证失效 →401；未知错误仅给脱敏 503。HTTP 和服务商请求均 no-store。不得把 unknown/empty/503 变成空数据。

- 服务端 `src/lib/cloud-projects/server.ts` 导出 `getCloudProject(identity,id)` 等边界；identity 必须由 `requireIdentity(request)` 获取，普通 accessToken 只能留在服务端，不传模型/页面/日志。后续生成入口用真实云端项目校验归属、基础代码/版本，不能信任客户端 baseHtml/projectId。
- 前端 `CloudDataSession(owner,projectId,codeVersion,onCommitted)` 管理首次读取、保存、原操作 retry、failed/pending 状态与 dispose。`status.pending` 保留 `DataSave`；订阅只更新 UI，不改变 iframe 文档。成功回执后更新本会话 dataVersion，失败保留旧值。返回项目列表/账号切换必须 dispose；dispose 不能撤销已经提交的事务。
- `CloudProjectView` 通过 `AppPreview cloud={session}` 接正式数据；trial/readOnly 优先保持现有独立语义。重新载入必须先允许用户下载，并在读取成功后替换会话，不能先清 pending。初次云端读取失败不创建可写的空 session。
- `unsavedCopy`/`downloadUnsavedCopy` 为需求、代码、状态提供明确未保存格式；首次生成/候选采用可复用投影，但需附加对应未保存需求与真实记录，不添加凭据或导入承诺。
- 新代码未重新挂载旧 ProjectWorkbench。#68 需要把其生成/候选/日志界面移入账号入口，并去掉 `initializeHomeWorkspace`、本地 list/save/adopt/activate 和同浏览器文案。当前 `continueAction(generate)` 仍明确为尚未接入，零模型调用。
- **本票没有暴露任意创建/采用代码的 RPC**。#68 应新增迁移与可信任务产物/采用资格校验边界；不能给 authenticated 直接 document 更新权限，或仅在 BFF 校验后开放一个可被用户 JWT 直调的任意 JSON DEFINER。代码+对应修改记录必须同事务，递增 code_version，校验预期 code/data（避免基于旧数据的采用），保持 state 不变。待验证启用同样校验资格/版本，不把 trial state 写回。
- 日志追加必须只合并该任务事件，按 task/source/sequence 去重，不能用旧 document 整体快照覆盖新代码/记录，不改变正式 state。独立日志失败独立反馈。对新写入类型继续使用 owner+operationId 去重、payload hash、一致的加锁顺序（操作锁→项目行锁），提交/回执原子性；既有重试先识别原回执，再做新写版本检查。
- `001` 已安装且校验和固定；#68 的迁移应增量落地。当前 schema 没有任何管理 secret；不要以 service_role 或管理钥匙替代普通用户运行时授权。若需要服务端证明“模型真实产物”，另行设计可信证明，不把鉴权与内容资格混为一谈。

## #69 延期验收与仍在的阻塞

需要获授权邮箱和已批准的邮件开关：真实注册/收件/登录/退出撤销、普通用户 access token 的 Auth→PG RPC→RLS 全链路、两浏览器同账号恢复、另一真实账号拒绝、实际网络响应丢失与保存时延、Vercel 公网 Cookie/网关与兼容重新部署、生成/候选/日志/自然失效和主动退出竞态、完整 verify-atoms。已有纯本地示例/候选浏览器驱动须按 #65 新边界迁移后集中执行；旧预置本地语义不再是现行要求。

当前没有新增云端审批阻塞；#66 记录的邮箱配置自动审批拒绝仍待协调方处理。本阶段没有尝试重新开启，也没有用管理员身份伪装真实邮箱认证。不发起 #68，不向其它聊天发消息，由协调方读取本记录续派。

官方接口依据：[CloudBase PG 身份与 RLS](https://docs.cloudbase.net/authentication-v2/auth/auth-pg)、[RPC 权限注意事项](https://docs.cloudbase.net/database/postgresql/rpc)、[RPC HTTP 参数](https://docs.cloudbase.net/database/postgresql/http/rpc)。实现前已读取当前 Next 随包 Route Handler 文档；以上链接说明接口来源，具体通过范围以本记录实际执行的检查为准。
