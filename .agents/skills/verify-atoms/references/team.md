# Native team and real target setup

Current account warning (#65/#69): the native browser and `live-cross-app.ts` launch recipes below still assume anonymous/IndexedDB. Their Python prerequisites and offline `test_runner.py` are valid, but those UI drivers cannot prove current account behavior until adapted. The current reading adapter is `live-cloud-cross-app.ts` (manifest first; two already authenticated isolated profiles); its fixture regression is `cloud-cross-app.spec.ts`. See account-cloud and the #69 report for actual executed coverage. Never bypass production auth to make the old recipes run.

Read only when selected criteria need native routing, provider calls or `/qa`. Ordinary UI/example checks need none of this. Runtime authority: [runtime/team/README.md](../../../../runtime/team/README.md), [Dockerfile.vercel](../../../../Dockerfile.vercel), current [ADR 0011](../../../../docs/adr/0011-review-findings-and-preview.md).

## Offline native team

Prerequisites: Node 24/pnpm/Chrome; Python 3.11 in an isolated environment with the pinned patched MetaGPT and compatible requirements; its config root containing the repository's offline config. The upstream SHA and packaging patch live in runtime README/Dockerfile. Use an existing verified environment if available. If unavailable, report this lane blocked; installing the full Python stack is a separate prerequisite, not a reason to replace the app runtime with a mock server.

Resolve the actual interpreter and config root before launch; do not borrow secret configs. The following preflight requires these exported paths, prints versions/locations only, and makes no model calls:

```sh
: "${ATOMS_VERIFY_PYTHON:?Set to the verified Python 3.11 venv executable}"
: "${METAGPT_PROJECT_ROOT:?Set to the verified MetaGPT config root}"
"$ATOMS_VERIFY_PYTHON" -c 'import sys, importlib.metadata as m; assert sys.version_info[:2] == (3,11); import metagpt; print(sys.version.split()[0], m.version("metagpt"), metagpt.__file__)'
"$ATOMS_VERIFY_PYTHON" -m pip check
cmp runtime/team/config2.yaml "$METAGPT_PROJECT_ROOT/config/config2.yaml"
```

Confirm the pinned upstream identity from checkout/package provenance; a version string alone does not establish the SHA. Unavailable provenance stays unverified. Do not print env values or credential files to diagnose auth.

Use a fresh run directory, two free ports, and a dedicated runtime HOME. `TEAM_FIXTURE=1` only enables tests; it does **not** replace the provider. The wrapper below performs that replacement by using existing `fixture_transport.py` and baking verified paths into a temporary executable (the server intentionally does not forward arbitrary env vars).

```sh
RUN="$(mktemp -d /tmp/atoms-verify-team.XXXXXX)"
export RUN
export ATOMS_VERIFY_ROOT="$PWD"
mkdir "$RUN/runtime-home"
python3 - <<'PY'
import os, pathlib, shlex
run = pathlib.Path(os.environ["RUN"])
# Preserve the venv entry point: resolving its symlink selects the system Python.
python = pathlib.Path(os.environ["ATOMS_VERIFY_PYTHON"]).expanduser().absolute()
assert python.is_file() and os.access(python, os.X_OK), "Python must be an executable file"
fixture = pathlib.Path(os.environ["ATOMS_VERIFY_ROOT"]) / "tests/team/fixture_transport.py"
wrapper = run / "offline-python"
wrapper.write_text("#!/bin/sh\nexec " + shlex.quote(str(python)) + " " + shlex.quote(str(fixture)) + ' "$@"\n')
wrapper.chmod(0o700)
PY
pnpm build --webpack >"$RUN/build.log" 2>&1
# Continue only when build succeeded:
node runtime/team/prepare.mjs
node --input-type=module -e 'import {sourceIdentity} from "./.agents/skills/verify-atoms/scripts/doctor.mjs"; console.log(JSON.stringify(sourceIdentity(),null,2))' >"$RUN/build-source.json"
PORT=3215
lsof -nP -iTCP:"$PORT" -iTCP:"$((PORT + 1))" -sTCP:LISTEN
# Continue only when both ports are free:
DEEPSEEK_API_KEY=offline-test-placeholder QA_TOOL_SIGNING_KEY=atoms-offline-test-signing-key ATOMS_TEAM_HOME="$RUN/runtime-home" ATOMS_TEAM_PYTHON="$RUN/offline-python" PORT="$PORT" NEXT_TELEMETRY_DISABLED=1 node runtime/team/gateway.mjs >"$RUN/server.log" 2>&1 &
SERVER_PID=$!
```

The gateway logs `Team gateway listening on 3215`. Wait for HTTP 200, then:

```sh
node .agents/skills/verify-atoms/scripts/doctor.mjs "http://127.0.0.1:$PORT" "$SERVER_PID" team >"$RUN/doctor.json"
HOME="$RUN/runtime-home" METAGPT_PROJECT_ROOT="$METAGPT_PROJECT_ROOT" "$ATOMS_VERIFY_PYTHON" runtime/team/test_runner.py >"$RUN/python.txt" 2>&1
TEAM_FIXTURE=1 TEST_BASE_URL="http://127.0.0.1:$PORT" pnpm exec playwright test tests/browser/team.spec.ts tests/browser/team-modification.spec.ts tests/browser/team-stop.spec.ts --workers=1 --retries=0 --trace=on --output="$RUN/browser" --reporter=json >"$RUN/playwright.json"
```

Run `pnpm test` as well: the current package script includes `tests/team-socket.test.ts` and `tests/team-client.test.ts`, whose isolated processes exercise the real client/adapter with scripted WebSockets, including pending heartbeat abort, timeout and transport failure. Use the current script and report its actual counts. The native `team-stop` cases cover first-generation and modification stops after a cached artifact, observe beyond the delayed Reviewer response, then reload and compare saved records.

Require zero unexpected skips and preserve failure output. Doctor's current source hashes must match build-source for product/runtime inputs; rebuild after changes. Doctor cannot verify upstream auth by reading an env name. In this lane provider replacement is established by wrapper provenance and scripted test outcomes, not live auth.

For a full regression explicitly select the whole suite only on this configured lane. For `/qa`, signing config above is sufficient, and `tests/browser/qa.spec.ts` is the targeted suite. Keep its synthetic data/iframe qualification result separate from business acceptance.

Stop the owned gateway after closing test browsers; it terminates its child and sockets. Verify both recorded listeners have exited. Remove the temporary wrapper/runtime-home after teardown, retaining build/server logs and test evidence. Never run the offline wrapper against a real provider or label its calls as real model usage.

## Real model and target

Read the selected feature contract and current task authorization first. Real inputs include synthetic requirements, generated HTML, platform prompts and role artifacts. Exclude user business records. This lane consumes provider calls; do not run it merely to prove the skill loads.

Local complete runtime: verified real Python interpreter as `ATOMS_TEAM_PYTHON`, verified `METAGPT_PROJECT_ROOT`, trusted server-side `DEEPSEEK_API_KEY` and `QA_TOOL_SIGNING_KEY`. Build/prepare as above, then launch `node --env-file=.env.local runtime/team/gateway.mjs` with an unused `PORT`. Do not reuse the offline wrapper or substitute a Next-only instance.

Remote: use the explicitly selected target. Read [Vercel instructions](../../../../docs/agents/vercel.md) before credential/deployment work. Record deployment ID and verified source mapping; no new deployment is implied. Confirm the browser reaches Atoms rather than a protection/login screen. API key presence is not an auth test; report auth unverified until an authorized actual task supplies evidence.

Preview the exact synthetic manifest before execution:

```sh
node --import tsx tests/team/live-cross-app.ts
node --import tsx tests/team/live-cross-app.ts --todo
# Only when the test plan includes explicit use of an eligible retained draft:
node --import tsx tests/team/live-cross-app.ts --use-retained-draft
```

Inspected baseline: the no-`--execute` branch prints inputs and exits before mkdir, browser launch and provider network. Observe network/process/file effects again if that code changes.

Execution needs exported `TEST_BASE_URL` and a **nonexistent** `TEAM_EVIDENCE_DIR`, with optional verified `TEAM_DEPLOYMENT_ID`. Use one new destination per run. Then:

```sh
node --import tsx tests/team/live-cross-app.ts --execute --todo
# Use another new evidence directory for the reading workflow:
node --import tsx tests/team/live-cross-app.ts --execute
```

Todo submits one task; reading submits initial + two modifications. Each shares the current 240s/20-call budget. The current manifest reports the ADR 0011 cap of three implementations; older manifests with two remain historical evidence. Add `--use-retained-draft` to execution only when that branch is part of the authorized synthetic test plan; see [initial artifact branches](initial-artifact.md). Without it the driver records an eligible draft and stops. The option never unlocks data-risk or execution-blocked artifacts.

`VERCEL_AUTOMATION_BYPASS_SECRET`, if authorized/needed, is attached only to the exact target origin by this driver. It records allowed event fields, product source and driver hashes, actual calls and missing usage. `summary.json` reports `workflowCompleted`, the initial disposition/task outcome and lifecycle path separately; a completed continuation never changes an initial failed task to passed. Keep secrets out of screenshots/traces/URLs. Record failed attempts; retries are additional tasks/cost, not erasure of failure.

The shared workflow currently refreshes and opens a new page in the same context; it does not prove full browser restart. Extend with an isolated persistent profile for that criterion. Its independent synthetic QA checks corroborate app behavior, not Reviewer browser activity.

Controlled modification repair is separate: review `repair-workflow.ts`, `inject-modification-save-defect.py`, and `TEAM_REPAIR_BASELINE` / `ATOMS_DEFECT_EVIDENCE_DIR` requirements before `--execute --repair`. Preserve original/injected/repaired HTML and one frozen independent plan. The repair driver requires its baseline proof to match the current executable initial planHash; after plan maintenance, run a fresh independent baseline check on the unchanged artifact and save it separately. Never rewrite an old proof/hash to satisfy that check. No hand repair is part of ordinary generated-app acceptance.
