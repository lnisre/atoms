# Atoms Demo

通过自然语言创建和持续修改轻量前端应用。Atoms 使用 DeepSeek 官方 API 和 MetaGPT 四角色团队生成代码、进行静态审查，在隔离预览中运行应用，并在当前浏览器保存项目与应用数据。

[在线体验](https://v0-test0-nine.vercel.app) · [需求与任务](https://github.com/lnisre/atoms/issues) · [领域术语](CONTEXT.md) · [架构决策](docs/adr/)

## 当前功能

- **生成与修改**：Leader、Requirements、Engineer、Reviewer 分别负责协调、需求规格、实现和代码审查。首次生成和追加修改使用同一团队流程，展示实际回复、角色交付、模型调用与平台执行记录；支持停止、需求澄清和不支持说明。
- **候选试用与明确采用**：连续修改基于最新候选；试用操作使用正式业务数据的会话副本。采用只保存代码及关联记录，试用数据不写回正式数据。刷新、关闭或放弃后，未采用候选与试用数据不保留。
- **保存与恢复**：项目代码、已保存消息和已采用修改记录保存在 IndexedDB；应用业务数据单独保存。刷新或从“我的项目”重开无需再次调用模型。
- **只读代码查看器**：工作台右侧可切换预览与代码，提供目录树、语法高亮、行号、当前文件搜索和原文复制。源码与预览对应同一版本，同版本切换不重启应用。当前生成物仍是唯一的 `index.html`；尚未支持真实多文件生成、代码编辑或工程构建。
- **可编辑示例项目**：新工作区和已有工作区均一次性提供独立的小费计算器，默认账单 20 元、小费 5%、4 人，每人应付 5.25 元。打开示例不调用模型；两轮真实来源记录与用户后续修改分别展示。旧番茄钟副本转为普通项目，保留原代码、个人数据和修改记录；重复访问不会重置已有示例。

生成完成、静态审查通过和预览加载成功都不等于业务功能已验证。请实际操作应用，再决定是否采用修改。最新代码查看器与示例验收分别见 [#47](docs/verification/issue-47.md) 和 [#46](docs/verification/issue-46.md)；线上部署及验证范围见 [#46 交付记录](https://github.com/lnisre/atoms/issues/46)。

## 本地运行

使用 **Node.js 24.x** 和 **pnpm 10.12.1**，版本约束见 `.nvmrc`、`.node-version` 和 `package.json`。

```bash
# macOS Homebrew 用户可先切换到 Node 24
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

打开 <http://localhost:3000>，可体验示例、预览、代码查看及本地保存。`pnpm dev` 或 `pnpm build && pnpm start` 仅启动 Next.js，**不提供完整团队生成所需的 WebSocket 网关和 Python 运行时**。

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

模型密钥与签名密钥仅放在可信服务端环境，不能使用 `NEXT_PUBLIC_` 前缀，也不要提交 `.env.local`。

```bash
pnpm team:build
node --env-file=.env.local runtime/team/gateway.mjs
```

打开 <http://localhost:3105>。`pnpm team:start` 运行同一网关，适用于变量已导出到进程环境的情况。不同端口属于不同存储源，3000 端口的本地项目不会自动出现在 3105 端口。

也可使用仓库容器配方运行完整服务：

```bash
docker build -f Dockerfile.vercel -t atoms-demo .
# .env.container 仅填入 DEEPSEEK_API_KEY 和 QA_TOOL_SIGNING_KEY
# Python 路径及服务端口由镜像配置
docker run --rm -p 3105:3000 --env-file .env.container atoms-demo
```

## 团队执行与交付边界

首页和工作台通过 `POST /api/generate` 协商 `atoms-team/3`，取得签名票据后，以同源 WebSocket 绑定一次团队执行。首次输入包含 `projectId`、`requirement`；修改还携带完整 `baseHtml`、本次 `modification`、成功轮次的 `context`，以及必要的已知数据风险。平台不附带应用业务数据副本。

- 原需求与本次修改各最多 4000 字符，基础 HTML 最多 500000 字符，上下文 JSON 最多 32000 字符，请求序列化最多 3300000 字符；超限拒绝，不静默截断。
- Python 运行时请求 `deepseek-flash`，关闭 thinking，使用非流式模型响应；平台实时传递实际执行事件，完整产物在任务收尾后展示。界面保留请求和响应的模型标识，不将别名视为固定版本保证。
- 每个任务共用 **4 分钟、20 次模型请求**预算。重大审查问题最多触发两次整体返工，即至多三份实现；一般问题可随代码交付。审查格式纠正最多一次，有限的连接或格式重试同样计入预算。
- 停止、断开连接或心跳失联会终止受监督进程；心跳失联兜底为 15 秒。没有自动重连、后台继续执行或任务恢复。供应商已经接收的请求不保证可以取消计费。每个 worker 最多同时运行两个任务，这不是账户级配额。
- Reviewer 进行静态代码审查；`/qa` 是独立的开发验证入口，使用明确标注的夹具和合成数据，不是当前生成主链路的自动业务验收。
- 已完整交付并校验的代码，可在审查失败或预算耗尽后保留，并如实展示任务状态。用户停止、身份或协议不合法，以及期限后的新产物不能替换当前成果。

**预览资格由平台决定。** 普通功能问题不自动禁止预览；数据丢失或持久化问题允许副本试用，但在当前代码有明确修复依据前禁止采用。审查不可用且无已知数据风险时，可由用户明确使用或采用。首次受限成果保存为待验证项目；被执行阻断的已保留代码仍可只读查看。规则及历史协议兼容见 [ADR 0011](docs/adr/0011-review-findings-and-preview.md) 与 [验收记录](docs/verification/reviewer-preview-policy.md)。

无团队协议头的旧 JSON/NDJSON 生成路径仍为兼容保留；其单次调用、120 秒超时和 `deepseek-v4-flash` 配置不代表当前首页团队流程，具体见 [生成路由](src/app/api/generate/route.ts)。

## 预览、保存与恢复

生成应用是内含 CSS 和原生 JavaScript 的单文件 HTML，通过 `srcdoc` 运行在 `sandbox="allow-scripts"` iframe。预览不授予 `allow-same-origin`；注入的 CSP 禁止外部依赖、网络请求、嵌套页面和表单导航。没有生成应用的服务端、登录、外部服务或依赖安装能力。沙箱不能保证任意代码没有业务错误、复杂死循环或性能问题。

应用通过平台注入的接口读写数据，不直接访问浏览器存储：

```ts
window.atoms.loadState(): Promise<JSON | null>
window.atoms.saveState(data): Promise<void>
```

`loadState` 成功返回 `null` 才表示新数据；读取失败不能当作空数据覆盖。每次用户修改须在同一事件处理函数中立即提交完整 JSON 快照，序列化长度最多 1,000,000 字符。保存期间平台锁定预览交互，只有事务完成后才表示保存成功；失败明确反馈，不用内存结果冒充持久化。

- **存储位置**：`atoms-projects` 数据库版本 1，使用 `projects` 和 `applicationData` 两个 store。项目使用稳定 UUID；业务数据与项目代码分别保存。示例安装、升级标记及旧副本退休使用原子事务，不覆盖已有个人成果。
- **候选生命周期**：已有候选时从最新候选继续修改，否则从项目已保存代码开始。候选数据只在会话副本中；采用事务保存最新代码、成功轮次的回复/记录及修改摘要，不写正式业务数据。保存失败保留候选供重试，旧保存结果仍可恢复。
- **数据桥接**：父子页面校验窗口、来源和随机通道，项目身份由父页面绑定。同一预览内读写顺序执行；没有跨标签页冲突协调，多标签编辑同一项目时最后提交的完整快照覆盖先前内容。
- **恢复范围**：要求同一浏览器配置文件、同一站点源（协议、主机、端口），且站点数据仍存在。`?project=<UUID>` 仅指向本地记录，复制链接不能把项目分享给其他浏览器。没有账号同步或服务端备份。
- **历史边界**：保存修改记录及实际任务记录，但不保存每轮历史代码；没有历史代码回退、完整项目快照或试用数据合并。旧项目缺少的回复与执行记录不补造。
- **源码阅读**：展示和复制保留的原始代码，不含平台运行注入内容。待验证或未保存成果仍显示真实限制；能查看不等于能运行、采用或恢复。刷新和重开默认进入预览，不持久化代码阅读偏好。

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

大多数 UI 测试使用受控生成/审查响应，实际执行 DOM、iframe 数据桥和 IndexedDB 操作。原生团队用例需要额外配置确定性 Python transport；仅设置 `TEAM_FIXTURE=1` 并不会替换供应商。配置见 [团队测试入口](.agents/skills/verify-atoms/references/team.md)。这些测试不能作为真实模型质量或线上生成验收。

不调用模型的小费示例冒烟会自行启动独立服务与浏览器，检查实际计算、保存、刷新和完整浏览器重启后的恢复，并清理自有进程。每次使用新的证据目录：

```bash
node .agents/skills/verify-atoms/scripts/smoke-example.mjs /tmp/atoms-smoke-new 3210
```

完整用户路径、故障注入与证据要求见 [verify-atoms](.agents/skills/verify-atoms/SKILL.md) 和 [功能地图](.agents/skills/verify-atoms/features/README.md)。运行真实模型验收需单独确认目标与调用范围。

| 范围 | 已有验证记录 |
| --- | --- |
| 最新示例、来源记录、旧工作区升级及完整重启 | [#46](docs/verification/issue-46.md) |
| 代码查看、搜索复制、版本同步与恢复 | [#47](docs/verification/issue-47.md) |
| 停止与心跳取消 | [#41](docs/verification/issue-41.md) |
| 审查问题、返工、预览和采用资格 | [审查政策](docs/verification/reviewer-preview-policy.md) |
| 团队首次生成、修改和跨应用验收 | [#25](docs/verification/issue-25-reviewer.md)、[#26](docs/verification/issue-26.md)、[#27](docs/verification/issue-27.md)、[#28](docs/verification/issue-28.md) |
| 保存恢复、候选与采用的历史基线 | [#3](docs/verification/issue-3.md)、[#5](docs/verification/issue-5.md)、[#6](docs/verification/issue-6.md)、[#11](docs/verification/issue-11.md) |
| 首页、消息流与桌面工作台 | [#15](docs/verification/issue-15.md)、[#16](docs/verification/issue-16.md)、[#17](docs/verification/issue-17.md)、[#18](docs/verification/issue-18.md) |

各记录保留当时的失败、复验和未覆盖项；历史验收不自动代表当前线上版本的全部能力已经复验。

## 部署与维护

完整团队服务需要同时承载 Next.js、同源 WebSocket 网关和 Python 子进程。仓库提供 [Dockerfile.vercel](Dockerfile.vercel)；仅部署普通 Next.js 页面不足以提供团队生成能力。Vercel 凭据、访问保护和部署操作见 [项目说明](docs/agents/vercel.md)，运行时细节见 [runtime/team](runtime/team/README.md)。

保持固定域名和 IndexedDB 名称、结构兼容，才能让同一浏览器在更新部署后继续恢复项目。`.vercelignore` 排除凭据、环境文件、私人资料及测试产物；部署应从明确的源码集合构建，不上传整个工作区归档。

公开演示生成接口会消耗维护者的模型额度，目前没有账户配额或持久化限流。当前不提供账号与跨设备恢复、项目发布/导出、真实多文件运行或历史版本回退。
