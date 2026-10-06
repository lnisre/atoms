# First generated artifact: observe, then choose the lifecycle

Use for `crossAppWorkflow` / `live-cross-app.ts`, or diagnosing a saved first-generation result without business data. Authority: [ADR 0011](../../../../docs/adr/0011-review-findings-and-preview.md). Requirements/selectors remain the frozen synthetic scenarios in `tests/team/cross-app-scenarios.ts`.

## Read the actual state

`tests/team/project-observation.ts` selects raw `projects` and `applicationData` by submitted `projectId`, checks the URL and initial `taskId` in the workflow, validates team/artifact hash and calculates the product's real preview policy. Snapshot ordering is convenience, not identity. Workspace metadata and unrelated projects may coexist; an absent current business row is explicit `undefined`, never `{}` or the first row.

| Initial disposition | Required observations | Driver action |
| --- | --- | --- |
| `formal` | No draft, valid artifact, persisted formal policy; execution/adoption allowed | Formal business lifecycle; business row required after actual save |
| `draft-usable` | Real HTML in draftResult, inert legacy result; trial + execution/adoption allowed | Stop by default; explicitly selected synthetic branch below may continue |
| `draft-restricted` | Draft with unresolved data risk, adoption blocked | Refuse formal lifecycle; remain a draft |
| `execution-blocked` | Actual code/policy blocks execution, even if review passed | Verify no iframe, refuse formal lifecycle |
| `no-artifact` | No saved project/business row for the submitted identity | Preserve failure; do not select a different saved project |

Task outcome is independent: failed/limit can retain eligible code. For initial drafts, computed and stored policy must agree. After real “使用此版本”, persisted dataMode becomes formal while an unavailable historical review still computes trial; execution/adoption must remain allowed. Do not reinterpret that as a new review.

## Explicit synthetic first use

Default library invocation remains `crossAppWorkflow(context, base, kind, evidence)`. Only a plan explicitly covering retained-artifact continuation selects:

```ts
await crossAppWorkflow(context, base, 'reading', evidence, { initialDraft: 'use-synthetic' });
```

CLI manifest: `node --import tsx tests/team/live-cross-app.ts --use-retained-draft`. Actual execution adds `--execute`, a fresh `TEAM_EVIDENCE_DIR` and verified `TEST_BASE_URL`, under [real-target authorization](team.md#real-model-and-target). The option is incompatible with `--repair`. It covers only the fresh project created from this driver's exact synthetic requirement, and only the usable-draft classification.

The driver checks the real draft HTML independently, writes a distinct trial record, verifies all formal rows unchanged and initial history retained, refreshes to prove trial reset, then creates trial data again. It clicks the actual “使用此版本” button. Before formal operations it requires the same HTML hash, removed draft, formal policy, no migrated trial data, and unchanged initial task/reply/calls/deliveries; prior execution events must remain intact (legitimate later platform events may append).

It then runs formal add/delete/toggle, reading's two modifications, trial isolation, adoption, rating/filter checks and refresh/new-page recovery. Compatibility seeding touches only the newly created synthetic business row after a real formal save; it never changes draft/policy/review fields. Full browser restart is not covered by this shared driver.

## Offline regression and evidence

On the owned dev instance after Doctor:

```sh
TEST_BASE_URL="http://127.0.0.1:$PORT" pnpm exec playwright test tests/browser/cross-app-draft.spec.ts tests/browser/cross-app-acceptance.spec.ts tests/browser/reviewer-preview.spec.ts tests/browser/record-assertions.spec.ts tests/browser/snapshot-cli.spec.ts --workers=1 --retries=0 --trace=on --output="$RUN/browser" --reporter=json >"$RUN/playwright.json"
```

`cross-app-draft` scripts an atoms-team/3 response at the protocol boundary: first Engineer artifact + failed Leader without Reviewer; modifications use explicit clean fixtures. It also checks default-stop, risk-restricted, execution-blocked, no-artifact and manifest branches. A separate unrelated legacy project/business row is an explicit DB precondition, never an activation shortcut. External/API requests without an explicit fixture are blocked and counted. This is real UI/storage execution with synthetic team records, not native provider routing or new model success. Existing `cross-app-acceptance` proves the ordinary reviewed path; `reviewer-preview` retains inherited-risk/current-code resolution coverage.

Evidence names: `initial-disposition`, `initial-storage`, `draft-trial`, `explicit-first-use`, `lifecycle`, independent proofs, `stored-project`, `workflow`, and failure-page when stopped. Read `workflowCompleted` separately from `initial.taskOutcome` in CLI summary. `formal-from-generation` and `explicit-retained-artifact-continuation` are distinct paths; failed history remains failed even if continuation completes. Hash the current drivers and keep previous proofs/plans/reports immutable. Historical online failure and continuation are documented separately in [Issue #40 maintenance](../../../../docs/verification/issue-40.md).
