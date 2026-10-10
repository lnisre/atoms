"use client";

import { useEffect, useRef, useState } from "react";
import { ExampleConversation } from "./example-conversation";
import { GenerationRecord } from "./generation-record";
import { CloudDataSession, downloadUnsavedCopy, type DataSessionStatus } from "@/lib/cloud-projects/client";
import type { CloudProject } from "@/lib/cloud-projects/contract";

export function UnsavedDialog({ action, onCancel, onConfirm, onDownload }: {
  action: string; onCancel: () => void; onConfirm: () => void; onDownload: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="unsaved-dialog" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2>先保留未保存的内容</h2>
    <p>当前页面有尚未确认保存的内容。{action}后，页面中的副本将丢失；已经提交到云端的内容会保留。</p>
    <p>下载文件标记为未保存副本，当前不支持导入。刷新或关闭后无法恢复页面内的未保存内容。</p>
    <div><button className="primary-button" onClick={onDownload}>下载未保存副本</button><button className="secondary-button" onClick={onCancel}>留在页面</button><button className="secondary-button" onClick={onConfirm}>仍要{action}</button></div>
  </dialog>;
}

// Saved history is independent of the current candidate and its controls.
export function CloudProjectHistory({ cloud }: { cloud: CloudProject }) {
  const project = cloud.project;
  return <>
    <h2>项目需求</h2><p>{project.requirement}</p>
    {project.exampleSource && <ExampleConversation source={project.exampleSource} cloud/>}
    {project.initialGeneration && <GenerationRecord live={false} pending={false} saveError={false} saving={false} record={project.initialGeneration}/>}
    {project.modificationRecords?.map(record => <section key={record.id}><h3>已采用修改</h3><p>{record.summary}</p>{record.generations?.map(generation => <GenerationRecord live={false} pending={false} saveError={false} saving={false} key={generation.taskId} title="已采用修改" requirement={generation.requirement} record={generation}/>)}</section>)}
  </>;
}

export function CloudDataControls({ cloud, session, onReload, onLogin, onRetried }: {
  cloud: CloudProject; session: CloudDataSession; onReload: () => void; onLogin: () => void; onRetried: () => void;
}) {
  const [status, setStatus] = useState<DataSessionStatus>(session.status);
  const project = cloud.project;
  useEffect(() => session.subscribe(setStatus), [session]);
  async function retry() {
    try { await session.retry(); onRetried(); }
    catch { /* The session retains and displays the exact failed operation. */ }
  }
  return <div className="cloud-save-panel">
    {project.previewPolicy?.dataMode !== "trial" && project.previewPolicy?.status !== "blocked" && <p role={status.phase === "failed" ? "alert" : "status"}>
      {status.phase === "unread" ? "等待应用读取云端数据" : status.phase === "loading" ? "正在读取云端数据…" : status.phase === "saving" ? "应用数据正在保存…云端提交后才会确认" : status.phase === "failed" ? status.error : (status.hasData ? "应用数据已保存到云端" : "云端数据已读取 · 尚无已保存数据")}
    </p>}
    {status.pending && <p>本次未保存内容已保留在平台页面。请先处理这次保存，再继续编辑。</p>}
    <div>
      {status.pending && <button className="primary-button" disabled={status.phase === "saving"} onClick={() => void retry()}>重试原保存</button>}
      {status.pending && <button className="secondary-button" onClick={() => downloadUnsavedCopy(project, status.pending!.state)}>下载未保存副本</button>}
      {(status.code === "PT401" || status.code === "unauthenticated" || status.code === "account_changed") && <button className="secondary-button" onClick={onLogin}>重新登录原账号</button>}
      <button className="secondary-button" onClick={onReload}>重新载入云端版本</button>
    </div>
  </div>;
}
