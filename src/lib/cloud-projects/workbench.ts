import { cloudRequest, CloudDataSession, readProject, readHistory, readSnapshot, unsavedCopy } from "./client";
import { ProjectError, type CloudProject, type CommitReceipt, type ProjectHistory, type HistorySnapshot, type HistoryAction, type HistoryEntry, type ProjectVersion } from "./contract";
import type { Artifact, ArtifactProof } from "./artifact-contract";
import type { GenerationProgress } from "../generation-progress";
import type { InitialGeneration } from "../execution";
import type { TrialData } from "../trial-data";
import type { SavedProject } from "../project-store";
import { readTeam } from "../team/client";
import { TEAM_TIMEOUT_MS, TeamError } from "../team/contract";
import { previewPolicy } from "../team/preview-policy";
import { unresolvedDataIssues, unresolvedDataRisks } from "../team/review";

// A preview may share this read. Stop waiting for it without cancelling the
// preview's data request; its late result cannot restart a stopped generation.
async function waitForTask<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort = () => {};
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    })]);
  } finally { signal.removeEventListener("abort", onAbort); }
}

export type HistoryConfirmation = { action: HistoryAction; targetId: string; expected: ProjectVersion; expectedHistory: number; entry?: HistoryEntry };
type Pending = { acknowledged?: boolean; uncertain?: boolean; operationId: string; path: string; body: object };
export type WorkbenchState = {
  initialRequirement?: string; cloud?: CloudProject; artifact?: Artifact; proof?: ArtifactProof; trial?: TrialData;
  progress?: GenerationProgress; task?: InitialGeneration; generating: boolean; saving: boolean; error: string;
  historyOpen?: boolean; history?: ProjectHistory; historyLoading?: boolean; historyError?: string;
  historySnapshotLoading?: boolean;
  confirmation?: HistoryConfirmation; errorCode?: string;
  historyTrial?: { snapshot: HistorySnapshot; trial: TrialData; instanceId: string };
  logError: string; logsPending: boolean; input: string; pending?: Pending;
};
export function projectOf(artifact: Artifact): SavedProject {
  return { id: artifact.projectId, title: artifact.requirement.slice(0,48), requirement: artifact.requirement,
    updatedAt: artifact.result.generatedAt, result: artifact.result, previewPolicy: artifact.policy,
    initialGeneration: artifact.initialGeneration, modificationRecords: artifact.generations.length ? [{id:artifact.taskId,adoptedAt:artifact.result.generatedAt,requests:artifact.generations.map(g=>g.requirement),summary:"未采用的候选修改",generations:artifact.generations}] : [] };
}
// One owner and one page lifetime. This controller owns all async publication,
// pending operation IDs and cancellation, including before a React view mounts.
export class CloudWorkbenchSession {
  readonly id = crypto.randomUUID();
  state: WorkbenchState;
  data?: CloudDataSession;
  private listeners = new Set<() => void>();
  private lifetime = new AbortController();
  private active?: AbortController;
  private logQueue: Pending[] = [];
  private logFlight?: Promise<void>;
  private saveFlight?: Promise<void>;
  private historyRead?: AbortController;
  private snapshotRead?: AbortController;
  private attempts = new Set<string>();
  constructor(readonly owner: string, readonly projectId: string, cloud?: CloudProject, data?: CloudDataSession) {
    this.state = {cloud, trial:cloud?.project.previewPolicy?.dataMode === "trial" ? {projectId,state:null,hasData:false} : undefined, generating:false,saving:false,error:"",logError:"",logsPending:false,input:""};
    this.data = data;
    this.data?.subscribe(() => this.publish({}));
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private publish(change: Partial<WorkbenchState>) {
    if (this.lifetime.signal.aborted) return;
    this.state = {...this.state,...change}; this.listeners.forEach(l=>l());
  }
  get dirty() { return !!(this.state.generating || this.state.task || this.state.artifact || this.state.pending || this.state.logsPending || this.state.trial?.hasData || this.state.input || this.data?.status.pending); }
  setInitialRequirement(initialRequirement: string) { this.publish({initialRequirement}); }
  setInput(input: string) { this.publish({input}); }
  dispose() { this.lifetime.abort(); this.active?.abort(); this.data?.dispose(); this.historyRead?.abort(); this.snapshotRead?.abort(); this.listeners.clear(); }
  stop() { this.active?.abort(new TeamError("stopped","本次任务已停止。")); }
  discard() { if (!this.state.generating && !this.state.saving && !this.state.pending) this.publish({artifact:undefined,proof:undefined,trial:this.state.cloud?.project.previewPolicy?.dataMode === "trial" ? {projectId:this.projectId,state:null,hasData:false} : undefined,task:undefined,progress:undefined,input:"",error:""}); }
  get historyBusy() { return this.state.generating || this.state.saving || !!this.state.pending || !!this.data?.status.pending || this.data?.status.phase === "loading"; }
  prepareHistory(action: HistoryAction, entry?: HistoryEntry) {
    const cloud = this.state.cloud;
    if (!cloud || this.historyBusy) return;
    if (action === "restore" && this.state.artifact) { this.publish({historyError:"请先明确采用或放弃当前候选，再执行恢复。"}); return; }
    const targetId = action === "undo" ? cloud.restore?.id : entry?.id;
    if (!targetId) return;
    this.publish({confirmation:{action,targetId,entry,expectedHistory:(action === "undo" ? cloud.historyRevision : this.state.history?.revision) ?? cloud.historyRevision ?? 0,expected:{...(this.data?.version ?? cloud.version)}},error:"",errorCode:undefined});
  }
  cancelConfirmation() { if (!this.state.saving) this.publish({confirmation:undefined}); }
  confirmHistory() {
    const confirmation = this.state.confirmation;
    if (!confirmation || this.historyBusy || (confirmation.action === "restore" && this.state.artifact)) return Promise.resolve();
    return this.save({operationId:crypto.randomUUID(),path:`/${this.projectId}/history`,body:{action:confirmation.action,targetId:confirmation.targetId,expected:confirmation.expected,expectedHistory:confirmation.expectedHistory}});
  }
  get canCleanupAfterFailure() { return !this.state.saving && !this.state.pending?.acknowledged && !this.state.pending?.uncertain && ["storage_full","PT507"].includes(this.state.errorCode ?? ""); }
  get canRecheckHistory() { return !this.state.saving && !this.state.pending?.acknowledged && ["conflict","PT410","PT412","PT423","PT403"].includes(this.state.errorCode ?? ""); }
  cleanupAfterFailure() {
    if (!this.canCleanupAfterFailure) return;
    // A definite transaction rejection has no receipt to recover; retain the
    // candidate/proof while releasing this rejected operation for manual cleanup.
    this.publish({pending:undefined,confirmation:undefined,error:"清理后可重新执行原操作；可清理空间不保证足够。",errorCode:undefined});
    void this.openHistory();
  }
  recheckHistory() {
    if (!this.canRecheckHistory) return;
    this.publish({pending:undefined,confirmation:undefined,error:"请重新载入云端版本后核对；原确认未执行。",errorCode:undefined});
    void this.openHistory();
  }
  async openHistory() {
    if (!this.state.cloud || this.lifetime.signal.aborted) return;
    this.historyRead?.abort();
    const read = new AbortController(); this.historyRead = read;
    this.publish({historyOpen:true,historyLoading:true,historyError:""});
    try {
      const history = await readHistory(this.owner,this.projectId,AbortSignal.any([read.signal,this.lifetime.signal]));
      if (read.signal.aborted || this.lifetime.signal.aborted) return;
      if (history.projectId !== this.projectId) throw new Error("历史列表与当前项目不一致，请重新读取。");
      this.publish({history,historyLoading:false});
    } catch (error) {
      if (!read.signal.aborted) this.publish({historyLoading:false,historyError:error instanceof Error ? error.message : "历史读取失败，请重试。"});
    }
  }
  closeHistory() {
    this.historyRead?.abort(); this.snapshotRead?.abort();
    this.publish({historyOpen:false,historyLoading:false,historySnapshotLoading:false,historyTrial:undefined,historyError:"",confirmation:undefined});
  }
  async tryHistory(snapshotId: string) {
    if (!this.state.cloud || this.lifetime.signal.aborted) return;
    this.snapshotRead?.abort();
    const read = new AbortController(); this.snapshotRead = read;
    this.publish({historyOpen:true,historySnapshotLoading:true,historyTrial:undefined,historyError:""});
    try {
      const snapshot = await readSnapshot(this.owner,this.projectId,snapshotId,AbortSignal.any([read.signal,this.lifetime.signal]));
      if (read.signal.aborted || this.lifetime.signal.aborted) return;
      if (snapshot.projectId !== this.projectId || snapshot.entry.id !== snapshotId) throw new Error("保存点与所选版本不一致，请重新读取。");
      this.publish({historySnapshotLoading:false,historyTrial:{snapshot,instanceId:crypto.randomUUID(),
        trial:{projectId:this.projectId,state:structuredClone(snapshot.state),hasData:snapshot.hasData}}});
    } catch (error) {
      if (!read.signal.aborted) this.publish({historySnapshotLoading:false,historyError:error instanceof Error ? error.message : "保存点读取失败，请重试。"});
    }
  }
  async generate(taskId: string, requirement?: string) {
    if (this.lifetime.signal.aborted || this.state.generating || this.state.saving || this.state.pending || this.data?.status.pending || this.attempts.has(taskId)) return;
    const cloud = this.state.cloud, parent = this.state.artifact, parentProof = this.state.proof;
    if (parent && !parentProof) {
      this.publish({error:"当前候选未取得可信保存证明。请先下载或放弃，再从已保存版本修改。"}); return;
    }
    const modification = cloud ? this.state.input.trim() : undefined;
    if (cloud && !modification) return;
    this.attempts.add(taskId);
    const active = new AbortController(); this.active = active;
    const timeout = setTimeout(()=>active.abort(new TeamError("limit",`任务已达到 ${TEAM_TIMEOUT_MS / 60_000} 分钟执行上限。`)),TEAM_TIMEOUT_MS);
    const record: InitialGeneration = {taskId,startedAt:new Date().toISOString(),assistantReply:null,events:[]};
    this.publish({generating:true,error:"",task:record,initialRequirement:requirement ?? this.state.initialRequirement,
      progress:{record,startedAt:Date.now(),lastProgressAt:Date.now(),waiting:cloud && !this.state.trial ? "trial" : "connection",modification:!!cloud}});
    const progress = (change: Partial<GenerationProgress>) => {
      if (this.active === active && this.state.progress?.record.taskId === taskId)
        this.publish({progress:{...this.state.progress,...change}});
    };
    const finish = (change: Partial<GenerationProgress> = {}) => progress({endedAt:this.state.progress?.endedAt ?? Date.now(),...change});
    try {
      let trial = this.state.trial;
      if (cloud && !trial) {
        const loaded = cloud.project.previewPolicy?.dataMode === "trial" ? undefined : await waitForTask(this.data!.load(), active.signal);
        trial = {projectId:this.projectId,state:structuredClone(loaded?.state ?? null),hasData:loaded !== undefined};
      }
      active.signal.throwIfAborted();
      progress({waiting:"connection"});
      const expected = parent?.expected ?? this.data?.version ?? cloud?.version;
      const response = await fetch("/api/generate", {method:"POST",cache:"no-store",headers:{"Content-Type":"application/json","X-Atoms-Protocol":"atoms-team/3","X-Atoms-Task-Id":taskId,"X-Atoms-Account":this.owner},
        body:JSON.stringify({projectId:this.projectId,...(cloud ? {modification,expected,...(parentProof ? {parent:parentProof} : {})} : {requirement})}),signal:active.signal});
      const base = parent?.result ?? (cloud && (cloud.project.draftResult ?? cloud.project.result));
      const baseTeam = parent?.generations.at(-1)?.team ?? cloud?.project.modificationRecords?.at(-1)?.generations?.at(-1)?.team ?? cloud?.project.initialGeneration?.team;
      const result = await readTeam(response,taskId,this.projectId,active.signal,event=>{record.events.push(event);this.publish({task:{...record}});progress({record:{...record},lastProgressAt:Date.now(),waiting:"team"});},team=>{record.team=team;this.publish({task:{...record}});progress({record:{...record},lastProgressAt:Date.now(),waiting:"team"});if(team.outcome)finish({outcome:team.outcome});},base?.html,baseTeam?.protocol === "atoms-team/3" ? unresolvedDataIssues(baseTeam) : []);
      if (this.lifetime.signal.aborted) return;
      // A transport-retained artifact may be downloadable, but has no trusted
      // terminal proof and cannot be saved/adopted by fabricating a team record.
      record.assistantReply=result.assistantReply; record.team=result.team;
      const artifact: Artifact = result.proof ? JSON.parse(result.proof.payload) : {
        v:1,kind:"artifact",ownerId:this.owner,projectId:this.projectId,taskId,requirement:cloud?.project.requirement ?? requirement!,expected:cloud ? expected! : null,
        result:result.result,policy:{...previewPolicy(result.team,result.result.html),dataMode:"trial",adoption:"blocked"},
        initialGeneration:cloud ? undefined : record,generations:[],
      };
      if (artifact.ownerId !== this.owner || artifact.projectId !== this.projectId || artifact.taskId !== taskId || artifact.result.html !== result.result.html) throw new Error("产物与当前账号任务不符。");
      finish({record:{...record},outcome:result.team.outcome,reason:result.error,html:artifact.result.html,preview:artifact.policy.status === "blocked" ? "blocked" : "loading"});
      clearTimeout(timeout);
      this.publish({generating:false});
      this.publish({artifact,proof:result.proof,trial:trial ?? {projectId:this.projectId,state:null,hasData:false},task:{...record},input:"",error:result.proof ? "" : "连接结束前未取得可信保存证明。代码已保留，可下载副本。"});
      if (!cloud && result.proof) await this.commit();
    } catch (error) {
      const reason=error instanceof Error ? error.message : "生成失败，请手动重试。";
      finish({outcome:error instanceof TeamError ? error.outcome : "failed",reason});
      if (!this.lifetime.signal.aborted) this.publish({error:reason});
    }
    finally { clearTimeout(timeout); finish(); if (this.active === active) {this.active=undefined;this.publish({generating:false});} }
  }
  previewStep(html: string, stepId: string, status: "started" | "completed" | "failed") {
    const progress=this.state.progress;
    if (!progress?.html || progress.html !== html || progress.preview === "blocked") return;
    if (!["preview-assemble","preview-load","preview-runtime"].includes(stepId)) return;
    const preview=status === "failed" ? "failed" : progress.preview === "failed" ? "failed" : stepId === "preview-load" && status === "completed" ? "loaded" : progress.preview;
    if (preview !== progress.preview) this.publish({progress:{...progress,preview}});
  }
  get adoptionBlock(): { message: string; details: string[] } | undefined {
    const { artifact, proof, generating, saving, pending } = this.state;
    const block = (message: string, details: string[] = []) => ({ message, details });
    if (!artifact) return block("请先生成候选版本。");
    if (generating) return block("正在生成新的候选，请等待生成结束后再采用。");
    if (saving) return block("正在保存，请等待云端确认后再采用。");
    if (pending || this.data?.status.pending) return block("上一次保存尚未确认，请先处理原保存，再采用修改。");
    if (this.data?.status.phase === "loading") return block("正在读取正式数据，请等待读取完成后再采用。");
    if (!proof) return block("当前候选缺少可信保存证明，不能采用。请先下载副本，再放弃本轮修改并重新生成。");
    if (artifact.policy.status === "blocked") return block("当前候选存在执行阻断，修复后才能采用。", artifact.policy.reasons);
    if (artifact.policy.adoption !== "allowed") {
      const team = artifact.generations.at(-1)?.team ?? artifact.initialGeneration?.team;
      const issues = team ? unresolvedDataRisks(team) : [];
      if (issues.length) return block("当前候选仍有数据丢失或重大保存风险，修复后才能采用。", issues.map(i => i.consequence + "（触发条件：" + i.trigger + "）"));
      // A previously signed policy stays authoritative; the client cannot upgrade it.
      return block("当前候选的保存证明不允许采用。请保留副本，继续修改并生成新候选。");
    }
  }
  commit() {
    if (this.saveFlight) return this.saveFlight;
    const {artifact,proof,cloud} = this.state;
    if (!artifact || !proof || (cloud && this.adoptionBlock)) return Promise.resolve();
    const pending = this.state.pending ?? {operationId:crypto.randomUUID(),path:"/artifact",body:{proof}};
    return this.save(pending);
  }
  activate() {
    const cloud=this.state.cloud;
    if (!cloud || this.state.artifact || this.data?.status.pending) return Promise.resolve();
    return this.save(this.state.pending ?? {operationId:crypto.randomUUID(),path:"/activate",body:{projectId:this.projectId,expected:this.data?.version ?? cloud.version}});
  }
  retry() { return this.state.pending ? this.save(this.state.pending) : this.commit(); }
  private save(pending: Pending): Promise<void> {
    if (this.saveFlight || this.lifetime.signal.aborted) return this.saveFlight ?? Promise.resolve();
    this.publish({saving:true,pending,error:"",errorCode:undefined});
    this.saveFlight=(async()=>{
      try {
        const receipt=await cloudRequest<CommitReceipt & {logProof?:ArtifactProof}>(this.owner,pending.path,{method:"POST",body:{...pending.body,operationId:pending.operationId},signal:this.lifetime.signal});
        if (this.lifetime.signal.aborted) return;
        if (receipt.projectId !== this.projectId) throw new Error("保存回执与当前项目不符。");
        pending = {...pending,acknowledged:true}; this.publish({pending});
        this.data?.dispose();
        if (receipt.logProof && !this.logQueue.some(p=>JSON.stringify(p.body)===JSON.stringify({proof:receipt.logProof}))) this.logQueue.push({operationId:crypto.randomUUID(),path:"/events",body:{proof:receipt.logProof}});
        // Keep the exact save pending through a failed readback; retry is still
        // idempotent and never invokes the model again.
        const cloud=await readProject(this.owner,this.projectId);
        if (this.lifetime.signal.aborted) return;
        this.closeHistory();
        this.publish({history:undefined});
        this.data?.dispose(); this.data=new CloudDataSession(this.owner,this.projectId,cloud.version.code);
        this.data.subscribe(() => this.publish({}));
        const clearing = "action" in pending.body && pending.body.action === "clear";
        const progress=this.state.progress;
        if ("action" in pending.body && !clearing) this.publish({progress:undefined});
        else if (progress?.html && !clearing) this.publish({progress:{...progress,saved:true,preview:progress.preview === "blocked" ? "blocked" : "loading"}});
        this.publish({cloud,artifact:clearing ? this.state.artifact : undefined,proof:clearing ? this.state.proof : undefined,trial:clearing ? this.state.trial : cloud.project.previewPolicy?.dataMode === "trial" ? {projectId:this.projectId,state:null,hasData:false} : undefined,task:clearing ? this.state.task : undefined,input:clearing ? this.state.input : "",pending:undefined,logsPending:this.logQueue.length>0});
        window.history.replaceState(null,"",`/?project=${this.projectId}`);
        if (this.logQueue.length) void this.retryLogs();
      } catch(error) {
        const errorCode=error instanceof ProjectError ? error.code : "unavailable";
        if (["unavailable","invalid_response"].includes(errorCode)) pending={...pending,uncertain:true};
        this.publish({pending,error:error instanceof Error ? error.message : "保存未确认，内容已保留。",errorCode});
      }
      finally {this.saveFlight=undefined;this.publish({saving:false});}
    })();return this.saveFlight;
  }
  retryLogs(): Promise<void> {
    if (this.logFlight || !this.logQueue.length || this.lifetime.signal.aborted) return this.logFlight ?? Promise.resolve();
    const pending=this.logQueue[0];
    this.logFlight=(async()=>{
      try {
        await cloudRequest(this.owner,pending.path,{method:"POST",body:{...pending.body,operationId:pending.operationId},signal:this.lifetime.signal});
        if (this.lifetime.signal.aborted) return;
        this.logQueue.shift(); this.publish({logsPending:this.logQueue.length>0,logError:""});
      } catch {this.publish({logsPending:true,logError:"代码已保存；云端提交步骤日志尚未确认，可单独重试。"});}
      finally {this.logFlight=undefined;}
      if (this.logQueue.length && !this.state.logError) await this.retryLogs();
    })();return this.logFlight;
  }
  download() {
    const project=this.state.artifact ? projectOf(this.state.artifact) : this.state.cloud?.project;
    const content={...(project ? unsavedCopy(project,this.data?.status.pending?.state) : {format:"atoms-unsaved-copy/v1",savedToCloud:false,importSupported:false}),
      initialGeneration:project?.initialGeneration,modificationRecords:project?.modificationRecords,currentTask:this.state.task,
      requirement:project?.requirement ?? this.state.initialRequirement,pendingRequirement:this.state.input,trialState:this.state.trial?.state,notice:"未保存副本；候选、试用数据与未保存内容仅在当前页面保留，当前不支持导入。"};
    const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download=`atoms-${this.projectId}-未保存副本.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
}
