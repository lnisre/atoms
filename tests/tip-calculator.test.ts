import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../public/examples/tip-calculator-v1.html", import.meta.url), "utf8");
const initial = { bill: 20, tipPercent: 5, people: 4, tipAmount: 1, total: 21, perPerson: 5.25, extra: { keep: [1, 2] } };
const flush = () => new Promise(resolve => setImmediate(resolve));
function app(readFails = false) {
  const elements = new Map<string, { value: string; textContent: string; disabled: boolean; input?: () => void; addEventListener: (event: string, listener: () => void) => void }>();
  for (const name of ["bill", "tipPercent", "people", "errorMsg", "tipAmountVal", "totalVal", "perPersonVal", "status"]) {
    elements.set(name, { value: "", textContent: "", disabled: true, addEventListener(_event, listener) { this.input = listener; } });
  }
  const writes: { state: typeof initial; resolve: () => void; reject: () => void }[] = [];
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], {
    document: { getElementById: (id: string) => elements.get(id), querySelector: () => elements.get("status") },
    window: { atoms: {
      loadState: () => readFails ? Promise.reject(new Error("read")) : Promise.resolve(structuredClone(initial)),
      saveState: (state: typeof initial) => new Promise<void>((resolve, reject) => writes.push({ state: JSON.parse(JSON.stringify(state)), resolve, reject: () => reject(new Error("write")) })),
    } },
  });
  return { elements, writes, input(name: string, value: string) { const el = elements.get(name)!; el.value = value; el.input!(); } };
}

test("tip app keeps latest consecutive input until acknowledged, preserving unknown fields", async () => {
  const a = app(); await flush();
  assert.equal(a.elements.get("perPersonVal")!.textContent, "¥5.25");
  a.input("bill", "80"); a.input("bill", "800"); a.input("people", "2");
  assert.equal(a.writes.length, 1);
  a.writes[0].resolve(); await flush();
  assert.equal(a.writes.length, 2);
  assert.equal(a.writes[1].state.bill, 800);
  assert.equal(a.writes[1].state.people, 2);
  assert.equal(a.writes[1].state.perPerson, 420);
  assert.deepEqual(a.writes[1].state.extra, initial.extra);
  a.writes[1].resolve(); await flush();
  assert.equal(a.elements.get("status")!.textContent, "已保存");
});

test("tip app rejects invalid inputs without saving", async () => {
  for (const [name, value] of [["bill", ""], ["bill", "-1"], ["tipPercent", "-1"], ["people", "0"], ["people", "1.5"], ["people", "not-a-number"]]) {
    const a = app(); await flush(); a.input(name, value);
    assert.equal(a.writes.length, 0);
    assert.equal(a.elements.get("perPersonVal")!.textContent, "—");
    assert.ok(a.elements.get("errorMsg")!.textContent);
  }
});

test("tip app read failure prevents editing and writing; failed save rolls back and next operation retries", async () => {
  const failedRead = app(true); await flush();
  assert.equal(failedRead.elements.get("status")!.textContent, "读取失败");
  for (const name of ["bill", "tipPercent", "people"]) assert.equal(failedRead.elements.get(name)!.disabled, true);
  failedRead.input("bill", "99"); assert.equal(failedRead.writes.length, 0);
  const a = app(); await flush(); a.input("bill", "80"); a.input("people", "2");
  a.writes[0].reject(); await flush();
  assert.equal(a.writes.length, 1);
  assert.equal(a.elements.get("bill")!.value, "20");
  assert.equal(a.elements.get("people")!.value, "4");
  assert.equal(a.elements.get("perPersonVal")!.textContent, "¥5.25");
  assert.equal(a.elements.get("status")!.textContent, "保存失败");
  a.input("bill", "100"); a.writes[1].resolve(); await flush();
  assert.deepEqual(a.writes[1].state.extra, initial.extra);
  assert.equal(a.elements.get("status")!.textContent, "已保存");
});

test("source export and derived release identities remain distinct and traceable", async () => {
  const { createHash } = await import("node:crypto");
  const { EXAMPLE_HASH, EXAMPLE_SOURCE_HASH } = await import("../src/lib/builtin-example");
  const history = JSON.parse(readFileSync(new URL("../src/lib/examples/tip-calculator-history.json", import.meta.url), "utf8"));
  const source = readFileSync(new URL("./fixtures/tip-calculator-source.html", import.meta.url));
  assert.equal(createHash("sha256").update(source).digest("hex"), EXAMPLE_SOURCE_HASH);
  assert.equal(createHash("sha256").update(html).digest("hex"), EXAMPLE_HASH);
  assert.notEqual(EXAMPLE_HASH, EXAMPLE_SOURCE_HASH);
  assert.equal(history.codeHash, EXAMPLE_SOURCE_HASH);
  assert.equal(createHash("sha256").update(readFileSync(new URL("../src/lib/examples/tip-calculator-history.json", import.meta.url))).digest("hex"), "146445746a21ddb21a5e679068d100b9c928f409d992057896d410f7c6cb1af0");
  for (const [i, record] of history.records.entries()) {
    const engineer = JSON.parse(record.details.find((d: { label: string }) => d.label === "实现工程师 · 交付").content);
    const review = JSON.parse(record.details.find((d: { label: string }) => d.label === "Reviewer · 代码审查").content);
    assert.equal(engineer.codeHash, review.codeHash);
    assert.equal(engineer.codeHash, i === 0 ? "1b0b9d7e2cc3a2380c869d5ff63f89971275d6608d628d1acc511780bfdd998c" : EXAMPLE_SOURCE_HASH);
    const calls = JSON.parse(record.details.find((d: { label: string }) => d.label.startsWith("模型调用与用量")).content);
    assert.equal(calls.length, i === 0 ? 8 : 7);
    assert.equal(record.steps.flatMap((s: { times: unknown[] }) => s.times).length, i === 0 ? 42 : 30);
  }
});
