"use client";
import type { CloudWorkbenchSession, WorkbenchState } from "@/lib/cloud-projects/workbench";
import type { HistoryEntry } from "@/lib/cloud-projects/contract";

export function historyTime(entry: HistoryEntry) {
  const time = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });
  const saved = !entry.hasData ? "当时尚无已保存业务数据" : entry.dataSavedAt ? `业务数据最后保存：${time(entry.dataSavedAt)}` : "此前业务数据保存时间未记录";
  const paired = entry.nextSequence ? `采用 V${entry.nextSequence} 前配对保存` : entry.origin === "baseline" ? "历史功能启用时建立基线" : entry.origin === "activated" ? "明确启用时建立基线" : "首次正式使用时建立基线";
  return `${paired}：${time(entry.pairedAt)} · ${saved}`;
}
export function CloudHistory({ session, state }: { session: CloudWorkbenchSession; state: WorkbenchState }) {
  if (!state.cloud) return null;
  if (!state.historyOpen) return <button className="secondary-button" onClick={() => void session.openHistory()}>历史保存点</button>;
  const history = state.history;
  const unpaired = state.cloud.project.modificationRecords?.filter(record => !history?.entries.some(entry => entry.recordId === record.id)) ?? [];
  return <section className="cloud-save-panel history-panel" aria-label="历史保存点">
    <div className="history-heading"><h2>历史保存点</h2><button className="secondary-button" onClick={() => session.closeHistory()}>{state.artifact ? "返回候选试用" : "返回当前项目"}</button></div>
    <p>保存点保留当时的代码与正式数据。副本试用中的修改只在本次试用有效。</p>
    {state.historyLoading && <p role="status">正在读取历史…</p>}
    {state.historyError && <p role="alert">{state.historyError}</p>}
    <button className="secondary-button" disabled={state.historyLoading} onClick={() => void session.openHistory()}>刷新历史列表</button>
    {history && <>
      {!history.entries.length && <p>尚无正式保存点。待验证成果明确启用后才会建立基线。</p>}
      <ol className="history-list">{history.entries.map(entry => <li key={entry.id}>
        <h3>V{entry.sequence} · {entry.status === "current" ? "当前项目" : entry.status === "cleared" ? "已清理，无法恢复" : "完整保存点"}</h3>
        <p>{entry.summary}</p><p className="history-time">{historyTime(entry)}</p>
        {entry.origin === "baseline" && <p>更早的代码与数据没有快照，不能补回。</p>}
        {entry.status === "current" && <p>当前业务数据可能继续更新，将在采用下一版本前配对保留。</p>}
        {entry.status === "available" && <button className="secondary-button" aria-pressed={state.historyTrial?.snapshot.entry.id === entry.id} disabled={state.historySnapshotLoading} onClick={() => void session.tryHistory(entry.id)}>试用 V{entry.sequence} 副本</button>}
      </li>)}</ol>
      {unpaired.length > 0 && <div><h3>未保留快照的旧记录</h3>{unpaired.map(record => <p key={record.id}>{record.requests.join("；")} · 仅修改记录，无法恢复</p>)}</div>}
    </>}
  </section>;
}
