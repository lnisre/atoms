# Atoms feature map

Select by current criteria, not historical counts. Distinct entry points in each file are part of its coverage.

| Feature | Existing recipes | Acceptance authority |
| --- | --- | --- |
| [Generation and cross-app lifecycle](generation.md) | generation, first-generation, team, team-stop, cross-app, cross-app-draft | #2/#3; current ADR 0011 |
| [Modification, trial and adoption](modification.md) | candidate, modification-records, persistence, save-race, reviewer-preview, cross-app-acceptance, cross-app-draft, record-assertions, team-modification, team-stop | #5/#6/#17/#27; ADR 0011 |
| [Review, repairs and preview](review-policy.md) | reviewer-preview, cross-app-draft, team, team-stop, preview-document | ADR 0011 / #35 |
| [First-visit example and timer](example.md) | builtin-example; full-browser smoke | ADR 0012 / #36/#37/#39 |
| [Home and workbench](workbench.md) | home-entry, workbench, workbench-stream, source-browser, source-reading, source-version, source-recovery, source-acceptance | #15/#18/#47; retain visual reference gaps |

Requirements live in linked Issues/ADRs. Selectors/commands are checkout observations; reconcile drift before changing expectations.

Auxiliary `/qa`: `tests/browser/qa.spec.ts` drives “应用”, “验证场景”, “开始检查”, “停止检查”. It needs signing configuration in [team setup](../references/team.md). Synthetic iframe qualification and code/plan identity do not prove model quality. Source: [ADR 0007](../../../../docs/adr/0007-browser-qa-tool.md), [#24](https://github.com/lnisre/atoms/issues/24).

Outstanding real acceptance candidates: cross-app generation, schema-changing continuous modification, actual Reviewer/repair behavior. Reconcile latest records before scheduling; visual work stays in #15/#18. Bootstrap coverage: [Issue #40 verification](../../../../docs/verification/issue-40.md).
