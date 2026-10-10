"use client";

import { useEffect, useRef, useState } from "react";
import { PreviewNavigation } from "@/components/workbench-controls";
import type { RecordStep } from "@/lib/execution";
import type { TrialData } from "@/lib/trial-data";
import { previewDocument } from "@/lib/preview-document";
import { loadApplicationData, saveApplicationData } from "@/lib/project-store";

export function AppPreview({
  html,
  projectId,
  projectSaved,
  onRetry,
  trial,
  recordStep,
  readOnly = false,
  readOnlyState = null,
}: {
  html: string;
  projectId: string;
  projectSaved: boolean;
  onRetry: () => void;
  trial?: TrialData;
  recordStep?: RecordStep;
  readOnly?: boolean;
  readOnlyState?: unknown;
}) {
  // Keep event callbacks fresh without remounting the document on log updates.
  const recorder = useRef(recordStep);
  useEffect(() => { recorder.current = recordStep; }, [recordStep]);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [document, setDocument] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [storage, setStorage] = useState("等待应用读取数据");
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    const channel = crypto.randomUUID();
    let disposed = false;
    let queue = Promise.resolve();
    let pending = 0;
    let readSucceeded = false;
    const fail = (message: string) => {
      if (disposed) return;
      setStorageError(true);
      setStorage(message);
    };
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        message?.channel !== channel
      )
        return;
      if (message.type === "atoms:preview-error") {
        recorder.current?.("preview-runtime", "预览运行错误", "failed", "预览报告脚本异常；未将模型说明作为运行检查依据。");
        return setFailed(true);
      }
      if (message.type === "atoms:storage-error")
        return fail(
          "应用数据保存或读取失败，请保留页面；刷新可能丢失未保存的修改。",
        );
      if (
        message.type !== "atoms:state" ||
        !Number.isSafeInteger(message.id) ||
        !["load", "save"].includes(message.method)
      )
        return;
      const source = frame.current!.contentWindow!;
      pending++;
      setStorage(
        message.method === "save"
          ? trial ? "试用数据正在更新…" : "应用数据正在保存…暂时无法编辑，完成后可继续"
          : "正在读取应用数据…",
      );
      setStorageError(false);
      // Serialize calls so rapid changes cannot overwrite newer state with older state.
      const recordOperation = recorder.current;
      queue = queue.then(async () => {
        if (disposed) return;
        const stepId = `data-${channel}-${message.id}`;
        const label = trial ? (message.method === "load" ? "读取试用数据" : "更新试用数据") : (message.method === "load" ? "读取应用数据" : "保存应用数据");
        recordOperation?.(stepId, label, "started", trial ? "访问本轮会话的试用副本，不写入正式数据。" : "通过平台接口访问本项目的正式业务数据。");
        try {
          if (trial && trial.projectId !== projectId)
            throw new Error("试用数据与项目不匹配，已阻止读写。");
          if (readOnly && message.method === "save") throw new Error("示例为只读，请先保存个人副本。");
          if (!readOnly && !projectSaved)
            throw new Error(
              "项目尚未保存，应用数据无法保存。请保留页面并检查浏览器存储权限或空间。",
            );
          let state: unknown;
          let hasData = false;
          if (message.method === "load") {
            const record = readOnly ? { state: structuredClone(readOnlyState) } : trial
              ? (trial.hasData ? { state: structuredClone(trial.state) } : undefined)
              : await loadApplicationData(projectId);
            state = record?.state ?? null;
            hasData = !!record;
            readSucceeded = true;
          } else {
            if (!readSucceeded)
              throw new Error(
                "应用尚未成功读取数据，已阻止覆盖保存。请保留页面并检查浏览器存储。",
              );
            const json = JSON.stringify(message.state);
            if (json === undefined || json.length > 1_000_000)
              throw new Error(
                "应用数据保存失败：仅支持不超过 1 MB 的 JSON 状态，请减少数据量。",
              );
            if (trial) {
              trial.state = JSON.parse(json);
              trial.hasData = true;
            } else {
              await saveApplicationData(projectId, JSON.parse(json));
            }
            hasData = true;
          }
          recordOperation?.(stepId, label, "completed", message.method === "load" ? "读取已完成；未复制业务数据到执行记录。" : trial ? "试用副本已更新，未写入正式数据。" : "正式业务数据事务已提交。");
          if (disposed) return;
          pending--;
          source.postMessage(
            {
              type: "atoms:state-result",
              channel,
              id: message.id,
              ok: true,
              state,
            },
            "*",
          );
          if (!pending) {
            setStorageError(false);
            setStorage(
              readOnly ? "只读示例 · 未创建个人项目" : trial
                ? "试用数据已更新 · 仅本轮会话有效，未写入正式数据"
                : hasData ? "应用数据已保存" : "应用数据已读取 · 尚无已保存数据",
            );
          }
        } catch (error) {
          pending--;
          const detail =
            error instanceof Error && !error.message.startsWith("浏览器")
              ? error.message
              : "应用数据保存或读取失败，请保留页面并检查浏览器存储权限或空间；刷新可能丢失未保存的修改。";
          recordOperation?.(stepId, label, "failed", detail);
          fail(detail);
          if (!disposed)
            source.postMessage(
              {
                type: "atoms:state-result",
                channel,
                id: message.id,
                ok: false,
                error: detail,
              },
              "*",
            );
        }
      });
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("message", receive);
    window.addEventListener("beforeunload", beforeUnload);
    // Mount only after the listener exists: a generated script may load state immediately.
    recorder.current?.("preview-assemble", "装配隔离预览", "started", "向结构合格的完整 HTML 注入平台数据接口与隔离策略。");
    try {
      setDocument(previewDocument(html, channel, window.location.origin, readOnly));
      recorder.current?.("preview-assemble", "装配隔离预览", "completed", "完整预览文档已装配；未验证业务功能。");
      recorder.current?.("preview-load", "载入隔离预览", "started", "将完整文档载入 sandbox iframe。");
      loadTimer.current = setTimeout(() => {
        if (disposed) return;
        setFailed(true);
        recorder.current?.("preview-load", "载入隔离预览", "failed", "15 秒内未观察到 iframe 载入完成，请检查预览或重新生成。");
      }, 15_000);
    } catch {
      recorder.current?.("preview-assemble", "装配隔离预览", "failed", "HTML 结构无法装配，未运行预览。");
      setDocument("");
      setFailed(true);
      fail("应用 HTML 结构不完整，无法装配预览；请重新生成。");
    }
    return () => {
      disposed = true;
      if (loadTimer.current) clearTimeout(loadTimer.current);
      window.removeEventListener("message", receive);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [html, projectId, projectSaved, trial, readOnly, readOnlyState]);

  return (
    <section className="preview-panel" aria-label="应用预览">
      <PreviewNavigation />
      <div className="preview-toolbar">
        <span>
          <span className="status-dot" />
          {readOnly ? "示例预览 · 只读" : trial ? "候选试用 · 未采用" : "运行预览 · 已采用应用"}
        </span>
        <span>{loaded ? readOnly ? "预览已加载" : "预览已加载 · 请实际操作检查" : "正在加载预览"}</span>
      </div>
      <p
        className={`data-status ${storageError ? "save-error" : ""}`}
        role={storageError ? "alert" : "status"}
      >
        {storage}
      </p>
      {failed && (
        <div className="preview-error" role="alert">
          预览出现运行错误，部分功能可能不可用。
          <button onClick={onRetry}>{readOnly ? "重新读取示例" : trial ? "修改需求后重新发起" : "重新生成"}</button>
        </div>
      )}
      {document && (
        <iframe
          ref={frame}
          tabIndex={readOnly ? -1 : undefined}
          title="生成的应用"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={document}
          onLoad={() => {
            if (loadTimer.current) clearTimeout(loadTimer.current);
            setLoaded(true);
            recorder.current?.("preview-load", "载入隔离预览", "completed", "已观察到 iframe load 事件；请实际操作验证业务功能。");
          }}
        />
      )}
    </section>
  );
}
