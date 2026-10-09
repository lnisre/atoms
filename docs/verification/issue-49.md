# Issue #49：T1 项目源码与目录浏览

2026-10-09（Asia/Shanghai）。实现任务 [#49](https://github.com/lnisre/atoms/issues/49)，父规格 [#47](https://github.com/lnisre/atoms/issues/47)。独立工作树 `/private/tmp/atoms-source-browser-t1`，分支 `codex/source-browser-t1`，基线 `1d4d81791b3b48c51e0311f1af7e842a13d9cd1f`。主目录既有 CONTEXT.md、示例 ADR 和 experiments 修改未带入提交。

## 验证策略调整

本轮检查启动后，用户要求：**verify-atoms 留到 #47 全部子任务完成后集中执行，不在每个 ticket 重复整体验收。** 调整到达时，已启动的 36 项既有浏览器回归已结束；已完成的 T1 专项和底层检查如实保留，未继续扩展或重跑整套验收。随后仅完成静态检查、证据归档和清理。

这里的通过结论只覆盖下列已执行项目，**不代表 #47 PRD 级 verify-atoms 验收通过**。T2–T4、真实多文件生成与运行、完整版本生命周期及复杂保存失败分支不属于本次交付。

## 实现

- `ResultViewer` 提供“预览 / 查看代码”。项目重开默认预览；首次进入代码打开入口文件。切换只改变可见性及焦点资格，保持同版本 iframe、几何尺寸、数据桥接和运行逻辑。
- `SourceBrowser` 的公开输入是代码版本身份、入口路径和只读文本文件集合。目录由路径组织，支持展开/收起、文件选择、完整路径、选中状态、纯文本阅读和选择，以及同版本文件阅读位置保留。
- 工作台从与预览相同的完整结果读取原始 HTML，真实成果只映射为 `index.html`。没有改生成协议、项目存储或预览注入逻辑。候选与审查状态、采用/放弃操作在代码模式仍可达，原有限制继续生效。
- 沿用工作台视觉和左右结构。右侧宽度不超过 620px 时自动收起目录；重新展开只覆盖右侧区域。
- 合成多文件仅存在于 `tests/fixtures/`，通过生产组件的公开 props 在隔离浏览器页面承载；没有产品演示入口、模拟生成按钮或多文件项目存储。
- 没有语法高亮、行号、搜索、复制按钮、代码编辑或文件管理。`esbuild` 仅作为测试开发依赖，用于打包隔离承载页。

## 逐项结果

来源均为 #49 验收项；相关约束沿用 ADR 0002、0004、0011、0012。环境：Node 24.18.0、pnpm 10.12.1、Next 16.3.6、Playwright 1.63.0、Chrome 154.0.8037.99。真实 Next 工作台、sandbox iframe、平台数据桥接和 IndexedDB；生成结果与审查记录是明确标识的受控协议响应，未调用真实模型。

| 预期 | 实际观察 | 证据 | 结果 |
| --- | --- | --- | --- |
| 默认预览，首次打开入口，刷新和项目重开恢复默认 | UI 生成、刷新、首页卡片重开均默认预览；进入源码显示 index.html，重开阅读位置为 0 | [专项结果](assets/issue-49/t1-results.json)、[1440 操作记录](assets/issue-49/workbench-1440-actions.json) | 通过 |
| 真实单文件原样展示，示例不伪造文件 | 源码 textContent 与受控 HTML 逐字相等；示例与 pomodoro-v1.html 逐字相等；生产目录只有一个按钮 | [1440 源码/存储证据](assets/issue-49/workbench-1440-read-only-evidence.json)、[示例截图](assets/issue-49/example-source.png) | 通过 |
| 公开文件集合支持嵌套目录、同名文件、长路径、空文本 | 合成输入覆盖根文件、TS/CSS/JSON/Markdown、不同目录的 index.ts 和深层空文件；完整路径、选中状态与文本相符 | [合成输入](assets/issue-49/synthetic-files-synthetic-input-evidence.json)、[操作记录](assets/issue-49/synthetic-files-actions.json)、[截图](assets/issue-49/synthetic-files-desktop.png) | 通过 |
| 源码只读，内容不执行，文本可选择 | HTML/script/img 仅为文本，无对应 DOM；脚本标记未出现，源码资源请求为 0；真实鼠标拖选获得文本；没有编辑入口 | 专项结果、合成操作记录 | 通过 |
| 桌面与 736px 保持左右结构，窄窗口优先收目录 | 1440×900、1280×720、736×900 均左右排列；736 下目录先隐藏，展开边界限定在成果面板 | [1440](assets/issue-49/source-1440.png)、[1280](assets/issue-49/source-1280.png)、[736 展开目录](assets/issue-49/source-736.png)、[长路径窄窗口](assets/issue-49/synthetic-files-narrow.png) | 通过 |
| 同版本保留输入、选择、目录、阅读位置和预览运行 | iframe DOM 仍连接且应用实例 UUID 相同；未提交应用/对话输入保留；源码滚动 950px 保留；合成文件切换与视图切换保留滚动及目录状态 | 三份 workbench read-only-evidence、合成操作记录 | 通过 |
| 隐藏预览继续运行 | 1440 计时 3→16，1280 2→19，736 5→27；示例在代码模式从 25:00 继续倒计时 | [1280 状态证据](assets/issue-49/workbench-1280-read-only-evidence.json)、[736 状态证据](assets/issue-49/workbench-736-read-only-evidence.json)、[示例操作](assets/issue-49/example-actions.json) | 通过 |
| 阅读不生成、不采用、不直接写数据，修改基础不变 | 阅读前后请求数均为 1，完整项目和业务记录逐值一致；之后显式生成候选才增至 2，提交的 baseHtml 等于原始完整 HTML；示例 API 请求为 0 | 三份 read-only-evidence、专项操作记录、[示例请求](assets/issue-49/example-example-requests.json) | 通过 |
| 没有完整成果时禁用并解释，执行限制不绕过 | 首次生成中和失败后按钮禁用且有说明；执行阻断的完整源码可阅读，但切换前后 iframe 数量始终为 0，没有使用入口 | [未完成成果操作](assets/issue-49/unavailable-actions.json)、[执行阻断操作](assets/issue-49/blocked-actions.json) | 通过 |
| 鼠标和键盘可达 | 鼠标切换、选文件、展开目录、选文本；Enter/Space 操作视图/目录/文件，Tab 到目录控制与源码；对话输入可聚焦；候选操作在三个视口可达 | 专项操作记录 | 通过 |

## 已执行检查

- T1 专项：7/7 通过，首次运行和最后一次完整成果门槛调整后的运行均无失败。见 [两轮摘要](assets/issue-49/attempts.json) 和 [最终专项结果](assets/issue-49/t1-results.json)。
- 策略调整前已启动并完成的相关回归：36/36 通过，0 跳过、0 重试。覆盖 workbench、workbench-stream、candidate、save-race、reviewer-preview、builtin-example、preview-document；见 [实际用例清单](assets/issue-49/existing-regressions.json)。未扩展到完整 Playwright 套件。
- `pnpm test`：54/54 通过，见 [输出](assets/issue-49/unit-tests.log)。
- `pnpm typecheck`、`pnpm lint`、`git diff --check`：通过。最后仅将目录的 DOM 关联 ID 按路径编码，以保证带空格路径不产生多个 IDREF；该小改动通过静态检查，未重新启动浏览器验收。
- 前期 [Doctor](assets/issue-49/doctor.json) 确认服务 cwd、端口、Next 版本与素材 hash。它在策略调整前执行，不代表整体验收。

可复用的 T1 针对性测试入口：`tests/browser/source-browser.spec.ts`。多文件承载代码在 `tests/fixtures/source-browser-harness.tsx`，输入在 `source-browser-files.ts`；通过 Playwright 路由提供测试资源，不增加应用路由。

## 证据及清理

本目录保留匹配视口截图、从真实 Playwright trace 提取的操作与断言记录、源码 hash、完整合成项目/业务数据前后观察、请求计数和测试结果。trace 内的固定响应均为测试数据；UI 请求数不是实际供应商调用数，截图中的合成角色调用记录不证明真实模型质量。

完整 ZIP trace、原始 JSON 报告和服务日志位于 `/private/tmp/atoms-t1-evidence/`，属于临时原件；[专项结果](assets/issue-49/t1-results.json) 记录它们的 hash 和位置，不声称这些 ZIP 已长期归档。已归档的精简证据足以核对本次具体操作和断言。

[浏览器验证时源码 hash](assets/issue-49/source-files.sha256.json) 与 [交付源码 hash](assets/issue-49/delivery-files.sha256.json) 区分最后的 DOM ID 编码修改。自有开发服务已结束，3214 端口释放，测试浏览器已由 Playwright 关闭；见 [清理记录](assets/issue-49/cleanup.json)。未启动生产构建、生产部署或真实供应商调用；PRD 级 verify-atoms 验收保留到 #47 全部子任务完成后集中执行。
