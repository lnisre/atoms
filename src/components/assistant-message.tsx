import type { ReactNode } from "react";

// The same conversation layout serves real generations and clearly labelled
// example content. This component makes no claims about execution or provenance.
export function AssistantMessage({ title, requirement, requirementLabel = "你", children }: {
  title: string;
  requirement?: string;
  requirementLabel?: string;
  children: ReactNode;
}) {
  return <section className="generation-record" aria-label={`${title}记录`}>
    {requirement && <div className="user-message"><span>{requirementLabel}</span><p>{requirement}</p></div>}
    <div className="assistant-heading"><span className="assistant-mark" aria-hidden="true">✳</span><h2>助手 <span>{title}</span></h2></div>
    <div className="assistant-content">{children}</div>
  </section>;
}
