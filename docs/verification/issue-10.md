# Issue #10：桌面入口与持续修改工作台验收

日期：2026-09-30（Asia/Shanghai）。范围仅为 [#10](https://github.com/lnisre/atoms/issues/10)，父规格 [#9](https://github.com/lnisre/atoms/issues/9) 保持打开，阅读记录真实闭环 [#11](https://github.com/lnisre/atoms/issues/11) 未开始。

## 实现与基线

开始时主工作区为 `main / 3b586af`，含完整且未提交的 M1/M2 实现，不能据旧 HEAD 判断功能。核对另一会话的 M2 PR #8，基线为 `c2bf7d9f72e77c598fd010eacb48d92ad543c3e9`；其提交整理未被接管。本次增量单独基于此提交整理，主工作区既有改动保留。

参考已归档 Atoms 首页与左右工作台布局，保留现有浅色主题，统一导航、间距和操作。桌面首页把已有项目放到输入旁边；工作台左侧对话独立滚动、输入固定在底部，右侧预览保持可操作高度，采用/放弃及边界说明靠近候选。原需求、较早记录、模型耗时与恢复范围通过原生 details/summary 展开。本轮对话最新在前，采用记录保留完整内容。

页面生成、采用、放弃、项目切换等处理函数逐字未改；AppPreview 只增加展示操作区的 ReactNode 插槽，不改变 effect 依赖、key、srcdoc 或通道。其他业务模块与 M2 提交清单哈希一致，见 [业务保全核对](assets/issue-10/business-preservation.json)。新增工作台浏览器测试；现有采用失败断言跟随错误提示迁到候选操作区。

## 验收条件逐项对应

| #10 条件 | 结果与证据 |
| --- | --- |
| 1. 首页、列表、工作台统一 | 通过；导航复用相同回首页行为，项目在首页右侧可重开。[线上首页](assets/issue-10/production-home.png)、[项目列表](assets/issue-10/production-project-list.png)。 |
| 2. 输入、已有项目清楚，示例不生成 | 通过；两种桌面测试确认示例仅填入输入；新建、返回、重开请求计数不增加；现有 390×844 首页测试保留并通过。 |
| 3. 独立滚动与持续可见输入 | 通过；1280×720、1440×900 下测试长原需求、12 条历史记录、6 轮候选对话。滚动左栏不移动 iframe，滚动 iframe 不移动左栏；页面不纵向溢出。 |
| 4. 候选操作就近且语义保留 | 通过；采用与放弃位于预览顶部，沿用 busy/adopting 条件。候选、事务等待、失败保全、采用清理及放弃回归通过（首跑/复验区别见下文）。 |
| 5. 信息优先级与键盘详情 | 通过；最新对话在前、最近采用结果单独展示；原需求/较早记录/模型耗时用键盘 Enter 展开与收起，全文仍可查看。 |
| 6. 数据边界与失败提示 | 通过；候选未采用、试用不写回、离开/刷新/关闭丢失紧邻采用；生成、采用保存、项目保存和应用数据失败仍在默认展示区域，未藏进详情。 |
| 7. 展示操作不改变业务状态 | 通过；展开/折叠后未提交输入保留，iframe 原节点仍连接，试用计数仍为 2，项目 URL 不变，生成计数仍为 7；采用后恢复正式值 1。 |
| 8. 已采用/候选/生成/保存/失败状态 | 通过；延迟响应、存储事务中止、生成失败、采用失败、数据读取失败、保存时锁定等现有回归覆盖；真实候选及采用另行操作。 |
| 9. 低高度桌面可达、无遮挡 | 通过；两种实际视口检查输入、iframe、采用与放弃边界均在窗口内；人工检查截图，未发现相互遮挡。 |
| 10. 完整路径与工程检查 | 通过，保留首击异常记录；lint、类型检查、服务端 10/10、默认 Turbopack 生产构建通过。完整浏览器路径及定向复验见下文。 |
| 11. 固定生产地址与旧项目恢复 | 通过；同一域名、同一浏览器配置下部署前后原项目记录哈希、业务数据哈希、可访问性快照一致，恢复模型调用为 0。 |
| 12. 范围保全 | 通过；未增加管理/后端/手机专项能力，保留手机首页回归、存储源、模型环境与 M1/M2 合同。M2 提交由原会话负责。 |

长内容线上截图：[1280 候选](assets/issue-10/live-tests/workbench-长内容桌面路径、独立滚动与详情状态保全-1280×720/candidate.png)、[1280 详情展开](assets/issue-10/live-tests/workbench-长内容桌面路径、独立滚动与详情状态保全-1280×720/details.png)、[1440 候选](assets/issue-10/live-tests/workbench-长内容桌面路径、独立滚动与详情状态保全-1440×900/candidate.png)、[1440 详情展开](assets/issue-10/live-tests/workbench-长内容桌面路径、独立滚动与详情状态保全-1440×900/details.png)。受控夹具只用于稳定验证平台展示与状态合同，不计为真实生成样本。

## 检查与失败记录

- [lint](assets/issue-10/lint.txt)、[类型检查](assets/issue-10/typecheck.txt)、[服务端测试 10/10](assets/issue-10/server-tests.txt)、[生产构建](assets/issue-10/build.txt) 通过。新增测试最初有一个 nullable IDB key 类型错误，已改为在已确认项目 URL 下的非空值并重验。
- 本地开发构建首跑 **20/22**：[日志](assets/issue-10/browser-first.txt)。两项装配测试首次 pointer click 后计数仍为 0。
- 被动事件探针 **8 次中 1 次复现**：[事件数据](assets/issue-10/click-probe.json)、[脚本](assets/issue-10/click-probe.mjs)。失败时父页面收到目标为 iframe 的 pointer/mouse/click，子页面事件数组为空，body.inert 为 false，应用处于已读取状态；明确第二次点击成功。支持“首次事件未进入子页面”，不支持归咎于数据提交失败；Chrome 底层原因仍未完全确认。
- 本地生产构建首跑 **20/22**：[日志](assets/issue-10/browser-production-build.txt)。计数器生成和一项装配测试受同类首击影响。生成与装配合同测试改为键盘 Enter 激活，不添加自动重试、不跳过保存/隔离断言；[生成定向 5/5](assets/issue-10/generation-keyboard.txt)、[装配定向 4/4](assets/issue-10/assembly-keyboard.txt) 通过。其他用户鼠标路径仍保留。
- 固定生产地址全量首跑 **21/22**：[线上日志](assets/issue-10/browser-live.txt)。唯一失败是采用流程起始的正式数据复选框首次鼠标勾选未改变状态；原测试未改，带 trace 单独复验 **1/1** 通过：[复验日志](assets/issue-10/live-adoption-recheck.txt)。不能把该复验写成首跑全绿。长内容新增测试、既有手机首页和保存失败回归在这次线上首跑通过。

已知非阻断限制延续既有复审：自动化 iframe 首次鼠标事件偶发未送达。没有用改业务逻辑、延迟或无说明重试掩盖它。截图仅辅助布局检查，行为断言与真实操作另有证据。

## 生产部署与旧项目

固定地址：<https://v0-test0-nine.vercel.app>。已核实 `v0-test0 / prj_eErnQuAz4P719xKTyuT6XT2Qu5ab`，Node.js 24.x；使用现有服务端模型环境，不复制或更换密钥。

- 部署前：`dpl_42zmSjVZG4daVXycgnsDo7DBxrvb`。
- 部署后：`dpl_3c8byi7JK7THH8DGmB4LzLhNYvXf`，`target=production`，`READY`，固定生产别名核对一致：[前](assets/issue-10/deployment-before.json)、[后](assets/issue-10/deployment-after.json)。
- 旧项目：`e5052705-847c-4858-be72-2b7d57d172c6`，在原验收浏览器配置 `/private/tmp/atoms-m1-save-fix-live` 中读取。部署前后未清库、未写入业务数据、未重新生成，项目/业务数据/应用快照一致：[前](assets/issue-10/old-project-before.json)、[后](assets/issue-10/old-project-after.json)、[检查脚本](assets/issue-10/old-project-check.mjs)。

## 真实生成与修改操作（补充 #10 主路径验证）

在独立浏览器配置 `/private/tmp/atoms-issue10-live` 中，通过线上首页创建“桌面验收待办”；生成应用由现有模型返回，未手工替换 HTML。

1. 初次真实调用 **6559 ms**，返回 `deepseek-flash`：[请求及结果元数据](assets/issue-10/real-initial.json)、[产物](assets/issue-10/real-initial.html)。添加正式任务甲/乙，等待应用数据已保存，刷新恢复两条记录。
2. 提出只改标题与按钮颜色的兼容修改，真实调用 **5834 ms**，以原 HTML 为 base：[修改元数据](assets/issue-10/real-modification.json)、[候选产物](assets/issue-10/real-modification.html)。标题变为“桌面验收待办·已调整”，原记录正常保留。
3. 在候选中新增“只在试用中新增”、删除正式任务甲、完成正式任务乙。展开原需求和模型耗时后，未提交输入、候选和试用记录仍保留：[试用操作快照](assets/issue-10/real-details-trial.json)、[截图](assets/issue-10/real-details-trial.png)。比较 [正式数据基线](assets/issue-10/real-data-before.json) 与 [试用时数据库](assets/issue-10/real-trial-data.json)，正式数据未变。
4. 明确采用后，正式任务甲/乙恢复为采用前的原状态，试用新增不存在；正式数据逐项与基线相同。随后在正式应用勾选任务甲并等待保存：[采用后的正式数据](assets/issue-10/real-data-adopted.json)。
5. 刷新、返回项目列表、关闭页面、新开页面并从已有项目重开。采用标题、任务甲完成状态、两条原记录与修改记录恢复；共两次生成调用，恢复过程新增调用 **0**：[最终断言摘要](assets/issue-10/real-final-checks.json)、[重开快照](assets/issue-10/real-final-reopened.json)、[截图](assets/issue-10/real-final-reopened.png)。真实应用的鼠标添加、删除、勾选及平台采用本次均成功。

仅据本次样本确认 #10 桌面路径；不推导任意生成应用的成功率，不将此待办样本替代 #11 阅读记录验收。源码文件对应 [SHA-256 清单](assets/issue-10/source-manifest.json)。
