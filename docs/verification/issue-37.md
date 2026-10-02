# Issue #37：首访专注番茄钟示例

基线 `b2e56e19105d52283b98ea0e976e57f6c57c3523`，独立工作区与分支 `codex/first-visit-pomodoro`。规格 #36/#37、ADR 0012；保留 ADR 0011 审查政策。本地实现与验收完成；目标部署授权待确认，任务未全部完成。

## 素材与修订

原始导出 SHA-256：`a6c8df564b6088fc986ae137286e2b039d0cb9c10ab678d17a56bccd11dfc489`。原始完整 HTML 保留于本地忽略目录，不提交源聊天、浏览器导出或私人研究。正式业务记录不存在，试用读取 null；25/5 分钟与 0 次是代码默认值。

原始素材在独立 Chrome 页面执行，API 使用受控读写副本：开始后推进 60 秒显示 24:00，重新加载保存状态返回 25:00，复现恢复缺陷。读取失败禁用写入、开始保存失败回滚和未知字段保留通过；未据旧 UI 风险推定当前候选有其他已证实数据丢失。

修订固定文件为 `public/examples/pomodoro-v1.html`，SHA-256 `d1d6944ff3eda19b7f5150e9895cacc71579313be13e1e40232153f5b747871f`。保留原有 DOM/CSS、声音/闪光和前台自动阶段切换；保存截止时间，恢复跨期只结算当前段并暂停；保存失败保留确认状态并提供显式重试。读写均经真实 atoms 桥，不依赖卸载保存。无模型审查记录，也不把开发验证伪称 Reviewer 通过。

## 工程验收

- 新增浏览器用例覆盖首访、独立工作区、同源并发、旧客户端/项目、删除后不再初始化、模板更新、深链接、素材校验失败、事务中止、读库失败、与正常项目保存竞争。
- 真实 sandbox iframe 操作验证运行跨刷新/关闭、过期一次结算、暂停/继续/重置、前台阶段切换、未知字段、读写失败和重试。测试控制 Date.now，真实计时回调、DOM 操作、IndexedDB 事务及平台桥照常执行；不直接写期望结果冒充计时。历史数据测试输入明确为合成旧记录。
- 可控团队响应验证完整基线与项目身份、真实修改后才产生团队记录、试用副本、只采用代码、重开零调用；合成角色/审查不作为真实模型证据。
- 接口/协议 32/32，类型、ESLint 与 webpack 生产构建通过。原生 Python 路由/预算/取消 20/20；生产 standalone 的固定素材 HTTP 200。最终完整浏览器 **92/92**（2.7 分钟，无跳过）通过，部署尚未执行。

## 首次失败与复验

1. 首轮 13 项：5 通过、8 失败。4 项全局 alert 定位同时命中 Next 路由 announcer；4 项时钟覆盖问题。收窄 main 区域，并验证 opaque srcdoc 不稳定接收 Playwright 时钟更新，补充每个新 iframe 在应用脚本前的 Date.now 注入；不修改被保存 HTML、状态或业务断言。
2. 初次相关回归 41 项：36 通过、5 失败。包含上述重建 iframe 时钟问题、旧用例的单项目/第一条记录假设，以及一次 Chrome context 创建超时。项目断言改按实际 ID；重建 iframe 时钟用独立前置注入保障。
3. 复验 32 项：31 通过，1 项旧 snapshot helper 仍按第一条记录取修改历史，已改按当前项目 ID 排序且保留全部记录比较。随后 19 项定向复验与 2 项工作台复验通过。

4. 生产构建完整首轮 92 项：85 通过、7 失败。新增示例 15 项全部通过；4 项旧 helper 按第一条项目/数据记录取值、2 项工作台重开定位匹配到示例和原项目、1 项 Reviewer 预览的首次指针点击未触发。改为按当前项目身份排序/精确选择，保留所有记录的保全比较；点击沿用仓库已记录的键盘激活做法，未改变业务断言。
5. 原生 Python 首次因本地旧 MetaGPT 配置仍为占位值而未启动；改用本仓库的独立离线配置后 20/20。未读取生产模型密钥用于本地回归。

## 最终场次与复现

最终生产构建 + 本机网关 + 真实 Python 调度 + 明确离线模型夹具，完整浏览器 92/92（无跳过），含新增 15 项。Node 24、pnpm 10.12.1、Chrome；`pnpm test` 32/32、`runtime/team/test_runner.py` 20/20、`pnpm lint`、`pnpm typecheck`、`pnpm build --webpack` 通过。固定素材在 standalone 中可访问且通过客户端 SHA-256 校验。

复现：按 `runtime/team/README.md` 准备离线 Python 环境与测试 provider，构建后执行 `node runtime/team/prepare.mjs`，启动网关，再运行 `TEAM_FIXTURE=1 TEST_BASE_URL=http://localhost:<网关端口> pnpm exec playwright test`。仅新增主流程可在普通 `next dev` 上运行 `pnpm exec playwright test tests/browser/builtin-example.spec.ts`，无需模型配置。

最小证据：[源码身份清单](assets/issue-37/source-sha256.json)、[原始素材独立检查](assets/issue-37/original-source-check.json)、[首页](assets/issue-37/home-example.png)、[示例工作台](assets/issue-37/workbench-example.png)。详细首轮和复验日志留在本地 `/private/tmp/atoms-37/`，未批量提交截图、trace、源聊天或用户浏览器导出。

## 独立评审

固定候选 `3b2103e` 对基线的 code-review 两轴并行审查：Standards 0 项硬性违规、1 项 P3 命名建议；Spec 0 项代码规格偏差。已将隐含写入的 `listHomeProjects` 改为 `initializeHomeWorkspace`，事务不变。后续测试调整仅消除旧单项目假设和已知测试交互竞态；类型、静态与生产构建再次通过。

## 交付边界

未修改来源项目或当前生产用户数据。本地新增首访/计时验收全部零模型；后续修改使用可控协议响应，真实模型调用 0。

Preview 部署被自动审批审查在命令执行前拒绝：拒绝理由是上传源码并将已有 `DEEPSEEK_API_KEY`、`QA_TOOL_SIGNING_KEY` 复用到同项目 Preview 的敏感配置传递需明确授权。已请求用户批准，无部署创建、无密钥轮换或撤销、无生产别名更改。目标部署及真实入口修改尚未完成，不宣称通过；#37 保持 OPEN，#36 不关闭。

只读核对的 Vercel 项目为 `v0-test0` / `prj_eErnQuAz4P719xKTyuT6XT2Qu5ab`，生产部署 `dpl_8Ju6PuNVhAf5YE7wGGZgVzMdatMQ`，已有自动化访问凭据存在且保留。此身份记录不等同于本次源码已部署。
