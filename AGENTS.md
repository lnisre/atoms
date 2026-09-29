## Agent skills

### Issue tracker

任务和规格使用 lnisre/atoms 的 GitHub Issues。
操作前读取 docs/agents/issue-tracker.md。

### Triage labels

使用五个默认 triage 标签。
分类任务前读取 docs/agents/triage-labels.md。

### Domain docs

采用 single-context：根目录 CONTEXT.md 和 docs/adr/。
探索代码或修改领域术语、架构决策前读取 docs/agents/domain.md。

### Vercel

使用 Vercel Token、部署或排查访问权限前，读取 [Vercel 操作说明](docs/agents/vercel.md)。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
