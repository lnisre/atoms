# Example and old local-data preservation

Authority: #65 / ADR 0015 replaces automatic anonymous provisioning and local workspace upgrades from #46/#50/#51. ADR 0013 source authenticity and #47 read-only source browsing remain applicable.

Guest: “查看只读示例” → inspect fixed 20/5/4 values and ¥5.25; pointer, keyboard, atoms.saveState and raw bridge writes cannot edit. “查看代码” exposes the raw revision without executing it. Viewing and ordinary login create no project or model request.

Account: explicitly choose “保存此示例到我的项目”; login resumes that action once. A lost response retries the original operation. Personal copies have independent IDs/state and retain source history separately from user-generated records. Confirm cloud saving before reopening in another session; show the account/cloud save scope, never the old browser-only promise.

| Current recipe | Boundary |
| --- | --- |
| account-access | Guest read-only pointer/keyboard/API/bridge, source view, no project IndexedDB reads, ordinary login and old local row preservation |
| cloud-projects | Explicit copy, response-loss retry, independent contexts, stranger rejection, tip input, actual saving state, failures/conflicts/download/reload, cloud scope copy |
| tip-calculator unit tests | Consecutive/invalid input and unknown field preservation, scripted bridge |
| cloud-generation / cloud-regressions | Candidate/official state exclusion, explicit adoption, source/iframe state and restored restrictions on synthetic counter |

The current browser tests use real DOM/iframe with synthetic Auth/BFF responses. Real email→ordinary JWT→PG and real Vercel recovery need separate evidence. Detailed two-account example copies, complete old-store snapshots, source-history plus personal adoption remain selected final-acceptance gaps until driven.

Do not use smoke-example, builtin-example, workspace-upgrade, legacy-example or example-restart as current account acceptance: they initialize or mutate the old IndexedDB workspace. Their computation/source-identity assertions remain references, but automatic preinstallation/retirement expectations were superseded. The new app must not scan, migrate, claim or delete old local data.

`cloud-regressions` additionally proves complete Chrome process restart with a synthetic account and in-memory BFF. This verifies the UI recovery path, not persistence of a real Auth session or PG rows.
