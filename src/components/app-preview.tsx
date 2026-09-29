"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export function AppPreview({
  html,
  onRetry,
}: {
  html: string;
  onRetry: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const document = useMemo(() => {
    // Put the policy and error listener before any model-produced script.
    const guard = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><script>addEventListener('error',()=>parent.postMessage({type:'atoms:preview-error'},'*'));addEventListener('unhandledrejection',()=>parent.postMessage({type:'atoms:preview-error'},'*'));</script>`;
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + guard);
  }, [html]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source === frame.current?.contentWindow &&
        event.data?.type === "atoms:preview-error"
      )
        setFailed(true);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  return (
    <section className="preview-panel" aria-label="应用预览">
      <div className="preview-toolbar">
        <span>
          <span className="status-dot" />
          运行预览
        </span>
        <span>{loaded ? "预览已加载 · 请实际操作检查" : "正在加载预览"}</span>
      </div>
      {failed && (
        <div className="preview-error" role="alert">
          预览出现运行错误，部分功能可能不可用。
          <button onClick={onRetry}>重新生成</button>
        </div>
      )}
      <iframe
        ref={frame}
        title="生成的应用"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={document}
        onLoad={() => setLoaded(true)}
      />
    </section>
  );
}
