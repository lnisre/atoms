# Atoms Demo

通过自然语言创建和持续修改轻量前端应用。Atoms 使用 DeepSeek 官方 API 和 MetaGPT 四角色团队生成代码、进行静态审查，在隔离预览中运行应用，通过邮箱验证码登录后，将账号私有项目与正式应用数据保存到云端，支持跨设备继续使用和历史项目恢复。

[在线体验](https://v0-test0-nine.vercel.app) · [需求与任务](https://github.com/lnisre/atoms/issues) · [领域术语](CONTEXT.md) · [架构决策](docs/adr/)

## 当前功能

- **邮箱登录与个人项目**：游客从左侧“我的项目”下方打开只读小费示例、来源记录和源码；登录后明确点击“保存此示例到我的项目”创建个人副本。游客与个人项目共用聊天和预览布局，保留独立滚动。普通登录不自动复制示例或开始生成。项目私有，链接供同一账号在其他设备打开，不是公开分享链接。
- **真实团队生成与修改**：Leader、Requirements、Engineer、Reviewer 负责协调、需求、实现和静态代码审查；展示实际回复与步骤，支持停止、需求澄清和最多两次整体返工。
- **候选试用与明确采用**：连续修改基于最新候选，试用使用正式数据的会话副本。采用切换代码和关联记录，试用数据不写回；未采用候选不会跨设备接续。
- **云端保存与冲突保护**：项目、任务记录与正式业务数据使用 CloudBase Auth 和上海 PostgreSQL 保存。云端已有更新时拒绝旧设备覆盖，提供原操作重试、下载未保存副本或重新载入；保存与重开不重复调用模型。
- **历史保存点与项目恢复**：按代码版本变化保留配对的代码和正式业务数据，可查看、试用历史副本、恢复、撤销最近一次恢复及主动清理旧保存点。恢复同时截断之后的版本与对话，具体规则见下文。
- **只读代码查看器**：预览与代码可切换，支持目录、语法高亮、行号、当前文件搜索和原文复制，跟随候选与采用状态。当前真实产物仍为单个 `index.html`，不支持代码编辑或真实多文件生成与运行。

当前说明更新至 **2026-10-12**，依据 master `468acf6`。固定入口已发布包含游客工作台与采用策略改进的源码 `72b4d5e`（[PR #82](https://github.com/lnisre/atoms/pull/82) 已合并），生产迁移 001–005 已安装。云端账号功能的发布记录见 [#69](https://github.com/lnisre/atoms/issues/69)；历史功能集中验收见 [#74](docs/verification/issue-74.md)。发布后的历史功能普通用户完整操作尚未重新验收。

生成完成、静态审查通过与预览加载也不等于业务功能正确，采用前应实际操作验证。

## 本地运行

使用 **Node.js 24.x** 和 **pnpm 10.12.1**，版本约束见 `.nvmrc`、`.node-version` 和 `package.json`。

```bash
# macOS Homebrew 用户可先切换到 Node 24
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

打开 <http://localhost:3000> 进行 Next.js 页面开发；游客示例为只读。账号登录、云端保存需要下面的 CloudBase 配置，不会回退到旧 IndexedDB。`pnpm dev` 或 `pnpm build && pnpm start` 仅启动 Next.js，**不提供完整团队生成所需的 WebSocket 网关和 Python 运行时**。

### 完整团队运行

团队运行需要 Python 3.11、固定提交的 MetaGPT 及项目锁定依赖。上游版本、打包补丁、依赖和离线配置见 [团队运行说明](runtime/team/README.md) 与 [Dockerfile.vercel](Dockerfile.vercel)。本地使用独立 Python 虚拟环境；容器构建会自动准备这些依赖。

在 `.env.local` 配置：

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 服务端模型密钥 |
| `QA_TOOL_SIGNING_KEY` | 随机签名密钥，用于团队任务票据和 `/qa`；生产实例需保持一致 |
| `ATOMS_TEAM_PYTHON` | 已安装固定依赖的 Python 3.11 解释器绝对路径 |
| `METAGPT_PROJECT_ROOT` | 固定 MetaGPT checkout 路径，包含项目提供的 `config2.yaml` |
| `PORT` | 网关端口，默认 `3105`；内部 Next 服务使用相邻端口 `3106` |
| `CLOUDBASE_ENV_ID` | 已配置邮箱 Auth 与上海 PostgreSQL 的 CloudBase 环境 |
| `ATOMS_AUTH_SECRET` | 32 字节随机值的十六进制编码；同环境各实例和部署保持稳定 |
| `ATOMS_APP_ORIGIN` | 精确的公开访问源，不带末尾斜杠；本地例如 `http://localhost:3105` |
| `ATOMS_ARTIFACT_SECRET` | 独立的 32 字节十六进制产物签名密钥，须与数据库迁移安装值一致 |
| `ATOMS_PROJECT_NAMESPACE` | 可选隔离存储命名空间；默认 `atoms`，验收环境需与迁移目标一致 |

模型、Auth 与产物签名密钥仅放在可信服务端环境，不能使用 `NEXT_PUBLIC_` 前缀，也不要提交 `.env.local`。应用运行时使用普通用户令牌访问数据，不配置腾讯云管理密钥。

运行前须在自己的 CloudBase 环境启用邮箱验证码登录与邮件发送，并安装 [001–005 数据库迁移](db/migrations/)。[迁移脚本](scripts/cloudbase/migrate.mjs) 不带 `--apply` 时检查已安装记录，带该参数才写入；通过 `--credentials`、`--env` 和可选 `--namespace` 指定管理配置与目标。管理凭据仅供独立迁移进程使用，不放入应用环境。已安装迁移校验和与产物签名密钥必须一致，不通过改写旧 SQL 或随意换密钥完成升级。账号与可信产物约定见 [ADR 0015](docs/adr/0015-account-owned-cloud-projects.md)、[ADR 0016](docs/adr/0016-trusted-cloud-artifacts.md)。

```bash
pnpm team:build
node --env-file=.env.local runtime/team/gateway.mjs
```

打开 <http://localhost:3105>。`pnpm team:start` 运行同一网关，适用于变量已导出到进程环境的情况。访问源必须与 `ATOMS_APP_ORIGIN` 一致；项目归属登录账号，读取所配置云端环境中的最近成功保存状态。不同来源的登录会话需要分别建立。

也可使用仓库容器配方运行完整服务：

```bash
docker build -f Dockerfile.vercel -t atoms-demo .
# .env.container 填入上述服务端模型、签名、Auth、CloudBase 和公开 origin 配置
# Python 路径及服务端口由镜像配置
docker run --rm -p 3105:3000 --env-file .env.container atoms-demo
```

## 团队执行与交付边界

登录后的首页和工作台通过 `POST /api/generate` 协商 `atoms-team/3`，取得账号绑定的签名票据后，以同源 WebSocket 执行团队任务。服务端从已保存项目或签名的上一轮候选确定基础代码、需求、成功修改上下文和数据风险，拒绝客户端任意提供 `baseHtml/context/state/owner`。数据库在启动执行器前领取任务，终态产物证明绑定账号、项目、任务、基础版本和代码；普通用户身份与可信产物证明共同约束保存和采用。真实业务数据不发送给模型。

- 原需求与本次修改各最多 4000 字符，基础 HTML 最多 500000 字符，上下文 JSON 最多 32000 字符，请求序列化最多 3300000 字符；超限拒绝，不静默截断。
- Python 运行时请求 `deepseek-flash`，关闭 thinking，使用非流式模型响应；平台实时传递实际执行事件，完整产物在任务收尾后展示。界面保留请求和响应的模型标识，不将别名视为固定版本保证。
- 每个任务共用 **8 分钟、20 次模型请求**预算。Engineer 输出额度为 **384K（393,216）token**；单次模型等待受任务剩余时间约束。重大审查问题最多触发两次整体返工，即至多三份实现；一般问题可随代码交付。审查格式纠正最多一次，有限的连接或格式重试同样计入预算。
- 停止、断开连接或心跳失联会终止受监督进程；心跳失联兜底为 15 秒。没有自动重连、后台继续执行或任务恢复。供应商已经接收的请求不保证可以取消计费。每个 worker 最多同时运行两个任务，这不是账户级配额。
- Reviewer 进行静态代码审查；`/qa` 是独立的开发验证入口，使用明确标注的夹具和合成数据，不是当前生成主链路的自动业务验收。
- 已完整交付并校验的代码，可在审查失败或预算耗尽后保留，并如实展示任务状态。用户停止、身份或协议不合法，以及期限后的新产物不能替换当前成果。

**预览资格由平台决定。** 普通功能问题不自动禁止预览；数据丢失问题（不论严重程度）和重大持久化缺陷允许副本试用，但在当前代码有明确修复依据前禁止采用；一般持久化意见保留提示，用户试用后可以明确采用。已有重大风险不能靠降级同一问题、换代码 hash 或审查不可用消除。审查不可用且无已知数据风险时，可由用户明确使用或采用。首次受限成果保存为待验证项目；被执行阻断的已保留代码仍可只读查看。生成中、保存中、待处理保存、正式数据读取、缺可信证明及执行阻断等采用限制会在按钮旁说明。旧候选的签名证明不由前端改写，新规则在服务端签发新候选时生效。规则及历史协议兼容见 [ADR 0011](docs/adr/0011-review-findings-and-preview.md) 与 [验收记录](docs/verification/reviewer-preview-policy.md)。

旧 HTML 直通生成请求不再执行付费模型；旧客户端需要刷新。自然登录失效允许已启动任务在原预算内收尾，成果留在原页面，同账号重新登录后再保存；主动退出则停止任务、清除账号页面状态并隔离迟到响应。退出前可下载未保存副本，普通重登不重新生成。

## 预览、保存与恢复

生成应用是内含 CSS 和原生 JavaScript 的单文件 HTML，通过 `srcdoc` 运行在 `sandbox="allow-scripts"` iframe。预览不授予 `allow-same-origin`；注入的 CSP 禁止外部依赖、网络请求、嵌套页面和表单导航。没有生成应用的服务端、登录、外部服务或依赖安装能力。沙箱不能保证任意代码没有业务错误、复杂死循环或性能问题。

应用通过平台注入的接口读写数据，不直接访问浏览器存储：

```ts
window.atoms.loadState(): Promise<JSON | null>
window.atoms.saveState(data): Promise<void>
```

`loadState` 成功返回 `null` 才表示新数据；读取失败不能当作空数据覆盖。每次用户修改须在同一事件处理函数中立即提交完整 JSON 快照，序列化长度最多 1,000,000 字符。保存期间平台锁定预览交互，只有事务完成后才表示保存成功；失败明确反馈，不用内存结果冒充持久化。

- **存储位置**：账号项目与正式业务数据通过服务端接口保存在 CloudBase PostgreSQL；云端事务成功后才显示已保存。旧 IndexedDB 原件不读取、认领、迁移或删除，原来的本地项目不会自动出现在账号列表。
- **候选生命周期**：已有候选时继续修改最新候选，否则使用已保存版本。候选与试用数据留在当前会话；采用事务保存最新代码及记录，沿用正式业务数据，不合并试用内容。
- **并发与失败**：保存检查预期代码和数据版本，旧设备、旧候选或旧 iframe 不能覆盖云端新状态。失败或结果不确定时保留原操作身份，支持重试、下载副本或主动重载；未保存页面内容不承诺关闭后找回。
- **数据桥接**：父子页面校验窗口、来源和随机通道，项目身份由平台绑定；正式数据写入继续受账号权限、当前代码版本和保存策略约束。
- **跨设备恢复**：同一账号读取云端最近保存成功的项目、正式数据、消息及限制，不调用模型。未采用候选、试用数据与运行任务不跨设备接续。项目默认私有，不支持分享给他人或多人协作。
- **源码阅读**：展示和复制保留的原始代码，不含平台注入脚本；可查看不等于允许运行、采用或已保存。刷新重开默认进入预览，不持久化阅读偏好。

## 历史项目恢复

“跨设备恢复”读取最近已保存状态；“历史项目恢复”回到某个配对保存点。后者已经实现，规则见 [ADR 0014](docs/adr/0014-version-restore-history-semantics.md) 与 [#71](https://github.com/lnisre/atoms/issues/71)。

- **保存点配对**：在版本变化的关键时刻保存代码与正式数据。旧版本配对被下一版本替换前最后成功保存的数据，不是该版本刚生成时的数据；不提供同一代码版本任意时间点恢复，也不补造功能启用前的历史。
- **查看与试用**：历史入口标明代码版本、数据保存时刻和配对关系。历史副本试用是可选步骤，试用数据不改云端保存点或正式项目；真正恢复读取服务端原件。
- **恢复确认**：有未采用候选时先采用或放弃。恢复、撤销和清理使用独立确认框，操作区保持可见并支持取消、Escape 和焦点返回。确认恢复后，代码与数据一起切换到保存点，并截断之后的版本和对话；取消不改变状态，事务失败不留下部分恢复。
- **单次完整撤销**：只保留最近一次恢复的撤销机会，恢复前的代码、数据、版本及对话一并备份。刷新、重开、另一设备登录和普通数据保存不会使其过期；成功采用新代码才结束该机会，再次恢复会替换它。撤销需确认舍弃恢复后产生的数据或候选，不自动合并。
- **主动清理**：清理永久删除所选快照的恢复内容，保留修改记录和对话并标注不可恢复。当前状态、有效撤销备份及其依赖受保护，不自动清理旧历史。
- **冲突和响应丢失**：操作账本与写入计数不随历史回退；重试沿用原操作 ID，防止重复执行。空间不足时保留操作前完整状态，提示重试或清理。

## 验证

基础工程检查：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

浏览器回归默认使用已安装的 Google Chrome，需先启动目标服务：

```bash
pnpm start --port 3100
# 另一个终端
pnpm test:e2e
# 指定已有本地实例时
TEST_BASE_URL=http://localhost:3100 pnpm test:e2e
```

当前账号与历史流程的浏览器测试通过真实 DOM、iframe 和源码查看器操作，Auth/BFF/provider 使用明确的合成响应；SQL 事务测试与真实 CloudBase、普通邮箱登录分别记录。旧 IndexedDB/匿名预置示例脚本不能直接作为当前账号版的验收。对应入口见 [账号云端功能地图](.agents/skills/verify-atoms/features/account-cloud.md) 和 [verify-atoms](.agents/skills/verify-atoms/SKILL.md)。

```bash
# 在已启动的隔离本地实例运行账号和历史路径；这些用例使用合成身份/服务响应
TEST_BASE_URL=http://localhost:3100 pnpm exec playwright test \
  tests/browser/account-access.spec.ts tests/browser/cloud-projects.spec.ts \
  tests/browser/cloud-generation.spec.ts tests/browser/cloud-history.spec.ts \
  tests/browser/cloud-regressions.spec.ts --workers=1 --retries=0
```

原生团队测试需要独立 Python 环境及确定性测试 transport；仅设置 `TEAM_FIXTURE=1` 不会替换供应商。真实邮件、普通用户令牌、CloudBase 和模型调用必须单独记录目标与范围，不能由受控回归推导为通过。

| 验证范围 | 已有记录与边界 |
| --- | --- |
| 账号私有项目、云端保存与跨浏览器恢复 | [#69](docs/verification/issue-69.md)：单邮箱独立浏览器、真实保存冲突及 3 个模型任务、两轮候选采用；第二真实账号未执行，不列为已通过 |
| 历史试用、恢复、撤销和清理 | [#74](docs/verification/issue-74.md)：37 个浏览器场景具备通过结果、106/106 服务端检查；隔离 CloudBase 事务与单邮箱双浏览器真实操作通过，真实容量耗尽未验证 |
| 完整容器与团队入口 | [#63](docs/verification/issue-63.md)及 [Issue 真实验收](https://github.com/lnisre/atoms/issues/63)：真实首次生成和修改共 14 次模型请求，试用、采用、恢复与停止边界通过 |
| 代码查看与示例 | [#47](docs/verification/issue-47.md)、[#46](docs/verification/issue-46.md)：保留历史独立验证；旧本地存储结论不替代当前账号版验证 |
| 停止、审查与返工策略 | [#41](docs/verification/issue-41.md)、[审查政策](docs/verification/reviewer-preview-policy.md)、[采用风险分级 #81](docs/verification/issue-81.md)：112/112 服务端检查，28 个浏览器场景具备通过记录，最终视觉 5/5；本次未新增真实模型调用 |

各报告保留首次失败、修复、复验与未覆盖项。历史恢复本次生产发布完成了来源、迁移与匿名边界检查，普通用户发布后完整恢复操作未重新验收；不将合并、部署 READY 或离线夹具称为真实业务全部通过。

## 部署与维护

完整团队服务需要同时承载 Next.js、同源 WebSocket 网关和 Python 子进程。仓库提供 [Dockerfile.vercel](Dockerfile.vercel)；仅部署普通 Next.js 页面不足以提供团队生成能力。Vercel 凭据、访问保护和部署操作见 [项目说明](docs/agents/vercel.md)，运行时细节见 [runtime/team](runtime/team/README.md)。

部署使用 `pnpm release:vercel plan/create/status/verify`，从冻结 Git 提交生成并核对完整容器源码清单；需要先验收再切流时使用 `stage`，它不会自动绑定固定域名。正式切换后复核 alias、源码、容器和数据库迁移状态。运行配置应包含精确公开 origin、CloudBase 环境和各实例一致的 Auth/产物签名密钥；数据库与应用的产物签名密钥必须匹配。详细操作见 [部署说明](docs/agents/vercel.md)。

`.vercelignore` 排除凭据、环境文件、私人资料及测试产物；管理密钥不进入应用运行时。升级保持已安装迁移校验和，旧本地 IndexedDB 不迁移也不删除。当前固定入口部署来源为 `72b4d5e`，对应已合并的 PR #82，生产 001–005 已安装；不要把较早验收报告中的“生产尚未发布”当作当前状态。

目前开放邮箱注册，登录后生成会消耗维护者模型额度；保留单任务时长、请求数及每 worker 并发保护，尚无账号生成次数配额。当前不提供多人协作、公开项目分享、旧本地项目导入、离线同步、候选持久化、真实多文件运行或任意后端；下载未保存 JSON 副本不等于提供完整项目导入导出。真实多文件能力仍在 [#48](https://github.com/lnisre/atoms/issues/48) 设计阶段，独立取消故障环境工具 [#44 / PR #45](https://github.com/lnisre/atoms/issues/44) 尚未合入。
