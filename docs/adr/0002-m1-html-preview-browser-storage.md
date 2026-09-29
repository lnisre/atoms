---
status: accepted
---

# M1 使用单文件 HTML、iframe 预览和浏览器存储

2026-09-29，用户确认 M1 采用单文件 HTML 作为生成物，通过 sandbox iframe 运行预览，并由平台统一使用 IndexedDB 保存项目与应用业务数据。这套组合直接覆盖真实生成、操作预览和同一浏览器恢复，省去生成应用的依赖安装、构建服务、逐应用部署和服务端数据库，符合 M1 只跑通主链路的目标。

## 已选方案

| 部分 | 决定 | 原因 |
| --- | --- | --- |
| 生成物 | 完整 HTML，内含 CSS 和原生 JavaScript；M1 不依赖 npm 安装、编译或外部 CDN | 覆盖待办、书签等轻量交互应用，减少构建和依赖相关的失败环节 |
| 运行预览 | 使用 iframe 的 srcdoc 加载生成物，sandbox 允许脚本运行，不授予同源访问权限 | 提供可操作的浏览器运行环境，并限制生成代码直接访问平台页面和存储 |
| 持久化 | 平台侧 IndexedDB 按项目保存需求、HTML、更新时间等项目记录，以及应用业务数据 | 满足同浏览器恢复；适合异步保存结构化数据和代码文本，无需部署数据库 |
| 保存触发 | 生成完成后自动保存项目；应用业务数据在操作后通过固定接口自动保存，写入成功才显示“已保存”，失败时明确提示 | 用户操作后可直接进入恢复流程，避免遗漏手动保存；不增加独立保存按钮 |
| 应用数据接口 | 平台注入固定脚本，向生成应用提供读取和保存状态的能力，例如 loadState() / saveState(data)；通过 postMessage 交给父页面处理 | 统一数据保存行为；父页面核对消息来源并绑定实际项目，不依赖生成代码自行选择存储方案或项目身份 |
| 模型调用 | 通过薄服务端接口调用用户指定的 DeepSeek V4-Flash，密钥仅放在服务端 | 遵循用户的模型选择，平台统一保管调用凭据 |

## 取舍与边界

- 生成应用的格式不限制平台自身使用前端框架。复杂工程生成、构建运行环境及源码多文件组织不属于 M1。
- 恢复读取已有代码和应用业务数据，不重新调用模型。M1 通过实际操作验收，不将 iframe 加载完成等同于业务正确，也不建设自动运行检查系统。
- 数据保存在当前浏览器配置文件的当前平台源下。平台源包括协议、主机与端口；保持同源且数据格式兼容的重新部署应能读取已有数据，仍需实际验证。
- 清除站点数据、结束无痕会话或浏览器回收存储可能导致数据丢失。M1 不提供跨设备恢复或服务端备份找回。
- 本决定取代讨论中较早的 M1 服务端持久化建议；不引入任务队列、后台续跑、并发冲突控制、分阶段重试或自动修复。
- 平台技术栈、模型服务与部署平台已由 [ADR 0003](0003-m1-stack-model-and-hosting.md) 确定；DeepSeek V4-Flash 的接入、质量、耗时与额度仍待验证。这是设计决定，不代表相关能力已经实现。

## 技术依据

- [MDN：iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)
- [MDN：postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [MDN：IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [MDN：浏览器存储限制与回收](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
