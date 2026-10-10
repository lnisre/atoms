# Issue #63：恢复完整容器发布

规格与生产交付证据：[Issue #63](https://github.com/lnisre/atoms/issues/63)。基线 `6d074ec0968eea170451a8e22b2881df17bda644`，独立工作树、分支 `codex/fix-63-container-release`。共享 master 的其他工作未改动。

## 根因与修复范围

旧临时上传清单漏掉 `Dockerfile.vercel`。生产 `dpl_GAfGycHMFqk9qN1hCC1cND5CvaM1` 为普通 Next.js 函数，团队入口返回网关未配置 503；历史完整部署 `dpl_DfYb9orGzdCLPvW78dwx7w9WcBuE` 为 container 输出。两者通过只读管理 API 核对。生产环境变量名仅有 `DEEPSEEK_API_KEY`、`QA_TOOL_SIGNING_KEY`，没有 `ATOMS_INTERNAL_KEY`；现有自动化访问凭据保留。

新增仓库内发布脚本，以冻结 Git 提交为唯一上传源，强制完整容器输入、显式 container framework、逐文件身份和实际远端容器产物核验。没有修改 `src/`、`public/`、`runtime/team/`、Docker 配方或存储结构；保留最新小费示例与代码查看功能。README 仅补可执行发布命令，沿用此前更新。

## 实施侧检查

| 预期与依据 | 观察与证据 | 结果 |
| --- | --- | --- |
| #63：上传前拒绝 Dockerfile/Python 运行输入遗漏 | 新增 10 项发布测试，重现删除 Dockerfile、依赖、patch、config、schema 的失败；拒绝新增未覆盖 COPY、清单篡改及远端普通 Node 产物 | 通过 |
| 工程静态、类型与服务端检查 | [lint](assets/issue-63/lint.txt)、[typecheck](assets/issue-63/typecheck.txt)、[71 项测试](assets/issue-63/tests.txt)，含团队停止/心跳生命周期 | 通过，0 跳过 |
| 同一源码生产构建 | [Next 16.3.6 正式构建](assets/issue-63/build.txt)，Node 24.18.0、pnpm 10.12.1；随后 prepare standalone | 通过 |
| #63：既有项目与示例兼容、候选采用、刷新恢复 | 真实本机网关 + 独立 Chrome + 合成生成响应；9 个文件共 58 项，覆盖小费示例、旧工作区升级、旧副本、完整浏览器重启、候选、持久化、代码查看/版本/恢复 | [58/58，0 失败/跳过/重试](assets/issue-63/browser-summary.json) |
| 自有资源清理 | 网关 PID 4374 与 Next PID 4395 已退出，3263/3264 均无监听 | 通过 |

本机浏览器场次的 Doctor 在提交前记录基线及未提交修复文件的哈希，见汇总 source 字段；没有将合成 Reviewer 响应称作真实模型证据。Python 原生回归由独立验收会话在已核实的上游 SHA 环境执行；生产容器自身仍需通过 Docker 配方中的 `pip check` 与 `test_runner.py`，实施侧本机浏览器不证明 Python 安装。

## 独立审查修订

首轮独立审查复现 P2：末尾第二个 CMD 会覆盖网关入口，缩进 COPY/ADD 会漏检。已按规范化指令与最终阶段检查入口，拒绝 ENTRYPOINT、额外 CMD、未知 COPY 选项与续行形式。两个原始反例及扩展负例已纳入 [10 项发布复验](assets/issue-63/release-tests-v2.txt)，静态检查再次通过。首次解析修订过严，拒绝 pnpm 路径中的 `@`，在提交前补齐该现有合法路径后全部通过；未改 Docker 配方或任何产品运行输入。原有 71 项与浏览器证据仍对应相同运行源码。

## 发布与独立验收

执行方法见 [完整容器发布](../agents/vercel.md#完整容器发布63)。每次新目录保留 manifest、attempt、deployment、status、verification；交付时在 Issue/PR 记录冻结 SHA、完整上传文件清单、sourceDigest、deployment ID、alias、container digest 和构建门槛证据。生产固定源仍为 `https://v0-test0-nine.vercel.app`。

`verify` 仅生成未消费的任务票据，模型调用数为零；它证明入口和容器身份，不证明真实团队业务完成。真实首次生成、修改、角色/模型记录、保存、候选试用/采用、恢复与停止边界由独立验收会话核验。最终交付与验收状态以 Issue/PR 中该冻结提交对应记录为准；本记录不授权绕过独立验收合并。
