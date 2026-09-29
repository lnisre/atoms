# Issue #4 原评审 P2 修复与复验

日期：2026-09-29。原评审：[issue-4-review.md](issue-4-review.md)。本次修复已部署至既有 [生产地址](https://v0-test0-nine.vercel.app)，**等待原 review 会话独立复审，不据此宣布 #4 完整通过或关闭 Issue**。

## 修复机制与范围

原问题已在改动前用原评审脚本复现：服务端接受注释内含 `<head>` 的完整 HTML，返回 200；浏览器桥接为 undefined、有效 CSP 为 0、业务按钮禁用，平台没有运行错误提示。证据见 [before.json](assets/issue-4-review-fix/before.json) 与 [before.png](assets/issue-4-review-fix/before.png)。本次没有证明 sandbox 逃逸或数据泄漏。

目标是让服务端的成功结果能在预览中正确装配平台能力。新增共享 `src/lib/html-document.ts`，使用 parse5 8.0.1 的 HTML 树构建与源码位置，按浏览器启用脚本的解析模式定位真实的根 html/head/body；缺少显式 head/body 或完整根元素时拒绝。隐式 head 不能保证桥接先于生成脚本执行，因此不自动补齐。

- `src/lib/preview-document.ts:5`、`:56`：用真实 head 起始标签的结束偏移插入原有 guard，不再正则替换首个 head 文本。原生成源码的前后两段逐字保留，不序列化重写 CSS/JS/业务逻辑。
- `src/app/api/generate/route.ts:125`：生成成功前使用同一结构校验；不再把注释中的标签视为合同满足。无法装配时返回明确 502，不返回 HTML 成功结果。
- `src/components/app-preview.tsx:153`：恢复历史异常 HTML 时捕获装配失败，显示错误且不挂载 iframe。
- `package.json`、`pnpm-lock.yaml`：新增 parse5 运行依赖，以标准解析器处理注释、属性和 HTML 解析状态，避免维护另一套不完整的标签匹配算法。代价是服务端和客户端增加解析器依赖及一次文档解析。
- `tests/generate.test.ts`：新增真实 head/body 缺失和脚本先于显式 head 的拒绝回归。
- `tests/browser/preview-document.spec.ts`：4 项新增浏览器测试。受控模型输出先经过实际 POST 函数，再将其原样结果送入浏览器。覆盖普通完整 HTML、head 前注释、多个注释、head 属性中的 `>`、首个业务脚本已能访问桥接、真实 DOM 中 CSP 位于 head 首位、外部 fetch 被阻止、load/save 与刷新恢复、运行异常提示、旧无效记录恢复失败。
- `tsconfig.json`：与现有 ESLint 范围一致，将 `docs/**/assets/**` 归档证据排除出应用类型检查。原 review 的 `.mts` 证据脚本含绝对模块导入和隐式 any，首次 Webpack 构建因此失败；保留原文件，未绕过 src 或 tests 的类型检查。

sandbox 仍为 `allow-scripts`，没有增加同源权限；桥接 API、父页面来源/通道/项目校验与保存队列未修改。未引入模型业务自动修补、试用数据写回或 M2 范围外功能。

## 实际执行结果

所有命令使用 Node 24.18.0；浏览器使用独立 Chrome context，不读取或清除用户已有浏览器项目。完整回归设置 60 秒单测试上限、单 worker。

| 检查 | 结果与证据 |
| --- | --- |
| 原脚本修复前复现 | 成功复现上述 P2；初次 sandbox 阻止 Chrome 启动，获工具权限后服务未启动导致连接失败，启动旧构建后才取得有效复现；相关日志均保留 |
| 新服务端回归修复前 | 9 通过 / 1 失败，[server-red.txt](assets/issue-4-review-fix/server-red.txt) |
| 新浏览器回归旧构建 | 3/3 失败；除注释外，还证明带 `>` 的 head 属性被旧正则错误切分，[browser-red.txt](assets/issue-4-review-fix/browser-red.txt) |
| 修复后服务端 | 10/10，[server-green.txt](assets/issue-4-review-fix/server-green.txt) |
| lint | 通过，[lint-final.txt](assets/issue-4-review-fix/lint-final.txt) |
| 类型检查 | 最终通过，[typecheck-final.txt](assets/issue-4-review-fix/typecheck-final.txt)。首次和构建并发导致生成类型文件被重写而缺失；顺序复跑再暴露归档脚本类型错误；调整证据排除范围后通过。未把初跑失败记成通过 |
| 默认本地生产构建 | 失败，Turbopack CSS 子进程端口绑定 `Operation not permitted`，[build-default.txt](assets/issue-4-review-fix/build-default.txt) |
| Webpack 生产构建 | 排除归档脚本后通过，[build-webpack-retry.txt](assets/issue-4-review-fix/build-webpack-retry.txt)；本地浏览器验收运行该产物 |
| 本地完整浏览器 | 首跑 19/20；一项新增注释场景在点击后计数仍为 0，其桥接/CSP 检查已通过。全部 16 项原有回归通过。[browser-local.txt](assets/issue-4-review-fix/browser-local.txt)，失败截图/上下文见 `assets/issue-4-review-fix/local-first-failure/` |
| 新增浏览器定向复跑 | 测试与源码不变，4/4 通过；trace 存在 `focused-traces/`，[browser-focused.txt](assets/issue-4-review-fix/browser-focused.txt) |
| 新增浏览器重复五轮 | 20/20，[browser-repeat.txt](assets/issue-4-review-fix/browser-repeat.txt)。首次点击失败根因未得到证明，保留为验收局限，不宣称首跑全绿 |
| 原复现脚本修复后 | 服务端仍返回原 HTML；atoms 为 object、有效 CSP 为 1、按钮启用、无 pageerror、试用数据正常读取。[after.json](assets/issue-4-review-fix/after.json)、[after.png](assets/issue-4-review-fix/after.png) |
| 生产完整浏览器 | 20/20，[browser-production.txt](assets/issue-4-review-fix/browser-production.txt)；涵盖生成、失败反馈、多轮候选、试用隔离、采用原子保存、旧通道失效、正式保存、刷新/页面关闭重开 |
| 真实历史模型产物生产回放 | 通过。核对 #6 原始输出 SHA-256 与基础代码链，回放未修改 HTML；优先级默认值、筛选/布局、多轮基础代码、试用增删改隔离、只采用代码、正式操作和重开、修改记录与恢复 0 次模型请求均通过。[replay-result.json](assets/issue-4-review-fix/replay-result.json)、[脚本](assets/issue-4-review-fix/replay.mjs)、[截图](assets/issue-4-review-fix/replay-adopted.png) |

## 部署与源码对应关系

- 既有项目 `v0-test0` / `prj_eErnQuAz4P719xKTyuT6XT2Qu5ab`，Node 24.x。
- 新部署 `dpl_42zmSjVZG4daVXycgnsDo7DBxrvb`，READY / production；固定别名 `v0-test0-nine.vercel.app` 已指向它。未更换域名或运行时凭据。Vercel 远端默认 Turbopack 构建成功，详见 [deploy.txt](assets/issue-4-review-fix/deploy.txt) 和 [deployment-after.json](assets/issue-4-review-fix/deployment-after.json)。
- 生产浏览器实际访问应用并完成交互，未把 READY 或登录页 HTTP 200 当作可用证据。
- 本地 15 项核心源码/配置的 SHA-1 全部与远端上传 UID 一致；[source-manifest.json](assets/issue-4-review-fix/source-manifest.json) 同时保存 SHA-256，[source-match.json](assets/issue-4-review-fix/source-match.json) 关联部署 ID 与逐文件检查。
- Git HEAD 仍为 `3b586af67495ffd22ea1c3ebe9f2802016616bd2`（main）。本次修复及既有 M2 实现均在未提交工作区；没有提交、推送、覆盖既有未提交文件或关闭 Issue。复审必须检查当前完整工作区和未跟踪文件，不能仅检查 HEAD。

## 证据边界与复审要求

本轮新增真实模型调用 **0**；服务器及浏览器成功响应是明确标注的受控测试输入，历史真实 HTML 回放也不计为新增真实调用。当前模型额度/服务可用性未重新实调。本次页面关闭重开使用相同测试 context，不冒充完整 Chrome 进程重启；未新做第二次同源部署恢复，相关完整进程重开/跨部署验证仍依赖原评审所核对的 #6 历史证据。

本次未改变自动采用资格判定，也没有声称任意生成业务代码正确；有效候选中的业务异常依旧由平台提示并供用户试用判断。装配失败的生成结果被服务端拒绝，历史无法装配的记录不静默运行。

请原 review 会话重新执行原 P2 定向复现，独立检查结构校验、注入顺序及 DOM；复查相关 M2 主链路与 #4 是否完整正确。不要只接受本报告的通过声明或历史结果。该轮只评审和复验，不直接修复、部署或自动改变 Issue 状态。

## 复审交接

已向原 review 会话 `01a0ed62-b15f-7a32-a0e2-5a839d61027c`（local）发送完整复审任务，附上述修复、部署、测试与限制。有界 `wait_threads` 返回 active / inProgress，并收到该会话开始核对源码、工作区、部署及独立复验的进度消息。**复审已启动，尚无复审通过结论。** 本地 3107 服务保留供其复验。
