# #81：采用修改的风险分级与禁用原因

2026-10-12（Asia/Shanghai）。基于已集成 #76/#77/#78 的 `136c549`。用户要求全面修复采用置灰，Chrome 现场只读查看，无刷新、丢弃、采用或重新生成操作。领域决定同步 ADR 0011。

## 现场与根因

恢复 V2 后的新候选仅有 `duplicate-save-on-change`（minor / persistence）。Reviewer 明确描述同值重复保存，不造成数据丢失或错误结果。旧策略按分类统一阻断；恢复状态本身未参与禁用。策略测试在修复前复现误拦截，记录见 [policy-before.log](assets/issue-81/policy-before.log)。

修复按类别与严重度，不特判问题 ID：data-loss 任意严重度和 major persistence 阻断；minor persistence 保留意见、允许采用。所有未解决意见继续作为 Reviewer 上下文，仅真实数据风险决定采用资格。已有重大问题被同 ID 降级为 minor 不算修复；只有当前代码的明确 resolution 可解除。换 hash、审查不可用不能洗掉风险。

## 禁用条件审视

| 条件 | 界面与提交行为 |
| --- | --- |
| 无候选 | 先生成候选；提交入口不写入 |
| 正在生成 | 禁用采用，说明正在生成新候选；控制器也拒绝旧候选提交 |
| 正在保存 | 等待云端确认；已发出的相同提交复用进行中操作 |
| 原代码/数据保存未确认 | 先处理原保存；原操作重试仍沿用同一 operationId |
| 正式数据读取中 | 等待读取完成 |
| 无可信 proof | 说明无法取得保存资格，提供下载、放弃后重新生成的路径 |
| 执行阻断 | 显示平台实际阻断原因，继续禁止运行与采用 |
| data-loss 或重大持久化风险 | 显示后果和触发条件，拒绝采用 |
| 一般持久化意见 | 保留审查提醒，允许试用后采用 |
| 普通功能/交互意见、无已知风险但审查不可用 | 沿用既有采用规则 |
| 已恢复、存在撤销机会 | 不阻止采用；只有采用成功结束撤销 |
| 旧签名仍声明 blocked | 不由前端改写；新规则用于服务端签发的新产物 |

UI 与控制器共用 adoptionBlock。最终保存边界仍由服务端签名、数据库账号/任务/基础代码/版本检查负责。本次没有迁移、重新签发旧证明或修改生产业务数据。

## 验证

Node 24、pnpm 10.12.1、本地 Chrome / webpack dev 3216，Doctor 核对工作树和服务归属。

- 全量 `pnpm test`：112/112；包含真实 HMAC attestation → 已安装 PostgreSQL/WASM 迁移：一般 persistence 可提交，major persistence 与两种严重度 data-loss 均被拒绝，改写证明也被拒绝。数据库/JWT 身份为合成接缝，不等同于生产 CloudBase 验收。
- 补充的控制器正式数据读取/未完成写入测试通过，证明直接调用 commit 也不会绕过限制。
- 浏览器首轮 26/27；唯一失败为现有 restricted 试用测试的 iframe 首击未命中（count 仍为 0）。保留该失败，原测试未改成强制点击或重试点击；独立复跑通过。
- 最终定向 7/7。按用例去重后 28 个场景均有通过结果；不据此宣称已根治浏览器首击竞态。
- 新增真实页面链路：V3 → 恢复 V2 → minor persistence 候选 → 在试用副本修改数据 → 采用 → 原正式数据不被副本覆盖 → 刷新保留新代码 → 后续仍可继续修改；撤销资格在成功采用后结束。
- 界面覆盖重大风险具体原因、缺证明、生成中、执行阻断。既有历史失败重试、源代码/预览、候选、账号及 #78 游客布局场景通过。
- `pnpm typecheck`、`pnpm lint`、`git diff --check` 通过。

[逐项浏览器记录](assets/issue-81/browser-summary.json) · [服务端测试](assets/issue-81/unit-tests.log) · [允许采用](assets/issue-81/minor-adoption-after-restore.png) · [真正风险的具体原因](assets/issue-81/major-risk-blocked.png)

浏览器验收使用既有合成 Auth/BFF/生成产物接缝，零真实模型调用。审查分类来自测试接缝，策略使用真实 previewPolicy；SQL 用真实 attestArtifact 签名进行独立最终保存资格验证。用户当前未采用候选现场保持原样，旧签名不会因部署被前端自动解锁。
