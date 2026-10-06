# Issue #40：Atoms 验证技能与功能地图

2026-10-05（Asia/Shanghai），在独立 worktree / 分支 `codex/verify-atoms` 完成项目技能。基线 `886f933c3015d3c810f85662812c5bc201a478f7`。本轮只增加技能、驱动与证据，不修改产品代码、配置或现有测试，不部署、不调用真实模型。

## 交付

- [技能入口](../../.agents/skills/verify-atoms/SKILL.md)：当前任务验收合同、三种运行模式、启动、Doctor、操作、证据和清理。
- [五类功能地图](../../.agents/skills/verify-atoms/features/README.md)：生成、修改/试用/采用、审查/返工/预览、首访示例、首页/工作台，均链接对应 Issue/ADR。
- 两个可执行 Node helper：只读 Doctor，以及拥有独立 Next 实例和持久化 Chrome profile 的番茄钟冒烟。
- [团队运行分支](../../.agents/skills/verify-atoms/references/team.md)：区分普通页面、离线原生团队和真实供应商，复用已有工具，不把 TEAM_FIXTURE 标记误当 provider 替换。

## 本次实测

环境：Node 24.18.0、pnpm 10.12.1、Next 16.3.6、Playwright 1.63.0、Chrome 154.0.8037.93。worktree 独立安装锁文件依赖，离线缓存安装成功。Next dev 使用 webpack，仅监听本机 3210；不是生产构建验收。

执行技能自己的命令：

```sh
node .agents/skills/verify-atoms/scripts/smoke-example.mjs /private/tmp/atoms-verify-40-smoke-2 3210
```

| 预期及来源 | 实测 | 证据 | 状态 |
| --- | --- | --- | --- |
| #40：独立启动和只读 Doctor 能辨认当前实例 | cwd、监听进程归属、HTTP、素材 hash、源码身份一致 | [doctor](assets/issue-40/doctor.json)、[manifest](assets/issue-40/manifest.json) | 通过 |
| ADR 0012：新工作区示例可从首页打开，初始化不调用模型 | 一份项目、无初始业务 state、无伪造 initialGeneration；初始 25:00 | [initial](assets/issue-40/initial.json)、[actions](assets/issue-40/actions.json) | 通过 |
| ADR 0012：开始/暂停实际保存，界面与提交数据一致 | 真实按钮点击，墙上时间推进到 24:59，暂停为 remaining=1499、running=false | [saved](assets/issue-40/saved.json)、actions | 通过 |
| ADR 0012：暂停后刷新恢复 | 深链接刷新后计时、完整项目和业务记录一致 | actions | 通过 |
| #40 / ADR 0012：完整浏览器退出后以原独立 profile 恢复 | 关闭 persistent context（浏览器退出），重新 launch，同源首页卡片重开；完整项目和业务记录逐值一致 | [reopened](assets/issue-40/reopened.json)、[截图](assets/issue-40/reopened.png)、actions | 通过 |
| #40：初始化/恢复零模型调用 | 浏览器拦截并记录 API/外部请求尝试；API 尝试 0；无页面错误 | [network](assets/issue-40/network.json) | 通过 |
| #40：失败与成功均清理实例，证据保留 | 两轮均 browserClosed/serverStopped/portReleased/profileRemoved=true；成功后证据 hash 留存 | [cleanup](assets/issue-40/cleanup.json)、[summary](assets/issue-40/summary.json) | 通过 |
| 技能结构与 helper 静态检查 | quick_validate 通过；两个 helper 的 ESLint、Node 语法检查通过；本地文档链接核对 | [checks](assets/issue-40/checks.json) | 通过 |

动作记录使用 ISO UTC 时间（2026-10-04T17:12），对应北京时间 2026-10-05 01:12。本次只证明当前暂停示例路径和驱动可用，不能解释为五类功能全部验收通过。

## 首轮失败及修正

`/private/tmp/atoms-verify-40-smoke-1` 中，计时/保存、刷新和完整重启后的存储比较均已完成，但页面错误断言失败：Playwright 1.63 的 `serviceWorkers: 'block'` 会向 frame 注入读取 `navigator.serviceWorker` 的脚本，在缺少 allow-same-origin 的 sandbox 中抛出异常。已在安装包 `playwright-core/lib/coreBundle.js` 核对注入来源。

移除这一不必要的测试配置，保留页面零错误、全部业务和存储断言；再次使用全新 evidence/profile 执行成功。没有过滤错误、修改 sandbox 或产品行为。首轮日志和两轮清理结果均保留，不能将两轮描述为首次即成功。归档：[首轮摘要](assets/issue-40/first-attempt-summary.json)、[首轮网络/错误](assets/issue-40/first-attempt-network.json)。

## 证据保留与限制

精简证据保存在 `docs/verification/assets/issue-40/`；[skill-files.sha256.json](assets/issue-40/skill-files.sha256.json) 记录交付技能文件身份。完整 trace、服务器日志和全部截图仍在 `/private/tmp/atoms-verify-40-smoke-2/`，首次失败原件在 `/private/tmp/atoms-verify-40-smoke-1/`；临时路径不是长期档案。summary 中 trace hash 对应这些原件，不表示精简目录包含 ZIP。

本轮未执行：运行中/跨到期计时恢复、故障注入用例、现有完整 Playwright 套件、Python/离线团队、真实跨应用生成/修改/返工、生产构建/部署、视觉对照。地图提供这些分支的已核查配方，并明确需要的环境与当前证据边界。

检查时发现并记录两项既有驱动差异：`live-cross-app.ts` 的旧 manifest 仍写 engineerArtifacts=2，不能作为 ADR 0011 的全局上限；`live-modifications.mjs` 仍有首条项目假设，应优先用已按当前项目排序的 shared workflow。它们的修订属于对应后续验收任务，本轮不扩展修改。

后续使用 maintain-verification-skill 维护功能地图。真实跨应用、复杂修改及真实 Reviewer 返工仍为独立验收候选；视觉缺口继续归属 #15/#18。


## 后续定点维护：驱动与配方（2026-10-05）

本节追加记录，前文及原有失败证据保留原意。结果 **changed**：用户指定的六项修复已完成；这是有界驱动维护，不是全产品或真实模型验收。工作目录 `/Users/gaowenlong/.codex/worktrees/verify-atoms/atoms`，分支 `codex/verify-atoms`，HEAD 仍为 `886f933c3015d3c810f85662812c5bc201a478f7`。

依据：本轮明确修复要求、Issue #40、冻结的跨应用需求、ADR 0004/0011，以及 `/private/tmp/atoms-diagnostic.6ewQQJ/report.txt`、`/private/tmp/atoms-verify-full.jjQVPK/report.txt`、`/private/tmp/atoms-verify-fix.AjoN8Z/report.txt`。维护源码波按 generation/modification 和 workbench 范围只读审计，协调者串行驱动自建实例。

### 修复内容与精确文件

- `.agents/skills/verify-atoms/SKILL.md`
- `.agents/skills/verify-atoms/features/README.md`
- `.agents/skills/verify-atoms/features/generation.md`
- `.agents/skills/verify-atoms/features/modification.md`
- `.agents/skills/verify-atoms/features/workbench.md`
- `.agents/skills/verify-atoms/references/team.md`
- `tests/browser/home-entry.spec.ts`
- `tests/browser/record-assertions.spec.ts`
- `tests/browser/snapshot-cli.spec.ts`
- `tests/browser/workbench-stream.spec.ts`
- `tests/team/cross-app-scenarios.ts`
- `tests/team/cross-app-workflow.ts`
- `tests/team/record-assertions.ts`
- `tests/team/repair-workflow.ts`
- `tests/team/snapshot-cli.mjs`

- snapshot 将两次 IndexedDB 读取就地展开，浏览器回调不依赖 tsx 注入的 `__name`。新增 CLI 回归通过 `node --import tsx` 导入实际 helper、启动真实 Chrome，核对两个 store、当前项目排序及刷新；既有 Playwright 套件调用同一入口。
- 共享 workflow 和 repair workflow 使用记录身份、完整可见名称及孤立业务标题组合断言。正式记录的 ID 序列逐值核对；每次 active/complete/all 后完整正式数据等值。独立 QA 使用原生 CSS 的 DOM 记录/名称双检查和独立空筛选场景，逐次断言完整 seed 与零保存；该 QA 接口的 DOM 计数不冒称可见性验证。
- 持久反例分别证明：空态 li 可以通过；已读记录错误保留在 active 下必须失败；同一错误记录即使去掉 data-id 仍必须失败。共享可见性 helper 和独立 QA 都拒绝后两案。新增样本均为明确合成 HTML，未编辑旧真实 HTML 或冻结需求文字。
- workbench-stream 合并初次 route 与替换 fetch 的请求账本，区别初次需求和修改需求，展开/滚动/resize 后仍为预期两次。另一次真正进入同一 window.fetch 的额外请求，使旧 route 数仍为 1，但新不变断言拒绝；流已消费结束。这些是 UI 生成尝试，供应商调用为 0。
- home-entry 名称改为缺失项目反馈；真正存储故障来源仍为 builtin-example 和 persistence。modification 配方补齐 reviewer-preview、cross-app-acceptance、record-assertions，实际选中 7 文件/33 项，README 与说明一致。
- 原 venv 配方与 smoke coverage 修复保留。执行计划修正会改变 planHash：新 proof 单独生成，旧 proof 不改；返工入口需要按当前计划对原产物重新做独立基线检查，不可手改旧 hash。

除上述 15 个测试/技能文件外，本次仅追加本报告与 `docs/verification/assets/issue-40/driver-maintenance-20261005/` 的精简证据：summary.json、counterexamples.json、snapshot-red.log、snapshot-green.log、files.sha256.json。未修改 src/、public/、runtime/、预算/审查政策或 Reviewer 提示；没有提交、推送、PR、部署、Issue 写操作或真实模型调用。

### 新执行结果

Node 24.18.0；独立 Next dev 实例 3337、PID 99020，独立 Chrome 临时目录；Doctor 通过。已有依赖，无升级，无 Python/模型环境需求。provider 回应全部在既有传输边界显式合成，未读取模型凭据。

| 检查 | 结果 | 新证据 |
| --- | --- | --- |
| tsx 实际入口，修复前与修复后 | 首轮稳定复现 __name；修复后同一回归通过 | snapshot-red.log / snapshot-green.log / 两份 trace |
| snapshot CLI + 筛选三案 + workbench-stream + cross-app（含 repair） | 13/13；0 失败/跳过/重试 | targeted-1.json |
| candidate + modification-records + persistence + save-race + reviewer-preview + home-entry + workbench | 28/28；0 失败/跳过/重试 | affected-1.json |
| modification 文档命令选择核对 | 33 项均在上述实跑集合通过；--list 自身不算执行 | modification-selection.json |
| pnpm lint / pnpm typecheck / 技能格式 / 本地链接 | 通过；33 个链接存在 | lint.log / typecheck.log / skill-validation.log / integrity-checks.json |
| 源码与历史保护 | 611 个既有受保护文件 hash 不变；冻结需求、旧 venv 与 smoke 修复保留 | identity-before.json / integrity-checks.json |
| 清理 | 自建服务退出、3337 释放、无本轮浏览器/profile；44 份本轮 trace 完整 | cleanup.json |

原严格 li 计数失败、历史真实产物和 Reviewer 附带意见误判仍属原报告记录。本次不把旧失败改写为成功，也不以新的合成样本补称真实模型质量。Reviewer minor 意见的反证继续作为独立质量观察，详见原定点诊断报告。

本次保留的额外失败：临时清理检查器先把 Playwright 转译缓存当 profile，随后缓存白名单漏了 Node 编译缓存；两次均发生在服务、浏览器已退出之后。按实际目录重新核验并只清理本轮三个编译缓存后通过，未改变产品断言或增加超时。见 cleanup-first.json、cleanup-second.json、cleanup.json。

完整新证据：`/private/tmp/atoms-driver-maintenance.o4e9849n`（临时目录，不是长期档案）。精简结果见 [summary](assets/issue-40/driver-maintenance-20261005/summary.json)、[正反例](assets/issue-40/driver-maintenance-20261005/counterexamples.json)、[最终文件身份](assets/issue-40/driver-maintenance-20261005/files.sha256.json)。原有精简证据和旧身份文件没有覆盖。

### 交接与独立复验

完整实际命令与退出码在 `/private/tmp/atoms-driver-maintenance.o4e9849n/commands.json`。后续从该 worktree 使用 Node 24，按技能 Launch/Doctor 新建端口及独立浏览器目录，保留独立输出；不复用已停止的 PID 99020。

1. `SNAPSHOT_EVIDENCE_DIR="$RUN/snapshot-cli" node --import tsx tests/team/snapshot-cli.mjs`；应通过实际 helper/浏览器，不注入 __name。
2. 运行 `tests/browser/record-assertions.spec.ts`、`cross-app-acceptance.spec.ts`、`snapshot-cli.spec.ts`；确认空态正例和两个反例、筛选数据不变、共享 reading/todo/repair 均通过。
3. 运行 workbench.md 的三文件配方；1440/1280 两视口各两次预期请求，额外 fetch 反例被拒绝，iframe/草稿/试用值保留。
4. 运行 modification.md 的 7 文件命令并用 `--list` 核对实际选择；需要 33 项且无意外 skip。该组与第 2 步重复的 spec 只需按最终版本执行一次。
5. 执行 `pnpm lint`、`pnpm typecheck`，核对 files.sha256.json、冻结需求和产品文件身份，关闭自建服务/profile并保存清理证据。

未验证：本轮未重跑全部原生 Python/gateway、真实供应商/Reviewer、生产构建/部署、原站视觉、完整浏览器重启的生成应用恢复或技能 UI 自动发现；对应历史证据不冒充新执行。本轮目标内没有尚未解决的失败。写完报告后停止改动，由原验证会话独立回归。

## 首次待验证草稿驱动维护（2026-10-06）

新增独立报告：[首次草稿分类、明确使用及失败历史回归](issue-40-draft-driver.md)。本轮在同一验证 worktree 补充驱动/技能，47/47 离线受影响回归通过，零新增供应商调用；将初次团队失败与保留产物继续的结果分开记录。上文旧结论、线上原始失败及既有证据不改写。
