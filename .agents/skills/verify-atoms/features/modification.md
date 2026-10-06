# Modification, trial and adoption

## Sub-features

| Expected observable result | Source |
| --- | --- |
| Successful round uses latest candidate and successful context; failure preserves candidate/input | [#5](https://github.com/lnisre/atoms/issues/5), [#17](https://github.com/lnisre/atoms/issues/17), [#27](https://github.com/lnisre/atoms/issues/27) |
| Trial operates on a session copy, never formal rows; later rounds retain the copy | #5, [ADR 0004](../../../../docs/adr/0004-m2-conversational-updates.md) |
| Explicit adoption atomically saves code/records, excludes trial data; failed commit preserves old saved result and retryable candidate | [#6](https://github.com/lnisre/atoms/issues/6), #17, [ADR 0011](../../../../docs/adr/0011-review-findings-and-preview.md) |
| Abandon/exit/refresh/close discard unadopted changes; adopted code/data/messages restore with zero model calls | #5/#6/#17 |
| Save lock and failed-read protection prevent loss; inherited data risk needs current-code resolution | [#3](https://github.com/lnisre/atoms/issues/3), ADR 0011 |

## How to get to it (user POV)

Open a saved formal project/example. For a first pending-verification project, use the [explicit first-use branch](../references/initial-artifact.md) before asserting formal writes; eligible draft trial has no required formal business row. Fill “追加修改需求”, click “生成候选”, operate “未采用” preview. Continue or choose “采用修改” / “放弃本轮修改”. Also cover leaving via “新建项目 / 已有项目”, refresh and reopen.

## Driving it with Playwright

```sh
TEST_BASE_URL="http://127.0.0.1:$PORT" pnpm exec playwright test tests/browser/candidate.spec.ts tests/browser/modification-records.spec.ts tests/browser/persistence.spec.ts tests/browser/save-race.spec.ts tests/browser/reviewer-preview.spec.ts tests/browser/cross-app-acceptance.spec.ts tests/browser/cross-app-draft.spec.ts tests/browser/record-assertions.spec.ts --workers=1 --retries=0 --trace=on --output="$RUN/browser" --reporter=json >"$RUN/playwright.json"
```

This selection includes inherited-risk/current-code resolution (`reviewer-preview`), rating/filter/legacy-field checks (`cross-app-acceptance`), first-draft use followed by two modifications and recovery (`cross-app-draft`), and empty-state plus two rejected filter counterexamples (`record-assertions`). These are required branches for the corresponding claims above.

Use `team-modification.spec.ts` with the [scripted team](../references/team.md) for native routing. Real reading modifications use `live-cross-app.ts --execute` after manifest/target acceptance.

Capture formal storage before trial and compare unchanged after trial actions. Inspect baseHtml hash and successful context, excluding real business records. Adopt, compare formal data unchanged, then perform a formal write and recover it. Wait until “执行记录正在保存，请等待完成再离开。” disappears before claiming message-history persistence. Check unknown and missing fields alongside visible rating/filter behavior. The shared workflow checks visible record identities and names independently, then compares formal data after each filter. Empty-state list items are not records; removing `data-id` from a visible title must still fail. The independent QA plan checks DOM membership and no-write behavior; Playwright owns the visibility check. Historical requirements and proof/plan hashes remain immutable; new runs record the current executable plan.

## Gotchas

Generation success is not adoption; data-risk candidates remain blocked through unavailable reviews. Adoption is not data rollback. Old `live-modifications.mjs` assumes first-record identity predating example seeding; prefer current shared workflow. Choose URL project ID, not arbitrary first row. Prove the action happened before refreshing. Multi-tab last-write behavior is not collaborative conflict coordination.
