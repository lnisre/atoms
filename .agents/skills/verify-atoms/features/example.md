# 小费示例与旧副本保全

## 验收时机

#50/#51 票内仅做类型、静态及直接相关的定向功能检查。两票全部交付并集成后，由 #46 在合入前统一调用 verify-atoms；票内不运行本功能完整矩阵或等价替代脚本。未执行项明确标注待集中验收。

## 入口与覆盖

新隔离 profile 访问 `/`，通过“已有项目”“我的项目”“最近项目”打开“示例 · 小费计算器”。首页保留创建入口、不自动跳转。有效项目链接先完成必要升级，再恢复原目标；缺失链接显示缺失提示，本次读取不安装示例。

| 可观察结果 | 驱动与依据 |
| --- | --- |
| 一份独立项目及 20/5/4 数据；两轮真实来源回复、交付、8/7 次请求、42/30 个时间条目、首次解析失败；来源不写入个人任务 | `builtin-example.spec.ts`；#46/#50、ADR 0013 |
| 小费 1、总额 21、每人 5.25；有效输入保存、非法输入不写；未知字段保留；读失败禁写、写失败回滚 | `builtin-example.spec.ts`；连续输入脚本定向回归在 `tests/tip-calculator.test.ts` |
| 项目/业务数据/安装标记一起提交；多标签唯一；素材/读库/事务错误可重试；删除后不重建 | `builtin-example.spec.ts` |
| 来源与本人记录分开；候选试用/放弃隔离，采用只换代码；继续修改、刷新/新标签恢复 | `builtin-example.spec.ts` 及既有 candidate/modification-records |
| 当前单文件源码与预览一致，复制无注入，同版本切换保留输入/iframe；代码模式下候选/失败状态可达 | source-browser/source-version/source-recovery；#47 保持有效 |
| 完整浏览器重启后恢复代码、数据、两轮来源且零模型请求 | `scripts/smoke-example.mjs`；`example-restart.spec.ts` 同时覆盖旧副本与已采用个人修改 |
| 已有工作区补入、旧副本退休、升级并发/失败/旧标签保存采用保全 | `workspace-upgrade.spec.ts`：旧格式种子、下载门控、真实 UI 保存/采用及事务回滚；`legacy-example.spec.ts`：旧计时和已修改副本保护 |

## 驱动

集中验收按主技能启动独立实例，再选择 `tests/browser/builtin-example.spec.ts`、`workspace-upgrade.spec.ts`、`legacy-example.spec.ts`、`example-restart.spec.ts` 和受影响源码/工作台用例。全重启 smoke 改用真实小费输入、已保存值、同一隔离 profile 重开；票内只更新驱动；PRD 集中执行结果见 `docs/verification/issue-46.md`。

选择器：卡片限定“已有项目”；iframe `#bill`、`#tipPercent`、`#people`、`#perPersonVal`、`[data-atoms-status]`；来源区 `示例来源记录`。同时核对 UI 和对应项目 ID 的业务行，不以数据库写入代替用户动作。

## 边界

来源导出仅为 DOM 展示快照，不是原始 IndexedDB 全对象。素材修订关系、hash 与检查范围见 `docs/verification/issue-50.md`。来源 Reviewer 不证明修订代码通过审查；展示不会授予执行或采用资格。

T2 使用 `$atoms:workspace:tip-calculator` 标记：缺少时补入，存在时即使副本已移除也不重建。旧 `exampleSource` 转为 `retiredExampleSource`，只将精确默认标题改成“专注番茄钟”；业务数据、代码和原记录保全。首页/最近项目只标记小费为当前示例，工作台“项目来源”保留旧来源。

升级竞争用例先因素材不可用打开旧副本，再在其他标签下载暂停期间通过该旧标签 UI 重置计时、生成并采用受控候选；解除下载门控后核对最新代码/记录/业务数据。种子仅用于建立迁移前状态。`draftResult` 用例分别覆盖禁止执行与数据风险，核对真实源码、搜索复制、禁用采用、跨项目和重开默认预览；不能以兼容说明页通过源码断言。

票内执行边界见 `docs/verification/issue-51.md`。完整故障组合、多视口、旧计时矩阵、浏览器进程重启、已有小费/删除后分支及受影响回归由 #46 在最终集成版本验收；按其记录区分已执行结果与限制。旧计时测试使用受控旧格式项目及 Date.now，不把其结果写成新小费行为。
