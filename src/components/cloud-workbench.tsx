"use client";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { CloudWorkbenchSession } from "@/lib/cloud-projects/workbench";
import { CloudDataControls, CloudProjectHistory } from "./cloud-project-view";
import { ConversationScroll } from "./conversation-scroll";
import { GenerationRecord } from "./generation-record";
import { AppPreview } from "./app-preview";
import { ResultViewer } from "./result-viewer";
import { MAX_REQUIREMENT_LENGTH } from "@/lib/generation";

export function CloudWorkbench({ session, accountSlot, onBack, onReload, onLogin, onRestart }: {
  session: CloudWorkbenchSession; accountSlot: ReactNode; onBack:()=>void; onReload:()=>void; onLogin:()=>void; onRestart:(requirement:string)=>void;
}) {
  const state=useSyncExternalStore(session.subscribe,session.snapshot,session.snapshot);
  const artifact=state.artifact;
  const [frameVersion, setFrameVersion] = useState(0);
  const controls=<section className="cloud-save-panel" aria-label="修改项目">
    {state.cloud && <>
      <label htmlFor="modification">追加修改需求</label>
      <textarea rows={3} id="modification" aria-label="追加修改需求" value={state.input} maxLength={MAX_REQUIREMENT_LENGTH} disabled={state.generating || state.saving || !!state.pending} onChange={e=>session.setInput(e.target.value)}/>
      <button className="primary-button" disabled={!state.input.trim() || state.generating || state.saving || !!state.pending || (!!artifact && !state.proof)} onClick={()=>void session.generate(crypto.randomUUID())}>生成候选</button>
    </>}
    {state.generating && <><p role="status">团队正在生成，最多 4 分钟、20 次模型请求。请保持页面打开。</p><button className="secondary-button" onClick={()=>session.stop()}>停止生成</button></>}
    {artifact && <><p>{state.cloud ? "候选仅在当前会话中试用；采用只更新代码与记录，试用数据不会写回。" : state.saving ? "首次成果正在保存，云端提交后才会确认。" : "首次成果尚未确认云端保存。"}</p>
      {state.cloud && !state.pending && <button className="primary-button" disabled={state.generating || state.saving || !state.proof || artifact.policy.adoption !== "allowed"} onClick={()=>void session.commit()}>采用修改</button>}
      {artifact.policy.adoption === "blocked" && <p>存在执行或数据风险，当前不能采用。可以继续修改。</p>}
      {!state.pending && state.cloud && <button className="secondary-button" disabled={state.generating || state.saving} onClick={()=>session.discard()}>放弃本轮修改</button>}
      {!state.pending && <button className="secondary-button" onClick={()=>session.download()}>下载未保存副本</button>}
    </>}
    {!state.cloud && !artifact && !state.generating && state.task && <>
      <label htmlFor="initial-retry">补充生成需求</label><textarea id="initial-retry" rows={3} maxLength={MAX_REQUIREMENT_LENGTH} value={state.initialRequirement ?? ""} onChange={e=>session.setInitialRequirement(e.target.value)}/>
      <button className="primary-button" disabled={!state.initialRequirement?.trim()} onClick={()=>onRestart(state.initialRequirement!.trim())}>重新生成</button>
      <button className="secondary-button" onClick={()=>session.download()}>下载未保存副本</button>
    </>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.pending && <><button className="primary-button" disabled={state.saving} onClick={()=>void session.retry()}>重试原保存</button><button className="secondary-button" onClick={()=>session.download()}>下载未保存副本</button></>}
    {(state.error || state.logError) && <button className="secondary-button" onClick={onLogin}>重新登录原账号</button>}
    {state.cloud && !artifact && state.cloud.project.previewPolicy?.dataMode === "trial" && <><p>待验证项目：启用前仅使用会话试用数据。</p><button className="primary-button" disabled={state.generating || state.saving || state.cloud.project.previewPolicy.adoption !== "allowed"} onClick={()=>void session.activate()}>使用此版本</button></>}
    {state.logsPending && <p role={state.logError ? "alert" : "status"}>{state.logError || "代码已保存，正在追加云端提交步骤日志…"}{state.logError && <button onClick={()=>void session.retryLogs()}>重试记录保存</button>}</p>}
    <p>候选、本轮未保存对话和试用数据只保留在此页面，刷新或关闭后无法恢复。</p>
  </section>;
  const cloud=state.cloud, project=cloud?.project;
  const result=artifact?.result ?? project?.draftResult ?? project?.result;
  const policy=artifact?.policy ?? project?.previewPolicy;
  const version=result ? {id:artifact?.taskId ?? `${session.projectId}:${cloud!.version.code}`,entryPath:"index.html",files:[{path:"index.html",text:result.html}]} : undefined;
  return <main className="cloud-project">
    <header><button className="secondary-button" onClick={onBack}>我的项目</button><h1>{project?.title ?? (artifact?.requirement ?? state.initialRequirement)?.slice(0,48) ?? "生成项目"}</h1>{accountSlot}</header>
    <p className="cloud-scope">{cloud ? "账号私有项目 · 云端已保存代码 · " : "生成成果在云端提交后才会确认保存 · "}未保存内容与试用数据仅在当前页面保留</p>
    <div className="cloud-project-content">
      <section className="cloud-project-history" aria-label="项目说明与记录">
        <ConversationScroll>
          {cloud && <CloudProjectHistory cloud={cloud}/>}
          {artifact?.generations.map(record=><GenerationRecord key={record.taskId} title="本轮修改" requirement={record.requirement} live={false} pending={false} saveError={!!state.error} saving={state.saving} record={record}/>)}
          {state.task && (!artifact?.generations.some(g=>g.taskId===state.task!.taskId)) && <GenerationRecord live={state.generating} pending={state.generating} saveError={!!state.error} saving={state.saving} record={state.task} title={cloud ? "本轮修改" : "首次生成"}/>}
        </ConversationScroll>
        {controls}
      </section>
      <ResultViewer version={version} status={artifact ? cloud ? "候选版本 · 会话试用" : "尚未确认保存的成果" : policy?.dataMode === "trial" ? "待验证代码 · 仅副本试用" : "已保存代码"} actions={cloud && session.data && (!artifact ? <CloudDataControls key={session.data.instanceId} cloud={cloud} session={session.data} onReload={onReload} onLogin={onLogin} onRetried={()=>setFrameVersion(v=>v+1)}/> : <button className="secondary-button" onClick={onReload}>重新载入云端版本</button>)}>
        {!result ? <div className="preview-placeholder"><p>任务完成后在此查看代码与预览。</p></div> : policy?.status === "blocked" ? <div className="preview-placeholder"><h2>此代码暂不执行</h2><p>{policy.reasons.join("；")}</p></div> : <AppPreview key={artifact?.taskId ?? `${session.data?.instanceId}:${frameVersion}`} html={result.html} projectId={session.projectId} projectSaved={!!cloud && !artifact} trial={state.trial} cloud={artifact || state.trial ? undefined : session.data} onRetry={onReload}/>}
      </ResultViewer>
    </div>
  </main>;
}
