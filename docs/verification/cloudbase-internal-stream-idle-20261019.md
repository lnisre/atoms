# T2 修复内部 HTTP 静默超时

统一验证发现：真实 gateway/Next/Python 的两个离线长任务均在约 306.4 秒以 WebSocket 1011 结束，浏览器各有 76 次成功心跳 ACK；一个应在 420 秒后成功，另一个应在原 480 秒预算结束。模型等待期间内部 `/api/generate` NDJSON 没有新 body chunk，浏览器控制请求仍正常。任务没有继续运行的 Python，但没有按预期得到终态。

原因是内部 HTTP 传输空闲超时，与浏览器心跳是两个通道。Node 24.18.0 的内置 Undici 7.28.0 默认在相邻 body chunk 间隔 300 秒后超时；[官方说明](https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md?plain=1)与独立真实时间对照一致：同一个临时 loopback 服务只发送初始 NDJSON 后静默，在 301,621 ms 以 `TypeError / UND_ERR_BODY_TIMEOUT` 结束；每 5 秒写空白行的响应收到 62 个 chunk，持续到人为设置的 307,000 ms 观察截止。对照不调用模型、不修改运行中的最终验证服务。[脱敏结果](assets/cloudbase-t2-stream-idle-20261019.json)

修复复用原有每 500 ms 的任务 watchdog：仅在任务未结束、浏览器 lease 和原截止时间仍有效、内部 body 距上次写出至少 5 秒时写一个空白 NDJSON 行。网关原解析器丢弃空白行，模型调用、步骤日志、进度和签名产物均不增加事件；不续期 lease、不延长 480 秒预算、不改 20 次请求或返工上限、不放宽全局 fetch。没有新增 timer 或依赖，所有末态继续由现有 cleanup 清理同一个 watchdog。

网关失败日志只增加固定白名单中的 `errorName` 与 `causeCode`，不输出异常正文、响应、请求头、票据或密钥。

局部回归：`tests/team.test.ts` 15 项通过，其中新增实际 `startTeam`/ReadableStream 的可控时钟检查，覆盖静默只写空白、取消、请求 abort、reader cancel、15 秒心跳失联与原始 deadline；末态后继续推进时钟不会重复 enqueue/close，迟到控制返回 410。真实网关回归额外验证前置、间隔和尾随空白行不会变成 WebSocket 事件。修改文件 ESLint 与 `git diff --check` 通过。

该修复尚未重新完成真实 gateway/Next/Python 的 420 秒成功与 480 秒超限；由主 agent 重建后继续统一 verify-atoms。独立 HTTP 对照与可控时钟回归不能替代该项或公网八分钟验收。
