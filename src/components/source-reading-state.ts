import { useLayoutEffect, useRef, useState } from "react";
import type { SourceVersion } from "./source-browser";

function parentPaths(path: string) {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

// Owned by one open project, not one code version. No persisted preferences.
export function useSourceReadingState(version: SourceVersion) {
  const [reading, setReading] = useState(() => ({
    versionId: version.id,
    selectedPath: version.entryPath,
    expanded: new Set(parentPaths(version.entryPath)),
    notice: "",
  }));
  const source = useRef<HTMLPreElement>(null);
  const positions = useRef(new Map<string, { top: number; left: number }>());

  if (reading.versionId !== version.id) {
    const removed = !version.files.some(file => file.path === reading.selectedPath);
    const directories = new Set(version.files.flatMap(file => parentPaths(file.path)));
    const expanded = new Set([...reading.expanded].filter(path => directories.has(path)));
    if (removed) for (const path of parentPaths(version.entryPath)) expanded.add(path);
    // Reconcile before committing: never render a removed file or old content
    // underneath the new version's status and preview.
    setReading({
      versionId: version.id,
      selectedPath: removed ? version.entryPath : reading.selectedPath,
      expanded,
      notice: removed
        ? `源码已更新。文件“${reading.selectedPath}”已从此版本移除，已打开入口文件“${version.entryPath}”。`
        : "源码已更新至当前展示版本。",
    });
  }

  const selected = version.files.find(file => file.path === reading.selectedPath)
    ?? version.files.find(file => file.path === version.entryPath)!;
  const selectedPath = selected.path;

  useLayoutEffect(() => {
    const paths = new Set(version.files.map(file => file.path));
    for (const path of positions.current.keys()) if (!paths.has(path)) positions.current.delete(path);
    const position = positions.current.get(selectedPath);
    const element = source.current!;
    // Native scrolling clamps both axes to the new content's valid range.
    element.scrollTo({ top: position?.top ?? 0, left: position?.left ?? 0 });
    positions.current.set(selectedPath, { top: element.scrollTop, left: element.scrollLeft });
  }, [selectedPath, version.id, version.files]);

  function rememberPosition() {
    const element = source.current!;
    positions.current.set(selectedPath, { top: element.scrollTop, left: element.scrollLeft });
  }

  function selectFile(path: string) {
    rememberPosition();
    setReading(current => ({ ...current, selectedPath: path }));
  }

  function toggleDirectory(path: string) {
    setReading(current => {
      const expanded = new Set(current.expanded);
      if (expanded.has(path)) expanded.delete(path); else expanded.add(path);
      return { ...current, expanded };
    });
  }

  return { selected, selectedPath, expanded: reading.expanded, notice: reading.notice, source, rememberPosition, selectFile, toggleDirectory };
}
