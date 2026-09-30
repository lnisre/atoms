"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Presentation only: never owns generation, input, candidate, or preview state.
export function ConversationScroll({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const pane = viewport.current!;
    const observer = new ResizeObserver(() => {
      if (following.current) pane.scrollTop = pane.scrollHeight;
    });
    observer.observe(content.current!);
    return () => observer.disconnect();
  }, []);
  function pause() { following.current = false; setAway(true); }
  return <div className="conversation-container">
    <div ref={viewport} className="conversation-scroll" role="region" aria-label="项目对话与详情" tabIndex={0}
      onWheel={event => { if (event.deltaY < 0) pause(); }}
      onKeyDown={event => { if (["PageUp", "Home", "ArrowUp"].includes(event.key)) pause(); }}
      onClickCapture={event => { if ((event.target as HTMLElement).closest("summary")) pause(); }}
      onScroll={() => {
        const pane = viewport.current!;
        following.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 24;
        setAway(!following.current);
      }}>
      <div ref={content} className="conversation-content">{children}</div>
    </div>
    {away && <button type="button" className="latest-message" onClick={() => {
      following.current = true;
      viewport.current!.scrollTop = viewport.current!.scrollHeight;
      setAway(false);
    }}>回到最新消息 ↓</button>}
  </div>;
}
