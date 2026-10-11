import { sha256 } from "./qa/contract";
import type { SavedProject } from "./project-store";

export type ExampleSource = {
  kind: "builtin-example";
  templateId: "focus-pomodoro" | "tip-calculator";
  version: 1;
  sourceCodeHash: string;
  codeHash: string;
};

export const EXAMPLE_SOURCE_HASH = "0bdda2b95e5f9d4cf58d071f65fae68d400b9346e5df321e27078af8c8e898f3";
export const EXAMPLE_HASH = "da317d0deedfa543013f4ae85decb80d59ce50a923d4c82b7ef3df20dd199b8e";
export const EXAMPLE_ASSET = "/examples/tip-calculator-v1.html";
export const EXAMPLE_TITLE = "示例 · 小费计算器";
export const EXAMPLE_STATE = { bill: 20, tipPercent: 5, people: 4, tipAmount: 1, total: 21, perPerson: 5.25 };
const requirement = "做一个小费计算器，可以输入账单金额、小费比例和人数，显示每人应付金额。中文界面。已采用的调整：左右两栏布局，左侧输入、右侧计算结果，窄屏上下排列，柔和青绿色调；继续保留金额、小费、总额和每人金额的计算、非法输入校验、同浏览器保存恢复、读取失败禁止写入、保存失败完整回滚及未知字段兼容。";

// Only this fixed, hash-checked release can enter through workspace seeding.
// No caller-supplied HTML, model result, policy or review is accepted here.
export async function prepareBuiltinExample(): Promise<SavedProject> {
  const response = await fetch(EXAMPLE_ASSET, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("示例素材暂不可用");
  const html = await response.text();
  return builtinExampleFromHtml(html);
}

export async function builtinExampleFromHtml(html: string): Promise<SavedProject> {
  if (await sha256(html) !== EXAMPLE_HASH) throw new Error("示例素材校验失败");
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), title: EXAMPLE_TITLE, requirement, updatedAt: now,
    result: { html, model: "内置示例（未调用模型）", durationMs: 0, generatedAt: now },
    exampleSource: {
      kind: "builtin-example", templateId: "tip-calculator", version: 1,
      sourceCodeHash: EXAMPLE_SOURCE_HASH,
      codeHash: EXAMPLE_HASH,
    },
  };
}
