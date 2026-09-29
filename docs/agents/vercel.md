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
