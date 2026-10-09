"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { findSourceMatches, highlightSource, type SourceLine, type SourceMatch } from "../lib/source-code";
import styles from "./source-browser.module.css";

function renderLines(lines: SourceLine[], matches: SourceMatch[], active: number) {
  let matchIndex = 0;
  return lines.map((line, index) => <Fragment key={index}>
    <span className={styles.line} data-line={index + 1}>{line.tokens.map(token => {
      const pieces: ReactNode[] = [];
      let offset = token.start;
      const end = offset + token.text.length;
      while (offset < end) {
        while (matches[matchIndex] && matches[matchIndex].end <= offset) matchIndex++;
        const match = matches[matchIndex];
        const inside = match && match.start <= offset;
        const next = Math.min(end, inside ? match.end : (match?.start ?? end));
        const text = token.text.slice(offset - token.start, next - token.start);
        pieces.push(inside
          ? <mark key={offset} data-match={matchIndex} data-active={matchIndex === active}>{text}</mark>
          : text);
        offset = next;
      }
      return <span key={token.start} className={token.classes || undefined}>{pieces}</span>;
    })}</span>{line.ending}
  </Fragment>);
}

// Remounted for the full path + version identity by SourceBrowser. A pending
// clipboard result can only update the file that initiated it.
export function SourceFile({ path, text, query, onQueryChange, sourceRef, onScroll, revealMatchOnMount }: {
  path: string;
  text: string;
  query: string;
  onQueryChange: (query: string) => void;
  sourceRef: RefObject<HTMLPreElement | null>;
  onScroll: () => void;
  revealMatchOnMount: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const [selection, setSelection] = useState({ query, index: 0, move: revealMatchOnMount ? 1 : 0 });
  const [copyState, setCopyState] = useState<"idle" | "pending" | "success" | "error">("idle");
  const lines = useMemo(() => highlightSource(path, text), [path, text]);
  const matches = useMemo(() => findSourceMatches(text, query), [text, query]);
  const active = selection.query === query ? Math.min(selection.index, Math.max(0, matches.length - 1)) : 0;
  const rendered = useMemo(() => renderLines(lines, matches, active), [lines, matches, active]);

  useEffect(() => {
    // A same-path version update restores the reading position. Recalculate
    // matches without jumping until the reader searches or navigates again.
    if (selection.move === 0) return;
    const container = sourceRef.current;
    const match = container?.querySelector<HTMLElement>(`mark[data-match="${active}"]`);
    if (!container || !match) return;
    const bounds = container.getBoundingClientRect(), target = match.getBoundingClientRect();
    // Scroll only the source region; focusing search must not move the workbench.
    container.scrollTo({
      top: target.top < bounds.top || target.bottom > bounds.bottom
        ? container.scrollTop + target.top - bounds.top - container.clientHeight / 2 : container.scrollTop,
      left: target.left < bounds.left + 60 || target.right > bounds.right
        ? Math.max(0, container.scrollLeft + target.left - bounds.left - container.clientWidth / 2) : container.scrollLeft,
    });
  }, [matches, active, selection.move, sourceRef]);

  function moveMatch(direction: number) {
    if (!matches.length) return;
    setSelection(current => ({ query, index: (active + direction + matches.length) % matches.length, move: current.move + 1 }));
  }

  function changeQuery(next: string) {
    setSelection({ query: next, index: 0, move: 1 });
    onQueryChange(next);
  }

  async function copyFile() {
    setCopyState("pending");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setCopyState("success");
    } catch {
      setCopyState("error");
    }
  }

  return <div className={styles.content} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault(); input.current?.focus(); input.current?.select();
    }
  }}>
    <div className={styles.readTools}>
      <label className={styles.search}>
        <span>当前文件</span>
        <input ref={input} type="search" aria-label="在当前文件中搜索" aria-describedby={`${searchId}-help ${searchId}-count`} placeholder="查找文本" value={query} onChange={event => changeQuery(event.target.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1); }
          if (event.key === "Escape") { event.preventDefault(); changeQuery(""); }
        }} />
      </label>
      <div className={styles.matchControls}>
        <output id={`${searchId}-count`} aria-live="polite" aria-label="当前文件搜索结果">{query ? (matches.length ? `${active + 1} / ${matches.length}` : "无匹配") : "输入文本查找"}</output>
        <button type="button" aria-label="上一处匹配" title="上一处匹配（Shift+Enter）" disabled={!matches.length} onClick={() => moveMatch(-1)}>↑</button>
        <button type="button" aria-label="下一处匹配" title="下一处匹配（Enter）" disabled={!matches.length} onClick={() => moveMatch(1)}>↓</button>
      </div>
      <button type="button" className={styles.copy} disabled={copyState === "pending"} onClick={copyFile}>{copyState === "pending" ? "复制中…" : "复制当前文件"}</button>
      <span id={`${searchId}-help`} className={styles.searchHelp}>不区分大小写 · Enter 下一处 · Shift+Enter 上一处</span>
    </div>
    {copyState === "success" && <p className={styles.copyFeedback} role="status">已复制当前文件的完整源码</p>}
    {copyState === "error" && <p className={styles.copyFeedback} role="alert">复制失败：无法写入剪贴板，请选中下方源码后手动复制。</p>}
    {text === "" && <p className={styles.empty} role="status">空文本文件</p>}
    <pre ref={sourceRef} onScroll={onScroll} className={styles.source} tabIndex={0} role="region" aria-label={`源码 ${path}`}><code>{rendered}</code></pre>
  </div>;
}
