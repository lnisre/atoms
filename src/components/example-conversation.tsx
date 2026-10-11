import { AssistantMessage } from "./assistant-message";
import { GenerationRecordBody } from "./generation-record-body";
import type { ExampleSource } from "@/lib/builtin-example";
import history from "@/lib/examples/tip-calculator-history.json";

// Authored onboarding content, not a persisted model reply or a TeamRecord.
// Display it for existing local examples too, without rewriting their code/data.
function LegacyExampleConversation() {
  return <AssistantMessage
    title="示例项目"
    requirementLabel="示例需求"
    requirement="做一个中文专注番茄钟，默认专注 25 分钟、休息 5 分钟，支持开始、暂停、重置和完成次数统计。使用深色卡片和绿色开始按钮，刷新后可以恢复计时。"
  >
    <p className="record-note">预置示例对话 · 打开即可体验，无需重新生成</p>
    <p className="assistant-reply">{`这份专注番茄钟已经准备好了。右侧可以直接开始、暂停或重置计时；专注完成后会进入休息，并累计完成次数。

进度会保存到当前浏览器，刷新后按实际经过时间恢复。离开期间到期，只结算当前一段并暂停。

继续修改时，在下方描述需求，先试用候选，满意后点击“采用修改”。`}</p>
    <details className="record-note"><summary>示例交付说明</summary><p>上方需求和助手说明是随应用提供的示例内容。初始版本经过开发验证；本次打开没有执行模型生成或团队审查。你后续提交修改时，会在下方看到实际的助手回复和团队记录。</p><p>保存和恢复限于同一浏览器、同一网址。清除站点数据后无法从这里恢复。</p></details>
    <div className="result-card"><strong>示例初始应用 · 已准备</strong><p>可在右侧操作，也可以输入需求继续修改。</p></div>
  </AssistantMessage>;
}


// Captured display history belongs to its source, never to the new user's tasks.
export function ExampleConversation({ source, readOnly = false, cloud = false }: { source: ExampleSource; readOnly?: boolean; cloud?: boolean }) {
  if (source.templateId !== "tip-calculator") return <LegacyExampleConversation />;
  return <section aria-label="示例来源记录">
    <p className="record-note">示例来源记录 · 以下是小费计算器形成时的真实对话。本次打开无需生成。{readOnly ? "右侧只读，保存个人副本后才能修改。" : "右侧可直接使用。"}</p>
    {history.records.map((record, i) => <AssistantMessage key={record.taskId}
      title={`${record.title} · 示例来源`} requirement={record.requirement} requirementLabel="来源需求">
      <GenerationRecordBody reply={record.assistantReply} note={record.note} statuses={record.statuses}
        reviewSummary={record.reviewSummary} details={record.details} steps={record.steps} taskId={record.taskId} source
        resultLabel={i === 0 ? "首次生成 · 来源已保存" : undefined}
        resultHint="此轮只保留来源过程记录，未导出首版完整代码；右侧以修改后采用的版本为基础。" />
    </AssistantMessage>)}
    <div className="result-card"><strong>布局与配色修改 · 来源已采用</strong><p>本示例以这次已采用版本为基础，并修复连续输入的保存问题。</p><small><time dateTime={history.adoptedAt}>2026/10/9 14:58:08</time> · 来源采用时间</small></div>
    <details className="record-note"><summary>示例来源与保存范围</summary><p>当前预置代码是来源代码的修订版：修复保存期间连续输入被忽略的问题。上述 Reviewer 结论仅对应来源代码，修订版未重新调用模型审查。</p><p>上述调用、审查与执行时间属于来源项目。保存个人副本后，项目与演示数据独立。来源首版仅保留过程记录，不提供历史代码回退。</p><p>来源项目：{history.sourceProjectId}。来源代码 SHA-256：<code>{source.sourceCodeHash}</code>。预置修订版 SHA-256：<code>{source.codeHash}</code>。</p>{!readOnly && <p>{cloud ? "个人副本保存到当前账号。云端保存成功后，可在其他设备登录同一账号恢复；未保存内容与试用数据仅保留在当前页面。" : "数据仅保存在同一浏览器、同一网址。清除站点数据后无法从这里恢复。"}</p>}</details>
  </section>;
}
