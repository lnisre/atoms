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
    {state.artifact && <p>可以查看和试用历史。恢复前，请返回候选试用，明确采用或放弃本轮修改。</p>}
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
        {entry.status === "available" && <>
          <button className="primary-button" disabled={session.historyBusy || !!state.artifact} onClick={() => session.prepareHistory("restore", entry)}>恢复到 V{entry.sequence}</button>
          <button className="secondary-button" disabled={session.historyBusy || !!entry.protectedReason} onClick={() => session.prepareHistory("clear", entry)}>清理 V{entry.sequence} 保存点</button>
          {entry.protectedReason === "undo" && <p>有效撤销依赖此保存点，暂不可清理。</p>}
        </>}
        {entry.status === "available" && <button className="secondary-button" aria-pressed={state.historyTrial?.snapshot.entry.id === entry.id} disabled={state.historySnapshotLoading} onClick={() => void session.tryHistory(entry.id)}>试用 V{entry.sequence} 副本</button>}
      </li>)}</ol>
      {unpaired.length > 0 && <div><h3>未保留快照的旧记录</h3>{unpaired.map(record => <p key={record.id}>{record.requests.join("；")} · 仅修改记录，无法恢复</p>)}</div>}
    </>}
  </section>;
}

export function HistoryConfirmation({ session, state }: { session: CloudWorkbenchSession; state: WorkbenchState }) {
  const confirmation = state.confirmation;
  if (!confirmation) return null;
  const { action, entry } = confirmation;
  const title = action === "undo" ? "确认撤销本次恢复" : action === "clear" ? `确认清理 V${entry!.sequence} 保存点` : `确认恢复到 V${entry!.sequence}`;
  return <section className="cloud-save-panel" role="dialog" aria-modal="false" aria-label={title}>
    <h2>{title}</h2>
    {entry && <><p>{entry.summary}</p><p>{historyTime(entry)}</p></>}
    {action === "restore" ? <>
      <p>将使用此保存点的代码和配对数据，替换当前业务数据。此版本之后的版本与对话将从当前历史移除，后续生成仅使用保留的需求。</p>
      <p>恢复前完整状态将保留，可通过“撤销本次恢复”找回。历史副本中的修改不会参与恢复。</p>
      {state.cloud?.restore && <p>本次恢复成功将替换上一次撤销机会。</p>}
    </> : action === "undo" ? <>
      <p>将完整找回本次恢复前的代码、业务数据、版本与对话。</p>
      <p>恢复后保存的新业务数据、当前未采用候选、未提交需求和试用修改都会舍弃，不进行合并。恢复前已主动放弃的候选不会找回。</p>
      <p>成功后本次撤销机会结束，不提供重做。</p>
    </> : <p>将永久删除此保存点的代码和数据快照，无法再试用或恢复。对应修改记录和对话保留。清理不保证释放的空间足够完成其他保存。</p>}
    <button className="primary-button" disabled={session.historyBusy} onClick={() => void session.confirmHistory()}>{action === "undo" ? "确认撤销恢复" : action === "clear" ? "永久清理保存点" : "确认恢复"}</button>
    <button className="secondary-button" disabled={state.saving || !!state.pending} onClick={() => session.cancelConfirmation()}>取消</button>
  </section>;
}
