# Domain docs

## 布局

采用 single-context：
- CONTEXT.md：根目录的领域概念和术语表。
- docs/adr/：架构决策记录。

## 读取规则

探索代码前，读取 CONTEXT.md 及与当前任务相关的 ADR。
文件缺失时直接继续；由 domain-modeling 在概念或决策明确后按需创建。

## 术语

任务标题、设计建议、假设和测试名称使用 CONTEXT.md 定义的术语。
发现缺失概念时，先核实是否属于项目语言，再记录待补充内容。

## 决策冲突

方案与现有 ADR 冲突时，明确指出对应 ADR，并说明重新讨论的理由。
