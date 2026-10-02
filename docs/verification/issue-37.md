# Issue #37：首访专注番茄钟示例

基线 `b2e56e19105d52283b98ea0e976e57f6c57c3523`，独立工作区与分支 `codex/first-visit-pomodoro`。规格 #36/#37、ADR 0012；保留 ADR 0011 审查政策。本地实现与目标生产部署验收完成；2026-10-02 用户明确要求发布到固定生产网址。

## 素材与修订

原始导出 SHA-256：`a6c8df564b6088fc986ae137286e2b039d0cb9c10ab678d17a56bccd11dfc489`。原始完整 HTML 保留于本地忽略目录，不提交源聊天、浏览器导出或私人研究。正式业务记录不存在，试用读取 null；25/5 分钟与 0 次是代码默认值。

原始素材在独立 Chrome 页面执行，API 使用受控读写副本：开始后推进 60 秒显示 24:00，重新加载保存状态返回 25:00，复现恢复缺陷。读取失败禁用写入、开始保存失败回滚和未知字段保留通过；未据旧 UI 风险推定当前候选有其他已证实数据丢失。

修订固定文件为 `public/examples/pomodoro-v1.html`，SHA-256 `d1d6944ff3eda19b7f5150e9895cacc71579313be13e1e40232153f5b747871f`。保留原有 DOM/CSS、声音/闪光和前台自动阶段切换；保存截止时间，恢复跨期只结算当前段并暂停；保存失败保留确认状态并提供显式重试。读写均经真实 atoms 桥，不依赖卸载保存。无模型审查记录，也不把开发验证伪称 Reviewer 通过。

## 工程验收

- 新增浏览器用例覆盖首访、独立工作区、同源并发、旧客户端/项目、删除后不再初始化、模板更新、深链接、素材校验失败、事务中止、读库失败、与正常项目保存竞争。
- 真实 sandbox iframe 操作验证运行跨刷新/关闭、过期一次结算、暂停/继续/重置、前台阶段切换、未知字段、读写失败和重试。测试控制 Date.now，真实计时回调、DOM 操作、IndexedDB 事务及平台桥照常执行；不直接写期望结果冒充计时。历史数据测试输入明确为合成旧记录。
- 可控团队响应验证完整基线与项目身份、真实修改后才产生团队记录、试用副本、只采用代码、重开零调用；合成角色/审查不作为真实模型证据。
- 接口/协议 32/32，类型、ESLint 与 webpack 生产构建通过。原生 Python 路由/预算/取消 20/20；生产 standalone 的固定素材 HTTP 200。最终完整浏览器 **92/92**（2.7 分钟，无跳过）通过；生产部署与线上验证见下文。

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

## 生产部署与真实修改验收

2026-10-02，用户明确要求部署到固定网址 [v0-test0-nine.vercel.app](https://v0-test0-nine.vercel.app/)。源码白名单逐文件匹配 [身份清单](assets/issue-37/source-sha256.json) 后创建 production 部署；由 Vercel 继承已有生产环境变量，没有读取或复制模型/签名密钥，也没有新建、轮换或撤销访问凭据。

- 产品源码提交：`ac9d5a7536485a9ee88cef6ce2ad476b65da29ac`。后续提交仅补验证记录，不改变被部署产品源码。
- 部署：`dpl_DfYb9orGzdCLPvW78dwx7w9WcBuE`，target=`production`，READY。固定地址的 alias API 已核对指向该部署；此前生产部署为 `dpl_8Ju6PuNVhAf5YE7wGGZgVzMdatMQ`。
- 固定素材 HTTP 200，SHA-256 为 `d1d6944ff3eda19b7f5150e9895cacc71579313be13e1e40232153f5b747871f`，与本地修订版一致；实际到达应用而非登录页。
- 固定生产网址上的新增浏览器验收 **15/15**（57.9 秒）：新/旧工作区、并发、事务/素材/读写失败、计时跨刷新/关闭/到期、数据保全、可控响应修改试用采用。全新隔离 Chrome 上下文；不访问用户现有 profile 或来源项目。
- 真实应用入口执行 **1 次修改任务、7 次供应商模型请求**，`deepseek-flash`，实际四角色交接与 Reviewer 通过。任务 `93f3dfb2-c612-4229-82ca-9953253675d5`，修改目标仅将标题改为“我的专注番茄钟”，未改计时规格。
- 实际开始→暂停得到剩余 1498 秒；候选重置只修改试用副本，正式记录逐值不变；明确采用只更新代码和修改记录。刷新恢复新标题及原暂停状态，初始化和重开新增模型请求均 **0**。采用代码 SHA-256：`5da3e82895e605b13811e30de0e1aa404b679ce20018c881b11aab532edde883`。

证据：[部署身份](assets/issue-37/production-deployment.json)、[线上真实修改摘要](assets/issue-37/production-live-result.json)、[真实修改与恢复截图](assets/issue-37/production-live-modified.png)。本票验证证明上述操作与恢复，不把单次模型通过泛化为任意后续修改的质量保证。

## 授权与交付边界

首轮 Preview 部署曾被自动审批审查在执行前拒绝，原因是上传源码并将已有模型/签名配置复用到 Preview 需明确授权。当时没有创建部署，PR 保持 Draft、#37 保持 OPEN。用户随后明确要求部署到上述固定生产网址，本轮按 production 发布并继承已有生产配置，完成线上验收；历史拒绝及未执行事实保留。

未修改来源项目或用户已有本地数据。线上验证只使用独立测试浏览器及其示例副本；Vercel 项目保护与现有访问凭据保留。#37 全部验收完成后记录结果并关闭，父规格 #36 不关闭；PR 是否合并与部署状态分开记录。
