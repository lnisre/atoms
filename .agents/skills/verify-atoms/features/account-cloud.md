# Account cloud generation and session lifecycle

Authority: [#65](https://github.com/lnisre/atoms/issues/65), [#68](https://github.com/lnisre/atoms/issues/68), [#69](https://github.com/lnisre/atoms/issues/69), [ADR 0015](../../../../docs/adr/0015-account-owned-cloud-projects.md), [ADR 0016](../../../../docs/adr/0016-trusted-cloud-artifacts.md). History authority: [#71](https://github.com/lnisre/atoms/issues/71), [#73](https://github.com/lnisre/atoms/issues/73), [#74](https://github.com/lnisre/atoms/issues/74), [ADR 0014](../../../../docs/adr/0014-version-restore-history-semantics.md). Current routes are `/` and `/?project=<UUID>`; account project reads never initialize or clear old IndexedDB.

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
| Paired history | `历史保存点` identifies the code, actual data-save time and replacement pairing time. `试用 Vn 副本` keeps source, label and iframe aligned; edits stay in that copy. | cloud-history; cloud-history-sql |
| Restore | `恢复到 Vn` works without trial. Resolve any candidate first, then confirm data replacement and later conversation truncation. Cancel changes nothing; apply reads the server original. | cloud-history direct restore |
| Durable undo | `撤销本次恢复` survives reload/reopen and the same account elsewhere, without a time expiry. Confirm discards post-restore data/candidate/trial. Generating/saving blocks undo; adopting successfully ends it. | cloud-history; SQL lifecycle |
| History failures | Preserve the original operation through response loss or failed readback. Conflicts require rechecking. A known uncommitted capacity rejection exposes manual cleanup; an acknowledged or uncertain commit keeps its identity. | cloud-history lost response/capacity; cloud-history.test |
| Cleanup | Explicit permanent confirmation removes snapshot content, retaining conversation and `已清理，无法恢复`. Current and undo dependencies are protected by SQL. Clearing has a separate history revision so a candidate remains usable. | cloud-history cleanup; SQL protection |
| Logs | A committed code save can have a separate pending log append. `重试记录保存` does not rerun generation or replace project state. | cloud-generation guest; verify-artifacts SQL |

## Live recipe

Use the owned dev instance and Doctor in SKILL.md, then:

```sh
TEST_BASE_URL="http://127.0.0.1:$PORT" pnpm exec playwright test tests/browser/account-access.spec.ts tests/browser/cloud-projects.spec.ts tests/browser/cloud-generation.spec.ts tests/browser/cloud-regressions.spec.ts tests/browser/cloud-history.spec.ts tests/browser/preview-document.spec.ts tests/browser/source-reading.spec.ts tests/browser/cloud-cross-app.spec.ts tests/browser/qa.spec.ts --workers=1 --retries=0 --trace=on --output="$RUN/browser" --reporter=json >"$RUN/playwright.json"
```

These tests drive real DOM and iframe behavior with synthetic Auth/BFF responses and explicitly fabricated team records. They verify UI failure handling and isolation, not real Reviewer judgment or actual PG access. Use a new evidence directory for retries. Source paths: `src/app/page.tsx`, `src/components/cloud-workbench.tsx`, `src/lib/cloud-projects/workbench.ts`, `artifacts.ts`, `src/lib/team/server.ts`.

`tests/generate.test.ts` exercises public generation/commit boundaries plus a real supervised process with scripted output. `scripts/cloudbase/verify-artifacts.mjs` exercises installed SQL transactions using synthetic claims and the authenticated SQL role; it needs approved management access and the matching server artifact key. Neither substitutes for real email/JWT gateway acceptance.

## Evidence and deployment acceptance

#69 recorded real authorized-email login, ordinary-user JWT → PG operations, three actual model tasks/adoption, same-account independent-browser recovery, public Cookie/WebSocket behavior and one end-to-end save latency sample in [the acceptance report](../../../../docs/verification/issue-69.md). Email delivery is enabled and the approved MaxDevice setting is 10. The user accepted single-email scope and removed a second real account as a merge gate; cross-account JWT denial remains unexecuted, not passed. Isolated deployment acceptance does not mean the production alias was updated. Read the report for current deployment/source identities and remaining evidence limits; this recipe alone grants no mail, configuration or model-call authorization.

#69 baseline and current coverage are recorded in `docs/verification/issue-69.md`. First-pointer samples exercise genuine `.click()` on fresh frames; failure-free samples are not proof that the historical compositor race is fixed. Do not replace pointer failures with Enter and report pointer success. Use a separate evidence directory and Doctor after a failed drive.

The cloud fixture is `tests/helpers/cloud-browser-fixture.ts`: it fabricates Auth/BFF/provider artifacts, including restricted draft shape. Test rows are in-memory, not SQL. `cloud-regressions` exercises actual page components and source/preview controls; `source-reading` is component-only. Native Python tests and supervised process tests are offline; all real identity/model/deployment claims require their own lane.

Real reading workflow preparation: `node --import tsx tests/team/live-cloud-cross-app.ts` prints a zero-network manifest. `--execute` needs `TEST_BASE_URL`, new `TEAM_EVIDENCE_DIR`, verified `TEAM_DEPLOYMENT_ID`, and two distinct existing `CLOUD_PROFILE_A/B` profiles already authenticated by real email login. It never invents cookies or imports old local projects. The scripted driver is exercised by `cloud-cross-app.spec.ts`; #69’s real workflow was driven through the public UI separately, so do not claim this CLI itself ran end to end. Two profiles may belong to the same account for cross-device recovery; a true cross-account check needs a separately authorized account. Profiles contain credentials; retain privately and never upload them as evidence. No raw network traces are enabled for the real lane.

## History verification lanes

`tests/browser/cloud-history.spec.ts` extends the existing cloud fixture. It uses real DOM/source/iframe interactions, with synthetic Auth/BFF/provider responses. Fresh opaque-frame mouse actions in this driver first hover and observe `:hover`, then call `.click()` once. Preserve failures from direct first-click probes separately; this is input synchronization, not evidence that every browser compositor race is fixed.

`node --import tsx --test tests/cloud-history.test.ts tests/cloud-history-sql.test.ts` covers BFF policy/response validation, same-operation readback recovery, installed PostgreSQL/WASM transactions, monotonic counters, old proofs/receipts, late logs and cleanup protection. Local PGlite is not real CloudBase concurrency or JWT evidence.

For an authorized real CloudBase acceptance run, use an isolated namespace. Pass the same `--namespace atoms_h74` to `scripts/cloudbase/migrate.mjs` and `scripts/cloudbase/verify-history.mjs`, and set `ATOMS_PROJECT_NAMESPACE=atoms_h74` on the acceptance runtime. Default `atoms` remains production. Supply management credentials and the matching artifact key only through the existing trusted launch process; the web application still uses ordinary user access tokens. The SQL runner refuses the production namespace, checks 004/005 checksums, creates synthetic owners, exercises actual transaction abort and concurrent requests, and removes only its owners. Set `HISTORY_EVIDENCE_FILE` to a new result path. Its claims and `SET LOCAL ROLE authenticated` remain synthetic.

Real email/JWT evidence needs a separate normal login to the acceptance runtime, a new synthetic example copy, an actual adopted candidate, distinct formal data, historical trial, restore, reload and full undo. Use only the task-authorized model budget. Read-only management observations may corroborate the known synthetic project but do not replace ordinary user actions. Keep email codes, cookies and keys out of traces and reports. Record production and isolated namespace installation separately; passing `atoms_h74` does not install production migrations.
