请独立复审 M1 保存误报 P1 修复。只评审和报告，不修改产品、部署、发布评论或自动关闭 Issue；父 #1 仍打开。

根因：原真实待办在第一笔保存中接受第二次修改，只安排定时器；第一笔成功即误报当前数据已保存。修复前已再次在旧生产重放原 HTML，立即关闭后第二条丢失，恢复生成请求 0。原 review 及原始产物完全保留。

修复：src/lib/preview-document.ts 的 saveState 同步设置 body.inert，并捕获拦截编辑事件，完成/失败/异常/超时后释放；src/app/api/generate/route.ts 要求每次修改同事件立即提交完整快照，禁止延迟/后台修改和绕过锁；src/components/app-preview.tsx 明确显示保存中暂时不能编辑。README 说明旧项目每次打开注入新接口、无需改 HTML/DB，已打开旧页面需重开。新增 tests/browser/save-race.spec.ts 使用原真实 HTML 验证锁、最新提交确认后立即关闭恢复；persistence.spec.ts 补失败后解锁。eslint.config.mjs 排除归档证据，避免改写原 review 的 CJS 脚本。

报告：/Users/gaowenlong/Desktop/atoms/docs/verification/m1-save-fix-2026-09-29.md
证据：/Users/gaowenlong/Desktop/atoms/docs/verification/assets/m1-save-fix/
重点：before-rapid-close.json/.mjs、old-project-after.json、new-rapid-after.json、new-behavior.json、new-production-todo.html、new-generation.json、production-browser.txt、deployment.json；对应复现脚本及截图齐全。

HEAD 仍是 3b586af67495ffd22ea1c3ebe9f2802016616bd2，未 commit/push。请覆盖未提交完整 M1，不能只看 HEAD。源码快照 /private/tmp/atoms-m1-save-fix-source；source-manifest.json 记录哈希，fix-only.patch 是相对修复起点的独立差异，baseline-recheck.json 证明原 review、M2 文档等未涉及文件未改，部署后源码一致。原真实 HTML 未手改。

工程检查：lint、typecheck、7/7 服务端测试、Next 和 Vercel 生产构建通过。线上回归 11/11，17.5s。旧项目在部署前保存，更新后恢复并操作；新真实模型调用仅1次，14,560ms，返回 deepseek-flash。两种真实产物保存中不接受新修改，解锁后最新提交在 saved 事件立即关闭重开均恢复，恢复生成请求0；完成、删除、失败、刷新、整浏览器重启从项目列表恢复均验证。

生产：https://v0-test0-nine.vercel.app
部署：dpl_MGPnkBGuHnGZks6ZNDh7SHRkuRm8，production / READY，Node 24.x，固定 alias 核对完成。独立部署 URL v0-test0-2xn9sbl11-lnisres-projects.vercel.app 。本地生产服务 http://127.0.0.1:3101 仍可用于检查。

限制：四轮本地完整回归都为10/11，仍有首次点击未触发；两组各3次单场景 trace 复查通过。有界诊断第3次失败时点击命中父文档 iframe 元素，子文档只有input没收到click，inert=false（click-diagnostic.json），根因未确定，不能声称已修复；线上全过不能否定它。未补远端完整业务操作或手机流量真机证据。锁无法修复任意历史代码在首次调用 API 前自行延迟或后台修改的问题；实际旧/新产物已验证。原旧 HTML 配不带锁的 mock API 仍有旧竞态，独立复验需要穿过当前平台注入接口。

请独立复现原路径并复查 Issue #1 US14/15/20 及整体 M1，分别报告 Standards / Spec、父 #1 是否具备关闭条件。修复者自验不替代你的结论。请在原 review 会话报告，无需自动向其他会话发消息。
