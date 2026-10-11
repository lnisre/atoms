import type { ReactNode } from "react";
import { ConversationScroll } from "./conversation-scroll";

// Shared presentation; permissions and save/generation state stay with callers.
export function ProjectWorkbenchLayout({ title, navigation, account, scope, conversation, controls, children }: {
  title: ReactNode; navigation: ReactNode; account: ReactNode; scope: ReactNode;
  conversation: ReactNode; controls: ReactNode; children: ReactNode;
}) {
  return <main className="cloud-project">
    <header>{navigation}<h1>{title}</h1>{account}</header>
    <p className="cloud-scope">{scope}</p>
    <div className="cloud-project-content">
      <section className="cloud-project-history" aria-label="项目说明与记录">
        <ConversationScroll>{conversation}</ConversationScroll>
        {controls}
      </section>
      {children}
    </div>
  </main>;
}
