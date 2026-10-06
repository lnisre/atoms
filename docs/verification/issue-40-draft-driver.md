# Issue #40：首次待验证草稿的跨应用驱动补充

2026-10-06（Asia/Shanghai），结果 **changed**。在 `/Users/gaowenlong/.codex/worktrees/verify-atoms/atoms`、`codex/verify-atoms` 完成有界维护；HEAD 保持 `886f933c3015d3c810f85662812c5bc201a478f7`。最终受影响回归 **47/47**，无失败、跳过、重试。供应商调用 0。

依据：用户本轮明确边界、Issue #40 正文/评论、CONTEXT、ADR 0011、现有 verify-atoms，以及只读线上报告 `/private/tmp/atoms-online-acceptance.jeGNJa/report.txt` 和 continuation-1。按 maintain-verification-skill / writing-for-agents 检查 generation、modification、review-policy 三类功能；三个只读源码分支审计，协调者串行驱动独立本地实例。

## 修复的语义边界

旧共享驱动把“项目已保存”当作正式项目，并读取 `data[0].state`。线上首次 Engineer 交付后 Leader failed、Reviewer 未执行；平台按现行策略保留 `draftResult` 和 trial-only 预览，没有当前项目的正式业务行是合法状态。原始失败、线上任务/代码和 continuation 结论均保持原样。本轮没有重放旧 HTML，也没有新模型生成；全部新增角色/审查回应明确为离线协议夹具。

新驱动按提交的 projectId/taskId 和 URL 定位原始记录，校验工件 hash/交接及实际 previewPolicy，区分正式、可明确使用草稿、风险受限草稿、执行阻断、无产物失败。正式写入后业务行缺失会明确报错，不用空对象或其他项目的首行替代。workspace 元数据、无关正式项目与当前业务行可以同时存在。

默认停在可用草稿；只有 `{ initialDraft: 'use-synthetic' }` / CLI `--use-retained-draft` 的明确合成场景可继续。执行真实草稿 HTML 的独立检查、试用隔离、失败历史保全、刷新丢弃试用，再建立非空试用并真实点击“使用此版本”。断言代码 hash 不变、draft 移除、正式策略、试用数据未迁入，以及原始 task/team/calls/deliveries/reply 不变、旧执行事件仍存在。之后才进入正式保存、两轮修改、采用、评分/筛选及刷新/新页面恢复。

风险受限或执行阻断即使设置该选项也拒绝正式链路；错误 task/hash/policy、stopped 产物均拒绝。显式使用后 persisted dataMode=formal，而无审查历史仍使重新计算的原始策略 dataMode=trial：驱动核对真实执行/采用资格并承认用户动作，不伪造 Reviewer 或把 failed 改成 passed。

CLI 记录 `workflowCompleted`、初始 outcome/disposition 与生命周期路径，区分 `formal-from-generation` 和 `explicit-retained-artifact-continuation`；补充实际驱动文件 hash。manifest 实现上限从旧 2 修正为 ADR 0011 的 3，旧 manifest/proof 不重写。

## 精确修改文件

以下路径均相对此 worktree；完整 SHA-256 见 [files.sha256.json](assets/issue-40/draft-driver-20261006/files.sha256.json)。

| 文件 | 本次变更 |
| --- | --- |
| `tests/team/project-observation.ts`（新增） | 按身份读取、五类产物分类、强制正式行、初始历史保全断言 |
| `tests/team/cross-app-workflow.ts` | 初次分类与明确使用分支；业务/项目按 ID；保留原有记录级断言和 tsx snapshot |
| `tests/team/live-cross-app.ts` | 显式操作入口、分开记录 outcome/续验结果、驱动 hash、当前工件上限 |
| `tests/browser/cross-app-draft.spec.ts`（新增） | 6 项持久回归、外部请求阻断账本、无关项目种子和反例 |
| `tests/browser/cross-app-acceptance.spec.ts` | 原成功路线额外确认 formal/passed 且未执行首次草稿使用 |
| `tests/browser/record-assertions.spec.ts` | 改用当前 URL projectId 查正式行，保留全部正反例和计数 |
| `.agents/skills/verify-atoms/SKILL.md` | 主体公开草稿操作/回归入口和结果边界 |
| `.agents/skills/verify-atoms/features/README.md` | 三类受影响功能索引 |
| `.agents/skills/verify-atoms/features/generation.md` | 五分支和跨应用草稿回归 |
| `.agents/skills/verify-atoms/features/modification.md` | 首次明确使用入口、8 文件配方 |
| `.agents/skills/verify-atoms/features/review-policy.md` | 正式资格与失败历史/风险反例配方 |
| `.agents/skills/verify-atoms/references/team.md` | CLI manifest/execute 选项和证据字段 |
| `.agents/skills/verify-atoms/references/initial-artifact.md`（新增） | 集中描述分类、明确操作、记录身份和证据解释 |
| `docs/verification/issue-40.md` | 仅追加本报告索引，历史正文不改 |
| `docs/verification/issue-40-draft-driver.md`（新增） | 本独立诊断及回归报告 |

另新增 `docs/verification/assets/issue-40/draft-driver-20261006/` 精简证据，不覆盖任何旧证据。未修改 src/public/runtime、产品配置、Leader 策略或取消流逻辑；不提交、推送、部署、创建 PR 或关闭 Issue。

## 实测结果

Node 24.18.0，独立 Next dev/webpack 端口 3348，根 PID 11874/子进程 11913；Doctor 核对 cwd、父子监听归属、HTTP、素材 hash 和工作树身份通过。没有复用其他会话的实例/构建服务。Chrome profile/cache 全部位于本轮独立 TMPDIR。

| 预期与依据 | 观察结果 | 新证据 |
| --- | --- | --- |
| ADR 0011：失败初次任务保留可用草稿，明确使用不复制试用 | 草稿当前正式行 absent；试用前后全部正式数据等值；UI 使用后仍 absent；正式保存后才产生正确行 | branches.json / full evidence 中 draft-trial、explicit-first-use |
| ADR 0011：失败记录诚实保留 | 三处 team digest 相等；初次 failed、末次 Mike failed、Reviewer 调用 0；两次修改 passed，恢复后初次仍 failed | branches.json |
| 用户边界：默认不提升未知产物权限 | 无 opt-in 的可用草稿停止；data-risk、execution-blocked 即使 opt-in 也停止；无产物失败不误选示例/无关项目 | branches.json 中四类反例、每类 failure-page |
| 记录身份与错误数据不被掩盖 | 反转两个数组仍选对记录；删除当前行明确报错；错 task、篡改策略/hash、stopped 结果均被拒绝；无关项目逐值不变 | cross-app-draft 测试、checks.json |
| 普通已审查路径不退化；既有驱动修复仍有效 | reading/todo formal+passed、无草稿使用；tsx 真实 CLI、过滤正反例、请求账本、repair、存储/采用/工作台回归通过 | affected-final.json，47/47 |
| 修改技能命令与执行计数一致 | 8 文件实际选择 39 项，全部包含在最终通过集合；--list 本身不算执行 | modification-selection.json / checks.json |
| 静态及技能完整性 | lint/typecheck 退出 0；skill valid；41 个本地链接均存在 | checks.json / static logs |
| 既有产物与产品保护 | 625 个受保护文件 hash 与本轮开始一致，含产品、冻结场景、旧证据及未涉及的既有驱动修复 | protected-files.json / checks.json |
| 清理并保留证据 | 本轮服务/浏览器均退出，3348 释放，独立 TMPDIR 删除；54 份 trace ZIP 完整且保存 hash | cleanup.json |

新增套件首次 6/6 通过；随后补强错误身份/策略反例、载入完成断言和正常路径证据后，最终全套 47/47。初次直接 tsc 曾指出旧 record-assertions 的 state 可能缺失；该调用点改为按 ID 强制读取真实业务行，最终 `pnpm typecheck` 通过。没有忽略错误或放宽原有断言。

失败草稿场景的独立检查：草稿 55、正式初版 55、第一候选 103、已采用候选 103 项分别通过，codeHash/planHash 保存在 branches.json。它们是合成 HTML 的业务检查，不是新模型成功或 Reviewer 浏览器执行。

## 命令、证据和独立复验

精简 [summary](assets/issue-40/draft-driver-20261006/summary.json)、[正反分支](assets/issue-40/draft-driver-20261006/branches.json)、[检查清单](assets/issue-40/draft-driver-20261006/checks.json)、[命令](assets/issue-40/draft-driver-20261006/commands.json)、[清理](assets/issue-40/draft-driver-20261006/cleanup.json)。完整证据 `/private/tmp/atoms-draft-driver.mvtjyw9_` 是保留的临时目录，非永久档案；精简目录不包含完整 trace。原线上只读文件的实际 hash 已另存 summary，未将其复制为本轮成功样本。

后续独立复验使用该 worktree 的 Node 24，按技能 Launch 新选空闲端口/浏览器临时目录，启动自己的实例并 Doctor；不要复用已停止的 PID。

1. 按 [initial-artifact 配方](../../.agents/skills/verify-atoms/references/initial-artifact.md) 运行 cross-app-draft、cross-app-acceptance、reviewer-preview、record-assertions、snapshot-cli；要求无失败/skip，且四种禁止继续分支被拒绝。snapshot spec 实际调用 `node --import tsx tests/team/snapshot-cli.mjs`。
2. 运行 modification.md 的 8 文件/39 项及 workbench.md 配方，重复 spec 只需在最终源码执行一次。本次完整 12 文件/47 项命令在 commands.json。
3. 单独运行 `node --import tsx tests/team/live-cross-app.ts` 及 `--use-retained-draft`，确认只输出 manifest、默认 stop/明确 use-synthetic、上限 3；`--repair --use-retained-draft` 应拒绝。不要为本轮复验增加 `--execute` 或供应商调用。
4. 执行 `pnpm lint`、`pnpm typecheck`，核对文件 hash；关闭自己启动的服务/浏览器，确认端口释放、证据保留。

未验证：真实供应商/Leader 决策改善、原生 gateway/Python、生产构建/部署、生成应用完整浏览器重启、视觉参照、技能 UI 自动发现，以及本次未选择的其余功能地图分支。取消流问题按用户要求留给另一个 worktree。本次指定草稿驱动缺口已补齐，完成后停止修改。
