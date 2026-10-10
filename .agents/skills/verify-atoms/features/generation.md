# Generation and cross-app lifecycle

Current account/cloud entry and selectors: [account-cloud.md](account-cloud.md), accepted by #65/#68 and ADR 0015. The local workbench/IndexedDB recipes below describe the historical surface and are not current cloud acceptance.

## Sub-features

| Expected observable result | Source |
| --- | --- |
| Requirement starts a real task with actual role events and usable code or honest terminal outcome | [#2](https://github.com/lnisre/atoms/issues/2), [#25](https://github.com/lnisre/atoms/issues/25), current [ADR 0011](../../../../docs/adr/0011-review-findings-and-preview.md) |
| Code runs in sandbox; initial formal/draft storage follows current policy | ADR 0011, [#3](https://github.com/lnisre/atoms/issues/3) |
| Actual add/complete/delete changes business state; saved code/data reopen without generation | #3, [#11](https://github.com/lnisre/atoms/issues/11), [#28](https://github.com/lnisre/atoms/issues/28) |
| Stop/leave ends the task and rejects cached or late artifacts without changing saved projects | [ADR 0006](../../../../docs/adr/0006-m5-metagpt-agent-team.md), ADR 0011, [#41](https://github.com/lnisre/atoms/issues/41) |
| Assistant text and real events persist; absent text is reported, never fabricated | [#16](https://github.com/lnisre/atoms/issues/16), ADR 0011 |

## How to get to it (user POV)

Home → “你想做什么？” → “开始生成”. Idea chips fill input only. Operate the result, wait for saving, return using “新建项目 / 已有项目”; reopen via recent projects, project cards or `/?project=<UUID>`.

## Driving it with Playwright

```sh
TEST_BASE_URL="http://127.0.0.1:$PORT" pnpm exec playwright test tests/browser/generation.spec.ts tests/browser/first-generation.spec.ts tests/browser/persistence.spec.ts tests/browser/cross-app-acceptance.spec.ts tests/browser/cross-app-draft.spec.ts --workers=1 --retries=0 --trace=on --output="$RUN/browser" --reporter=json >"$RUN/playwright.json"
```

These replace provider/transport boundaries with fixtures. For native roles use [offline team](../references/team.md#offline-native-team) and `team.spec.ts` plus `team-stop.spec.ts`; stop from the generating page or leave through “新建项目 / 已有项目”. For generated apps use [real acceptance](../references/team.md#real-model-and-target), `tests/team/live-cross-app.ts` and shared `cross-app-workflow.ts`.

Frozen synthetic requirements in `cross-app-scenarios.ts` request selectors `#name`, `#add`, `#records li .toggle`, `.remove`, `[data-atoms-status]`. Add two distinguishable records, delete one, toggle another and check committed state. Capture artifact/hash and independent results. Different requirements need matching selectors, not changed business expectations. Executable independent checks are maintained separately from the frozen requirement text; each new proof records its exact planHash. Keep historical plans/results unchanged when correcting a driver.

The shared driver classifies raw storage by the submitted task/project identity and current preview policy before business actions. Follow [initial artifact branches](../references/initial-artifact.md) for formal, usable draft, restricted draft, execution-blocked and no-artifact outcomes. Failed-task continuation is a distinct result from a successful initial team run.

## Gotchas

“项目已保存” alone proves neither formal-data permission nor business correctness; pair with [policy](review-policy.md). A generated mismatch is a failed criterion, not permission to relax it. Cross-app currently reopens pages, not the full browser. Compatibility seeds are deliberate synthetic DB writes, not user actions. #28 closed with real acceptance gaps; subsequent offline green runs do not fill them.
