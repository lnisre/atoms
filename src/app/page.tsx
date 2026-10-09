"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  appendGenerationEvents,
  initializeHomeWorkspace,
  loadApplicationData,
  saveProject,
  adoptCandidate,
  activateProject,
  type ModificationRecord,
  type SavedProject,
} from "@/lib/project-store";
import type { TrialData } from "@/lib/trial-data";
import { AppPreview } from "@/components/app-preview";
import { ResultViewer } from "@/components/result-viewer";
import type { SourceVersion } from "@/components/source-browser";
import { HomeEntry, type HomeView } from "@/components/home-entry";
import {
  MAX_REQUIREMENT_LENGTH,
  type GenerationResult,
} from "@/lib/generation";

import { createRecorder, type InitialGeneration, type ModificationGeneration, type RecordStep } from "@/lib/execution";
import { readTeam } from "@/lib/team/client";
import { previewPolicy, type PreviewPolicy } from "@/lib/team/preview-policy";
import { unresolvedDataIssues } from "@/lib/team/review";
import { TEAM_TIMEOUT_MS, TeamError, outcomeLabels, type TeamOutcome } from "@/lib/team/contract";
import { ExampleConversation } from "@/components/example-conversation";
import { GenerationRecord } from "@/components/generation-record";
import { ConversationScroll } from "@/components/conversation-scroll";
import { Unavailable, WorkspaceTools, PreviewNavigation, AtomsMark } from "@/components/workbench-controls";

type ModificationSession = {
  record: ModificationGeneration;
  step: RecordStep;
  active: boolean;
};

type Project = Pick<SavedProject, "id" | "requirement" | "exampleSource" | "retiredExampleSource"> & { title?: string };
type Task =
  | { status: "waiting" }
  | { status: "failed"; error: string; outcome?: TeamOutcome }
  | { status: "complete"; result: GenerationResult; policy?: PreviewPolicy };

const examples = [
  {
    name: "待办清单",
    text: "做一个支持添加、完成、删除任务的待办应用。中文界面，清楚区分已完成和未完成任务，适配手机。",
  },
  {
    name: "番茄钟",
    text: "做一个专注番茄钟，支持开始、暂停、重置，默认专注 25 分钟，休息 5 分钟。中文界面。",
  },
  {
    name: "小费计算器",
    text: "做一个小费计算器，可以输入账单金额、小费比例和人数，显示每人应付金额。中文界面。",
  },
];

export default function Home() {
  const modificationSessions = useRef<ModificationSession[]>([]);
  const [sessionRecords, setSessionRecords] = useState<ModificationGeneration[]>([]);
  const [previousAttempts, setPreviousAttempts] = useState<{ requirement: string; record: InitialGeneration }[]>([]);
  const [supplement, setSupplement] = useState("");
  const [generationRecord, setGenerationRecord] = useState<InitialGeneration | null>(null);
  const [logSavePending, setLogSavePending] = useState(false);
  const pendingRecordWrites = useRef(0);
  const [logSaveError, setLogSaveError] = useState(false);
  const generationSession = useRef<{ record: InitialGeneration; step: RecordStep; projectId: string; writes: Promise<void> } | null>(null);
  const [previewStep, setPreviewStep] = useState<RecordStep>();
  const [requirement, setRequirement] = useState("");
  const [homeView, setHomeView] = useState<HomeView>("home");
  const [project, setProject] = useState<Project | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [listError, setListError] = useState("");
  const [exampleError, setExampleError] = useState("");
  const [homeLoadAttempt, setHomeLoadAttempt] = useState(0);
  const [projectSave, setProjectSave] = useState<
    "unsaved" | "saving" | "saved" | "failed"
  >("unsaved");
  const [restored, setRestored] = useState(false);
  const [modification, setModification] = useState("");
  const [draftTrial, setDraftTrial] = useState<TrialData>();
  const [candidate, setCandidate] = useState<{ result: GenerationResult; trial: TrialData; revision: number; session: ModificationSession } | null>(null);
  const [dialogue, setDialogue] = useState<string[]>([]);
  const [records, setRecords] = useState<ModificationRecord[]>([]);
  const [adopting, setAdopting] = useState(false);
  const [adoptionError, setAdoptionError] = useState("");
  const adoptionPending = useRef(false);
  const [modifying, setModifying] = useState(false);
  const [modificationError, setModificationError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const active = useRef<AbortController | null>(null);
  const initialBusy = task?.status === "waiting" || projectSave === "saving";
  const busy = initialBusy || modifying || adopting;
  const policy = candidate?.session.record.team ? previewPolicy(candidate.session.record.team,candidate.result.html) : task?.status === "complete" ? task.policy : undefined;
  async function activateDraft() {
    if (!project || task?.status !== "complete" || projectSave !== "saved" || busy) return;
    adoptionPending.current = true;
    setAdopting(true); setAdoptionError("");
    try {
      const saved=await activateProject(project.id,task.result.html);
      setTask({status:"complete",result:saved.result,policy:saved.previewPolicy}); setDraftTrial(undefined);
      setProjects(items=>[saved,...items.filter(p=>p.id!==saved.id)]);
    } catch(error) { setAdoptionError(error instanceof Error ? error.message : "保存失败"); }
    finally {adoptionPending.current = false;setAdopting(false);}
  }


  useEffect(() => {
    let cancelled = false;
    const id = new URLSearchParams(window.location.search).get("project");
    const load = initializeHomeWorkspace(id);
    load
      .then(({ projects: saved, exampleError }) => {
        if (cancelled) return;
        setProjects(saved);
        setExampleError(exampleError);
        setListError("");
        const current = saved.find((item) => item.id === id);
        if (current) {
          generationSession.current = null;
          setGenerationRecord(current.initialGeneration ?? null);
          setProject(current);
          setRecords(current.modificationRecords ?? []);
          setTask({ status: "complete", result: current.result, policy:current.previewPolicy });
          setDraftTrial(current.previewPolicy?.dataMode === "trial" ? {projectId:current.id,state:null,hasData:false} : undefined);
          setProjectSave("saved");
          setRestored(true);
        } else if (id) {
          setListError(
            "此浏览器中找不到该项目。请确认使用原浏览器和原网址，且没有清除站点数据。",
          );
        }
      })
      .catch(() => {
        if (!cancelled)
          setListError(
            "无法读取已有项目，请检查浏览器存储权限；当前无法保证保存与恢复。",
          );
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false);
      });
    return () => {
      cancelled = true;
    };
  }, [homeLoadAttempt]);

  function retryHomeLoad() {
    setLoadingProjects(true);
    setHomeLoadAttempt(value => value + 1);
  }

  async function retryExamplePreparation() {
    setLoadingProjects(true);
    try {
      const loaded = await initializeHomeWorkspace();
      setProjects(loaded.projects);
      setExampleError(loaded.exampleError);
      // Refresh only provenance/title. A retry must not reset the current task,
      // candidate, source view, iframe or unsent input.
      setProject(current => {
        const saved = loaded.projects.find(p => p.id === current?.id);
        return current && saved ? { ...current, title: saved.title,
          exampleSource: saved.exampleSource, retiredExampleSource: saved.retiredExampleSource } : current;
      });
    } catch {
      setExampleError("无法读取已有项目，请检查浏览器存储权限；当前无法保证保存与恢复。");
    } finally { setLoadingProjects(false); }
  }

  function discardChanges() {
    for (const session of modificationSessions.current) session.active = false;
    modificationSessions.current = [];
    setSessionRecords([]);
    setPreviewStep(undefined);
    setCandidate(null);
    setDialogue([]);
    setModification("");
    setModificationError("");
    setAdoptionError("");
  }

  function openProject(saved: SavedProject) {
    setPreviousAttempts([]); setSupplement("");
    generationSession.current = null;
    setPreviewStep(undefined);
    setGenerationRecord(saved.initialGeneration ?? null);
    setLogSaveError(false);
    discardChanges();
    setProject(saved);
    setRecords(saved.modificationRecords ?? []);
    setTask({ status: "complete", result: saved.result, policy:saved.previewPolicy });
    setDraftTrial(saved.previewPolicy?.dataMode === "trial" ? {projectId:saved.id,state:null,hasData:false} : undefined);
    setProjectSave("saved");
    setRestored(true);
    window.history.replaceState(
      null,
      "",
      `?project=${encodeURIComponent(saved.id)}`,
    );
  }

  function goHome() {
    if (
      projectSave === "failed" &&
      !window.confirm("项目保存失败。离开会丢失当前生成结果，是否继续？")
    )
      return;
    discardChanges();
    setPreviousAttempts([]); setSupplement("");
    generationSession.current = null;
    setPreviewStep(undefined);
    setGenerationRecord(null);
    setProject(null);
    setTask(null);
    setProjectSave("unsaved");
    window.history.replaceState(null, "", "/");
    retryHomeLoad();
  }

  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    const abort = () => active.current?.abort();
    window.addEventListener("pagehide", abort);
    return () => { abort(); window.removeEventListener("pagehide", abort); };
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (adoptionPending.current || pendingRecordWrites.current > 0) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  function stopTask() {
    active.current?.abort(new TeamError("stopped", "任务已停止，已有成果保留。可修改需求后重新发起。"));
  }

  async function generate(nextProject: Project) {
    if (active.current || adoptionPending.current) return;
    if (task?.status === "failed" && generationRecord && project) setPreviousAttempts(items => [...items, {requirement: project.requirement, record: generationRecord}]);
    const controller = new AbortController();
    active.current = controller;
    setSupplement("");
    setProject(nextProject);
    setRecords([]);
    discardChanges();
    setProjectSave("unsaved");
    setRestored(false);
    window.history.replaceState(null, "", "/");
    setTask({ status: "waiting" });
    setDraftTrial(undefined);
    setSeconds(0);
    const taskId = crypto.randomUUID();
    const record: InitialGeneration = { team: { protocol: "atoms-team/3", taskId, projectId: nextProject.id, deliveries: [], calls: [] }, taskId, startedAt: new Date().toISOString(), assistantReply: null, events: [] };
    let persisted = false;
    const session = { record, step: null as unknown as RecordStep, projectId: nextProject.id, writes: Promise.resolve() };
    generationSession.current = session;
    setGenerationRecord({ ...record });
    setLogSaveError(false);
    const append = (event: InitialGeneration["events"][number]) => {
      record.events = [...record.events, event];
      if (generationSession.current === session) setGenerationRecord({ ...record });
      if (persisted) {
        const events = [...record.events];
        pendingRecordWrites.current++;
        setLogSavePending(true);
        session.writes = session.writes.then(() => appendGenerationEvents(nextProject.id, taskId, events)).then(() => {
          if (generationSession.current === session) setLogSaveError(false);
        }).catch(() => {
          if (generationSession.current === session) setLogSaveError(true);
        }).finally(() => {
          pendingRecordWrites.current--;
          setLogSavePending(pendingRecordWrites.current > 0);
        });
      }
    };
    session.step = createRecorder(taskId, "browser", append);
    setPreviewStep(() => session.step);
    session.step("transport", "接收生成结果", "started", "向服务端提交需求并持续读取实际执行事件。");
    const timer = setTimeout(() => controller.abort(new TeamError("limit", "任务已达到 4 分钟上限，已结束本次执行。")), TEAM_TIMEOUT_MS);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", "X-Atoms-Task-Id": taskId, "X-Atoms-Protocol": "atoms-team/3" },
        body: JSON.stringify({ requirement: nextProject.requirement, projectId: nextProject.id }),
        signal: controller.signal,
      });
      const { result: data, assistantReply, team } = await readTeam(response, taskId, nextProject.id, controller.signal, append, team => {
        record.team = team;
        if (generationSession.current === session) setGenerationRecord({ ...record });
      });
      if (controller.signal.aborted && !(controller.signal.reason instanceof TeamError && controller.signal.reason.outcome === "limit")) controller.signal.throwIfAborted();
      record.team = team;
      record.assistantReply = assistantReply;
      session.step("transport", "接收生成结果", "completed", "完整代码已收到；实际审查与任务结束状态见团队记录。");
      const policy = previewPolicy(team,data.html);
      setTask({ status: "complete", result: data, policy });
      setDraftTrial(policy.dataMode === "trial" ? {projectId:nextProject.id,state:null,hasData:false} : undefined);
      setProjectSave("saving");
      const saved: SavedProject = {
        ...nextProject,
        title: nextProject.requirement.slice(0, 48),
        result: data,
        previewPolicy: policy,
        initialGeneration: record,
        updatedAt: new Date().toISOString(),
      };
      session.step("project-save", "保存项目与助手回复", "started", "写入本浏览器项目存储，等待事务提交。");
      try {
        await saveProject(saved);
        persisted = true;
        session.step("project-save", "保存项目与助手回复", "completed", "项目、HTML、助手回复及已有执行记录已提交；后续步骤独立追加。");
        setProjectSave("saved");
        setProjects((items) => [
          saved,
          ...items.filter((item) => item.id !== saved.id),
        ]);
        window.history.replaceState(
          null,
          "",
          `?project=${encodeURIComponent(saved.id)}`,
        );
      } catch {
        session.step("project-save", "保存项目与助手回复", "failed", "浏览器存储未提交，当前产物仅留在页面中。");
        setProjectSave("failed");
      }
    } catch (error) {
      const failure = controller.signal.aborted ? controller.signal.reason : error;
      const outcome = failure instanceof TeamError ? failure.outcome : "failed";
      const detail = failure instanceof Error ? failure.message : "连接失败，未取得完整结果。";
      if (record.team) record.team = {...record.team, outcome};
      session.step("transport", outcomeLabels[outcome], "failed", detail);
      setTask({ status: "failed", outcome, error: detail });
    } finally {
      clearTimeout(timer);
      active.current = null;
    }
  }

  async function modify() {
    if (active.current || adoptionPending.current || !project || task?.status !== "complete" || projectSave !== "saved" || !modification.trim()) return;
    const controller = new AbortController();
    active.current = controller;
    setPreviewStep(undefined);
    const change = modification.trim();
    const taskId = crypto.randomUUID();
    const record: ModificationGeneration = { team: { protocol: "atoms-team/3", taskId, projectId: project.id, deliveries: [], calls: [] }, taskId, projectId: project.id, requirement: change, startedAt: new Date().toISOString(), assistantReply: null, events: [], outcome: "waiting" };
    const session: ModificationSession = { record, step: null as unknown as RecordStep, active: true };
    modificationSessions.current.push(session);
    const append = (event: ModificationGeneration["events"][number]) => {
      if (!session.active || event.taskId !== taskId) return;
      record.events = [...record.events, event];
      setSessionRecords(modificationSessions.current.map(item => ({ ...item.record })));
    };
    session.step = createRecorder(taskId, "browser", append);
    session.step("transport", "接收修改结果", "started", candidate ? "提交最新候选代码及已完成的本轮需求，读取实际执行事件。" : "提交已采用代码，读取实际执行事件。");
    setModifying(true);
    setModificationError("");
    setAdoptionError("");
    setSeconds(0);
    const timer = setTimeout(() => controller.abort(new TeamError("limit", "任务已达到 4 分钟上限，已有成果保留。")), TEAM_TIMEOUT_MS);
    const baseHtml = (candidate?.result ?? task.result).html;
    const baseTeam = candidate?.session.record.team ?? records.at(-1)?.generations?.at(-1)?.team ?? generationRecord?.team;
    const baseDataIssues = baseTeam?.protocol === "atoms-team/3" ? unresolvedDataIssues(baseTeam) : [];
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", "X-Atoms-Task-Id": taskId, "X-Atoms-Protocol": "atoms-team/3" },
        body: JSON.stringify({ projectId: project.id, requirement: project.requirement, modification: change, baseHtml, baseDataIssues, context: [...records.flatMap(item => item.requests), ...dialogue] }),
        signal: controller.signal,
      });
      const { result, assistantReply, team } = await readTeam(response, taskId, project.id, controller.signal, append, team => {
        if (!session.active) return;
        record.team = team;
        setSessionRecords(modificationSessions.current.map(item => ({ ...item.record })));
      }, baseHtml, baseDataIssues);
      record.team = team;
      if (controller.signal.aborted && !(controller.signal.reason instanceof TeamError && controller.signal.reason.outcome === "limit")) controller.signal.throwIfAborted();
      if (previewPolicy(team,result.html).status === "blocked") throw new Error(previewPolicy(team,result.html).reasons.join("；"));
      record.assistantReply = assistantReply;
      session.step("transport", "接收修改结果", "completed", "完整 HTML 已保留；实际审查与任务结束状态见团队记录。");
      session.step("trial", "准备试用副本", "started", candidate ? "沿用当前会话的试用数据。" : "读取正式数据并创建会话内副本。");
      let trial: TrialData;
      try {
        const data = candidate || draftTrial ? undefined : await loadApplicationData(project.id);
        trial = candidate?.trial ?? draftTrial ?? { projectId: project.id, state: structuredClone(data?.state ?? null), hasData: !!data };
      } catch (error) {
        session.step("trial", "准备试用副本", "failed", "未成功读取正式数据，未开始空数据试用。");
        throw error;
      }
      if (controller.signal.aborted && !(controller.signal.reason instanceof TeamError && controller.signal.reason.outcome === "limit")) controller.signal.throwIfAborted();
      record.outcome = "complete";
      session.step("trial", "准备试用副本", "completed", "试用副本已准备；不会写入正式业务数据。");
      setCandidate({ result, trial, revision: (candidate?.revision ?? 0) + 1, session });
      setDialogue(items => [...items, change]);
      setModification("");
    } catch (error) {
      record.outcome = "failed";
      const failure = controller.signal.aborted ? controller.signal.reason : error;
      if (record.team) record.team = { ...record.team, outcome: failure instanceof TeamError ? failure.outcome : "failed" };
      if (!record.events.some(event => event.stepId === "transport" && event.status === "completed"))
        session.step("transport", "接收修改结果", "failed", "未取得完整且匹配的结果，接收已结束。");
      session.step("modification", "本轮修改", "failed", controller.signal.aborted ? controller.signal.reason?.message ?? "任务已停止，已有成果保留。" : error instanceof Error ? error.message : "修改失败，已有成果保留。");
      if (failure instanceof TeamError && failure.outcome === "clarification") setModification(`${change}\n\n此前问题：${failure.message}\n用户补充：`);
      setModificationError(controller.signal.aborted ? controller.signal.reason?.message ?? "任务已停止，已有成果保留。" : error instanceof Error ? error.message : "修改失败，请重新发起。");
    } finally {
      clearTimeout(timer);
      active.current = null;
      setModifying(false);
    }
  }

  async function adopt() {
    if (!project || !candidate || active.current || adoptionPending.current) return;
    adoptionPending.current = true;
    setAdopting(true);
    setAdoptionError("");
    try {
      const sessions = modificationSessions.current.filter(item => item.record.outcome === "complete");
      candidate.session.step("adoption", "采用代码与消息", "started", "在同一事务保存最新候选代码、对应需求、助手回复与执行记录；不写入试用数据。");
      const saved = await adoptCandidate(project.id, candidate.result, dialogue, sessions.map(item => item.record));
      candidate.session.step("adoption", "采用代码与消息", "completed", "采用事务已提交，代码与对应消息已保存；正式数据保持原样。");
      // Completion is only recorded after commit. Append to the latest stored
      // record, never overwrite code or official data with a stale snapshot.
      pendingRecordWrites.current++;
      setLogSavePending(true);
      try {
        await appendGenerationEvents(project.id, candidate.session.record.taskId, candidate.session.record.events);
        setLogSaveError(false);
      } catch {
        setLogSaveError(true);
      } finally {
        pendingRecordWrites.current--;
        setLogSavePending(pendingRecordWrites.current > 0);
      }
      saved.modificationRecords!.at(-1)!.generations = sessions.map(item => structuredClone(item.record));
      setPreviewStep(undefined);
      setTask({ status: "complete", result: saved.result, policy:saved.previewPolicy });
    setDraftTrial(saved.previewPolicy?.dataMode === "trial" ? {projectId:saved.id,state:null,hasData:false} : undefined);
      setRecords(saved.modificationRecords ?? []);
      setProjects(items => [saved, ...items.filter(item => item.id !== saved.id)]);
      setRestored(false);
      // Remount with a fresh channel and official storage only after commit.
      discardChanges();
    } catch {
      candidate.session.step("adoption", "采用代码与消息", "failed", "采用事务未提交，旧保存结果仍保留，当前候选未采用。");
      setAdoptionError("采用保存失败。原先已保存的代码、修改记录和正式数据仍保留；当前候选尚未采用，请保留页面并检查浏览器存储权限或空间，再手动点击“采用修改”。");
    } finally {
      adoptionPending.current = false;
      setAdopting(false);
    }
  }

  // Use the same completed result and identity as the preview, before runtime injection.
  const result = task?.status === "complete" && projectSave !== "saving" ? candidate?.result ?? task.result : undefined;
  const versionId = project && task?.status === "complete" ? project.id + task.result.generatedAt + (candidate ? `:trial:${candidate.revision}` : ":adopted") : "";
  const sourceVersion = useMemo<SourceVersion | undefined>(() => result ? {
    id: versionId,
    entryPath: "index.html",
    files: [{ path: "index.html", text: result.html }],
  } : undefined, [result, versionId]);

  return (
    <div className={project ? "app-shell workbench" : "app-shell"}>
      {project && <header className="topbar">
        <div className="project-titlebar">
          <button className="brand" disabled={busy} onClick={goHome} aria-label="Atoms 首页"><AtomsMark /></button>
          <h1 title={project.requirement}>{project.title ?? project.requirement}</h1>
          <button className="text-button project-home" disabled={busy} onClick={goHome} aria-label="新建项目 / 已有项目" title="返回项目入口">⌄</button>
          <Unavailable label="代码历史与恢复">◴</Unavailable>
          <Unavailable label="收起对话">«</Unavailable>
        </div>
        <WorkspaceTools />
      </header>}
      {!project ? (
        <HomeEntry
          view={homeView}
          onViewChange={setHomeView}
          requirement={requirement}
          onRequirementChange={setRequirement}
          projects={projects}
          loadingProjects={loadingProjects}
          listError={listError}
          exampleError={exampleError}
          onRetryProjects={retryHomeLoad}
          examples={examples}
          onOpenProject={openProject}
          onGenerate={() => {
            if (requirement.trim() && !loadingProjects)
              void generate({ id: crypto.randomUUID(), requirement: requirement.trim() });
          }}
        />
      ) : (
        <main className="workspace">
          <aside className="project-panel">
            {exampleError && <div role="alert" className="save-error"><p>{exampleError}</p><button className="text-button" disabled={loadingProjects} onClick={() => void retryExamplePreparation()}>重试准备示例</button></div>}
            <ConversationScroll key={project.id}>
              <details className="project-details"><summary>项目详情与保存范围</summary>
                <details className="requirement-block"><summary>{project.exampleSource ? "示例功能基线" : "原需求详情"}</summary><p>{project.requirement}</p></details>
                {task?.status === "complete" && (!project.exampleSource || candidate || records.length > 0) && <details className="generation-details"><summary>模型与耗时</summary><dl><div><dt>模型</dt><dd>{(candidate?.result ?? task.result).model}</dd></div><div><dt>{candidate ? "最近候选耗时" : "生成耗时"}</dt><dd>{((candidate?.result ?? task.result).durationMs / 1000).toFixed(1)} 秒</dd></div></dl></details>}
                {project.retiredExampleSource && <details className="record-note"><summary>项目来源</summary><p>来自旧版专注番茄钟示例，现作为普通项目保留。代码、个人数据和已采用修改继续属于本项目；没有补充生成或审查记录。</p><p>来源代码 SHA-256：<code>{project.retiredExampleSource.sourceCodeHash}</code>。预置版本 SHA-256：<code>{project.retiredExampleSource.codeHash}</code>。这些标识属于初始素材，不代表后续修改的代码。</p></details>}
                <details className="storage-details"><summary>保存与恢复范围</summary><p>自动保存到本浏览器的当前网址。项目与应用数据分别显示保存结果，请等待保存成功再离开。清除站点数据、无痕会话结束或存储被回收后可能丢失，不支持跨设备找回。</p></details>
              </details>
              {project.exampleSource ? <ExampleConversation source={project.exampleSource} /> : <div className="user-message"><span>{project.retiredExampleSource ? "原项目功能基线" : "你 · 初始需求"}</span><p>{project.requirement}</p></div>}
              {!project.exampleSource && <section className={`task-state ${task?.status}`} aria-live="polite" aria-atomic="true">
                <div className="state-title">
                  <span className={initialBusy ? "spinner" : "state-symbol"} aria-hidden="true">{initialBusy ? "" : task?.status === "failed" ? "!" : "✓"}</span>
                  <h2>{initialBusy ? "正在生成应用" : task?.status === "failed" ? (task.outcome && task.outcome !== "failed" ? outcomeLabels[task.outcome] : "生成未完成") : restored ? "已恢复保存的应用" : "代码已生成"}</h2>
                </div>
                {initialBusy && <><p>正在处理需求，实际进展见平台执行记录。完整结果保存后会展示预览。</p><p className="elapsed">已等待 {seconds} 秒 · 最多 4 分钟</p></>}
                {task?.status === "waiting" && <button className="text-button" onClick={stopTask}>停止任务</button>}
                {task?.status === "failed" && <><p role="alert" style={{whiteSpace:"pre-wrap"}}>{task.error}</p><button className="primary-button" onClick={() => void generate(project)}>重新生成</button></>}
                {task?.status === "complete" && <p>{restored ? "已读取保存的需求和代码，没有重新调用模型。" : projectSave === "failed" ? "完整源码仅保留在本页，可查看和复制；尚未保存，刷新后无法恢复。" : policy?.status === "blocked" ? "完整源码已保留，可只读查看和复制；当前代码禁止运行。" : "现在可以在预览中操作应用。生成完成不代表所有功能都已验证。"}</p>}
              </section>}
              {previousAttempts.map(attempt => <GenerationRecord key={attempt.record.taskId} title="此前任务" requirement={attempt.requirement} record={attempt.record} live={false} pending={false} saveError={false} saving={false} />)}
              {generationRecord && <GenerationRecord record={generationRecord} live={!restored && task?.status !== "failed"} pending={task?.status === "waiting"} saveError={logSaveError} saving={logSavePending} resultHint={projectSave === "failed" ? "成果尚未保存，请在右侧查看并复制需要保留的源码。" : task?.status === "complete" && task.policy?.status === "blocked" ? "此成果禁止运行，可在右侧查看和复制源码。" : undefined} resultLabel={task?.status === "complete" ? (projectSave === "saved" ? "首次生成 · 已保存" : "首次生成 · 尚未保存") : undefined} />}
              <section className="record-history" aria-label="已采用修改记录">
                {records.length === 0 && !project.exampleSource && <p className="empty-history">还没有已采用的修改记录。</p>}
                {records.map(record => <div key={record.id} className="adopted-group">
                  {record.generations?.length ? record.generations.map(generation => <GenerationRecord key={generation.taskId} title="已保存修改" requirement={generation.requirement} record={generation} live={false} pending={false} saveError={false} saving={false} />) : record.requests.map((request, index) => <div className="user-message" key={index}><span>已保存的修改需求</span><p>{request}</p></div>)}
                  <div className="result-card"><strong>{record.summary}</strong><p><time dateTime={record.adoptedAt}>{new Date(record.adoptedAt).toLocaleString("zh-CN")}</time> · 已采用并保存</p><small>修改记录，不提供历史代码回退。</small></div>
                </div>)}
              </section>
              {!generationRecord && logSaveError && <p role="alert" className="save-error">执行记录保存失败，最新步骤可能无法恢复；已采用的代码与消息仍保留。</p>}
              {sessionRecords.length > 0 && <ol className="current-dialogue" aria-label="本轮对话">{sessionRecords.map(record => <li key={record.taskId}><GenerationRecord title={record.outcome === "failed" ? "修改失败" : "本轮修改"} requirement={record.requirement} record={record} live={record.outcome !== "failed"} pending={record.outcome === "waiting"} saveError={false} saving={false} resultLabel={record.outcome === "complete" ? (record.taskId === candidate?.session.record.taskId ? `第 ${candidate.revision} 轮候选 · 未采用` : "已由后续候选继续修改 · 未采用") : record.outcome === "failed" ? "修改未完成 · 已有成果保留" : undefined} /></li>)}</ol>}
            </ConversationScroll>
            <p className={`project-save ${projectSave === "failed" ? "save-error" : ""}`} role={projectSave === "failed" ? "alert" : "status"}>
              {projectSave === "saved" ? "项目已保存" : projectSave === "saving" ? "项目正在保存…" : projectSave === "failed" ? "项目保存失败，请保留页面并检查浏览器存储权限或空间；刷新会丢失当前结果。" : "项目尚未保存"}
            </p>
            {task?.status === "complete" && projectSave === "saved" && <section className="modification-panel" aria-label="对话修改">
              <div className="modification-feedback" aria-live="polite">
                {modifying && <button className="text-button" onClick={stopTask}>停止任务</button>}
                {modifying && <p role="status">正在基于{candidate ? "最新候选" : "已采用代码"}修改，已等待 {seconds} 秒，最多 4 分钟。现有预览与完整源码仍可查看。</p>}
                {modificationError && <p className="save-error" role="alert">{modificationError} 原应用与正式数据未被替换，可点击“生成候选”手动重试。</p>}
              </div>
              <form onSubmit={event => { event.preventDefault(); void modify(); }}>
                <label htmlFor="modification">追加修改需求</label>
                <textarea id="modification" value={modification} onChange={event => setModification(event.target.value)} maxLength={MAX_REQUIREMENT_LENGTH} disabled={busy} placeholder="例如：增加任务优先级与筛选" required />
                <div className="composer-footer"><Unavailable label="添加附件">＋</Unavailable><Unavailable label="语音输入">♩</Unavailable><span>{candidate ? "基于最新候选继续修改" : "基于已采用应用修改"}</span><button className="primary-button" disabled={busy || !modification.trim()} type="submit">{modifying ? "正在生成候选…" : "生成候选"}</button></div>
              </form>
              {!candidate && modificationError && <button className="text-button" disabled={busy} onClick={discardChanges}>放弃本轮修改</button>}
            </section>}
            {task?.status === "failed" && <form className="modification-panel" onSubmit={event => {
              event.preventDefault();
              const next = `${project.requirement}\n\n此前问题与限制：${task.error}\n用户补充：${supplement.trim()}`;
              if (supplement.trim() && next.length <= MAX_REQUIREMENT_LENGTH) void generate({...project, requirement:next});
            }}>
              <label htmlFor="supplement">补充或调整需求</label>
              <textarea id="supplement" value={supplement} onChange={event => setSupplement(event.target.value)} maxLength={MAX_REQUIREMENT_LENGTH} required placeholder="回答上方问题，或说明需要调整的要求" />
              <p>本轮执行已结束。此前需求与问题保留在当前会话，补充后发起新任务。</p>
              {`${project.requirement}\n\n此前问题与限制：${task.error}\n用户补充：${supplement.trim()}`.length > MAX_REQUIREMENT_LENGTH && <p role="alert">合并后的需求超过 4000 字，请缩短补充内容或返回首页重新整理需求。</p>}
              <button className="primary-button" disabled={!supplement.trim() || `${project.requirement}\n\n此前问题与限制：${task.error}\n用户补充：${supplement.trim()}`.length > MAX_REQUIREMENT_LENGTH}>补充后重新发起</button>
            </form>}
            {task?.status !== "failed" && !(task?.status === "complete" && projectSave === "saved") && <section className="modification-panel"><textarea aria-label="追加修改需求（生成完成后可用）" disabled placeholder="生成并保存后，可在这里继续修改" /><div className="composer-footer"><Unavailable label="添加附件">＋</Unavailable><span>等待当前任务完成</span><Unavailable label="发送修改">↑</Unavailable></div></section>}
          </aside>
          <ResultViewer
            key={project.id}
            version={sourceVersion}
            status={candidate ? "候选版本 · 未采用" : projectSave === "failed" ? "尚未保存" : policy?.dataMode === "trial" || policy?.status === "blocked" ? "待验证项目" : projectSave === "saved" ? "已采用版本" : "尚未保存"}
            notice={result && policy ? policy.status === "blocked" ? `禁止运行：${policy.reasons.join("；")}。源码可只读查看和复制，暂不可采用。` : `${policy.review === "unavailable" ? "审查未完成，代码已保留" : policy.review === "issues" ? "可预览，有待修复问题" : "代码审查通过"} · 业务运行尚未验证${policy.adoption === "blocked" ? "；存在待修复的数据问题，暂不可采用" : ""}` : undefined}
            actions={result && <>
              {projectSave === "failed" && <p className="source-save-error save-error" role="alert">项目保存失败，完整源码仅保留在本页，可查看和复制；刷新或离开后无法恢复。请先复制需要保留的源码。</p>}
              {candidate ? <div className="candidate-actions" aria-label="候选操作">
                <div className="candidate-action-row"><strong>第 {candidate.revision} 轮候选 · 等待采用</strong><div>
                  <button className="text-button" disabled={busy} onClick={discardChanges}>放弃本轮修改</button>
                  <button className="primary-button" disabled={busy || policy?.adoption === "blocked"} onClick={() => void adopt()}>{adopting ? "正在保存采用…" : "采用修改"}</button>
                </div></div>
                <p>采用保存代码、对应消息与修改记录，试用数据不会写回正式数据。</p>
                <p>候选、试用数据和本轮对话仅在当前会话保留；放弃、离开项目、刷新或关闭后会丢失。</p>
                {adopting && <p role="status">正在保存代码与修改记录，完成前仍为未采用候选。请等待保存成功再离开。</p>}
                {adoptionError && <p className="save-error" role="alert">{adoptionError}</p>}
              </div> : draftTrial && <div className="candidate-actions">
                <p>{projectSave === "saved" ? "待验证项目 · 代码与问题已保存，试用数据仅本次会话有效。" : "待验证成果 · 尚未保存，试用数据仅本次会话有效。"}</p>
                <button disabled={busy || projectSave !== "saved" || policy?.adoption === "blocked"} onClick={() => void activateDraft()}>使用此版本</button>
                {adoptionError && <p role="alert">{adoptionError}</p>}
              </div>}
            </>}
          >
            {result && policy?.status === "blocked" ? (
              <section className="preview-panel" aria-label="预览已阻止"><PreviewNavigation /><p role="alert">暂未运行：{policy.reasons.join("；")}</p><p>{projectSave === "saved" ? "代码和问题已保存，可查看源码或继续修改。" : "代码仅保留在本页，可查看和复制源码。"}</p></section>
            ) : result ? (
              <AppPreview
                key={versionId}
                html={result.html}
                recordStep={candidate ? candidate.session.step : previewStep}
                trial={candidate?.trial ?? draftTrial}
                projectId={project.id}
                projectSaved={projectSave === "saved"}
                onRetry={() => {
                  document.getElementById("modification")?.focus();
                }}
              />
            ) : (
              <section className="preview-panel waiting-preview" aria-label="预览等待区"><PreviewNavigation /><div className="preview-placeholder">
                <div className="preview-glyph" aria-hidden="true">
                  {busy ? "✳" : "↗"}
                </div>
                <h2>{busy ? "你的想法，正在成形" : "等待新的生成结果"}</h2>
                <p>
                  {busy
                    ? "完整应用返回后，会在这里打开可操作预览。"
                    : "左侧保留了你的需求，可以重新发起生成。"}
                </p>
                <span>APP PREVIEW</span>
              </div></section>
            )}
          </ResultViewer>
        </main>
      )}
    </div>
  );
}
