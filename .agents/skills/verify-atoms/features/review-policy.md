# Review, repairs and preview policy

## Current account verification (#65/#69)

Authority: ADR 0011 plus #65 and ADR 0015/0016. A trusted terminal proof is required for saving code; transport-retained code without it is page-only/downloadable and cannot be adopted. A trusted unreviewed terminal can save as draftResult with an inert legacy result. Reopening preserves restrictions, not trial state.

`cloud-generation.spec.ts` covers trusted restricted/blocked UI and explicit activation; the shared fixture now models draftResult/inert result. `cloud-regressions.spec.ts` covers no-proof retention. `preview-document.spec.ts` covers actual iframe/CSP assembly and invalid HTML through cloud fixtures. `pnpm test` covers policy/hash/risk inheritance and actual supervised scripted proofs. `runtime/team/test_runner.py` covers native routing and shared repair/budget limits with an offline provider.

These UI fixtures override policy; they do not prove Reviewer judgment, ordinary-user PG authorization, or the entire native UI risk→resolution chain. The reviewer/cross-app-draft/native browser drivers below still assume anonymous/IndexedDB and require migration. Current controls are “停止生成”, “补充生成需求”, “重新生成”. Keep real model judgments and remaining native UI coverage unverified until actually executed.

## Historical local-workbench reference (not executable cloud acceptance)

## Sub-features

Current authority: [ADR 0011](../../../../docs/adr/0011-review-findings-and-preview.md) / [#35](https://github.com/lnisre/atoms/issues/35), replacing old approval-to-deliver and one-repair gates.

| Expected result | Observable proof |
| --- | --- |
| Minor findings deliver directly; major findings allow at most two repairs/three implementations; remaining findings persist | Current hashes, actual Engineer/Reviewer deliveries, visible findings |
| Unavailable review/budget exhaustion may retain eligible completed code honestly; stop/invalid identity/late artifact cannot publish | Terminal event, preserved code and storage |
| Data risk permits trial but blocks adoption until current-code resolution; changing hash alone does not clear it | Formal rows unchanged, disabled adoption, matching resolution/hash |
| Unreviewed first result is a restorable draft; explicit use excludes trial data; legacy result is inert | draftResult/result records, reopen, “使用此版本”, formal data |
| Platform execution blocker prevents running even with model approval | No mounted iframe; reason and saved code retained; modification reachable |

[ADR 0008](../../../../docs/adr/0008-m5-pinned-team-connection.md) bounds retained by ADR 0011: 240 seconds/20 explicit calls shared across roles, cancellation owns the connected process. Review does not prove business behavior.

## How to get to it (user POV)

Generate or modify, expand actual role records/findings, observe preview and “使用此版本” or “采用修改”. During generation use “停止任务”. Clarification uses “补充或调整需求” → “补充后重新发起”.

## Driving it with Playwright

```sh
TEST_BASE_URL="http://127.0.0.1:$PORT" pnpm exec playwright test tests/browser/reviewer-preview.spec.ts tests/browser/cross-app-draft.spec.ts tests/browser/preview-document.spec.ts --workers=1 --retries=0 --trace=on --output="$RUN/browser" --reporter=json >"$RUN/playwright.json"
```

Native repair/stop/clarification: [team setup](../references/team.md), `team.spec.ts` and `team-stop.spec.ts` (first-generation and modification stop, including delayed results). `pnpm test` includes socket lifecycle and client heartbeat/abort/timeout integration; `runtime/team/test_runner.py` corroborates native protocol/routing. Synthetic Reviewer messages are not model judgment.

Real controlled repair uses `repair-workflow.ts` plus `inject-modification-save-defect.py`. Its fixed independent plan checks injection/rejection/repair. Its two-Engineer assertion belongs to that successful one-repair scenario; it is not the global cap and cannot prove the two-repair cap alone.

The [initial artifact branch recipe](../references/initial-artifact.md) binds raw draft/formal storage to task outcome, exact HTML hash and computed policy. Its offline shared-driver regression preserves failed Leader/absent Reviewer history, proves trial exclusion at explicit first use, and refuses risk/blocked/no-artifact branches even with the opt-in. The existing reviewer-preview test separately covers inherited data risk and actual resolution during modification.

## Gotchas

Bind findings/resolutions to task and exact current hash. Retain original semantics for historical /1 QA and /2 Reviewer; new tasks use /3. Narrow empty-loop detection is not general resource isolation. Provider fault injection is a dedicated test seam; ordinary acceptance cannot hand-edit generated failures to pass.
