# Issue tracker: GitHub

任务和规格保存在 https://github.com/lnisre/atoms 的 GitHub Issues。
使用 gh CLI；命令显式指定 --repo lnisre/atoms。

## 操作约定

- 发布任务或规格：创建 GitHub issue。
- 读取任务：读取 issue 正文、标签及评论。
- 多行正文或评论：先写入临时文件，再通过 --body-file 提交。
- 分类标签：采用 triage-labels.md 中的映射。
- 完成任务：记录结果后关闭 issue。

常用命令：

    gh issue create --repo lnisre/atoms --title "标题" --body-file <文件>
    gh issue view <编号> --repo lnisre/atoms --comments
    gh issue view <编号> --repo lnisre/atoms --json number,title,body,labels
    gh issue list --repo lnisre/atoms --state open
    gh issue comment <编号> --repo lnisre/atoms --body-file <文件>
    gh issue edit <编号> --repo lnisre/atoms --add-label <标签>
    gh issue edit <编号> --repo lnisre/atoms --remove-label <标签>
    gh issue close <编号> --repo lnisre/atoms

## Pull requests as a triage surface

PRs as a request surface: no.

GitHub 的 issue 和 PR 共用编号空间；处理裸编号时先确认对象类型。

## Wayfinding

- Map：使用带 wayfinder:map 标签的 issue，记录笔记、已有决策和未知问题。
- 子任务：优先关联为 GitHub sub-issue；不可用时，在 map 中维护任务列表，
  并在子任务正文标注 Part of #<map>。
- 类型标签：wayfinder:research、wayfinder:prototype、
  wayfinder:grilling、wayfinder:task。
- 阻塞关系：优先使用 GitHub 原生 issue dependencies；
  不可用时，在正文顶部记录 Blocked by: #<编号>。
- 可领取任务：按 map 顺序选择未关闭、无未完成阻塞项且尚未指派的子任务。
- 领取：开始工作前将任务指派给当前开发者。
- 完成：记录答案、关闭子任务，并在 map 中补充结论及链接。
