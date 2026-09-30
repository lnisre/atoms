import type { ReactNode } from "react";

export function Unavailable({ children, label }: { children: ReactNode; label: string }) {
  return <button type="button" className="unavailable" disabled title={`${label}：当前未提供`} aria-label={`${label}（当前未提供）`}>{children}</button>;
}

export function WorkspaceTools() {
  return <div className="workspace-tools" aria-label="工作区工具">
    <span className="viewer-tab">▣ 应用查看器</span>
    <Unavailable label="工作流">⌘</Unavailable>
    <Unavailable label="终端">▹_</Unavailable>
    <Unavailable label="Cloud">☁</Unavailable>
    <Unavailable label="文件">▱</Unavailable>
    <Unavailable label="分析">⌁</Unavailable>
    <Unavailable label="更多工具">···</Unavailable>
    <span className="tools-spacer" />
    <Unavailable label="分享">分享</Unavailable>
    <Unavailable label="升级">升级</Unavailable>
    <Unavailable label="发布">发布</Unavailable>
  </div>;
}

export function PreviewNavigation() {
  return <div className="preview-navigation" aria-label="预览工具">
    <Unavailable label="设备切换">▣</Unavailable>
    <Unavailable label="刷新预览">↻</Unavailable>
    <Unavailable label="预览首页">⌂</Unavailable>
    <span className="preview-address">当前应用</span>
    <Unavailable label="新窗口打开">↗</Unavailable>
    <Unavailable label="控制台">‹› 控制台</Unavailable>
  </div>;
}

export function AtomsMark() {
  return <svg width="24" height="26" viewBox="0 0 28 30" fill="currentColor" aria-hidden="true"><path d="M16 2C8 0 0 10 3 18c6 3 14-5 13-16ZM19 5c-2 5 0 11 6 12 3-5 0-10-6-12ZM16 19c-5 1-7 4-5 8 7 3 12-1 12-6-2-2-4-3-7-2ZM3 23c0 4 3 6 6 5l-1-5Z"/></svg>;
}
