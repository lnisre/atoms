# Atoms Demo

输入自然语言需求，通过 DeepSeek 官方 API 生成轻量前端应用，在隔离预览里实际操作。

本次实现范围为 [Issue #2](https://github.com/lnisre/atoms/issues/2)：Home、当前项目工作台、真实生成、可操作预览和手动重试。**项目及应用业务数据尚未持久化，刷新、关闭或新建项目会丢失当前结果。** 自动保存和同浏览器恢复属于后续 Issue #3，不能据此认定整个 M1 已完成。

生产地址：https://v0-test0-nine.vercel.app 。2026-09-29 线上真实待办生成与添加、完成、删除已验证，生成耗时 15.7 秒。

## 运行

使用 Node.js 24.x、pnpm 10.12.1。已有 `.nvmrc`、`.node-version` 和 `engines.node` 约束版本；macOS Homebrew 可执行：

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm install --frozen-lockfile
cp .env.example .env.local
# 在 .env.local 填入 DEEPSEEK_API_KEY，不要使用 NEXT_PUBLIC_ 前缀
pnpm dev
```

打开 http://localhost:3000。未配置密钥时首页仍可访问，生成会明确失败，不返回预置应用。生产启动使用 `pnpm build && pnpm start`。

## 模型与运行边界

- `POST /api/generate` 接收 `{ "requirement": "应用需求" }`，限制 1–4000 字。Next.js Route Handler 使用 Node.js 运行时，仅从服务端环境变量读取 `DEEPSEEK_API_KEY`。
- 官方端点为 `https://api.deepseek.com/chat/completions`。请求模型 `deepseek-v4-flash`，使用 `thinking: { type: "disabled" }`、非流式返回、`max_tokens: 8192`。2026-09-29 实测该请求标识可用，官方响应的模型字段为 `deepseek-flash`；界面如实显示响应标识，不把别名解释为固定模型版本保证。
- 成功响应包含 `html`、`model`、`durationMs`、`generatedAt`。耗时覆盖服务端模型请求及解析，不包括浏览器网络和预览加载；不是未来耗时承诺。
- 若模型附带说明或 Markdown，仅提取其中唯一、完整的 HTML 文档；截断、空内容和不完整结构明确失败，不自动修复、不重试、不用模板替代。
- 模型请求在 120 秒超时，浏览器在 135 秒停止等待；Vercel 函数 `maxDuration` 为 180 秒，需启用 Fluid compute。失败后由用户手动重新发起。
- 生成物为内含 CSS 和原生 JavaScript 的单文件 HTML，通过 `srcdoc` 放入 `sandbox="allow-scripts"` iframe。没有 `allow-same-origin`，不直接插入平台 DOM。
- 预览注入 CSP，禁止外部依赖、网络请求、嵌套页面及表单导航，只允许内联脚本、样式和数据图片。脚本运行错误可提示重新生成；加载成功不代表业务功能正确。沙箱限制权限，但不保证任意生成代码没有逻辑错误或性能问题。
- 本阶段要求应用仅使用内存状态，不用 localStorage 冒充平台保存。没有账号、后台任务、对话修改、自动修复或跨设备恢复。
- 浏览器提交的需求会发送给 DeepSeek。模型密钥不进入浏览器 bundle、生成物或日志；上游错误正文不回传。公开无账号演示接口会消耗维护者模型额度，目前未实现账户配额或持久化限流。

接口依据：[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[Vercel 函数时限](https://vercel.com/docs/functions/configuring-functions/duration)。

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start --port 3100
# 另一个终端；默认使用已安装的 Google Chrome
pnpm test:e2e
# 也可 TEST_BASE_URL=https://固定生产地址 pnpm test:e2e
```

服务端测试控制模型外部响应，覆盖输入拒绝、未配置、认证/额度/上游失败、截断、文档提取和超时。浏览器回归使用明确的测试夹具，覆盖等待、失败重试、客户端超时、可执行隔离预览、运行错误和手机输入；这些测试不替代真实模型验收。

真实验收：从 Home 提交待办需求，添加两个不同任务，完成一个并删除另一个，记录生成耗时和产物，确认未显示已保存。线上验收必须从固定生产地址完成，另需外部网络访问证据。具体结果见 `docs/verification/issue-2.md`。

## Vercel 部署

在对应 Vercel 项目配置生产环境变量 `DEEPSEEK_API_KEY`，选择 Next.js 和 Node.js 24.x，启用 Fluid compute。通过 Vercel CLI 链接该项目，再执行 `vercel --prod`。后续更新继续部署同一项目和固定生产域名，为 #3 的同源存储提供稳定入口。

`.vercelignore` 排除私人研究资料、北极星、本地凭据、环境文件及测试产物；不要上传整个工作区归档。`.vercel` 保存本机项目链接信息，按 `.gitignore` 排除。
