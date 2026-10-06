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

## 整合 master 与交付验证（2026-10-07）

结果 **changed**。在指定 `codex/verify-atoms` worktree 先用 `ec43cbe` 固化全部 53 个既有文件，再以正常 merge `68da61c` 整合远端 master `29212c00b1b2701d84515743c3afc6a980140261`。没有冲突；未导入其他 worktree 的未提交补丁。初始 53 文件逐项匹配 #41 独立 B 的冻结身份；只更新 5 份技能配方，加入新 `team-stop`、默认 client/socket 心跳集成入口及独立 Python HOME。产品、运行时、锁文件、配置与 master 完全一致。技能及驱动候选为 `a242924f0e35468dc576a328c540822fa125aced`；之后仅追加本节与交付证据。

维护范围：generation、modification、review-policy、workbench 的受影响配方和共享驱动；三个只读源码 agent 覆盖四份地图，协调者串行执行 live pass。依据 #40 正文/评论、本轮明确授权、CONTEXT、ADR 0004/0006/0008/0011。未改变已接受期望，也未扩展产品设计。

### 本轮新结果

独立 Node 24.18.0 / pnpm 10.12.1、锁定依赖、webpack 生产构建；自建 gateway `3375` / Next `3376`。Python 3.11 venv 从本机缓存独立安装，依赖检查通过；五个原生调度核心文件与此前从固定上游 SHA 核验的字节一致，未声称本次重新下载或核验整个上游包。wrapper 明确执行本 worktree 的 `fixture_transport.py`，替换 `httpx.AsyncClient` 并要求离线占位凭据；同时启用 `TEAM_FIXTURE=1`。没有真实供应商调用，没有部署。

| 预期及来源 | 本轮观察 | 证据 | 结果 |
| --- | --- | --- | --- |
| 仓库默认静态/单元/构建门槛 | lint、typecheck、默认测试 54/54、webpack build/prepare 成功；默认测试含真实 client/adapter 心跳生命周期 | [unit](assets/issue-40/delivery-20261007/unit.log)、[build](assets/issue-40/delivery-20261007/build.log) | 通过 |
| 原生团队路由、预算与取消（ADR 0006/0008） | Python 20/20；gateway Doctor 前后健康，归属/构建/素材匹配 | [Python](assets/issue-40/delivery-20261007/python-summary.log)、[doctor](assets/issue-40/delivery-20261007/doctor.json)、[provenance](assets/issue-40/delivery-20261007/python-provenance.json) | 通过 |
| 新基线与共享驱动整合 | 16 文件 67/67；0 失败、跳过、重试；涵盖旧 B 47 项及原生团队、停止、preview-document | [逐项结果](assets/issue-40/delivery-20261007/browser-summary.json) | 通过 |
| 草稿五分支、显式使用、失败历史及风险拒绝（ADR 0011） | 默认停在可用草稿；显式使用保留 failed/无 Reviewer 历史与代码 hash，排除试用数据；风险/阻断/无产物拒绝正式链路；正式路径保持通过 | [分支摘要](assets/issue-40/delivery-20261007/branches.json)、逐项结果 | 通过 |
| 记录级断言、tsx CLI、工作台请求账本 | 空态正例与两种错误筛选反例；snapshot spec 启动实际 `node --import tsx` CLI；1440/1280 预期请求各 2 次，额外 fetch 反例拒绝 | [反例及停止](assets/issue-40/delivery-20261007/counterexamples-and-stops.json)、逐项结果 | 通过 |
| 地图选集与实际执行一致 | modification.md 的 8 文件选出 39 项，全部在本轮 67 项通过集合；不是用 `--list` 代替执行 | 逐项结果中的 modificationMapSelection | 通过 |
| 首次/修改停止保全，拒绝缓存及迟到工件（#41 / ADR 0011） | 两条均观察 32 秒；无页面错误、socket 关闭、无迟到 frame，停止前后完整存储一致，刷新不重启任务 | 反例及停止 | 通过 |
| 技能结构、入口、链接与权限（#40） | frontmatter 校验；UI metadata 存在；两 helper 可执行；技能及既有报告 70 个本地链接有效；manifest 默认 stop、显式 use、repair 组合拒绝 | [integrity](assets/issue-40/delivery-20261007/integrity.json)、[格式](assets/issue-40/delivery-20261007/skill-validation.log) | 通过；UI 自动发现未验证 |

静态/默认测试和构建先在 merge commit 执行；随后 `a242924` 只改上述技能文档，产品/测试/构建输入未变。浏览器与 Doctor 直接在 `a242924` 执行。精确源码、测试和技能身份见 [tested-files](assets/issue-40/delivery-20261007/tested-files.sha256.json)，构建产品身份见 [build-source](assets/issue-40/delivery-20261007/build-source.json)。CLI 默认/显式 manifest 和不兼容选项结果也保存在同目录。本轮候选验证没有失败或重试；不覆盖上文历史失败。

### 复用范围与未验证边界

[复用判断](assets/issue-40/delivery-20261007/evidence-reuse.json)：旧 B 47/47 与 53 文件身份保留为独立历史证据；因整合 client/socket 和 `team-stop` 使用本票 snapshot，旧计数不替代本次整合运行，上述 47 项全部新跑。旧番茄钟真实开始/暂停、完整 Chrome 退出重启及端口占用拒绝证据仍有效：example/store/page/smoke helper 字节未变；相比旧 smoke 仅 package 测试入口、client/socket 改动，与零模型示例路径无关。本轮未重做完整历史套件或番茄钟冒烟。

当前会话技能目录清单没有自动列出 `verify-atoms`；已验证项目文件注册位置、显式读取/命令调用与 metadata，**未验证实际 UI 自动发现**。真实模型/Reviewer 质量、生产部署与线上验收、原站视觉、生成应用完整浏览器重启，以及本轮未选择的其他地图分支均不新增通过结论。旧功能及真实验收缺口按原报告保持。

### 独立审查与清理

按 code-review 两个独立只读 agent 审查固定差异 `29212c0...a242924`：Standards 0 项硬性违反、0 项需修复异味；Spec 0 项发现。审查包含全部技能、driver、测试及历史报告；本节和新增精简证据另做最终增量核对。snapshot 的就地 IndexedDB 回调保留 tsx 序列化约束，不以抽象重构重新引入 `__name`。

[清理记录](assets/issue-40/delivery-20261007/cleanup.json)：仅关闭本轮 gateway/Next `89903/89915`，3375/3376 释放；浏览器退出，临时 profile/cache、Python venv、wrapper、runtime HOME 与配置根删除。68 份 trace 和完整结果保留在 `/private/tmp/atoms-40-delivery`；临时位置不是长期档案，长期精简结果在本节链接目录，[trace 哈希](assets/issue-40/delivery-20261007/trace-sha256.json)仅供追溯，不表示 ZIP 已入库。原主工作区与其他 worktree 未用于测试或修改；原 53 文件全部先提交保全，旧报告/失败证据未覆盖。GitHub PR、最终 head、merge SHA 与关闭状态以随后交付记录为准。
