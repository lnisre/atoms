# #50 小费示例 T1 交付与验证边界

2026-10-09。基线 `f83fcaed5be7cbc9d2f9e0adede502d90b3325c8`（已含 #47 / PR #58）。实现范围为 [#50](https://github.com/lnisre/atoms/issues/50)，父规格 [#46](https://github.com/lnisre/atoms/issues/46)，已有工作区迁移由 [#51](https://github.com/lnisre/atoms/issues/51) 完成。本记录不是完整 PRD 验收结论。

## 实现

- 全新工作区在首页获得独立小费示例；项目、演示数据和标记同一事务提交。正式数据为 bill=20、tipPercent=5、people=4、tipAmount=1、total=21、perPerson=5.25。采用现有 UUID、读库失败保护和事务内重查，不覆盖已有工作区。
- 两轮来源历史保持独立，复用正常消息正文、审查说明、角色交付、调用和执行卡。保留真实解析失败与重试，不构造 `InitialGeneration`、`TeamRecord`、原始事件 ID 或首版 HTML。
- 个人修改继续走已有候选/试用/采用流程。共用正文提取保留 `resultHint`（含禁止运行、尚未保存）、保存错误、进行中状态及返工信息；ResultViewer、iframe 生命周期和预览/代码模式不另行实现。
- 旧番茄钟素材、来源身份及原对话保留。旧计时、旧数据、修改过副本的保护用例移到 `legacy-example.spec.ts`，通过明确旧格式种子建立场景。

## 来源与派生关系

来源项目：`https://v0-test0-nine.vercel.app/?project=32c434ba-be5e-49a8-a558-406c370e3cf5`。来源站点当时部署于 `86db88d7dcc02156e4e99627dae3ca306d1ccc62`。提取来自授权会话中的实际 DOM：读取完整助手回复、展开详情中的角色/调用 JSON、执行卡及时间；从 iframe srcdoc 中仅去掉平台注入 CSP 和数据桥。授权会话已在同浏览器新标签逐项核对恢复，本票未重新操作来源浏览器。

| 素材 | 身份与范围 |
| --- | --- |
| 首次任务 | `f16271b4-c3ed-4de4-8ecc-602fbec89c3e`；8 请求、42 时间条目；hash `1b0b9d7e2cc3a2380c869d5ff63f89971275d6608d628d1acc511780bfdd998c`，未取得完整 HTML |
| 来源已采用修改 | `5b99f558-9df0-44e6-b700-efa538757bfb`；7 请求、30 时间条目；10091 字节；hash `0bdda2b95e5f9d4cf58d071f65fae68d400b9346e5df321e27078af8c8e898f3` |
| 原始 HTML 留存 | `tests/fixtures/tip-calculator-source.html`，与上行逐字节相同；工程师与 Reviewer 均对应此 hash |
| 两轮展示快照 | `src/lib/examples/tip-calculator-history.json`，61299 字节；SHA-256 `146445746a21ddb21a5e679068d100b9c928f409d992057896d410f7c6cb1af0`；原样保留，包括采用时间 `06:58:08.963Z` 及事务结束时间 `06:58:08.975Z` 的不同含义 |
| 发布素材 | `public/examples/tip-calculator-v1.html`；SHA-256 `da317d0deedfa543013f4ae85decb80d59ce50a923d4c82b7ef3df20dd199b8e`；从上述来源 HTML 作必要修复 |

原素材 `persist()` 在保存进行中直接 return，会忽略之后的有效输入：输入 80 → 800 → 人数 2，前次写入确认后仍只有首笔保存。定向测试在原素材上失败（预期第二笔写入，实际只有一笔）。修订增加最新有效状态队列，串行保存；失败时清除队列、恢复最后确认状态。CSS、布局、计算公式和读取逻辑未变。未知字段继续保留。

来源 Reviewer 静态结论只属于原素材，不能用于修订版。界面明确说明修订关系，保留两个 hash；没有新增模型审查或付费调用。脚本定向检查覆盖修复，完整业务/浏览器验收仍待下述集中阶段。

## 已执行

使用 Node 24、Next 16.3.6 与锁文件依赖。主目录依赖过旧，首次复用时报缺少 refractor/acorn/esbuild；随后在独立工作区按锁文件安装，未改动主目录。

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过，无警告 |
| `node --import tsx --test tests/tip-calculator.test.ts tests/generation-record.test.tsx tests/source-code.test.ts` | 8/8 通过：连续输入、非法值、读写失败、未知字段、素材与历史身份、普通/受限提示、源码与搜索文本 |
| `TEST_BASE_URL=http://127.0.0.1:3237 pnpm exec playwright test tests/browser/builtin-example.spec.ts --grep '独立小费\|来源历史与本人' --workers=1 --retries=0 --reporter=line` | 两项通过，15.1 秒；独立项目和默认数据、来源 2 轮/72 时间条目/失败保留、展开不换 iframe、刷新恢复、独立 context；受控修改、试用不写正式数据、采用只换代码与个人记录、刷新恢复 |
| `git diff --check` | 通过 |

浏览器仅使用本票本地实例及 Playwright 临时 context；生成请求由已有 `fulfillGeneration` 替身处理。来源打开/展开/刷新路径观察到 0 生成请求，候选用例 1 次受控请求、0 供应商请求。没有使用用户原浏览器、Vercel 或生产站点。两条定向路径不代表完整矩阵通过。

## 已更新但未执行 / #46 集中验收

本票未调用 verify-atoms，也未运行等价完整矩阵、生产构建、付费模型或部署。以下必须在 #50/#51 全部交付并集成后、完整 PRD 合入前统一执行：

- `builtin-example.spec.ts` 剩余用例：多标签、删除后不重灌、素材/读库/安装事务故障、真实非法输入与未知字段、应用读写失败、代码模式下采用后继续修改/放弃/再次采用。
- `legacy-example.spec.ts` 的旧计时、未知字段和旧修改保全；#51 完成后更新身份/迁移断言，保留原功能保护。
- source-browser/source-recovery 已切换默认入口；source-version、source-reading、普通首次生成/返工、工作台等受影响回归。核对代码模式操作及受限/未保存提示、同版本 iframe 与未提交草稿保留。
- `smoke-example.mjs` 和 doctor 已改用小费素材，完整 profile 重启驱动未执行；补充已采用个人修改、两轮来源和正式数据一起恢复的完整浏览器重启场景。
- 首页/我的项目/最近项目/深链接，以及 1440×900、1280×720、约 736px 桌面左右布局；示例内部 700px 响应式单独核验。
- #51 原子升级、旧首访标记、旧示例已移除、旧标签在素材下载期间保存/采用竞争、升级故障回滚和新旧源码隔离；本票未实现、未验收。

## #51 衔接

新安装在 `applicationData` 同时写 `$atoms:workspace:first-visit` 和 `$atoms:workspace:tip-calculator`；仅新项目安装时写后一标记。已有工作区继续遵守旧首访逻辑，不新增示例、不退休旧项目。#51 应以小费标记处理一次升级，在同一事务重读最新项目并保全旧标签写入；不得使用下载前快照覆盖当前代码或数据。T1 已安装后删除项目时，标记保留，不能重新创建。

T1 PR 供审查/集成；不自动合并、不发布、不关闭父规格。#51 与 #46 的最终验收仍待执行。
