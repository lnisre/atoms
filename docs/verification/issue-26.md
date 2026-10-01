# Issue #26：一次整体返工、停止与需求澄清

按 2026-10-01 的 [#26](https://github.com/lnisre/atoms/issues/26) 与 [父规格 #23](https://github.com/lnisre/atoms/issues/23) 实现。基线为 #30 / `bc01b79b58f040acefa490e31eafeade8d7fc1a8`；#30 仍 OPEN / Draft、未合并，#25 仍 OPEN。交付分支基于 `codex/issue-25-team`，不合并或改变依赖任务状态。

有效拒绝经原生 MetaGPT Leader 分派进入一次 Engineer 整体返工；冻结规格、原需求、完整被拒代码和实际意见进入修复上下文。修复立即使旧审查失效，新代码必须复审；复审仍拒绝、技术错误或预算不足均结束。JSON 与字段格式错误共用同一任务一次纠正，技术失败不触发盲修。平台同时验证交接顺序、任务/代码身份、请求账本和正常进程终态。成功记录保留拒绝、返工理由、修改说明与新审查，历史完整旧 HTML 只在执行器中供返工使用。

停止任务关闭连接、终止受监督进程，页面结束等待，迟到结果不能覆盖成果；M4 修改期间停止同样保全已有候选。终态分别为通过、审查拒绝、执行失败、停止、超限、澄清和不支持。核心歧义集中提问后结束本轮，补充与原问题组成新任务；此前需求和问题留在当前页面会话，不在后端等待。不迁移 #27 的多轮修改团队流程。

## 工程验证

- 接口 22/22、Python 17/17、lint、类型检查、webpack 生产构建通过。六个 MetaGPT 核心文件继续匹配固定上游 SHA。
- 完整浏览器回归 62/62，新增已有候选的停止/迟到保全 1/1；收尾增加正常终态防绕过门槛后，接口 22/22、受影响的生成/团队浏览器场景 17/17、构建和静态检查补验通过，其余无新增风险的场景复用完整回归证据。
- 受控实际 MetaGPT → 网关 → 页面覆盖直接通过、首次拒绝、一次修复通过、复审仍拒绝、格式纠正成功/持续无效、旧批准与错代码、停止、澄清后新任务、不支持。浏览器时钟验证 4 分钟终止；Python 验证纠正与复审共用预算、第 20 次之后不发第 21 次。
- 接口用实际受监督挂起进程验证取消与原截止时间均终止该进程；结束后控制回传 410，无新产物。浏览器验证复审中停止、断线、无保存、页面退出等待和后续请求为零。
- 既有读取失败、保存失败、数据隔离、候选采用、日志追加、保存竞态、旧记录与独立 QA 工具回归保留。Reviewer 仍是静态代码审查。

## 真实模型受控返工

[白名单调用、审查、操作与恢复记录](assets/issue-26/local-real-repair.json)。所有输入是 agent 编写的合成计数器需求，独立全新浏览器上下文，无用户业务内容。调用目标为 DeepSeek 官方 `https://api.deepseek.com/chat/completions`，请求和响应模型均 `deepseek-flash`，thinking disabled、reasoning effort none。

本地 `local-injected-1`：11 次真实请求，任务 52,932 ms，完整脚本 59,787 ms；prompt 27,500、completion 7,328、total 34,828 tokens，11 次均有 usage。开发专用注入器只把首份 Engineer 真实输出的 `atoms.saveState(...)` 换为 `Promise.resolve(...)`，不生成修复代码、不改规格、不改变 Reviewer 结果。该注入器不进入生产运行时。真实 Reviewer 指出点击后伪称保存而没有平台持久化；真实 Leader 分派 Engineer，Engineer 模型修复并说明，再由 Reviewer 审查完整新代码后通过，Leader 正常交付。

[注入说明](assets/issue-26/injection.json)、[代码身份](assets/issue-26/code-sha256.json)及三份实际代码均保留。注入前代码与修复代码在同一独立预选检查下各 36/36；被拒代码 25/36，失败包括保存次数为 0、保存锁缺失、业务数据未变和保存失败保护不触发，符合注入缺陷。没有改写期望值或把独立测试冒充 Reviewer 的动作。

开发者通过页面实际点击增加、增加、减少、重置、减少、增加、增加，output 依次为 1、2、1、0、-1、0、1，保存与刷新、关闭重开恢复成功；重开生成请求 0。对已完成的真实结果再使用最终交付校验器核对，仍通过。

独立零模型复现（需安装依赖和 Chrome）：

```sh
node tests/team/replay.mjs docs/verification/assets/issue-26/engineer-before-injection.html.proof.json /tmp/issue26-before.json
node tests/team/replay.mjs docs/verification/assets/issue-26/rejected.html.proof.json /tmp/issue26-rejected.json
node tests/team/replay.mjs docs/verification/assets/issue-26/generated.html.proof.json /tmp/issue26-repaired.json
```

预期分别 passed 36/36、failed 25/36、passed 36/36。脚本不访问项目存储、Vercel 或模型。开发专用真实注入入口见 `tests/team/inject-save-defect.py`，需 `ATOMS_DEFECT_EVIDENCE_DIR` 指向专用证据目录，并通过既有可信 Python 环境启动 `runner.py`；模型配置只在可信进程环境中传递，不写入命令参数或证据。

## 首次失败与复验

1. 最初直接 tsc 缺 Next 自动生成的 LayoutProps；运行安装版本 `next typegen` 后类型检查通过。系统 pnpm 的依赖检查想重建复用目录，未运行项目测试；改用已安装的执行器，之后复制为隔离工作区独有依赖，消除共享构建追踪。
2. 第一场受控浏览器：拒绝夹具原样返回被拒代码，正确触发“不改代码不能重审”，未到预期复审拒绝终态；修正夹具为真实第二份代码且保留缺陷，再次验证复审仍拒绝。另一个澄清断言匹配 Next 空 alert，改为内容定位。
3. 第二场浏览器复验被本 agent 提前重建运行包干扰，澄清后执行文件消失导致 0 次模型调用。该场作废；保留日志并在稳定构建重跑。后续测试期间不重建。
4. 稳定完整回归首次 59/60，唯一失败为旧“等待超时”文案断言，实际已进入新的明确超限终态。更新为 4 分钟/任务已超限断言后相关 17/17；最终完整回归 62/62。
5. 独立诊断脚本首次使用不存在的 planHash 导出，未执行浏览器/模型。修正为合同中的 `sha256(JSON.stringify(scenarios))`，同一三份代码完成前后对照。
6. 真实调用启动两次被自动审批拒绝，未调用模型；核实 #25 历史授权后仍被认为未覆盖 #26。用户随后明确授权本票的现有配置复用、合成上下文发送及本次 Preview 配置，再进行上述真实验收。

原始工程日志与失败截图在 `/private/tmp/atoms26-*`，仅关键复现证据纳入仓库。没有覆盖失败结果、输出/提交密钥、票据、请求头、cookies 或浏览器 profile。

## 目标部署验收

[最终 Preview](https://v0-test0-lsu3fdhxs-lnisres-projects.vercel.app/)：`dpl_BJgvJKB5tt2xdKLi5nsW7okkBWpw`，READY / staging。[部署及源码核验](assets/issue-26/final-verification.json)、[白名单源码哈希](assets/issue-26/source-sha256.json)确认部署与当前源码一致，生产仍为 `dpl_68LXQuH7oBNajTAM7JJKZMpVAJRH`，保留的自动化访问凭据未创建、轮换或撤销。中间 Preview `dpl_2HQhKYfcJkiEs6VJeNmb2BPQpqzS` 已 READY，因收尾门槛增强而由最终部署替代，没有进行模型验收，不冒充最终源码。

[两场真实线上调用与操作记录](assets/issue-26/cloud-runs.json)：

- `cloud-counter-1`：7 次请求，任务 32,306 ms，完整脚本 48,773 ms。Reviewer 直接通过，实际七次加减/重置、保存、刷新与关闭重开通过，重开请求 0。
- `cloud-reading-1`：7 次请求，任务 31,390 ms，完整脚本 42,401 ms。Reviewer 直接通过，实际添加书名、标记已读、添加再删除另一条记录、保存与重开状态恢复通过，重开请求 0。

线上两场未注入缺陷、未发生返工；真实一次返工证据来自上面的本地受控场次，使用相同原生运行器和最终交付校验。没有把线上直接通过改写成线上返工证据。

本票真实模型总计 25 次请求：prompt 53,080、completion 15,407、total 68,487 tokens，usage 缺失 0 次；三场独立任务各自共享本任务的 4 分钟/20 次预算，不把多个任务合计当成单任务额度。所有真实场次均成功完成其声明的验收范围。

## 证据边界

受控注入证明一项明确持久化缺陷的真实模型返工；不是自然缺陷成功率。Reviewer 静态通过与开发者运行检查分别记录，均不保证任意业务正确性。历史 QA 记录保留原始类型，未改标。未扩做 #27/#28。
