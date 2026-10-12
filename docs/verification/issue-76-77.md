# 工作台按钮与历史确认修复验收

2026-10-11，基于 `fd039ff`（PR #75），对应 [#76](https://github.com/lnisre/atoms/issues/76) 和 [#77](https://github.com/lnisre/atoms/issues/77)。独立工作树，Node 24、pnpm 10.12.1、Chrome，本地 webpack dev 3216。Doctor 校验服务归属与源码；源文件摘要见 [source-hashes.json](assets/issue-76-77/source-hashes.json)。

## 根因与修复

`secondary-button` 已在工作台广泛使用，却没有 CSS 定义，Tailwind reset 后只剩裸文字。补齐统一边框、背景、间距、hover/pressed 状态，沿用既有 focus/disabled 样式；历史恢复、试用、清理按钮独立分组换行，清理使用危险操作色。

历史列表与内联确认面板分别允许占据侧栏 65% 和 48% 高度，且不收缩，父容器裁切溢出。标题仍可见，而实际确认按钮落在不可见区域。恢复、撤销、清理统一使用原生 modal dialog，正文独立滚动、底部操作常驻。焦点默认进入取消，Escape/取消返回触发按钮。重要操作后果放在长保存点说明之前。提交后关闭对话框，由原工作台继续处理保存、失败、同操作重试和冲突核对，避免遮挡恢复出口。

## 验收结果

期望来源为用户截图及 #76/#77；代码与数据恢复语义沿用 ADR 0014。

| 期望 | 实际观察 | 结果 |
| --- | --- | --- |
| 次按钮有可辨识边界，入口仍可用 | 我的项目、历史、重新载入均有 1px 边框并可命中；刷新、返回与重新载入按真实点击完成 | 通过 |
| 历史操作彼此分离 | 恢复、试用、清理按钮有至少 8px 间距，可换行；清理单独标色 | 通过 |
| 确认操作不被裁切 | 1280×720、1024×480、390×640，加长保存点说明；确认与取消完整进入视口，元素中心真实命中 | 通过 |
| 可取消，键盘焦点明确 | 默认聚焦取消；Escape 和鼠标取消均保留原项目，并返回触发入口 | 通过 |
| 确认真正恢复项目 | 三视口从 V3 点击恢复 V1，iframe 为 Counter 1、配对数据 count=1、后续记录截断；刷新保留；撤销回 Counter 3 和完整修改记录 | 通过 |
| 共用确认流程和失败出口不退化 | 既有历史试用、取消、完整撤销、清理保护、容量失败、响应丢失、回读失败及冲突重试 | 通过 |
| 云端工作台相关回归 | 29 项中 28 项通过；1 项既有 iframe 首击探针失败，详见下文 | 有已知限制 |
| 静态检查与生产构建 | `pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check` | 通过 |

修复前新增两个定向用例均失败：次按钮边框为 0px；确认按钮可见比例为 0。初版修复曾有 3 项默认焦点失败，显式管理焦点后全部通过。完整逐项结果包含失败记录，见 [browser-summary.json](assets/issue-76-77/browser-summary.json)。

最终命令：

```sh
TEST_BASE_URL=http://127.0.0.1:3216 pnpm exec playwright test \
  tests/browser/cloud-history-controls.spec.ts tests/browser/cloud-history.spec.ts \
  tests/browser/cloud-generation.spec.ts tests/browser/cloud-projects.spec.ts \
  tests/browser/cloud-regressions.spec.ts \
  --workers=1 --retries=0 --trace=on
```

唯一失败为 `first pointer activation reaches a freshly restored opaque iframe`：首次点击后 count 仍为 0。与 [#74 已记录的输入竞态](issue-74.md) 一致；本次未修改 iframe 输入或将该探针改为重试，没有宣称根治。新增恢复流程对 iframe 保存动作先用真实 hover 同步，再点击一次；平台恢复确认按钮直接鼠标点击，没有 force、DOM click 或键盘替代。

## 视觉证据与边界

- [修复前确认被裁切](assets/issue-76-77/before-confirmation.png)
- [按钮样式与分组](assets/issue-76-77/history-buttons.png)
- [桌面确认](assets/issue-76-77/confirmation-desktop.png) · [短视口确认](assets/issue-76-77/confirmation-short.png) · [窄屏确认](assets/issue-76-77/confirmation-mobile.png)

本次是合成 Auth/BFF/生成内容接缝下的真实 DOM、鼠标、iframe 与刷新验收，模型调用为零。没有操作用户真实项目、重新验收生产数据库或发布到生产。原始截图、trace、Doctor 与构建日志暂存 `/tmp/atoms-controls-before`、`/tmp/atoms-controls-after`、`/tmp/atoms-controls-final`；以上精选证据已持久保存。测试进程结束，所属开发服务已停止。

## Production deployment (2026-10-11 22:51, Asia/Shanghai)

At the user's explicit request, deployed commit 0eef95aacef551698d09e1ca881f510b9a30637a to [the existing production origin](https://v0-test0-nine.vercel.app/). Deployment dpl_53Zz8XBjrxQwxz3TGQAaCi8afdEg is READY / production; the fixed alias resolves to it.

All 92 source files, sourceDigest and container image identity match the frozen manifest. Release tooling tests passed 11/11. Public homepage returned HTTP 200 and its served CSS contains the new secondary buttons, history action groups and confirmation dialog. Anonymous generation returned 401 / unauthenticated, with zero model requests. Existing production configuration and database were unchanged; the previous deployment remains available.

This verifies deployment identity and public assets. Authenticated restore behavior awaits the user's production check. The source was deployed directly from the frozen local commit and has not been pushed to GitHub. Both issues remain open pending user verification.

[Deployment verification](assets/issue-76-77/deployment/verification.json) | [Public smoke](assets/issue-76-77/deployment/public-smoke.json)

## 用户验收

2026-10-12，用户完成本会话修复的线上验证，确认“验证 ok”并要求 PR 合入 master。#76/#77 的产品代码已由 #80 集成，本次补齐发布证据并随 #81 完成验收收尾。
