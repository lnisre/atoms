"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSourceReadingState } from "./source-reading-state";
import styles from "./source-browser.module.css";

// A read-only presentation boundary, independent of generation and persistence.
// Paths are unique project-relative paths; entryPath names one of the files.
export type SourceVersion = {
  id: string;
  entryPath: string;
  files: readonly { path: string; text: string }[];
};

type Directory = { name: string; path: string; directories: Map<string, Directory>; files: string[] };

function directoryTree(files: SourceVersion["files"]) {
  const root: Directory = { name: "", path: "", directories: new Map(), files: [] };
  for (const file of files) {
    const segments = file.path.split("/");
    let parent = root;
    for (const name of segments.slice(0, -1)) {
      const path = parent.path ? `${parent.path}/${name}` : name;
      if (!parent.directories.has(name)) parent.directories.set(name, { name, path, directories: new Map(), files: [] });
      parent = parent.directories.get(name)!;
    }
    parent.files.push(file.path);
  }
  return root;
}

export function SourceBrowser({ version }: { version: SourceVersion }) {
  const { selected, selectedPath, expanded, notice, source, rememberPosition, selectFile, toggleDirectory } = useSourceReadingState(version);
  const [treeOpen, setTreeOpen] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const treeId = useId();
  const tree = useMemo(() => directoryTree(version.files), [version.files]);

  useEffect(() => {
    let wasNarrow = false;
    const observer = new ResizeObserver(([entry]) => {
      const narrow = entry.contentRect.width <= 620;
      if (narrow && !wasNarrow) setTreeOpen(false);
      wasNarrow = narrow;
    });
    observer.observe(root.current!);
    return () => observer.disconnect();
  }, []);

  function renderDirectory(directory: Directory) {
    return <ul>
      {[...directory.directories.values()].sort((a, b) => a.name.localeCompare(b.name)).map(child => <li key={child.path}>
        <button type="button" aria-label={`目录 ${child.path}`} aria-expanded={expanded.has(child.path)} aria-controls={`${treeId}-${encodeURIComponent(child.path)}`} onClick={() => toggleDirectory(child.path)}>
          <span className={styles.chevron} aria-hidden="true">{expanded.has(child.path) ? "⌄" : "›"}</span><span>{child.name}</span>
        </button>
        <div id={`${treeId}-${encodeURIComponent(child.path)}`} hidden={!expanded.has(child.path)}>{renderDirectory(child)}</div>
      </li>)}
      {[...directory.files].sort().map(path => <li key={path}>
        <button type="button" aria-label={path} title={path} aria-current={path === selectedPath ? "true" : undefined} onClick={() => selectFile(path)}>
          <span className={styles.fileIcon} aria-hidden="true">▤</span><span>{path.split("/").at(-1)}</span>
        </button>
      </li>)}
    </ul>;
  }

  return <div ref={root} className={styles.browser}>
    <div className={styles.filebar}>
      <button type="button" aria-expanded={treeOpen} aria-controls={treeId} onClick={() => setTreeOpen(open => !open)}>{treeOpen ? "收起目录" : "展开目录"}</button>
      <span className={styles.path} aria-label="当前文件路径">{selected.path}</span>
      <span className={styles.readonly}>只读</span>
    </div>
    {notice && <p className={styles.update} role="status" key={version.id}>{notice}</p>}
    <div className={styles.body}>
      <nav id={treeId} className={styles.directory} aria-label="项目文件" hidden={!treeOpen}>
        <div className={styles.directoryTitle}>文件 <span>{version.files.length}</span></div>
        {renderDirectory(tree)}
      </nav>
      <div className={styles.content}>
        {selected.text === "" && <p className={styles.empty} role="status">空文本文件</p>}
        <pre ref={source} onScroll={rememberPosition} className={styles.source} tabIndex={0} role="region" aria-label={`源码 ${selected.path}`}><code>{selected.text}</code></pre>
      </div>
    </div>
  </div>;
}
