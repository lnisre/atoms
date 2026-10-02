import { sha256 } from "./qa/contract";
import type { SavedProject } from "./project-store";

export type ExampleSource = {
  kind: "builtin-example";
  templateId: "focus-pomodoro";
  version: 1;
  sourceCodeHash: string;
  codeHash: string;
};

export const EXAMPLE_HASH = "d1d6944ff3eda19b7f5150e9895cacc71579313be13e1e40232153f5b747871f";
const requirement = "专注番茄钟：保留深色卡片、绿色开始按钮与中文界面；默认专注25分钟、休息5分钟，支持开始、暂停、重置与完成专注次数；前台到期自动进入下一段并提示。运行中的当前段按真实经过时间跨刷新/关闭恢复，重开时已到期只结算当前段并暂停，不追补多轮、不重复计数。暂停保持暂停，继续从剩余时间开始；重置到初始专注暂停状态，保留完成统计及未知字段。通过 atoms.loadState/saveState 保存，读取失败禁止覆盖，保存成功才确认操作、失败可重试。无时长设置、后台服务或后台提醒。";

// Only this fixed, hash-checked release can enter through workspace seeding.
// No caller-supplied HTML, model result, policy or review is accepted here.
export async function prepareBuiltinExample(): Promise<SavedProject> {
  const response = await fetch("/examples/pomodoro-v1.html", { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("示例素材暂不可用");
  const html = await response.text();
  if (await sha256(html) !== EXAMPLE_HASH) throw new Error("示例素材校验失败");
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), title: "示例 · 专注番茄钟", requirement, updatedAt: now,
    result: { html, model: "内置示例（未调用模型）", durationMs: 0, generatedAt: now },
    exampleSource: {
      kind: "builtin-example", templateId: "focus-pomodoro", version: 1,
      sourceCodeHash: "a6c8df564b6088fc986ae137286e2b039d0cb9c10ab678d17a56bccd11dfc489",
      codeHash: EXAMPLE_HASH,
    },
  };
}
