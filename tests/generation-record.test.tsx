import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerationRecord } from "../src/components/generation-record";
import type { InitialGeneration } from "../src/lib/execution";

const record: InitialGeneration = { taskId: "real-task", startedAt: "2026-10-09", assistantReply: "实际助手回复", events: [
  { taskId: "real-task", source: "server", sequence: 1, stepId: "parse", label: "解析响应", status: "failed", at: "2026-10-09T00:00:00Z", detail: "实际解析失败" },
] };
test("shared record rendering preserves blocked and unsaved result hints and actual failure/save feedback", () => {
  for (const hint of ["禁止运行：当前代码不可执行。", "尚未保存：完整源码仅保留在本页。"] ) {
    const output = renderToStaticMarkup(<GenerationRecord record={record} live={false} pending={false} saving={false} saveError resultLabel="成果" resultHint={hint} />);
    assert.ok(output.includes(hint));
    assert.ok(!output.includes("请在右侧预览中实际操作"));
    assert.ok(output.includes("实际助手回复"));
    assert.ok(output.includes("实际解析失败"));
    assert.ok(output.includes("执行记录保存失败"));
    assert.ok(output.includes("对应任务：real-task"));
  }
});
test("ordinary record rendering retains pending and saving states", () => {
  const output = renderToStaticMarkup(<GenerationRecord record={record} live pending saving saveError={false} />);
  assert.ok(output.includes("等待模型完整说明"));
  assert.ok(output.includes("执行记录正在保存"));
  assert.ok(!output.includes("实际助手回复"));
});
