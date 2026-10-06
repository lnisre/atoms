# First-visit example and timer

## Sub-features

| Expected observable result | Source |
| --- | --- |
| Empty workspace gets one independent example without auto-opening/model calls; concurrent visits create one; existing projects/marker semantics survive | [ADR 0012](../../../../docs/adr/0012-first-visit-example-project.md), [#36](https://github.com/lnisre/atoms/issues/36) |
| Start/pause/reset persist; running time recovers by elapsed time; expired reopen settles current segment once and pauses; paused state stays paused; unknown fields survive | ADR 0012, [#37](https://github.com/lnisre/atoms/issues/37) |
| Read failure cannot overwrite data; initialization/transaction failures are retryable without half-projects; failed timer writes preserve committed state | ADR 0012 |
| Preset requirement/assistant/delivery is identified truthfully; old example code/data do not migrate to show messages | ADR 0012, [#39](https://github.com/lnisre/atoms/issues/39) |
| Modification uses normal candidate policy; adoption excludes trial data | ADR 0012 and [ADR 0011](../../../../docs/adr/0011-review-findings-and-preview.md) |

## How to get to it (user POV)

Visit `/` in a new isolated profile. Open “示例 · 专注番茄钟” in “已有项目”; also exercise “我的项目” and “最近项目” when entry coverage is required. Reopen via the project's UUID deep link or homepage after full browser restart. Idea chips only fill a new requirement; they are different from the installed example.

## Driving it with Playwright

Use [Launch](../SKILL.md#launch) and its default smoke command. It clicks the card, observes 25:00, clicks 开始, observes elapsed wall time, clicks 暂停, waits for app `#status=已保存` and platform “应用数据已保存”, compares committed remaining time, refreshes, then closes/relaunches Chrome using the same isolated profile and reopens through the card. Complete code/data records must match; API attempts must be zero. No clock/state injection.

For concurrency, expired/running recovery, failure protection, messages, old state and candidate boundaries:
```sh
TEST_BASE_URL="http://127.0.0.1:$PORT" pnpm exec playwright test tests/browser/builtin-example.spec.ts --workers=1 --retries=0 --trace=on --output="$RUN/browser" --reporter=json >"$RUN/playwright.json"
```

Selectors: card scoped to “已有项目”; iframe `#timeDisplay`, `#toggleBtn`, `#resetBtn`, `#countDisplay`, `#status`, “重试”. Capture before/action/after and the committed row for the URL project ID.

## Gotchas

Existing timer specs inject Date.now into each opaque iframe; real callbacks, DOM and storage still run. Label controlled time. The wall-time smoke proves paused recovery, not running/expired recovery.

The initialization marker shares `applicationData`; select business rows by projectId/state, not array position. Fixed asset identity comes from `src/lib/builtin-example.ts`. Never clear a user's workspace to pass. Existing Enter-based boundary tests do not prove pointer interaction.
