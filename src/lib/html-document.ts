import { parse, type DefaultTreeAdapterTypes } from "parse5";

function element(parent: DefaultTreeAdapterTypes.ParentNode, name: string) {
  return parent.childNodes.find(
    (node): node is DefaultTreeAdapterTypes.Element =>
      "tagName" in node && node.tagName === name,
  );
}

// Use the HTML tree builder (with scripting enabled, like the preview), not tag
// text matching. Implied heads cannot provide a safe pre-script insertion point.
// Source offsets let us insert without reserializing or rewriting business code.
// This same contract is checked before generation succeeds and when reopening.
export function previewHeadOffset(html: string): number | null {
  const document = parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: true });
  const root = element(document, "html");
  const head = root && element(root, "head");
  const body = root && element(root, "body");
  if (!root?.sourceCodeLocation?.startTag || !root.sourceCodeLocation.endTag ||
      !head?.sourceCodeLocation?.startTag || !body?.sourceCodeLocation?.startTag) {
    return null;
  }
  return head.sourceCodeLocation.startTag.endOffset;
}
