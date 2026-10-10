# Cancellation environment release verification

Issue: [#44](https://github.com/lnisre/atoms/issues/44). This delivers the Atoms-specific environment skill and CLI. It does not change product source, publish the generic pstack adapter, or install user-global skills.

The immutable product seed is `1d4d81791b3b48c51e0311f1af7e842a13d9cd1f`. The executable file hashes and sanitized observations are in [release-evidence.json](release-evidence.json). These are actual release checks, separate from earlier coordination experiments. Full local runtime logs and traces remain separately archived; no absolute user paths, credentials or original conversation dumps are needed in this PR.

## Actual results

- A and B were created from the committed tool and matched their distinct expected abort failures. The repaired reference calibrated green. `accept` rejected both untouched fault states.
- Reference `accept` ran the fixed abort probe and all 54 unit tests: 54 passed, zero failed/cancelled/skipped/todo.
- Prepared Python/MetaGPT, build, start and Doctor passed through the supplied runtime. The two unchanged native stop tests passed with zero skips/retries. Each observed 32 seconds after stop, preserved the saved snapshot and had zero page errors and post-close frames.
- Edited fixed probes were rejected. Missing initial prerequisites failed before creating a run root. A run root containing spaces and reached through the `/tmp` alias produced canonical working paths.
- After writing source, HOME and browser markers, cleanup removed only the owned instance and retained evidence. A fresh instance had the same reference source identity and none of the prior markers.
- The owned service and internal process exited; both listeners were released. Temporary idle-sleep prevention ended with the check process.
- Targeted ESLint, Node syntax checks and skill validation passed. Product source was unchanged; the reference build and fixed unit suite supplied the relevant existing-product regression.

## Independent review

Standards review found that reading source identity before `stop` could fail after normal source deletion. Spec review also reproduced restart after gateway death overwriting the live Next child's identity, and PostCSS changes passing an old build check. These findings were fixed and independently rechecked.

Current behavior records deleted inputs as missing, lets owned stop continue when source/Git identity cannot be collected, includes root code/build configuration in build identity, and refuses both start and rebuild while any recorded runtime process is alive. The recheck used isolated local HTTP/child-process fixtures, not the model provider or a production instance. Those diagnostics were cleaned up. No remaining Standards or Spec blocking finding was reported for the final executable source.

## Reproduce within the supported environment

Read the project skill for prerequisites. Use Node 24, put pnpm and uv on PATH, supply a lock-matched dependency seed and the pinned Python/MetaGPT environment. Create new instances rather than resetting an old working tree.

```sh
node tools/team-cancel-environment/env.mjs create --variant reference \
  --root /path/to/owned-runs \
  --python /path/to/python-env/bin/python \
  --metagpt-source /path/to/pinned-metagpt
node tools/team-cancel-environment/env.mjs inspect --run RUN_ID --root /path/to/owned-runs
node tools/team-cancel-environment/env.mjs check --run RUN_ID --root /path/to/owned-runs
```

Use the returned `runtime/run` in order: `prepare`, `build`, `start`, `doctor`, `test-stop`, `stop`. Then run CLI `accept --run RUN_ID --root ...` for the fixed probe/unit acceptance. Use `cleanup` only after owned processes exit and after preserving any repair commits or artifacts you need. Cleanup retains evidence, but it removes the candidate checkout.

A/B `check` success means the expected defect was observed; it is never a product pass. Reference success and subsequent repaired acceptance only cover the specified checks. No real-model quality, provider cancellation billing, production deployment, Windows/Linux portability or general coordinator reliability is claimed.
