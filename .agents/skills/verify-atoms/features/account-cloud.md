# Account cloud generation and session lifecycle

Authority: [#65](https://github.com/lnisre/atoms/issues/65), [#68](https://github.com/lnisre/atoms/issues/68), [ADR 0015](../../../../docs/adr/0015-account-owned-cloud-projects.md), [ADR 0016](../../../../docs/adr/0016-trusted-cloud-artifacts.md). Current routes are `/` and `/?project=<UUID>`; account project reads never initialize or clear old IndexedDB.

## User path and expected results

| Feature | Public actions and expected result | Low-cost recipe |
| --- | --- | --- |
| Login continuation | Guest fills `你想做什么？`, clicks `开始生成`, then logs in. Resume that intent once. Ordinary login creates nothing. | account-access; cloud-generation guest intent |
| First result | Stream real task events; save result + records atomically. A lost response offers `重试原保存` and `下载未保存副本` without a new task. A no-artifact failure retains editable `补充生成需求`; `重新生成` explicitly starts a new task after an exit/download prompt. | cloud-generation guest/first failure |
| Candidates | `追加修改需求` → `生成候选`; further rounds use the newest candidate. Trial stays in page memory. `采用修改` commits code and records, leaving formal data intact. | cloud-generation multi-round |
| Competing devices | A stale candidate or old running iframe cannot overwrite another device's new code/data. Download retains the rejected page content; reload requires a deliberate choice. | cloud-generation multi-round; cloud-projects stale pages |
| Restrictions | Reopening a draft preserves code, trial mode and execution/adoption blockers. `使用此版本` works only when saved server policy permits. Trial never becomes formal data and has its own exit/download protection. | cloud-generation restricted/blocked |
| Natural expiry | Already-started connection finishes within its original budget; save fails until `重新登录原账号`. Retry original save, with no repeated generation. | cloud-generation natural expiry |
| Active logout | `退出登录` → `留在页面` retains work; confirm stops the task, removes iframe and suppresses late results/commits under another account. Download includes retained requirement/code/records/data as applicable. | cloud-generation exit and uncertain commit |
| Logs | A committed code save can have a separate pending log append. `重试记录保存` does not rerun generation or replace project state. | cloud-generation guest; verify-artifacts SQL |

## Live recipe

Use the owned dev instance and Doctor in SKILL.md, then:

```sh
TEST_BASE_URL="http://127.0.0.1:$PORT" pnpm exec playwright test tests/browser/account-access.spec.ts tests/browser/cloud-projects.spec.ts tests/browser/cloud-generation.spec.ts --workers=1 --retries=0 --trace=on --output="$RUN/browser" --reporter=json >"$RUN/playwright.json"
```

These tests drive real DOM and iframe behavior with synthetic Auth/BFF responses and explicitly fabricated team records. They verify UI failure handling and isolation, not real Reviewer judgment or actual PG access. Use a new evidence directory for retries. Source paths: `src/app/page.tsx`, `src/components/cloud-workbench.tsx`, `src/lib/cloud-projects/workbench.ts`, `artifacts.ts`, `src/lib/team/server.ts`.

`tests/generate.test.ts` exercises public generation/commit boundaries plus a real supervised process with scripted output. `scripts/cloudbase/verify-artifacts.mjs` exercises installed SQL transactions using synthetic claims and the authenticated SQL role; it needs approved management access and the matching server artifact key. Neither substitutes for real email/JWT gateway acceptance.

## Deferred final acceptance

#69 owns complete verify-atoms, porting remaining legacy browser/cross-app drivers, real authorized-email registration/login, normal-user JWT → PG/RLS, actual model generation/adoption, independent device recovery, Vercel public Cookie/WebSocket behavior and deployment-to-Shanghai latency. Check [#68 handoff](../../../../docs/verification/issue-68.md) for configuration and the unresolved shared-environment email authorization. Keep unexecuted checks explicit; avoid sending mail or changing provider settings based only on this recipe.
