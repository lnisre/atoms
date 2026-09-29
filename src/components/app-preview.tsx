"use client";

import { useEffect, useRef, useState } from "react";
import { previewDocument } from "@/lib/preview-document";
import { loadApplicationData, saveApplicationData } from "@/lib/project-store";

export function AppPreview({
  html,
  projectId,
  projectSaved,
  onRetry,
}: {
  html: string;
  projectId: string;
  projectSaved: boolean;
  onRetry: () => void;
}) {
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
      if (message.type === "atoms:preview-error") return setFailed(true);
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
          ? "应用数据正在保存…暂时无法编辑，完成后可继续"
          : "正在读取应用数据…",
      );
      setStorageError(false);
      // Serialize calls so rapid changes cannot overwrite newer state with older state.
      queue = queue.then(async () => {
        if (disposed) return;
        try {
          if (!projectSaved)
            throw new Error(
              "项目尚未保存，应用数据无法保存。请保留页面并检查浏览器存储权限或空间。",
            );
          let state: unknown;
          let hasData = false;
          if (message.method === "load") {
            const record = await loadApplicationData(projectId);
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
            await saveApplicationData(projectId, JSON.parse(json));
            hasData = true;
          }
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
              hasData ? "应用数据已保存" : "应用数据已读取 · 尚无已保存数据",
            );
          }
        } catch (error) {
          pending--;
          const detail =
            error instanceof Error && !error.message.startsWith("浏览器")
              ? error.message
              : "应用数据保存或读取失败，请保留页面并检查浏览器存储权限或空间；刷新可能丢失未保存的修改。";
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
    setDocument(previewDocument(html, channel, window.location.origin));
    return () => {
      disposed = true;
      window.removeEventListener("message", receive);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [html, projectId, projectSaved]);

  return (
    <section className="preview-panel" aria-label="应用预览">
      <div className="preview-toolbar">
        <span>
          <span className="status-dot" />
          运行预览
        </span>
        <span>{loaded ? "预览已加载 · 请实际操作检查" : "正在加载预览"}</span>
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
          <button onClick={onRetry}>重新生成</button>
        </div>
      )}
      {document && (
        <iframe
          ref={frame}
          title="生成的应用"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={document}
          onLoad={() => setLoaded(true)}
        />
      )}
    </section>
  );
}
