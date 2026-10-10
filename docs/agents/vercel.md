# Vercel 操作说明

## 凭据读取

本地凭据文件位于项目根目录 `.vercel_atoms_agent.token`，采用环境变量赋值格式：

```dotenv
VERCEL_TOKEN=实际凭据
```

认证使用解析出的 `VERCEL_TOKEN` 值。把文件全文直接放入 `Bearer` 会把 `VERCEL_TOKEN=` 也发送出去，导致 `invalidToken`；这已在本项目的开发过程中发生过。

使用 Node.js 24 内置的 `parseEnv` 读取，支持引号与末尾换行。以下命令在项目根目录执行，只查询项目，不修改远端资源，也不输出凭据：

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
node --use-env-proxy --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const { VERCEL_TOKEN } = parseEnv(
  readFileSync('.vercel_atoms_agent.token', 'utf8'),
);
if (!VERCEL_TOKEN?.trim() || /[\r\n]/.test(VERCEL_TOKEN)) {
  throw new Error('凭据文件缺少有效的单行 VERCEL_TOKEN');
}
const response = await fetch(
  'https://api.vercel.com/v9/projects/prj_eErnQuAz4P719xKTyuT6XT2Qu5ab',
  {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN.trim()}` },
    signal: AbortSignal.timeout(15000),
  },
);
const result = await response.json();
console.log(JSON.stringify({
  status: response.status,
  project: response.ok ? result.name : undefined,
  errorCode: result.error?.code,
}));
if (!response.ok) process.exitCode = 1;
NODE
```

使用 Vercel CLI 时，将同样解析出的值通过子进程环境变量 `VERCEL_TOKEN` 传入，由 CLI 读取；凭据不放在命令参数中。仅在内存中传递，不打印原文或片段，不使用 `cat` 展示凭据文件，不把部署 Token 配入应用运行时。

凭据文件保持权限 `600`，已列入 `.gitignore` 和 `.vercelignore`。自写上传脚本也应使用源码文件白名单；不要假定 REST API 会自动应用本地忽略文件。

## Preview 自动化访问

2026-09-30，用户明确要求保留已授权创建的自动化访问凭据，供后续 Preview 验证复用。**验证成功、失败或中断后均保留凭据，不在清理步骤或 `finally` 中自动撤销。撤销或轮换须由用户明确要求。** 此决定替代此前“验证后撤销临时凭据”的安排；执行已有验证脚本前，先检查并移除该自动撤销行为。

| 凭据 | 用途 |
| --- | --- |
| `VERCEL_TOKEN` | 调用 Vercel 管理 API、查询项目或部署代码 |
| Protection Bypass for Automation secret | 让无登录态的自动化浏览器或 HTTP 客户端访问受保护部署，不授予项目管理权限 |

已登录 Vercel 且具有项目访问权限的浏览器可以直接访问 Preview。独立 Playwright 会话通常不共享该登录态，需要复用自动化访问凭据。凭据只用于进入平台页面、加载资源及调用平台 API；生成 HTML 内的 DOM 操作和合成数据检查不需要取得凭据。

使用流程：

1. 确认目标项目和本次 Preview URL。先复用该项目已有的自动化凭据，不按每次测试重新创建。可从项目 Deployment Protection 设置取得，或在可信进程中用管理 Token 查询项目的 `protectionBypass`；其中键名本身就是 secret，不能输出整个对象。凭据缺失或失效时先核对状态并报告，不自动轮换。
2. 在测试进程中通过环境变量传递 secret，推荐名称为 `VERCEL_AUTOMATION_BYPASS_SECRET`。现有 #24 测试若读取 `QA_PROTECTION_BYPASS`，在启动进程时将同一值映射过去；变量名不同不代表两种凭据。值留在进程内存或专用密钥存储中，项目仅保存使用说明。
3. 向已确认的目标部署源附加请求头 `x-vercel-protection-bypass`。浏览器请求与独立 API 客户端请求都需覆盖；按精确 origin 限定，避免把全局请求头带到第三方地址。使用请求头，不把 secret 放进 URL、日志、截图、trace、生成 HTML、检查数据或提交。
4. 先确认访问到真实应用页面，再执行 QA 和接口往返。HTTP 200 的登录页不是通过；记录最终 URL、实际执行结果和部署身份即可。
5. 验证结束后关闭测试进程和浏览器会话，保留远端凭据与部署保护配置。后续测试继续复用。

最小 HTTP 访问示例（环境变量由可信启动进程注入）：

```js
const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const target = new URL('/qa', process.env.TEST_BASE_URL);
if (!secret || target.protocol !== 'https:') throw new Error('缺少访问配置');
const response = await fetch(target, {
  headers: { 'x-vercel-protection-bypass': secret },
  redirect: 'manual',
  signal: AbortSignal.timeout(15000),
});
console.log({ status: response.status }); // 不输出请求头或 secret
```

该 secret 可访问同一项目的多个受保护部署，直到被撤销，并非仅对创建时的某个 Preview 有效。项目仍保持原有登录保护；测试仅在已授权的目标部署使用它。本地开发无需这个凭据。

参考：[Vercel Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)。

## 已验证的项目与权限

2026-09-29 的实测记录，后续操作仍需读取最新远端状态：

| 项目 | 值 |
| --- | --- |
| Vercel 项目名 | `v0-test0`，用户已允许使用和修改 |
| Project ID | `prj_eErnQuAz4P719xKTyuT6XT2Qu5ab` |
| 所属 Team ID | `team_brlKMv4xsRX1SFiSIq5cMbfj` |
| 已验证的生产地址 | https://v0-test0-nine.vercel.app/ |
| 权限验证部署 | `dpl_J8HuE87c2Y1tUstN3aQaZvsSRv9N` |

- 项目列表、项目详情和创建部署成功；验证页部署达到 `READY`，生产地址无需登录，返回 HTTP 200 且内容匹配。
- `/v2/user` 和 `/v5/user/tokens/current` 返回 404；团队列表与团队详情返回 403。这些结果不能单独证明 Token 无效或缺少项目部署权限。确切的账号级授权范围尚未确认。
- 当时项目的 Node 设置为 `22.x`；部署 Atoms 的 Next.js 工程时，应落实项目要求的 `24.x`。静态验证页未验证 Next.js 构建、服务端模型调用或完整 M1 功能。

## 部署与验收

按任务授权的环境执行部署，并检查返回的 `target` 和生产别名。本次验证请求省略 `target`，实际结果却为 `production`；不能仅凭请求意图宣称是 Preview。

将部署状态、公网访问和业务交互分开验收：`READY` 表示部署完成；打开生产地址后还要核对最终 URL 与页面内容，避免把跳转到 Vercel 登录页后的 HTTP 200 当作应用可访问。此次独立部署 URL 受登录保护，而上述生产地址可直接访问。

Issue 要求真实生成或待办交互时，还需在该线上应用中实际执行，不能用静态验证页替代。该说明不扩大当前任务的部署或修改授权。

参考：[Access Token](https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token)、[Vercel CLI Token 用法](https://github.com/vercel-labs/agent-skills/blob/main/skills/vercel-cli-with-tokens/SKILL.md)、[创建部署 API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment)。

## 完整容器发布（#63）

固定生产入口必须由根目录 `Dockerfile.vercel` 构建：Node 网关启动同实例 Next.js，再为每次任务启动 Python/MetaGPT。不要设置 `ATOMS_INTERNAL_KEY` 绕过网关；它由网关随机生成。普通 Next.js 构建即使 READY、首页 200，也不能证明团队可用。

使用仓库脚本，停止使用临时手写上传白名单。Node 24 下先完成工程回归、提交源码，再冻结提交并创建新的发布证据目录：

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
# 隔离工作树可指向主工作区凭据文件，只传路径，不复制凭据
export ATOMS_VERCEL_TOKEN_FILE=/Users/gaowenlong/Desktop/atoms/.vercel_atoms_agent.token
pnpm release:vercel plan /tmp/atoms-release-NEW COMMIT_SHA
# 检查 manifest.json 的 commit、sourceDigest 和 files 后，执行已授权发布
pnpm release:vercel create /tmp/atoms-release-NEW
pnpm release:vercel status /tmp/atoms-release-NEW
# READY 后执行；失败必须修复，不能用首页状态代替
pnpm release:vercel verify /tmp/atoms-release-NEW
```

- `plan` 无网络、无需凭据；读取指定 Git 提交而非脏工作区。清单含 Dockerfile、显式根配置文件、完整受跟踪 `src/`、`public/`、`runtime/team/` 和每文件 SHA-256/SHA-1。拒绝隐含环境文件、密钥路径、缓存与符号链接，并验证 Docker COPY 输入、网关 CMD、Python 依赖和构建测试门槛。新增 COPY 语法需明确扩展检查，不静默忽略。
- `create` 重新从冻结提交核对完整清单，显式使用 container framework；继承项目已有 production 配置，不上传本地环境文件、不读取或重写服务端模型密钥。固定项目、team、origin 定义在 `scripts/release-manifest.mjs`。发布会更新 production，只有已有任务授权时执行。
- 创建前写 `attempt.json`；成功写 `deployment.json`。网络中断不能证明创建失败，脚本拒绝相同目录重复创建。先用管理 API 根据 sourceCommit/sourceDigest 与时间找到该次部署，核实并补齐 deployment.json；不盲目重试或删除 attempt.json。
- `verify` 核对 target、project、固定 alias、提交元数据、远端每个源码文件的内容 SHA-1，以及实际 container 输出和镜像 digest。随后只协商 atoms-team/3 签名票据，不打开 WebSocket、不启动模型；完成后再次核对 alias。这不能证明 Python/模型业务运行，独立真实生成/修改验收仍必需。
- 将 manifest.json、verification.json 与实际业务验收证据一并保存到本次交付记录；遇到发布或验收失败保留证据。不要把 ticket、控制 token、模型密钥或访问保护 secret 写进证据。

`pnpm test` 中的发布回归会拒绝这次 Dockerfile 遗漏、Python 输入遗漏、篡改清单、错误远端源码和普通 Node 函数产物。容器构建继续运行 `pip check` 与原生 Python 测试；构建日志和真实业务验收分别提供安装/启动证据。

容器识别依据：[Vercel Docker 部署说明](https://vercel.com/kb/guide/does-vercel-support-docker-deployments)。
