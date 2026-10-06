# Issue #41：停止生成任务的流生命周期修复

> 当前交付状态（2026-10-06）：独立 Spec 审查与协调者复验发现 P1 取消竞态，**阻断发布**。候选尚未 push / 创建 PR / 合入 master；#41 保持 OPEN。下文作者自测与已通过集合属于历史/局部结果，不能解释为全部验收通过。详见末节。

2026-10-06（Asia/Shanghai）。本地修复与离线定向回归；未提交、推送、创建 PR、关闭 Issue 或部署。

## 被测身份与修改边界

- Worktree：`/Users/gaowenlong/.codex/worktrees/fe44/atoms`。
- 分支：`codex/fix-team-socket-cancel`。
- 基线：`886f933c3015d3c810f85662812c5bc201a478f7`，与 Issue 调查基线一致。
- Node `24.18.0`、pnpm `10.12.1`、Next `16.3.6`、Chrome `154.0.8037.98`。
- 当前源码在本 worktree 构建，BUILD_ID `bMF96r72Yu26vr7pW362e`；独立网关 `127.0.0.1:3241`、内部 Next `3242`。进程 cwd、固定示例资产字节均核对。
- Python `3.11.14`，本次临时环境中的 MetaGPT `1.0.0`。Team、MGXEnv、Role、RoleZero、TeamLeader 五个文件与上游固定 SHA `11cdf466d042aece04fc6cfd13b28e1a70341b1f` 逐字节一致；未声称核对整个上游包。
- Python 执行当前分支的 `runtime/team/runner.py`，通过当前分支的 `tests/team/fixture_transport.py` 替换 `httpx.AsyncClient`。只传离线占位凭据，真实供应商调用为 0。
- 页面由 Playwright 独立临时 profile 驱动；两条新增停止用例没有拦截 HTTP/WebSocket，没有写入 IndexedDB 来替代用户操作。
- 只读参考旧 worktree 的 `verify-atoms` 配方；未复制其未提交技能/驱动改动。使用当前基线已跟踪的 fixture 与 `snapshot` helper；未涉及另一任务的 draft 工作流修复。

文件 SHA-256、分支、基线和构建身份见 [identity.json](assets/issue-41/identity.json)。

## 修复

`src/lib/team/socket.ts` 将 reader cancel、显式 close、AbortSignal、正常/异常 socket close、协议/传输失败、控制请求超时和发送异常统一收尾：

1. 先标记终止；迟到消息、控制回执、重复终止和捕获到的旧回调都不再投递事件。
2. 立即清理 abort/socket 监听、拒绝所有 pending 控制请求并清理计时器，不等待 close 握手回来。
3. consumer cancel 时流已由 Streams 实现关闭，不再对 controller close/error；正常结束仍允许消费已排队事件；失败仍通过 reader rejection 传递具体原因。
4. 已终止的 adapter 即便 WebSocket 暂时仍为 OPEN 也不接受新控制请求；已 aborted 或 connecting 阶段停止不会发送 start。

没有吞掉 controller 异常、删除 pageerror 断言或延长产品预算。Leader、审查政策、240 秒/20 请求预算和存储模型均未改。

`tests/team-socket.test.ts` 增加 15 条零网络生命周期回归，并纳入 `package.json` 的默认测试。`tests/browser/team-stop.spec.ts` 增加两条真实页面停止回归。其余新增文件仅为本记录与脱敏证据。

## 修复前与失败记录

读取 Issue 正文（无评论）及给定历史报告、最小脚本、两种错误证据后，在本 worktree 对未修改 adapter 重跑：

```sh
node --import tsx /private/tmp/atoms-issue41/baseline-reproduction.mjs
node --import tsx --test --test-name-pattern='reader cancellation followed' tests/team-socket.test.ts
```

前者实际重新得到 `Invalid state: Controller is already closed`。新增测试第一次因 Node mock constructor 的替身装配失败；修正替身后，同一测试明确在实际 adapter 的 `controller.close()` 失败。产品代码之后才修改。

持久化证据：[原始最小复现结果](assets/issue-41/baseline-reproduction.json)、[测试装配失败](assets/issue-41/unit-before.txt)、[产品修复前回归失败](assets/issue-41/unit-before-2.txt)。当前单测是可长期重跑的最小复现，不依赖 `/tmp` 脚本。

线上历史 Chrome 报 `Cannot close an errored readable stream`；本次修复前 Node 报 `Controller is already closed`。两者均涉及非 readable 状态再次 close，但本次没有重现线上全部内部时序，也没有重测生产环境。

环境准备也保留失败：新 worktree 首次离线 pnpm 安装缺缓存，受限网络安装失败后使用授权的锁定依赖安装成功；旧临时 Python 环境已缺文件，从本机缓存建立独立 venv。首次 Python 导入因缺 PyArrow 失败，安装兼容的 `pyarrow==14.0.2` 后通过导入与依赖检查。测试包核心来源另行核对。没有修补产品/运行器来绕过这些环境问题。

## 实际验证

所有命令使用 Node 24 PATH，从本 worktree 执行。失败没有覆盖为成功；没有自动重试浏览器用例。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 零网络 socket 生命周期 | 15/15；取消后正常关闭、迟到事件、失败后关闭、重复终止、pending 拒绝/计时器清理、成功/拒绝 ack、正常流顺序、pre-abort、连接中止、发送失败 | [定向结果](assets/issue-41/unit-after-2.txt) |
| 默认单元回归 | 47/47，0 跳过 | [测试日志](assets/issue-41/tests-final.txt) |
| lint / typecheck | 通过 | [lint](assets/issue-41/lint-final.txt)、[typecheck](assets/issue-41/typecheck-final.txt) |
| 生产构建（webpack） | 通过，当前源码独立构建 | [构建日志](assets/issue-41/build.txt) |
| Python 原生团队离线测试 | 20/20 | [运行日志](assets/issue-41/python-tests.txt) |
| 新增真实页面停止 | 2/2，0 跳过，0 重试；两者 pageerror 均为 0 | [汇总](assets/issue-41/browser-stop-summary.json) |
| 既有团队与修改页面回归 | 14/14，0 跳过，0 重试 | [汇总](assets/issue-41/browser-existing-summary.json) |

执行命令：

```sh
pnpm test
pnpm lint
pnpm typecheck
pnpm build --webpack
node runtime/team/prepare.mjs
METAGPT_PROJECT_ROOT=/private/tmp/atoms-issue41/metagpt \
  /private/tmp/atoms-issue41/venv/bin/python runtime/team/test_runner.py
TEAM_FIXTURE=1 TEST_BASE_URL=http://127.0.0.1:3241 \
  pnpm exec playwright test tests/browser/team-stop.spec.ts \
  --workers=1 --retries=0 --output=/private/tmp/atoms-issue41/browser-stop --reporter=json
TEAM_FIXTURE=1 TEST_BASE_URL=http://127.0.0.1:3241 \
  pnpm exec playwright test tests/browser/team.spec.ts tests/browser/team-modification.spec.ts \
  --workers=1 --retries=0 --output=/private/tmp/atoms-issue41/browser-existing --reporter=json
```

网关使用独立临时 HOME、配置根和 offline-python wrapper；wrapper 仅调用本 worktree 的 fixture，再进入实际 runner。配方沿用 `runtime/team/README.md` 与已读的验证技能，未引入新的测试服务器。

首次生成用例实际等到第二次 Reviewer 请求开始，此前已有缓存 artifact，然后通过 UI 点击停止。等待结束、真实 socket 关闭、停止按钮消失；观察 32 秒（超过 fixture 的 30 秒延迟）仍无 iframe/项目交付；刷新后原工作区快照相等，没有新 socket。

修改用例先由离线原生团队完成首次生成，再实际生成候选并采用，UI 点击增加使正式 count 为 1，确认保存且有一条修改记录。再发起停止场景，第二次 Reviewer 开始后点击停止。生成候选按钮恢复、连接关闭；观察 32 秒无候选替换，iframe srcdoc、完整项目与业务数据快照均不变；刷新后 count、代码和修改记录一致，没有新 socket。

逐值快照和 socket 计数见 [首次停止](assets/issue-41/first-stop.json)、[修改停止](assets/issue-41/modification-stop.json)。截图见 [首次](assets/issue-41/first-stopped.png)、[修改](assets/issue-41/modification-stopped.png)，已人工查看。

## 清理与未验证范围

本次浏览器用例全部结束，Playwright 关闭隔离浏览器；已向本次网关 PID 17556 发送 SIGTERM，其 Next 子进程 PID 17586 同时退出。临时 venv、runtime HOME、MetaGPT 配置根、offline-python wrapper 和重建 wheel 均已删除；本 worktree 的 node_modules 与 .next 构建缓存保留。端口与进程检查见 [cleanup.json](assets/issue-41/cleanup.json)。完整运行工作目录为 `/private/tmp/atoms-issue41`；必要脱敏结果已复制到本记录相邻的 `assets/issue-41/`，不依赖临时目录存续。

未验证：生产部署、真实模型/供应商计费取消、线上服务端进程退出、跨部署兼容、整个上游 Python 包字节映射。新增页面用例证明本地受控 provider 下的停止、数据保护与客户端零 pageerror；不把离线 Reviewer 决策称为真实模型质量或业务验收。

本 worktree 保留未提交修改供独立回归；主目录和其他 worktree 未修改。完成本记录后停止写入，交由主会话审阅和后续交付。

## 独立回归与交付候选（2026-10-06）

本节为新会话的新运行，不复用上文作者自测计数。A 从 `codex/fix-team-socket-cancel` 白名单导入本会话 managed worktree `/Users/gaowenlong/.codex/worktrees/bf81/atoms`，分支 `codex/independent-team-cancel`。B 从 `codex/verify-atoms` 的已跟踪基线、实际 tracked 差异和必要未跟踪技能/测试/文档导出到独立临时 Git checkout `/private/tmp/atoms-independent-20261006/B`；B 的产品代码保持原基线，不含 A 修复。两个来源的 HEAD 均为 `886f933c3015d3c810f85662812c5bc201a478f7`。

导出前核对 A identity/sha256 与 B draft-driver manifest 全部匹配，记录来源 HEAD/status、29/53 个候选文件 hash；前后来源与导出文件均一致。来源与主工作目录未用于构建或运行，未复制 node_modules、.next、环境文件或秘密配置。[冻结身份](assets/issue-41/independent-20261006/identity-before.json)、[结束核对](assets/issue-41/independent-20261006/identity-after.json)。

| 独立环境 / 验证 | 本次实测 | 证据 |
| --- | --- | --- |
| A：Node 24.18.0，独立 pnpm 锁定依赖、webpack 生产构建；网关 3355 / Next 3356，BUILD_ID `ex8qOwbsoj9XFRhu1UvY1` | cwd/父子进程、素材字节、打包 runner 与当前源码一致 | [实例](assets/issue-41/independent-20261006/A-doctor.json)、[构建](assets/issue-41/independent-20261006/A-build.log) |
| 基线反证 | 从固定基线导出 adapter；同一新增取消用例仅调整 import，明确失败于 `Controller is already closed` | [基线失败](assets/issue-41/independent-20261006/A-baseline-red.log) |
| A 生命周期 / 默认测试 | 15/15、47/47，0 失败/跳过；正常流、失败、取消交错、pending/监听/计时器及迟到回执覆盖 | [定向](assets/issue-41/independent-20261006/A-socket-green.log)、[默认](assets/issue-41/independent-20261006/A-unit.log) |
| A 静态 / Python | lint、typecheck、构建通过；新 Python 3.11 venv 20/20，pip check 通过 | [lint](assets/issue-41/independent-20261006/A-lint.log)、[类型](assets/issue-41/independent-20261006/A-typecheck.log)、[Python](assets/issue-41/independent-20261006/A-python-summary.txt)、[依赖](assets/issue-41/independent-20261006/python-check.log) |
| A 真实页面停止 / 既有团队 | 2/2 + 14/14，失败/跳过/重试均 0；首次和修改均实际点击停止后观察 32 秒，pageerror 0、socket 已关闭、存储快照完全一致、刷新不发起新任务 | [16 项结果与停止观察](assets/issue-41/independent-20261006/A-summary.json)、[首次截图](assets/issue-41/independent-20261006/first-stopped.png)、[修改截图](assets/issue-41/independent-20261006/modification-stopped.png) |
| B：Node 24.18.0，独立依赖 / Next dev 3358 / Chrome 临时目录 | Doctor 通过；47/47，失败/跳过/重试均 0；地图 39 项全部包含在实际执行集合 | [逐项结果](assets/issue-41/independent-20261006/B-summary.json) |
| B 五分支与正式链路 | 正式、可用草稿、风险受限、执行阻断、无产物；默认停止/显式使用、错身份/hash/policy、记录级正反例、计数、实际 tsx CLI 全部通过；6 份草稿账本无外部请求与页面错误 | 同上；全部来自本次 47 项运行 |
| B manifest / 技能 / 静态 | 默认 stop、显式 use-synthetic、上限 3、不兼容参数拒绝；41 本地链接有效、技能结构有效；lint/typecheck 通过 | [默认](assets/issue-41/independent-20261006/B-manifest-default.json)、[显式](assets/issue-41/independent-20261006/B-manifest-use.json)、[拒绝](assets/issue-41/independent-20261006/B-manifest-incompatible.log)、[链接](assets/issue-41/independent-20261006/B-links.json)、[结构](assets/issue-41/independent-20261006/B-skill-validation.log)、[lint](assets/issue-41/independent-20261006/B-lint.log)、[类型](assets/issue-41/independent-20261006/B-typecheck.log) |

A 的新 Python 环境按只读版本清单从缓存独立安装，使用仓库离线配置；MetaGPT 五个原生调度核心文件重新从固定上游 SHA 获取并逐字节比对，通过结果见 [provenance](assets/issue-41/independent-20261006/python-provenance-fresh.json)。本轮没有核验整个上游包。临时 wrapper 显式调用本候选 `fixture_transport.py` 再执行生产构建中的当前源码 runner；仅使用离线占位凭据，未外发真实供应商请求。B 使用明确协议夹具，不启动 Python 或供应商。

B 的成功草稿续验保留初始 failed/无 Reviewer 的历史；真实使用草稿后试用数据没有迁入，随后正式保存、两轮候选、采用与恢复通过。风险/阻断/无产物和错身份反例均被拒绝，原 formal 路径不退化。这不将初始失败改写为模型成功，不关闭 #40，也不将 B 技能或驱动提交到本 PR。

首轮环境失败如实保留：创建分支受共享 Git 元数据写权限限制；导出脚本首次误用系统 Python 3.9 不支持的 tar filter，切换 3.11 后完成；两个 pnpm 离线安装缺 Next 缓存后按原锁文件联网安装；B 首次启动受 loopback bind 权限限制后在同一端口授权重启；uv 首次只读 freeze 受默认缓存写权限限制后改用本轮缓存目录。上述均在业务回归前修复，没有修改候选或测试断言。候选回归首次实跑全部通过，无业务失败后重试；基线预期失败独立保留。

本轮完整证据位于 `/private/tmp/atoms-independent-20261006`，包含两份完整 Playwright JSON、64 份 trace、安装失败日志和原始 Python 输出；临时位置不视为永久归档。[精简证据 hash](assets/issue-41/independent-20261006/sha256.json) 和 [trace 索引](assets/issue-41/independent-20261006/trace-sha256.json) 保留追溯。两套服务与浏览器已退出，3355/3356/3358 释放，本轮 venv、运行 HOME、离线配置、wrapper、profile/cache 删除；独立 checkout 与构建缓存保留。见 [清理](assets/issue-41/independent-20261006/cleanup.json)。

发布边界仍是 #41 客户端取消生命周期；未执行生产页面复验、真实模型/计费取消、手工 Vercel 部署或环境修改。PR 与远端合并结果以 GitHub 记录及本会话最终交付报告为准。

## 独立审查：发布阻断

Standards / Spec 按 `code-review` 技能由两个并行只读 agent 独立审查。固定基线 `886f933c3015d3c810f85662812c5bc201a478f7`，冻结候选 `3be65e0734f21382ff77f5b2b5c6e8a0ca8d30a1`；四个产品/测试文件逐字节匹配被测身份。没有修改候选、放宽断言或补丁式重跑。

### Standards

0 项发现。未发现违反 AGENTS.md、领域术语、ADR 或 PR 交付原则的改动，也未发现值得提出的基线代码异味。终止状态、监听、计时器和 pending 控制请求集中收尾；报告区分作者自测、独立回归及未验证范围。历史原始日志保留 CR/末尾空白以维持原始字节与 hash；源码、测试和报告的 whitespace check 通过。

### Spec

**1 项 P1，阻断发布：pending heartbeat 期间停止会产生未处理的 AbortError。**

Issue #41 要求“pending 控制请求和计时器得到有界清理……覆盖发生中的取消竞态”，以及“重复终止均不抛未处理异常”。正式调用链尚未满足该条件：

1. `readTeam` 接收 session 后建立实际 4 秒 heartbeat，控制请求尚未收到 ack。
2. AbortSignal 中止；候选 `socket.ts:35` 的 onAbort 进入 finish，立即拒绝 pending（第 26 行）并令流 error（第 29 行）。
3. `client.ts:67` 的 heartbeat 失败回调执行 `void reader.cancel()`；对已经 errored 的流，该 Promise 被拒绝且没有局部捕获，形成未处理的 `AbortError`。

审查者与协调者各自用 Node 24、正式 `readTeam` 与固定版本 adapter 重跑。两次候选运行均 exit 1，包含一个未处理的 AbortError；两次基线均 exit 1，表现为原 `Controller is already closed` 未捕获异常。候选消除了原错误，但新增了未处理异常形式，属于修复不完整。既有 client 及其运行时依赖在两版本间无改动。

[最小集成复现](assets/issue-41/independent-20261006/spec-review/pending-heartbeat-abort.mjs) 从 Git 固定 SHA 读取 client/socket，仅擦除 TypeScript 类型与调整 import；真实 ReadableStream、真实 4 秒计时器，WebSocket 是明确零网络替身。错误观察器仅记账，检测到未处理异常即退出 1，不修改产品行为。可从本仓库执行：

```sh
node --import tsx docs/verification/assets/issue-41/independent-20261006/spec-review/pending-heartbeat-abort.mjs 3be65e0734f21382ff77f5b2b5c6e8a0ca8d30a1
node --import tsx docs/verification/assets/issue-41/independent-20261006/spec-review/pending-heartbeat-abort.mjs 886f933c3015d3c810f85662812c5bc201a478f7
```

证据：[审查候选](assets/issue-41/independent-20261006/spec-review/candidate.json)、[审查基线](assets/issue-41/independent-20261006/spec-review/baseline.json)、[协调者候选复验](assets/issue-41/independent-20261006/spec-review/candidate-coordinator.json)、[协调者基线复验](assets/issue-41/independent-20261006/spec-review/baseline-coordinator.json)。这些运行是新增集成检查，不包含在前文已通过的 47/15/16 测试计数中。

最小建议：局部处理 heartbeat 失败清理中 `reader.cancel()` 的预期拒绝，沿用已有 onAbort/finally 的清理方式，并增加正式 readTeam + adapter 的 pending heartbeat 与 abort/timeout 集成回归。不要全局吞掉错误。这会改变产品候选，超出本轮独立回归的修补边界；故仅记录建议，没有修改 client、adapter 或原测试。

Standards 0 项；Spec 1 项 P1。停止发布，未 push、未创建 PR、无 merge SHA；#41 保持 OPEN。远端 master 在交付检查时仍为原基线，主工作区干净但不需要同步；两个来源工作区的未提交内容保持原样。B 独立回归仍通过，未交付、未关闭 #40。所有本轮服务/profile/临时 Python 已清理，最后的零网络复现进程亦已退出。
