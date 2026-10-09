import { refractor } from "refractor/core";
import markup from "refractor/markup";
import css from "refractor/css";
import javascript from "refractor/javascript";
import typescript from "refractor/typescript";
import jsx from "refractor/jsx";
import tsx from "refractor/tsx";
import json from "refractor/json";
import markdown from "refractor/markdown";
import python from "refractor/python";
import bash from "refractor/bash";
import yaml from "refractor/yaml";

for (const syntax of [markup, css, javascript, typescript, jsx, tsx, json, markdown, python, bash, yaml]) refractor.register(syntax);

const languages: Record<string, string> = {
  html: "markup", htm: "markup", xml: "markup", svg: "markup", css: "css",
  js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", mts: "typescript", cts: "typescript",
  jsx: "jsx", tsx: "tsx", json: "json", md: "markdown", markdown: "markdown",
  py: "python", sh: "bash", bash: "bash", yml: "yaml", yaml: "yaml",
};

type Token = { text: string; classes: string; start: number };
export type SourceLine = { tokens: Token[]; ending: string };
export type SourceMatch = { start: number; end: number };

// Only text and token classes cross this boundary. No parsed tag or attribute is
// used as markup, and original character offsets remain valid for searching.
export function highlightSource(path: string, text: string): SourceLine[] {
  const language = languages[path.split(".").at(-1)?.toLowerCase() ?? ""];
  const lines: SourceLine[] = [{ tokens: [], ending: "" }];
  let offset = 0;
  function append(value: string, classes: string) {
    const parts = value.split(/(\r\n|\r|\n)/);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2) {
        lines.at(-1)!.ending = parts[i];
        lines.push({ tokens: [], ending: "" });
      } else if (parts[i]) {
        lines.at(-1)!.tokens.push({ text: parts[i], classes, start: offset });
      }
      offset += parts[i].length;
    }
  }
  if (!language) { append(text, ""); return lines; }
  try {
    type Node = ReturnType<typeof refractor.highlight>["children"][number];
    function visit(nodes: Node[], inherited = "") {
      for (const node of nodes) {
        if (node.type === "text") append(node.value, inherited);
        else if (node.type === "element") visit(node.children, [node.properties.className, inherited].flat().filter(Boolean).join(" "));
      }
    }
    visit(refractor.highlight(text, language).children);
    return lines;
  } catch {
    // Unsupported syntax must never prevent reading or copying the source.
    return highlightSource("source.txt", text);
  }
}

export function findSourceMatches(text: string, query: string): SourceMatch[] {
  if (!query) return [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...text.matchAll(new RegExp(escaped, "giu"))].map(match => ({ start: match.index, end: match.index + match[0].length }));
}
