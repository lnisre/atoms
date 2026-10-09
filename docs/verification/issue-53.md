# #53 / T2：当前文件内定位与复制代码

2026-10-09。本票基于 T1 `948387d0de927492f9bfd7f8e8d07a0eea823824`，交付分支 `codex/source-browser-t2`。交付前确认 PR #52 仍为 OPEN、未合并，因此 PR 以 `codex/source-browser-t1` 为基线，只包含 T2 增量。父规格 #47 未修改；本记录不代表 PRD 集中验收通过。

## 实现

- 高亮支持 HTML/XML/SVG、CSS、JavaScript/JSX、TypeScript/TSX、JSON、Markdown、Python、Shell 和 YAML；未知扩展名退回普通文本，空文件显示“空文本文件”。使用 refractor 的文本语法树，再以 React 文本节点展示；不插入源码 HTML，也不执行脚本。显示保留原字符、CRLF、制表符、末尾空行和长行。
- 行号只在展示层生成，不进入源码文本。搜索明确限定当前文件，按普通文本、不区分大小写匹配；显示当前位置/总数或“无匹配”，按钮与 Enter / Shift+Enter 可循环前后定位。阅读区内 Ctrl/Cmd+F 聚焦搜索，Esc 清空；输入法组合期间保留按键给输入法处理。
- 切换文件保留查找文本，重新计算当前文件的匹配并回到首个匹配；定位只滚动源码区域。复制直接向 Clipboard API 传入 `SourceVersion.files[].text`，不从 DOM 或预览文档提取。等待期间显示“复制中…”，成功后才确认；拒绝或不可用时提示手动选择源码复制。
- `SourceFile` 按 `[version.id, selected.path]` 绑定生命周期，因此两个目录的同名文件、新版本同一路径，以及迟到的剪贴板 Promise 不会混用反馈或匹配状态。

## 与 T3 的接口边界

`SourceVersion` 的 `id`、`entryPath`、`files: { path, text }[]` 保持不变。生产工作台、ResultViewer、预览运行与数据桥接、生成和持久化协议未修改。真实产物继续只适配为 `index.html`。

SourceBrowser 新增会话内搜索文本；原源码 `<pre>` 及阅读控件移入 `SourceFile`，SourceBrowser 仍通过传入的 `sourceRef` 读取和恢复滚动位置。T3 如调整版本同步，应保留 SourceFile 的版本+完整路径 key，以及 SourceBrowser 对滚动位置的所有权；不需要改写 T2 的输入接口。版本更新、采用/放弃及其保存状态仍由 T3 处理。

## 实际执行

环境为 Node 24、Next.js 16.3.6、Playwright + 本机无头 Chrome。使用隔离 managed worktree；未启动应用开发服务，未调用模型，测试浏览器由 Playwright 关闭。

| 检查 | 实际结果与范围 |
| --- | --- |
| `pnpm typecheck` | 通过。新增源码与测试均纳入检查。 |
| `pnpm lint` | 通过。最终输入处理调整后再次检查。 |
| `pnpm build` | 通过。确认新增语法依赖、CSS 与 Next 生产构建兼容；没有部署。 |
| `node --import tsx --test tests/source-code.test.ts` | 2/2 通过。多个常见扩展名、未知语言、空文件、CRLF/制表符/Unicode/长行的字符与偏移保真；大小写、正则特殊字符、无匹配的搜索范围。 |
| `pnpm exec playwright test tests/browser/source-reading.spec.ts --workers=1 --reporter=line` | 4/4 通过，6.3 秒。只检查 T2 的隔离组件公开输入。 |
| 同一浏览器文件的 `--grep '当前文件搜索'` | 最终输入处理调整后，直接相关的 1 项复验通过。其他检查复用有效结果。 |
| `git diff --check` | 通过。 |

4 项浏览器检查分别覆盖：

1. 当前文件多次匹配、跨语法 token 匹配、前后循环、键盘、长行横向及纵向定位、同名文件切换后重新计算/无匹配；没有用 CSS 快照替代行为断言。
2. 实际 Clipboard API 写入后回读，HTML 原文（包含 CRLF）、未知语言、空文件逐字符一致；源码没有生成 script/img/style 元素或执行。合成预览实例、未提交预览输入和对话输入在阅读后保持；736px 合成承载页搜索、复制与源码均在右侧可达。已人工查看 1440px 和 736px 截图，高亮和行号可读。
3. 剪贴板权限拒绝及接口不可用都显示明确失败，没有成功提示；实际鼠标仍可选中源码文本。
4. 延迟 Clipboard Promise 未解决时不显示成功；切换到另一个同名文件、完成旧请求、再返回时都没有旧成功反馈。

现有 T1 浏览器用例仅补充新增搜索和复制控件的 Tab 顺序断言，未重跑 T1 广泛检查。新底层测试已加入 `pnpm test` 的文件列表，本票没有运行该命令中的其他测试。

## 尚未执行 / 集成后核验

按用户调整后的验证安排，**未调用 verify-atoms，未重跑完整浏览器矩阵或 T1 广泛回归**。本票的合成多文件与合成预览结果只能证明组件阅读行为，不代表平台支持多文件生成，也不证明生产工作台的全部副作用边界。

#47 集成后仍需集中验证真实工作台的原始单文件复制、预览注入隔离、生成请求计数、正式/试用数据及采用状态、完整版本生命周期、恢复/重开、待验证/执行阻断/保存失败等错误分支，以及规定的多文件与布局矩阵。T3、T4 和 #48 未在本票开展。
