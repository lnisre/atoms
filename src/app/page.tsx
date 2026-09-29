"use client";

import { useEffect, useRef, useState } from "react";
import { AppPreview } from "@/components/app-preview";
import {
  CLIENT_TIMEOUT_MS,
  MAX_REQUIREMENT_LENGTH,
  type GenerationResult,
} from "@/lib/generation";

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
  const [requirement, setRequirement] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [seconds, setSeconds] = useState(0);
  const active = useRef<AbortController | null>(null);
  const busy = task?.status === "waiting";

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

  async function generate(nextProject: Project) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setProject(nextProject);
    setTask({ status: "waiting" });
    setSeconds(0);
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement: nextProject.requirement }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(data?.error || "生成服务未能完成请求，请稍后重试。");
      if (
        !data ||
        typeof data.html !== "string" ||
        typeof data.durationMs !== "number"
      )
        throw new Error("生成结果不完整，请重新发起。");
      setTask({ status: "complete", result: data });
    } catch (error) {
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

  return (
    <div className={project ? "app-shell workbench" : "app-shell"}>
      <header className="topbar">
        <button
          className="brand"
          disabled={busy}
          onClick={() => {
            if (
              !project ||
              window.confirm("返回首页会清除尚未保存的项目，是否继续？")
            ) {
              setProject(null);
              setTask(null);
            }
          }}
          aria-label="Atoms 首页"
        >
          <span className="brand-mark" aria-hidden="true">
            a
          </span>
          atoms<span className="brand-tag">LAB</span>
        </button>
        <span className="topbar-note">从一个想法，到一个可用的应用</span>
        <span className="session-badge">无需注册 · 当前会话</span>
      </header>
      {!project ? (
        <main className="home">
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
                disabled={!requirement.trim()}
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
            支持无需后端的交互小工具。当前版本尚未保存项目和应用数据，刷新或离开后会丢失。
          </p>
          <div className="home-bottom">
            <span>01 / 描述需求</span>
            <span>02 / 真实生成</span>
            <span>03 / 操作预览</span>
          </div>
        </main>
      ) : (
        <main className="workspace">
          <aside className="project-panel">
            <div className="project-heading">
              <p className="eyebrow">项目工作台</p>
              <h1>
                {project.requirement.slice(0, 26)}
                {project.requirement.length > 26 ? "…" : ""}
              </h1>
              <p className="unsaved">尚未保存 · 刷新或离开后会丢失</p>
            </div>
            <section className="requirement-block">
              <h2>你的需求</h2>
              <p>{project.requirement}</p>
            </section>
            <section
              className={`task-state ${task?.status}`}
              aria-live="polite"
              aria-atomic="true"
            >
              <div className="state-title">
                <span
                  className={busy ? "spinner" : "state-symbol"}
                  aria-hidden="true"
                >
                  {busy ? "" : task?.status === "failed" ? "!" : "✓"}
                </span>
                <h2>
                  {busy
                    ? "正在生成应用"
                    : task?.status === "failed"
                      ? "生成未完成"
                      : "代码已生成"}
                </h2>
              </div>
              {busy && (
                <>
                  <p>
                    已提交模型服务，正在等待完整结果。此时可以保留页面，生成完成后会自动展示预览。
                  </p>
                  <p className="elapsed">
                    已等待 {seconds} 秒<span>最多等待约 2 分钟</span>
                  </p>
                </>
              )}
              {task?.status === "failed" && (
                <>
                  <p role="alert">{task.error}</p>
                  <button
                    className="primary-button"
                    onClick={() => void generate(project)}
                  >
                    重新生成
                  </button>
                </>
              )}
              {task?.status === "complete" && (
                <>
                  <p>
                    现在可以在预览中操作应用。生成完成不代表所有功能都已验证。
                  </p>
                  <dl>
                    <div>
                      <dt>模型</dt>
                      <dd>{task.result.model}</dd>
                    </div>
                    <div>
                      <dt>生成耗时</dt>
                      <dd>{(task.result.durationMs / 1000).toFixed(1)} 秒</dd>
                    </div>
                  </dl>
                </>
              )}
            </section>
            <div className="project-footnote">
              <p>
                本次项目和应用数据仅保留在当前页面。保存与恢复将在后续版本提供。
              </p>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "当前项目尚未保存。新建项目会清除当前结果，是否继续？",
                    )
                  ) {
                    setProject(null);
                    setTask(null);
                  }
                }}
              >
                ＋ 新建项目
              </button>
            </div>
          </aside>
          {task?.status === "complete" ? (
            <AppPreview
              key={task.result.generatedAt}
              html={task.result.html}
              onRetry={() => void generate(project)}
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
