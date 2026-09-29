---
status: accepted
---

# M1 采用 Next.js、DeepSeek V4-Flash 和 Vercel

2026-09-29，用户确认平台使用 Next.js（App Router）+ React + TypeScript + Tailwind CSS，模型使用 DeepSeek V4-Flash 官方 API，部署到 Vercel。页面和薄服务端接口放在同一项目内开发与部署，配合已有的浏览器存储方案，减少 M1 主链路所需的服务和配置。

## 决定与原因

| 部分 | 决定 | 原因 |
| --- | --- | --- |
| 平台 | Next.js + React + TypeScript + Tailwind CSS | 页面和模型接口共同部署；类型用于约束模块间的数据，样式便于根据调研调整界面 |
| 模型调用 | Next.js Route Handler 提供 POST /api/generate，服务端调用 DeepSeek V4-Flash | M1 的一次需求生成只需一个薄接口；密钥留在服务端，模型调用集中维护 |
| 模型服务 | 使用 DeepSeek V4-Flash，接入时核实实际 API 参数 | 遵循用户指定；生成质量、耗时和可用额度需用主链路验证 |
| 部署 | Vercel，模型接口采用 Node.js 运行时 | 与 Next.js 直接集成，减少服务器维护；项目数据由 IndexedDB 保存，无需持久磁盘 |

## 边界

- 平台使用 React 不改变生成应用的格式：生成物仍是内含 CSS 和原生 JavaScript 的单文件 HTML，按 [ADR 0002](0002-m1-html-preview-browser-storage.md) 预览与保存。
- 本决定不增加任务队列、后台续跑、自动修复、多模型路由或服务端数据库等 M1 范围。
- Vercel 交付使用固定生产地址，以维持浏览器存储的同源范围。线上需验证实际访问路径和模型调用耗时，并按所用套餐设置接口超时。
- 模型密钥通过服务端环境变量配置，不进入浏览器代码或仓库。已发现本地凭据配置，不等于已验证有效性、余额或部署环境可调用。
- 当前记录的是选型；模型接入、Vercel 项目配置及端到端运行仍待完成。

## 依据

- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [DeepSeek API 开放平台](https://www.deepseek.com/platform/)
- [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)
- [Vercel Functions 限制](https://vercel.com/docs/functions/limitations)
