---
name: team-cancel-environment
description: "Prepare and verify an isolated Atoms cancellation-lifecycle experiment environment from the fixed project base. Use when a new local run needs the historical fault, incomplete-fix, or fixed-reference slice for Issue 41; do not use for ordinary Atoms acceptance or real-model runs."
---

# Team cancellation environment

Use this skill only to create a fresh local experiment instance for the Issue 41 stop/cancellation slice. It is an environment-preparation skill, not a product-fix or coordinator skill.

## Fixed inputs

The entry script always exports the stable Atoms base `1d4d81791b3b48c51e0311f1af7e842a13d9cd1f`. Tool commits may advance on a descendant checkout; committed and uncommitted changes outside `tools/team-cancel-environment/` and this skill directory are rejected. Tool HEAD, script hash and dirty state are recorded separately from the product base. It creates a candidate with one synthetic local commit and only these target files replaced; the candidate has no historical refs:

- `A`: both `src/lib/team/socket.ts` and `src/lib/team/client.ts` from `886f933c3015d3c810f85662812c5bc201a478f7` (historical cancellation fault). The historical pair preserves the already-calibrated A fixture; it is not a socket-only mutation.
- `B`: both target files from `3be65e0734f21382ff77f5b2b5c6e8a0ca8d30a1` (incomplete heartbeat cleanup fix; that revision’s socket is byte-identical to the fixed base file).
- `reference`: target files from `7c604dce257b0b8a57ee261610d1501c186b6065` as the calibration reference.

These are historical fault reconstructions, not complete historical checkouts. The candidate omits Git metadata, verification reports, and environment files. This reduces accidental answer leakage but is not a system-wide filesystem sandbox; an agent that can read the host can still inspect other paths.

## Create, inspect, check

Requires macOS/APFS for isolated copy-on-write dependency clones. Run from the repository checkout that contains this skill with Node **24**, and put pnpm **10.12.1** and uv on PATH. The CLI records the Node executable used to invoke it and resolves pnpm/uv from PATH; it does not depend on an author-specific worktree.

```sh
node tools/team-cancel-environment/env.mjs create --variant A \
  --python /path/to/python-env/bin/python \
  --metagpt-source /path/to/pinned-metagpt
node tools/team-cancel-environment/env.mjs inspect --run RUN_ID
node tools/team-cancel-environment/env.mjs check --run RUN_ID
```

The command prints JSON with the candidate, runtime entry, handoff and evidence paths. Hand the executor only the candidate path and `runtime/HANDOFF.md`; variant selection, `manifest.json`, calibration output and other runs stay with the organizer. Run directory names are opaque and do not disclose the selected state. Use a new run for every trial. The root defaults to `atoms-team-cancel-environment` inside the OS temporary directory; set `--root` to an owned durable location when needed. The dependency seed defaults to this checkout's `node_modules`. Pass `--node-modules-source` if the pnpm install is elsewhere; its adjacent lockfile must match the fixed product base. `prepare` also checks the actual required modules. The source seed is APFS-cloned into each candidate, so its writes do not share a mutable `node_modules` tree.

`check` calibrates the **untouched initial seed** using only the `heartbeat-lifecycle.mjs abort` integration probe. It checks the fixed probe, source hashes, actual pending-heartbeat trigger and structured failure signature: A must report the already-closed controller with four remaining socket listeners; B must report the unhandled heartbeat `AbortError`; `reference` must pass with all resources released. Missing dependencies, altered entrypoints, incomplete output and unexpected failures are unsuccessful/inconclusive calibration, never an active seed.

After a repair, run `node tools/team-cancel-environment/env.mjs accept --run RUN_ID`. This slice acceptance requires the unchanged probe to pass against the **current** product source, then runs the fixed deterministic unit suite. It permits legitimate repaired source hashes and requires green regardless of the original variant. It is not page or complete product acceptance; continue with `verify-atoms` for those claims. Both commands bind results to before/after candidate source hashes and write a fresh evidence subdirectory for every invocation, preserving initial calibration and failed attempts. Recreate a seed for the next trial rather than resetting a repaired candidate.

## Native page lane

Each create supplies `runtime/run`, a neutral `runtime/HANDOFF.md`, and explicit dependency paths. Use the printed absolute entry from any directory:

```sh
/absolute/run/runtime/run prepare
/absolute/run/runtime/run build
/absolute/run/runtime/run start
/absolute/run/runtime/run doctor
/absolute/run/runtime/run test-stop
/absolute/run/runtime/run test
/absolute/run/runtime/run stop
```

`prepare` selects Node 24/pnpm 10.12.1 and the supplied Python 3.11 without installation. It uses `uv pip check --python` because a uv-created environment need not contain pip, verifies the pinned MetaGPT core against the supplied checkout, and runs the native runner tests. Default Python and MetaGPT paths are `ROOT/python-env/bin/python` and `ROOT/metagpt-src`; override with `create --python PATH --metagpt-source PATH`. The dependency seed remains read-only; each candidate has its own APFS-cloned node_modules.

The entry creates an isolated HOME and dummy config from the fixed repository config. The real gateway uses the explicit `tests/team/fixture_transport.py` provider wrapper; `TEAM_FIXTURE=1` alone is insufficient. `prepare` and `start` execute real ps/lsof probes; an OS denial requires the tool’s normal permission path, and is not a successful preflight. Failed launches terminate their freshly owned detached process group even if identity recording fails. `start` selects two free ports and records gateway/Next identities. `doctor` checks current source against the build, process ancestry, ports, HTTP and served assets. `test-stop` requires both unchanged native stop cases to pass, with no skips; `test` requires the fixed 54-test suite. Each call records source, configuration and fixed-test identities under `evidence/runtime/`, including failures and browser traces. For additional checks use `runtime/run exec node|pnpm|python ...` with the same environment.

After source changes, stop and rebuild before starting again. Build identity includes root build/configuration inputs such as PostCSS and imported root modules. A recorded live gateway or Next child blocks both a new start and rebuilding, including after its parent exits. Source deletion or unavailable Git identity is recorded without preventing the owned stop path. The fixed tests and offline config cannot be edited to manufacture a pass; add separate regression files as needed. The page lane proves the gateway/Python/browser/provider seam; the deterministic probe owns exact pending-heartbeat calibration. [verify-atoms](../verify-atoms/references/team.md) describes that evidence boundary and the manual offline recipe if diagnosing the helper itself.

`stop` checks saved PID start time, command, cwd and port ownership before signaling. It refuses mismatches rather than touching another instance. Close test browsers and run stop before cleanup. Cleanup refuses live recorded processes or occupied recorded ports and retains evidence (including older runtime/logs):

```sh
node tools/team-cancel-environment/env.mjs cleanup --run RUN_ID
```

Keep evidence from completed runs. Cleanup is irreversible for the run directory; do not use it for unknown directories.

## Boundaries

Do not copy `.env`, real configuration, user data, provider keys, historical verification reports, or reference answers into a candidate. Do not run real-model or deployment lanes as part of preparation. The current regression tests remain visible, so the experiment primarily tests coordination and delivery mechanics, not unknown-bug discovery. `verify-atoms` remains the ordinary product acceptance skill; this skill only owns fixed-slice construction and lifecycle-resource setup.
