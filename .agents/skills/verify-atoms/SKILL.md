---
name: verify-atoms
description: "Verify Atoms web UI, project persistence, candidate adoption and bounded team behavior using existing Playwright drivers. Use for Atoms acceptance checks, regression evidence, or reproducing a user workflow."
---

# Verify Atoms

## Acceptance and scope

Read the current task's accepted criteria, exclusions and agreed testing seams, then [CONTEXT.md](../../../CONTEXT.md) and applicable ADRs linked from the [feature map](features/README.md). Reuse settled decisions; ask only about material unresolved conflicts. A recipe does not override authoritative requirements. Label code-derived expectations as observed baselines awaiting product confirmation.

Select the task's checks and applicable regressions, including distinct entry points. Return **expected result + source → observed result → evidence → pass/fail/unverified**. List unexecuted checks and blockers. Driver setup or one smoke does not complete product acceptance. Hand evidence and skill edits back to the invoking workflow for its existing review and delivery; this skill adds no review cycle.

Primary surface: home/workbench at `/` and `/?project=<UUID>`. Secondary: team HTTP/WebSocket and standalone `/qa`. Static Reviewer approval is not browser business acceptance.

| Mode | Evidence boundary | Launch |
| --- | --- | --- |
| UI/storage | Real DOM, iframe bridge, IndexedDB; existing generated/team regression responses are explicit fixtures | Local dev below |
| Offline native team | Real gateway/Python routing, budgets and cancellation; scripted provider | [Team setup](references/team.md#offline-native-team) |
| Real model | Actual provider artifacts plus independent business checks | [Real target](references/team.md#real-model-and-target) |

Use the current task's authorization for provider calls/deployment; selecting this skill alone requests neither. Default example smoke calls no model. Product fixes and contract changes belong to the owning task.

## Launch

Run from this skill's repository root in its own worktree. Use Node **24.x**, pnpm **10.12.1**, installed Google Chrome and `lsof`/`ps` (helpers support macOS/Linux). Check versions, select an installed Node 24, then `pnpm install --frozen-lockfile` (add `--offline` when cached). Keep this worktree's `node_modules` and `.next` independent.

Default smoke needs no environment file, model/signing key or Python:

```sh
RUN_PARENT="$(mktemp -d /tmp/atoms-verify.XXXXXX)"
RUN="$RUN_PARENT/example"
node .agents/skills/verify-atoms/scripts/smoke-example.mjs "$RUN" 3210
```

The helper requires a new evidence directory and unused port. It starts `next dev --webpack --hostname 127.0.0.1 --port 3210`, waits for HTTP, runs Doctor/UI operations, and tears down its browser/server. Webpack follows the previously verified local path; no product config changes. Read `summary.json` even on failure.

For selected existing UI specs, use one terminal session:

```sh
RUN="$(mktemp -d /tmp/atoms-verify-ui.XXXXXX)"
PORT=3210
# If this prints a listener, stop and choose another port.
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
# Continue only after the port is confirmed free.
NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port "$PORT" >"$RUN/server.log" 2>&1 &
SERVER_PID=$!
```

Record the PID and terminal ownership. Wait for Ready and `curl --fail http://127.0.0.1:"$PORT"/`, then Doctor. One dev server per worktree (`.next/dev` lock); one production build/gateway per worktree (`.next`). Gateway also reserves `PORT+1`. Separate concurrent instances into worktrees/profiles/ports. Dev alone cannot run the native team WebSocket path.

## Doctor

Before driving, and whenever the instance looks wrong:

```sh
node .agents/skills/verify-atoms/scripts/doctor.mjs "http://127.0.0.1:$PORT" "$SERVER_PID" dev >"$RUN/doctor.json"
```

Checks Node, process cwd, listener PID ancestry, HTTP/content, served example hash against checkout, package versions, source commit/dirty state and file hashes. Team mode also checks the adjacent port and BUILD_ID; [team prerequisites](references/team.md) separately verify Python, build provenance and provider mode.

Doctor does not start/stop processes, open browsers, alter project storage or test paid provider auth. GET can trigger dev compilation. Remote targets need approved URL, deployment/source mapping and access response without credentials. Login/protection pages are not a healthy app. Unknown build/auth identity stays unverified.

## Drive

Read [features/README.md](features/README.md), then relevant feature files. Prefer existing specs/current selectors. Against the owned UI instance:

```sh
TEST_BASE_URL="http://127.0.0.1:$PORT" pnpm exec playwright test tests/browser/builtin-example.spec.ts --workers=1 --retries=0 --trace=on --output="$RUN/browser" --reporter=json >"$RUN/playwright.json"
```

The example spec covers more example boundaries than the smoke.

After changing shared cross-app helpers or the TypeScript launch path, also run the persistent zero-model browser regression:

```sh
SNAPSHOT_EVIDENCE_DIR="$RUN/snapshot-cli" node --import tsx tests/team/snapshot-cli.mjs
```

It imports the actual `snapshot` helper under tsx, checks both IndexedDB stores and active-project ordering in isolated Chrome, and preserves a trace. `tests/browser/snapshot-cli.spec.ts` includes the same CLI entry in the existing Playwright suite. It needs no server or Python; it proves driver serialization, not generated-app quality.

For first-generation cross-app runs, follow [initial artifact branches](references/initial-artifact.md). `crossAppWorkflow` defaults to stopping on a draft; `{ initialDraft: 'use-synthetic' }` or CLI `--use-retained-draft` explicitly enables eligible synthetic first use after isolation/history checks. Read task outcome separately from workflow completion. The regression entry is `tests/browser/cross-app-draft.spec.ts`; the classification/data lookup helper is `tests/team/project-observation.ts`.

Full suite on dev may skip native tests; report skips, never call that complete coverage. Preserve failures; use a separate directory for retries.

Stable controls: `你想做什么？`, `开始生成`, `追加修改需求`, `生成候选`, `采用修改`, `放弃本轮修改`. App controls belong in `page.frameLocator('iframe')`. Assert the action and transaction-confirmed saving before recovery. Existing specs sometimes use Enter for the observed opaque-iframe pointer race; keyboard checks do not prove pointer coverage.

Recovery levels: refresh; page close/new page in the same BrowserContext; full persistent Chrome context close and relaunch with the same isolated profile and exact origin. `crossAppWorkflow` covers the first two. The smoke targets the third for the saved tip example; record execution evidence separately. Extend the scenario for adopted personal modifications and legacy timer recovery.

## Evidence

Each attempt gets its own `/tmp/atoms-verify.*` directory or caller-selected durable location. Record source/driver identity, mode/fixtures, target/build, actions/observations, screenshots/trace, relevant committed rows, errors and model request counts. Collect only synthetic test-project records.

Drive public UI. Read-only DB snapshots/logs corroborate effects; internal writes/setters cannot replace user actions. Existing legacy seeds, time controls and provider injection are explicit test seams, not UI-produced records. Mocks belong at already isolated external boundaries; manufactured role records do not prove real Reviewer judgment.

Inspect dry-run/manifest paths and observe skipped effects rather than trusting their name. The cross-app manifest exits before browser/network; execution is separate. Traces can contain request data: use synthetic scenarios, exclude credentials from URLs/events and inspect before sharing.

Smoke artifacts: manifest/Doctor/actions, initial/saved/reopened snapshots, screenshots, trace ZIPs, network, cleanup and summary. Browser API/external requests are blocked, attempts counted, and success requires zero API attempts; the app and storage bridge are real. Summary `plannedCoverage` lists the intended checks; `coverage` lists only completed checks, and `unverified` includes unfinished checks. Cleanup marks resources never launched as `not-started`. Summary hashes verify required evidence survived cleanup.

Report criterion/source, observation, evidence and status. Historical counts are context, not current results. For durable delivery preserve selected sanitized artifacts under the task's artifact store or `docs/verification/assets/<task>/`; temporary storage is not archival storage.

## Cleanup

Smoke `finally` closes the full persistent browser, terminates only its created process group (bounded TERM then KILL), removes its temporary profile, checks port release and retained evidence, including failed attempts. `instance.json` identifies resources after host interruption; recheck live PID ownership before manual recovery.

For a manual dev/gateway launch, close the run's browser, terminate its saved live `SERVER_PID` from the original session, then `wait "$SERVER_PID"`. Check recorded children/all reserved ports are released. Never kill by process name or assume a port listener belongs to you. Report lost ownership instead of guessing.

Remove scratch state only. Retain evidence and confirm it exists after teardown. Dependencies/build caches may remain; they are not proof.

## Helpers

- `node .agents/skills/verify-atoms/scripts/smoke-example.mjs NEW_EVIDENCE_DIR [PORT]`: owned launch, Doctor, example, full browser restart, cleanup; port defaults to 3210.
- `node .agents/skills/verify-atoms/scripts/doctor.mjs URL OWNED_SERVER_PID [dev|team]`: read-only JSON preflight, nonzero on mismatch.
- Existing drivers are linked from feature files and [team setup](references/team.md).

Use **maintain-verification-skill** when requirements/selectors/drivers drift. If unavailable, return the specific stale recipe and evidence to the owning workflow. Operational instructions here do not require a user-global skill.
