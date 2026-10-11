# 游客示例入口与工作台布局验收

2026-10-11，范围为 [Issue #78](https://github.com/lnisre/atoms/issues/78)，基于 `fd039ff`。根工作区的未提交改动保留，使用独立工作区。Node 24.18.0、Next 16.3.6、pnpm 10.12.1、Chrome；本地 3228 端口。未修改模型、云端保存、账号鉴权或示例来源数据。

## 原因与实现

修复前游客页面直接铺开 ExampleConversation，1440×900 下页面内容高度 4890px，缺少 ConversationScroll。首页示例入口位于主内容底部。

提取 ProjectWorkbenchLayout，让游客示例和账号工作台共用外壳、聊天面板、ConversationScroll 与成果列；只读说明放在顶部，显式保存与失败重试放在左侧独立操作区。侧栏“我的项目”下新增“小费计算器 / 示例 · 只读”，独立于账号项目计数，取消主区孤立入口。600px 以下共用纵向布局，各面板仍有独立滚动，避免过窄两列。

## 结果

| 期望（来源 #78） | 实际观察 | 结论 |
| --- | --- | --- |
| 左侧入口首屏可见，导航/返回/刷新可用 | 三视口均可打开，账号项目计数仍为 0 | 通过 |
| 游客和个人副本同视口布局一致 | 1440×900、1280×720、390×844；背景、边框、圆角、内边距、字体、行高与列宽逐项对比一致 | 通过 |
| 长记录独立滚动 | 展开真实来源折叠项，成果面板文档坐标和尺寸不变；回到最新消息到达底部 | 通过 |
| 预览/代码与窄屏可用 | 切换正常，窄屏文档无横向溢出，保存按钮可实际点击 | 通过 |
| 游客不能修改或自动创建项目 | 鼠标、键盘、atoms.saveState 与原始桥写入均拒绝；浏览零复制/模型请求 | 通过 |
| 保存必须明确操作 | 保存触发登录后只复制一次；丢失响应复用同一操作；普通登录不复制 | 通过 |
| 账号工作台回归 | 候选/源码查看、失败与停止、可信证明、长历史、浏览器重启、历史恢复/撤销/清理 | 通过 |

定向及相关回归共 22/22 通过，无跳过；生产构建另跑三视口 3/3 通过。typecheck、lint、build、diff --check 通过。截图已逐张检查桌面及窄屏结构。首次矩阵 9/10 通过，窄屏失败来自测试使用视口坐标比较可滚动页面；改为文档坐标后 3/3 通过，未为该失败修改产品布局。保留各次结果于 [browser-summary.json](assets/issue-78/browser-summary.json)。

测试使用已有合成 Auth/BFF 接缝，实际 DOM、Chrome、鼠标、iframe 和真实示例来源数据；不代表再次验证真实邮件送达或生产数据库。零真实模型调用。仓库已记录的 opaque iframe 首击探针未选择，本次不宣称修复该问题。Doctor 与源码摘要在同目录。

## 同视口证据

- 修复前：[首页](assets/issue-78/before-home.png) / [示例](assets/issue-78/before-example.png)
- 1440×900：[首页](assets/issue-78/1440x900-guest-home.png) / [游客示例](assets/issue-78/1440x900-guest-example.png) / [个人副本](assets/issue-78/1440x900-account-example.png)
- 1280×720：[首页](assets/issue-78/1280x720-guest-home.png) / [游客示例](assets/issue-78/1280x720-guest-example.png) / [个人副本](assets/issue-78/1280x720-account-example.png)
- 390×844：[首页](assets/issue-78/390x844-guest-home.png) / [游客示例](assets/issue-78/390x844-guest-example.png) / [个人副本](assets/issue-78/390x844-account-example.png)

个人副本比游客多出修改和云端保存操作，因此聊天可滚动高度及预览内部上沿存在有意差异；共用面板和消息排版保持一致。

本报告记录提交前验证。后续生产部署身份、线上检查结果记录在 #78；用户线上确认尚未完成，issue 保留开放。
