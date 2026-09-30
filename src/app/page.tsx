"use client";

import { useEffect, useRef, useState } from "react";
import {
  appendGenerationEvents,
  listProjects,
  loadApplicationData,
  saveProject,
  adoptCandidate,
  type ModificationRecord,
  type SavedProject,
} from "@/lib/project-store";
import type { TrialData } from "@/lib/trial-data";
import { AppPreview } from "@/components/app-preview";
import {
  CLIENT_TIMEOUT_MS,
  MAX_REQUIREMENT_LENGTH,
  type GenerationResult,
} from "@/lib/generation";

import { createRecorder, type InitialGeneration, type RecordStep } from "@/lib/execution";
import { readGeneration } from "@/lib/generation-client";
import { GenerationRecord } from "@/components/generation-record";

type Project = { id: string; requirement: string };
type Task =
  | { status: "waiting" }
  | { status: "failed"; error: string }
  | { status: "complete"; result: GenerationResult };

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
  const [generationRecord, setGenerationRecord] = useState<InitialGeneration | null>(null);
  const [logSavePending, setLogSavePending] = useState(false);
  const pendingRecordWrites = useRef(0);
  const [logSaveError, setLogSaveError] = useState(false);
  const generationSession = useRef<{ record: InitialGeneration; step: RecordStep; saved: boolean; projectId: string; writes: Promise<void> } | null>(null);
  const [previewStep, setPreviewStep] = useState<RecordStep>();
  const [requirement, setRequirement] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [listError, setListError] = useState("");
  const [projectSave, setProjectSave] = useState<
    "unsaved" | "saving" | "saved" | "failed"
  >("unsaved");
  const [restored, setRestored] = useState(false);
  const [modification, setModification] = useState("");
  const [candidate, setCandidate] = useState<{ result: GenerationResult; trial: TrialData; revision: number } | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((saved) => {
        if (cancelled) return;
        setProjects(saved);
        const id = new URLSearchParams(window.location.search).get("project");
        const current = saved.find((item) => item.id === id);
        if (current) {
          generationSession.current = null;
          setGenerationRecord(current.initialGeneration ?? null);
          setProject(current);
          setRecords(current.modificationRecords ?? []);
          setTask({ status: "complete", result: current.result });
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
  }, []);

  function discardChanges() {
    setCandidate(null);
    setDialogue([]);
    setModification("");
    setModificationError("");
    setAdoptionError("");
  }

  function openProject(saved: SavedProject) {
    generationSession.current = null;
    setPreviewStep(undefined);
    setGenerationRecord(saved.initialGeneration ?? null);
    setLogSaveError(false);
    discardChanges();
    setProject(saved);
    setRecords(saved.modificationRecords ?? []);
    setTask({ status: "complete", result: saved.result });
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
    generationSession.current = null;
    setPreviewStep(undefined);
    setGenerationRecord(null);
    setProject(null);
    setTask(null);
    setProjectSave("unsaved");
    window.history.replaceState(null, "", "/");
    setLoadingProjects(true);
    listProjects()
      .then((saved) => {
        setProjects(saved);
        setListError("");
      })
      .catch(() =>
        setListError("无法读取已有项目，请检查浏览器存储权限或空间。"),
      )
      .finally(() => setLoadingProjects(false));
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
  useEffect(() => () => active.current?.abort(), []);
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

  async function generate(nextProject: Project) {
    if (active.current || adoptionPending.current) return;
    const controller = new AbortController();
    active.current = controller;
    setProject(nextProject);
    setRecords([]);
    discardChanges();
    setProjectSave("unsaved");
    setRestored(false);
    window.history.replaceState(null, "", "/");
    setTask({ status: "waiting" });
    setSeconds(0);
    const taskId = crypto.randomUUID();
    const record: InitialGeneration = { taskId, startedAt: new Date().toISOString(), assistantReply: null, events: [] };
    const session = { record, step: null as unknown as RecordStep, saved: false, projectId: nextProject.id, writes: Promise.resolve() };
    generationSession.current = session;
    setGenerationRecord({ ...record });
    setLogSaveError(false);
    const append = (event: InitialGeneration["events"][number]) => {
      record.events = [...record.events, event];
      if (generationSession.current === session) setGenerationRecord({ ...record });
      if (session.saved) {
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
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", "X-Atoms-Task-Id": taskId },
        body: JSON.stringify({ requirement: nextProject.requirement }),
        signal: controller.signal,
      });
      const { result: data, assistantReply } = await readGeneration(response, taskId, append);
      record.assistantReply = assistantReply;
      session.step("transport", "接收生成结果", "completed", "完整结果与正常传输终态已收到。");
      setTask({ status: "complete", result: data });
      setProjectSave("saving");
      const saved: SavedProject = {
        ...nextProject,
        title: nextProject.requirement.slice(0, 48),
        result: data,
        initialGeneration: record,
        updatedAt: new Date().toISOString(),
      };
      session.step("project-save", "保存项目与助手回复", "started", "写入本浏览器项目存储，等待事务提交。");
      try {
        await saveProject(saved);
        session.saved = true;
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
      session.step("transport", "接收生成结果", "failed", controller.signal.aborted ? "等待超时，本次请求已结束。" : error instanceof Error ? error.message : "连接失败，未取得完整结果。");
      setTask({
        status: "failed",
        error: controller.signal.aborted
          ? "等待超时，已结束本次请求。请稍后重新生成。"
          : error instanceof Error
            ? error.message
            : "网络连接失败，请重试。",
      });
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
    setModifying(true);
    setModificationError("");
    setAdoptionError("");
    setSeconds(0);
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement: project.requirement, modification: change, baseHtml: (candidate?.result ?? task.result).html, context: dialogue }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "修改未完成，请手动重新发起。");
      if (!result || typeof result.html !== "string" || typeof result.durationMs !== "number") throw new Error("修改结果不完整，请重新发起。");
      // Clone only a successfully read committed state. A failed read never becomes empty trial data.
      const record = candidate ? undefined : await loadApplicationData(project.id);
      const trial = candidate?.trial ?? { projectId: project.id, state: structuredClone(record?.state ?? null), hasData: !!record };
      setCandidate({ result, trial, revision: (candidate?.revision ?? 0) + 1 });
      setDialogue(items => [...items, change]);
      setModification("");
    } catch (error) {
      setModificationError(controller.signal.aborted ? "等待超时，已结束本次修改。已有应用与候选保留，可手动重新发起。" : error instanceof Error ? error.message : "修改失败，请重新发起。");
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
      const saved = await adoptCandidate(project.id, candidate.result, dialogue);
      setPreviewStep(undefined);
      setTask({ status: "complete", result: saved.result });
      setRecords(saved.modificationRecords ?? []);
      setProjects(items => [saved, ...items.filter(item => item.id !== saved.id)]);
      setRestored(false);
      // Remount with a fresh channel and official storage only after commit.
      discardChanges();
    } catch {
      setAdoptionError("采用保存失败。原先已保存的代码、修改记录和正式数据仍保留；当前候选尚未采用，请保留页面并检查浏览器存储权限或空间，再手动点击“采用修改”。");
    } finally {
      adoptionPending.current = false;
      setAdopting(false);
    }
  }

  return (
    <div className={project ? "app-shell workbench" : "app-shell"}>
      <header className="topbar">
        <button
          className="brand"
          disabled={busy}
          onClick={goHome}
          aria-label="Atoms 首页"
        >
          <span className="brand-mark" aria-hidden="true">
            a
          </span>
          atoms<span className="brand-tag">LAB</span>
        </button>
        <nav aria-label="主导航">
          {project ? <button className="text-button" disabled={busy} onClick={goHome}>← 新建项目 / 已有项目</button> : <a className="text-button" href="#projects">已有项目 ↗</a>}
        </nav>
        <span className="session-badge">无需注册 · 本浏览器保存</span>
      </header>
      {!project ? (
        <main className="home">
          <div className="home-create">
          <div className="home-intro">
            <p className="eyebrow">YOUR NEXT LITTLE APP</p>
            <h1>
              把想法，
              <br />
              变成<span>用得上的应用。</span>
            </h1>
            <p className="intro-copy">
              描述你需要的功能，AI 为你生成一个轻量应用。
              <br />
              生成后，直接在这里试一试。
            </p>
          </div>
          <form
            className="prompt-card"
            onSubmit={(event) => {
              event.preventDefault();
              if (requirement.trim())
                void generate({
                  id: crypto.randomUUID(),
                  requirement: requirement.trim(),
                });
            }}
          >
            <label htmlFor="requirement">你想做什么？</label>
            <textarea
              id="requirement"
              value={requirement}
              onChange={(event) => setRequirement(event.target.value)}
              maxLength={MAX_REQUIREMENT_LENGTH}
              placeholder="例如：一个帮我记录今天任务的待办清单，可以添加、完成和删除任务…"
              required
            />
            <div className="prompt-footer">
              <span>
                轻量前端应用
                <span className="character-count">
                  {requirement.length} / {MAX_REQUIREMENT_LENGTH}
                </span>
              </span>
              <button
                className="primary-button"
                disabled={!requirement.trim() || loadingProjects}
                type="submit"
              >
                开始生成 <span aria-hidden="true">↗</span>
              </button>
            </div>
          </form>
          <div className="examples">
            <span>从一个小想法开始</span>
            {examples.map((example) => (
              <button
                key={example.name}
                onClick={() => {
                  setRequirement(example.text);
                  document.getElementById("requirement")?.focus();
                }}
              >
                {example.name}
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
          <p className="scope-note">
            支持轻量前端应用。项目和应用数据自动保存在同一浏览器、同一网址（协议、主机和端口）下；请等待保存成功再离开。清除站点数据、无痕会话结束或浏览器回收存储后可能无法找回，不支持跨设备恢复。
          </p>
          </div>
          <section id="projects" className="project-list" aria-label="已有项目">
            <h2>已有项目</h2>
            {loadingProjects && <p role="status">正在读取已有项目…</p>}
            {listError && (
              <p className="save-error" role="alert">
                {listError}
              </p>
            )}
            {!loadingProjects && !listError && projects.length === 0 && (
              <p>还没有已保存的项目。生成一个应用后，会自动出现在这里。</p>
            )}
            {projects.map((saved) => (
              <button key={saved.id} onClick={() => openProject(saved)}>
                <span>{saved.title}</span>
                <small>
                  更新于 {new Date(saved.updatedAt).toLocaleString("zh-CN")} ·
                  打开项目 ↗
                </small>
              </button>
            ))}
          </section>
          <div className="home-bottom">
            <span>01 / 描述需求</span>
            <span>02 / 真实生成</span>
            <span>03 / 保存与重开</span>
          </div>
        </main>
      ) : (
        <main className="workspace">
          <aside className="project-panel">
            <div className="project-heading">
              <p className="eyebrow">项目工作台</p>
              <h1>{project.requirement.slice(0, 26)}{project.requirement.length > 26 ? "…" : ""}</h1>
              <p className={`unsaved ${projectSave === "failed" ? "save-error" : ""}`} role={projectSave === "failed" ? "alert" : "status"}>
                {projectSave === "saved" ? "项目已保存" : projectSave === "saving" ? "项目正在保存…" : projectSave === "failed" ? "项目保存失败，请保留页面并检查浏览器存储权限或空间；刷新会丢失当前结果。" : "项目尚未保存"}
              </p>
            </div>
            <div className="conversation-scroll" role="region" aria-label="项目对话与详情" tabIndex={0}>
              <section className={`task-state ${task?.status}`} aria-live="polite" aria-atomic="true">
                <div className="state-title">
                  <span className={initialBusy ? "spinner" : "state-symbol"} aria-hidden="true">{initialBusy ? "" : task?.status === "failed" ? "!" : "✓"}</span>
                  <h2>{initialBusy ? "正在生成应用" : task?.status === "failed" ? "生成未完成" : restored ? "已恢复保存的应用" : "代码已生成"}</h2>
                </div>
                {initialBusy && <><p>正在处理需求，实际进展见平台执行记录。完整结果保存后会展示预览。</p><p className="elapsed">已等待 {seconds} 秒 · 最多约 2 分钟</p></>}
                {task?.status === "failed" && <><p role="alert">{task.error}</p><button className="primary-button" onClick={() => void generate(project)}>重新生成</button></>}
                {task?.status === "complete" && <p>{restored ? "已读取保存的需求和代码，没有重新调用模型。" : "现在可以在预览中操作应用。生成完成不代表所有功能都已验证。"}</p>}
              </section>
              {generationRecord && <GenerationRecord record={generationRecord} live={!restored && task?.status !== "failed"} pending={task?.status === "waiting"} saveError={logSaveError} saving={logSavePending} />}
              {dialogue.length > 0 && <section className="current-dialogue">
                <h2>本轮对话 <span>最新在前</span></h2>
                <ol aria-label="本轮对话">{dialogue.map((change, index) => ({ change, index })).reverse().map(({ change, index }) => <li key={index}><small>第 {index + 1} 轮候选已生成 · 未采用</small><p>{change}</p></li>)}</ol>
              </section>}
              <section className="record-history" aria-label="已采用修改记录">
                <h2>最近修改结果</h2>
                {records.length === 0 ? <p>还没有已采用的修改记录。</p> : <>
                  <ol>{records.slice(-1).map(record => <li key={record.id}>
                    <small>{new Date(record.adoptedAt).toLocaleString("zh-CN")} · 已采用并保存</small>
                    {record.requests.map((request, index) => <p key={index}>{request}</p>)}<p>{record.summary}</p>
                  </li>)}</ol>
                  {records.length > 1 && <details><summary>较早修改记录（{records.length - 1}）</summary><ol>{records.slice(0, -1).reverse().map(record => <li key={record.id}>
                    <small>{new Date(record.adoptedAt).toLocaleString("zh-CN")} · 已采用并保存</small>
                    {record.requests.map((request, index) => <p key={index}>{request}</p>)}<p>{record.summary}</p>
                  </li>)}</ol></details>}
                </>}
              </section>
              <details className="requirement-block"><summary>原需求详情</summary><p>{project.requirement}</p></details>
              {task?.status === "complete" && <details className="generation-details"><summary>模型与耗时</summary>
                <dl><div><dt>模型</dt><dd>{(candidate?.result ?? task.result).model}</dd></div><div><dt>{candidate ? "最近候选耗时" : "生成耗时"}</dt><dd>{((candidate?.result ?? task.result).durationMs / 1000).toFixed(1)} 秒</dd></div></dl>
              </details>}
              <details className="storage-details"><summary>保存与恢复范围</summary><p>自动保存到本浏览器的当前网址。项目与应用数据分别显示保存结果，请等待保存成功再离开。清除站点数据、无痕会话结束或存储被回收后可能丢失，不支持跨设备找回。</p></details>
            </div>
            {task?.status === "complete" && projectSave === "saved" && <section className="modification-panel" aria-label="对话修改">
              <div className="modification-feedback" aria-live="polite">
                {modifying && <p role="status">正在基于{candidate ? "最新候选" : "已采用代码"}修改，已等待 {seconds} 秒，最多约 2 分钟。现有预览仍可使用。</p>}
                {modificationError && <p className="save-error" role="alert">{modificationError} 原应用与正式数据未被替换，可点击“生成候选”手动重试。</p>}
              </div>
              <form onSubmit={event => { event.preventDefault(); void modify(); }}>
                <label htmlFor="modification">追加修改需求</label>
                <textarea id="modification" value={modification} onChange={event => setModification(event.target.value)} maxLength={MAX_REQUIREMENT_LENGTH} disabled={busy} placeholder="例如：增加任务优先级与筛选" required />
                <div className="composer-footer"><span>{candidate ? "基于最新候选继续修改" : "基于已采用应用修改"}</span><button className="primary-button" disabled={busy || !modification.trim()} type="submit">{modifying ? "正在生成候选…" : "生成候选"}</button></div>
              </form>
              {!candidate && modificationError && <button className="text-button" disabled={busy} onClick={discardChanges}>放弃本轮修改</button>}
            </section>}
          </aside>
          {task?.status === "complete" && projectSave !== "saving" ? (
            <AppPreview
              key={project.id + task.result.generatedAt + (candidate ? `:trial:${candidate.revision}` : ":adopted")}
              html={(candidate?.result ?? task.result).html}
              recordStep={!candidate ? previewStep : undefined}
              trial={candidate?.trial}
              actions={candidate && <div className="candidate-actions" aria-label="候选操作">
                <div className="candidate-action-row"><strong>第 {candidate.revision} 轮候选 · 等待采用</strong><div>
                  <button className="text-button" disabled={busy} onClick={discardChanges}>放弃本轮修改</button>
                  <button className="primary-button" disabled={busy} onClick={() => void adopt()}>{adopting ? "正在保存采用…" : "采用修改"}</button>
                </div></div>
                <p>采用只保存代码与修改记录，试用数据不会写回正式数据。</p>
                <p>候选、试用数据和本轮对话仅在当前会话保留；放弃、离开项目、刷新或关闭后会丢失。</p>
                {adopting && <p role="status">正在保存代码与修改记录，完成前仍为未采用候选。请等待保存成功再离开。</p>}
                {adoptionError && <p className="save-error" role="alert">{adoptionError}</p>}
              </div>}
              projectId={project.id}
              projectSaved={projectSave === "saved"}
              onRetry={() => {
                if (candidate) document.getElementById("modification")?.focus();
                else if (!modifying) void generate({ ...project, id: crypto.randomUUID() });
              }}
            />
          ) : (
            <section className="preview-placeholder" aria-label="预览等待区">
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
            </section>
          )}
        </main>
      )}
    </div>
  );
}
