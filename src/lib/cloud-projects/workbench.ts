import { cloudRequest, CloudDataSession, readProject, unsavedCopy } from "./client";
import type { CloudProject, CommitReceipt } from "./contract";
import type { Artifact, ArtifactProof } from "./artifact-contract";
import type { InitialGeneration } from "../execution";
import type { TrialData } from "../trial-data";
import type { SavedProject } from "../project-store";
import { readTeam } from "../team/client";
import { TEAM_TIMEOUT_MS, TeamError } from "../team/contract";
import { previewPolicy } from "../team/preview-policy";
import { unresolvedDataIssues } from "../team/review";

type Pending = { operationId: string; path: string; body: object };
export type WorkbenchState = {
  initialRequirement?: string; cloud?: CloudProject; artifact?: Artifact; proof?: ArtifactProof; trial?: TrialData;
  task?: InitialGeneration; generating: boolean; saving: boolean; error: string;
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
  private attempts = new Set<string>();
  constructor(readonly owner: string, readonly projectId: string, cloud?: CloudProject, data?: CloudDataSession) {
    this.state = {cloud, trial:cloud?.project.previewPolicy?.dataMode === "trial" ? {projectId,state:null,hasData:false} : undefined, generating:false,saving:false,error:"",logError:"",logsPending:false,input:""};
    this.data = data;
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
  dispose() { this.lifetime.abort(); this.active?.abort(); this.data?.dispose(); this.listeners.clear(); }
  stop() { this.active?.abort(new TeamError("stopped","本次任务已停止。")); }
  discard() { if (!this.state.generating && !this.state.saving && !this.state.pending) this.publish({artifact:undefined,proof:undefined,trial:this.state.cloud?.project.previewPolicy?.dataMode === "trial" ? {projectId:this.projectId,state:null,hasData:false} : undefined,task:undefined,input:"",error:""}); }
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
    const timeout = setTimeout(()=>active.abort(new TeamError("limit","任务已达到 4 分钟上限。")),TEAM_TIMEOUT_MS);
    const record: InitialGeneration = {taskId,startedAt:new Date().toISOString(),assistantReply:null,events:[]};
    this.publish({generating:true,error:"",task:record,initialRequirement:requirement ?? this.state.initialRequirement});
    try {
      let trial = this.state.trial;
      if (cloud && !trial) {
        const loaded = cloud.project.previewPolicy?.dataMode === "trial" ? undefined : await this.data!.load();
        trial = {projectId:this.projectId,state:structuredClone(loaded?.state ?? null),hasData:loaded !== undefined};
      }
      active.signal.throwIfAborted();
      const expected = parent?.expected ?? this.data?.version ?? cloud?.version;
      const response = await fetch("/api/generate", {method:"POST",cache:"no-store",headers:{"Content-Type":"application/json","X-Atoms-Protocol":"atoms-team/3","X-Atoms-Task-Id":taskId,"X-Atoms-Account":this.owner},
        body:JSON.stringify({projectId:this.projectId,...(cloud ? {modification,expected,...(parentProof ? {parent:parentProof} : {})} : {requirement})}),signal:active.signal});
      const base = parent?.result ?? (cloud && (cloud.project.draftResult ?? cloud.project.result));
      const baseTeam = parent?.generations.at(-1)?.team ?? cloud?.project.modificationRecords?.at(-1)?.generations?.at(-1)?.team ?? cloud?.project.initialGeneration?.team;
      const result = await readTeam(response,taskId,this.projectId,active.signal,event=>{record.events.push(event);this.publish({task:{...record}});},team=>{record.team=team;this.publish({task:{...record}});},base?.html,baseTeam?.protocol === "atoms-team/3" ? unresolvedDataIssues(baseTeam) : []);
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
      this.publish({artifact,proof:result.proof,trial:trial ?? {projectId:this.projectId,state:null,hasData:false},task:{...record},input:"",error:result.proof ? "" : "连接结束前未取得可信保存证明。代码已保留，可下载副本。"});
      if (!cloud && result.proof) await this.commit();
    } catch (error) { if (!this.lifetime.signal.aborted) this.publish({error:error instanceof Error ? error.message : "生成失败，请手动重试。"}); }
    finally { clearTimeout(timeout); if (this.active === active) {this.active=undefined;this.publish({generating:false});} }
  }
  commit() {
    if (this.saveFlight) return this.saveFlight;
    const {artifact,proof,cloud} = this.state;
    if (!artifact || !proof || (cloud && artifact.policy.adoption !== "allowed")) return Promise.resolve();
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
    this.publish({saving:true,pending,error:""});
    this.saveFlight=(async()=>{
      try {
        const receipt=await cloudRequest<CommitReceipt & {logProof?:ArtifactProof}>(this.owner,pending.path,{method:"POST",body:{...pending.body,operationId:pending.operationId},signal:this.lifetime.signal});
        if (this.lifetime.signal.aborted) return;
        if (receipt.projectId !== this.projectId) throw new Error("保存回执与当前项目不符。");
        if (receipt.logProof && !this.logQueue.some(p=>JSON.stringify(p.body)===JSON.stringify({proof:receipt.logProof}))) this.logQueue.push({operationId:crypto.randomUUID(),path:"/events",body:{proof:receipt.logProof}});
        // Keep the exact save pending through a failed readback; retry is still
        // idempotent and never invokes the model again.
        const cloud=await readProject(this.owner,this.projectId);
        if (this.lifetime.signal.aborted) return;
        this.data?.dispose(); this.data=new CloudDataSession(this.owner,this.projectId,cloud.version.code);
        this.publish({cloud,artifact:undefined,proof:undefined,trial:cloud.project.previewPolicy?.dataMode === "trial" ? {projectId:this.projectId,state:null,hasData:false} : undefined,task:undefined,pending:undefined,logsPending:this.logQueue.length>0});
        window.history.replaceState(null,"",`/?project=${this.projectId}`);
        if (this.logQueue.length) void this.retryLogs();
      } catch(error) {this.publish({error:error instanceof Error ? error.message : "保存未确认，内容已保留。"});}
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
