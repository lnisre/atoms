# Home and workbench

## Sub-features

| Expected result | Source |
| --- | --- |
| Input/idea selection survives home/grid switching; recent/cards reopen without generation; unavailable controls are disabled | [#15](https://github.com/lnisre/atoms/issues/15) |
| Actual user/assistant/platform records have truthful source/chronology; missing history is not invented | [#16](https://github.com/lnisre/atoms/issues/16), [#17](https://github.com/lnisre/atoms/issues/17), [#18](https://github.com/lnisre/atoms/issues/18) |
| Long content scrolls independently; scroll-up respected; input/adopt/abandon remain reachable | #18 |
| Detail/scroll preserve input, iframe and trial state with no extra model calls | #18 |
| Same-viewport 1440×900 reference comparison and 1280×720 usability | #15/#18; missing reference states remain unverified |

## How to get to it (user POV)

Home → input or “待办清单” → “我的项目” → “最近项目” / “已有项目”. In workbench expand “原需求详情”, “模型与耗时” and role/step details; scroll old messages, use “回到最新消息”, return via “新建项目 / 已有项目”. Preset messages follow [example](example.md).

## Driving it with Playwright

```sh
TEST_BASE_URL="http://127.0.0.1:$PORT" pnpm exec playwright test tests/browser/home-entry.spec.ts tests/browser/workbench.spec.ts tests/browser/workbench-stream.spec.ts --workers=1 --retries=0 --trace=on --output="$RUN/browser" --reporter=json >"$RUN/playwright.json"
```

Specs seed controlled long histories/generated responses. Retain screenshots, request counts, iframe identity and input/trial values before/after expansion. `workbench-stream` counts the initial routed request and the modification handled by replaced `window.fetch` separately, then requires the combined request ledger to remain unchanged through details/scroll/resize. Its negative control sends an extra request through that same fetch entry and must be rejected; these counts are UI generation attempts, not supplier calls. `home-entry` covers missing-project feedback; storage-fault coverage lives in `builtin-example.spec.ts` and `persistence.spec.ts`.

Region “项目对话与详情” owns conversation scrolling, separate from iframe scroll.

For visual acceptance capture reference and implementation at matching viewport for home, projects, generating, adopted, candidate and expanded details. Record intentional mappings and differences in #15/#18.

## Gotchas

Layout assertions are not visual fidelity. Verify reference access only when needed. Generated-app style/dynamic account data are outside platform comparison. Example seeding changes empty-workspace assumptions. Prove the same iframe remains connected; a replacement visible iframe alone is insufficient.
