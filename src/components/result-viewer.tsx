"use client";

import { useId, useState, type ReactNode } from "react";
import { SourceBrowser, type SourceVersion } from "./source-browser";
import styles from "./result-viewer.module.css";

export function ResultViewer({ version, children, actions, notice, status }: {
  version?: SourceVersion;
  children: ReactNode;
  actions?: ReactNode;
  notice?: string;
  status?: string;
}) {
  const [view, setView] = useState<"preview" | "code">("preview");
  const [openedCode, setOpenedCode] = useState(false);
  const id = useId();
  const showingCode = view === "code" && !!version;
  return <section className={styles.panel} aria-label="项目成果">
    <div className={styles.toolbar}>
      <div className={styles.switcher} role="group" aria-label="成果视图">
        <button type="button" aria-pressed={!showingCode} aria-controls={`${id}-preview`} onClick={() => setView("preview")}>预览</button>
        <button type="button" aria-pressed={showingCode} aria-controls={`${id}-code`} disabled={!version} aria-describedby={!version ? `${id}-reason` : undefined} onClick={() => { setOpenedCode(true); setView("code"); }}>查看代码</button>
      </div>
      {version ? <span className={styles.status}>{status}</span> : <span className={styles.status} id={`${id}-reason`}>尚无完整成果，代码暂不可查看</span>}
    </div>
    {actions}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    <div className={styles.panes}>
      {/* Visibility preserves the running iframe, its geometry and bridge. Inert
          removes the hidden view from focus without pausing its application. */}
      <div id={`${id}-preview`} className={styles.pane} data-active={!showingCode} inert={showingCode} aria-hidden={showingCode}>{children}</div>
      <div id={`${id}-code`} className={styles.pane} data-active={showingCode} inert={!showingCode} aria-hidden={!showingCode}>
        {openedCode && version && <SourceBrowser version={version} />}
      </div>
    </div>
  </section>;
}
