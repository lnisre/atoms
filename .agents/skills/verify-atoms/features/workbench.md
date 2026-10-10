# Home and workbench

## Current account verification (#65/#69)

Current account routes and shared matrix: [account-cloud](account-cloud.md). The current cloud workbench keeps one ResultViewer across generation/candidate/adoption, saved history before the current round, ConversationScroll, and a separate modification control area. “我的项目” leaves through unsaved protection. Source viewing never grants permission to execute or adopt restricted code.

Run `cloud-regressions.spec.ts` for candidate code-mode/search retention, same-version iframe continuity, long-history scrolling and controls at 1440×900, 1280×720 and 736×900. `account-access.spec.ts` covers guest read-only source/preview. `source-reading.spec.ts` is an independent public SourceVersion component harness and remains valid for search/clipboard faults; it does not prove cloud persistence.

Old home/workbench/source page tests seed IndexedDB or assume anonymous generation. Do not run those as current cloud acceptance. The standalone source harnesses remain component evidence. Existing #15/#18 visual-reference comparison gaps remain unverified; layout checks do not establish visual fidelity. #69 records the implemented cloud regressions and actual screenshots.

## Historical local-workbench reference (not executable cloud acceptance)

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


## Read-only source browser

Authority: [#47](https://github.com/lnisre/atoms/issues/47), T1–T4 (#49/#53/#54/#57), ADR 0002/0004/0011. Open a saved or example project → “查看代码” → directory/file → “在当前文件中搜索” → previous/next match → “复制当前文件” → “预览”. The workbench stays side by side at 1440×900, 1280×720 and 736×900; narrow layouts initially hide the directory and its overlay stays inside the result panel.

| Expected result | Driver |
| --- | --- |
| Raw single `index.html`; same iframe/input survives viewing (tip example preserves invalid, unsaved input); reading has no generation/storage effects; keyboard and three viewports | `source-browser.spec.ts` |
| Current-file search, exact raw clipboard, rejection/unavailability/late completion; unknown/empty text | `source-reading.spec.ts` |
| Candidate synchronizes both views; valid paths/positions survive; removed path returns to entry with explanation; adopt/abandon and transaction failure | `source-version.spec.ts` |
| Retained draft/raw blocked source, failed save/copy, failed read/retry, multi-adoption recovery and cross-project reset | `source-recovery.spec.ts` |
| Real workbench search/copy preserve formal/trial data and requests; failure/block/stop/late result preserve candidate; risk still blocks adoption | `source-acceptance.spec.ts` |

Against the owned, Doctor-checked dev instance:

```sh
TEST_BASE_URL="http://127.0.0.1:$PORT" pnpm exec playwright test tests/browser/source-browser.spec.ts tests/browser/source-reading.spec.ts tests/browser/source-version.spec.ts tests/browser/source-recovery.spec.ts tests/browser/source-acceptance.spec.ts --workers=1 --retries=0 --trace=on --output="$RUN/browser" --reporter=json >"$RUN/playwright.json"
```

Review saved screenshots for visible highlighting, line numbers and usable narrow-layout controls; token classes alone do not prove readability. Scope save-error locators to “项目成果” because both conversation and result panels explain failure. For mouse text selection, use the visible source text geometry rather than the nonselectable line-number gutter.

Synthetic multi-file harnesses feed the public `SourceVersion` input only; they prove browsing, never #48 generation/runtime support. Real workbench tests keep the existing controlled generation/review boundary, real iframe and IndexedDB. Refresh/reopen defaults to preview and clears reading preferences; unadopted candidates remain session-only. Reading blocked source never authorizes running or adopting it. [Integrated acceptance and first-failure record](../../../../docs/verification/issue-47.md).
