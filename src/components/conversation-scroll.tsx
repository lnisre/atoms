"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Presentation only: never owns generation, input, candidate, or preview state.
export function ConversationScroll({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastTop = useRef(0);
  const geometry = useRef({ height: 0, viewport: 0 });
  const [away, setAway] = useState(false);
  useEffect(() => {
    const pane = viewport.current!;
    const observer = new ResizeObserver(() => {
      if (following.current) pane.scrollTop = pane.scrollHeight;
      lastTop.current = pane.scrollTop;
      geometry.current = { height: pane.scrollHeight, viewport: pane.clientHeight };
    });
    observer.observe(content.current!);
    observer.observe(pane);
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
        const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 24;
        // Layout changes can fire scroll before ResizeObserver, including when
        // the composer changes height. Only movement in unchanged geometry
        // interrupts following; native wheel/key intent is handled immediately.
        const resized = geometry.current.height !== pane.scrollHeight || geometry.current.viewport !== pane.clientHeight;
        if (atBottom) following.current = true;
        else if (!resized && pane.scrollTop < lastTop.current - 1) following.current = false;
        geometry.current = { height: pane.scrollHeight, viewport: pane.clientHeight };
        lastTop.current = pane.scrollTop;
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
