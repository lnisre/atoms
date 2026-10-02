import { AssistantMessage } from "./assistant-message";

// Authored onboarding content, not a persisted model reply or a TeamRecord.
// Display it for existing local examples too, without rewriting their code/data.
export function ExampleConversation() {
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
