import { parse as parseHtml, type DefaultTreeAdapterTypes } from "parse5";
import { parse as parseScript, type Node } from "acorn";
import { previewHeadOffset } from "../html-document";
import type { TeamRecord } from "./contract";
import { unresolvedDataIssues } from "./review";
export type PreviewPolicy = { status: "allowed" | "blocked"; reasons: string[]; dataMode: "formal" | "trial"; adoption: "allowed" | "blocked"; review: "clean" | "issues" | "unavailable" };
// A deliberately narrow, deterministic execution rule, not a general JS safety proof.
// Only a first executable, unconditional top-level empty loop is rejected. Text/comments/functions
// and loops with a possible exit are not treated as proven nontermination.
export function executionBlockers(html: string): string[] {
  if (previewHeadOffset(html) === null) return ["HTML 结构不完整，无法在应用脚本前注入隔离保护"];
  const reasons: string[] = [];
  const walk = (node: DefaultTreeAdapterTypes.Node) => {
    if ("tagName" in node && node.tagName === "script" && !node.attrs.some(a=>a.name === "src") && !node.attrs.some(a=>a.name === "type" && !["","module","text/javascript","application/javascript"].includes(a.value))) {
      const source = node.childNodes.map(n=>"value" in n ? n.value : "").join("");
      try {
        const ast = parseScript(source,{ecmaVersion:"latest",sourceType:"module"}) as Node & {body: (Node & {test?: {type: string; value?: unknown} | null; init?: unknown; update?: unknown; body?: {type:string;body?:unknown[]}})[]};
        for (const statement of ast.body) {
          if (statement.type === "EmptyStatement" || "directive" in statement) continue;
          const empty = statement.body?.type === "EmptyStatement" || (statement.body?.type === "BlockStatement" && statement.body.body?.length === 0);
          const always = statement.test?.type === "Literal" && statement.test.value === true;
          if (empty && ((statement.type === "WhileStatement" && always) || (statement.type === "ForStatement" && statement.test === null && statement.init === null && statement.update === null))) reasons.push(`检测到载入时无条件空循环：${source.slice(statement.start,statement.end)}`);
          // Unknown prefixes (including throw, calls and initializers) cannot
          // prove reachability. Do not reject a later loop by syntax alone.
          break;
        }
      } catch { /* Syntax/runtime defects are warnings, not proof of an execution threat. */ }
    }
    // Template content is inert and is intentionally not traversed.
    if ("childNodes" in node) node.childNodes.forEach(walk);
  };
  walk(parseHtml(html));
  return reasons;
}
export function previewPolicy(team: TeamRecord, html: string): PreviewPolicy {
  const reasons = executionBlockers(html), dataIssues = unresolvedDataIssues(team);
  const review = team.review ? team.review.issues.length ? "issues" : "clean" : "unavailable";
  return {status:reasons.length ? "blocked" : "allowed", reasons, review, dataMode:review === "unavailable" || dataIssues.length ? "trial" : "formal", adoption:reasons.length || dataIssues.length ? "blocked" : "allowed"};
}
