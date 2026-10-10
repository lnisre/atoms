import { authenticatedCookie, modelFetch, withCookie } from "./helpers/auth";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { POST as guardedPOST } from "../src/app/api/generate/route";

let authCookie = "";
beforeEach(async () => { authCookie = await authenticatedCookie(); modelFetch(async () => { throw new Error("unexpected model call"); }); });
const POST = (request: Request) => guardedPOST(withCookie(request, authCookie));
const originalFetch = globalThis.fetch;
const originalKey = process.env.DEEPSEEK_API_KEY;
const originalTimeout = AbortSignal.timeout;
afterEach(() => {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
});
const request = (
  requirement = "做一个待办应用",
  origin = "http://localhost:3100",
) =>
  new Request("http://localhost:3100/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify({ requirement }),
  });

test("无效需求与跨源请求不调用模型", async () => {
  modelFetch(async () => {
    throw new Error("Must not call provider");
  });
  assert.equal((await POST(request("  "))).status, 400);
  assert.equal((await POST(request("x".repeat(4001)))).status, 400);
  assert.equal((await POST(request("待办", "null"))).status, 403);
});
test("未配置密钥时明确失败", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /尚未配置/);
});
test("模型错误不会透传原始响应或返回假应用", async () => {
  process.env.DEEPSEEK_API_KEY = "test-secret-do-not-expose";
  for (const status of [401, 402, 429, 500]) {
    modelFetch(async () =>
      new Response("test-secret-do-not-expose", { status }));
    const response = await POST(request());
    const body = await response.text();
    assert.ok(response.status >= 400);
    assert.doesNotMatch(body, /test-secret|<html/);
  }
});
test("真实请求合同、完整 HTML 与调用耗时", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  const html =
    "<!DOCTYPE html><html><head><style>body{color:black}</style></head><body><button>添加</button><script>void 0</script></body></html>";
  modelFetch(async (url, options) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    const payload = JSON.parse(String(options?.body));
    assert.equal(payload.model, "deepseek-v4-flash");
    assert.equal(payload.messages[1].content, "做一个待办应用");
    assert.deepEqual(payload.thinking, { type: "disabled" });
    return Response.json({
      model: "deepseek-flash",
      choices: [{ finish_reason: "stop", message: { content: html } }],
    });
  });
  const response = await POST(request());
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.html, html);
  assert.equal(result.model, "deepseek-flash");
  assert.equal(typeof result.durationMs, "number");
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("截断、空白或非 HTML 结果不作为成功", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  for (const [reason, content] of [
    ["length", "<html>"],
    ["stop", ""],
    ["stop", "Here is your app"],
  ]) {
    modelFetch(async () =>
      Response.json({
        choices: [{ finish_reason: reason, message: { content } }],
      }));
    const response = await POST(request());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).html, undefined);
  }
});
test("服务端超时结束请求并给出可重试错误", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  const controller = new AbortController();
  AbortSignal.timeout = () => controller.signal;
  modelFetch(async () => {
    controller.abort();
    throw new DOMException("timeout", "TimeoutError");
  });
  const response = await POST(request());
  assert.equal(response.status, 504);
  assert.match((await response.json()).error, /120 秒/);
});

test("仅解包模型返回的唯一完整文档，不执行前后说明", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  const html = "<!DOCTYPE html><html><head></head><body>真实生成</body></html>";
  modelFetch(async () =>
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "说明\n```html\n" + html + "\n```\n更多说明" },
        },
      ],
    }));
  assert.equal((await (await POST(request())).json()).html, html);
  modelFetch(async () =>
    Response.json({
      choices: [{ finish_reason: "stop", message: { content: html + html } }],
    }));
  assert.equal((await POST(request())).status, 502);
});

const editRequest = (fields: Record<string, unknown>) => new Request("http://localhost:3100/api/generate", {
  method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost:3100" },
  body: JSON.stringify({ requirement: "原始待办需求", ...fields }),
});
test("修改完整传递基础代码、追加需求与成功对话；不沿用首次需求长度限制截断代码", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  const html = "<!DOCTYPE html><html><head></head><body>候选</body></html>";
  const baseHtml = html + " ".repeat(30000);
  modelFetch(async (_url, options) => {
    const payload = JSON.parse(String(options?.body));
    const input = JSON.parse(payload.messages.at(-1).content);
    assert.deepEqual(input, { originalRequirement: "原始待办需求", modification: "把筛选放到顶部", baseHtml, successfulModifications: ["增加优先级与筛选"] });
    assert.match(payload.messages[0].content, /window.atoms/);
    assert.match(payload.messages[1].content, /session-only trial copy/);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: html } }] });
  });
  assert.equal((await POST(editRequest({ baseHtml, modification: "把筛选放到顶部", context: ["增加优先级与筛选"] }))).status, 200);
});
test("缺失或超限修改输入明确失败，不丢弃上下文继续生成", async () => {
  modelFetch(async () => { throw new Error("Must not call provider"); });
  const valid = { baseHtml: "existing html", modification: "增加筛选", context: [] };
  for (const fields of [
    { ...valid, baseHtml: undefined }, { ...valid, baseHtml: "x".repeat(500001) },
    { ...valid, modification: "" }, { ...valid, modification: "x".repeat(4001) },
    { ...valid, context: [42] }, { ...valid, context: ["x".repeat(32001)] },
  ]) assert.equal((await POST(editRequest(fields))).status, 400);
  assert.equal((await POST(editRequest({ ...valid, baseHtml: "x".repeat(3300001) }))).status, 413);
});

test("注释中的结构标签不能冒充真实 head/body，无法装配时明确失败", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  for (const html of [
    "<!DOCTYPE html><html><!-- <head> --><body>缺少真实 head</body></html>",
    "<!DOCTYPE html><html><head></head><!-- <body> --></html>",
    "<!DOCTYPE html><html><script>void 0</script><head></head><body>脚本先于真实 head</body></html>",
  ]) {
    modelFetch(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: html } }] }));
    const response = await POST(request());
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /完整 HTML/);
  }
});

const fullHtml = "<!DOCTYPE html><html><head></head><body>真实生成</body></html>";
const streamedRequest = () => new Request("http://localhost:3100/api/generate", {
  method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", "X-Atoms-Task-Id": "test-task", origin: "http://localhost:3100" },
  body: JSON.stringify({ requirement: "做一个待办应用" }),
});
const events = async (response: Response) => (await response.text()).trim().split("\n").map(line => JSON.parse(line));

test("单次请求分离完整正文与 HTML，模型等待期间已传递真实开始事件", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  let resolve!: (value: Response) => void;
  let calls = 0;
  modelFetch(async (_url, options) => {
    calls++;
    const payload = JSON.parse(String(options?.body));
    assert.match(payload.messages[0].content, /assistantReply/);
    assert.equal(payload.max_tokens, 12288);
    return new Promise<Response>(done => { resolve = done; });
  });
  const response = await POST(streamedRequest());
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const first = [];
  while (first.length < 3) first.push(JSON.parse(decoder.decode((await reader.read()).value)));
  assert.deepEqual(first.map(x => [x.event.stepId, x.event.status]), [["context", "started"], ["context", "completed"], ["model", "started"]]);
  const assistantReply = "这是本次模型说明，示例 <!DOCTYPE html> 只是文本。\n<script>window.bad=true</script>";
  resolve(Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ html: fullHtml, assistantReply }) } }] }));
  let tail = "";
  while (true) { const item = await reader.read(); if (item.done) break; tail += decoder.decode(item.value); }
  const rest = tail.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(calls, 1);
  assert.equal(rest.at(-1).result.html, fullHtml);
  assert.equal(rest.at(-1).assistantReply, assistantReply);
  assert.deepEqual(rest.slice(0,-1).map(x => [x.event.stepId, x.event.status]), [["model", "completed"], ["extract", "started"], ["extract", "completed"], ["html", "started"], ["html", "completed"]]);
  for (const [index, item] of [...first, ...rest.slice(0,-1)].entries()) {
    assert.equal(item.event.taskId, "test-task"); assert.equal(item.event.source, "server"); assert.equal(item.event.sequence, index + 1);
    assert.ok(Number.isFinite(Date.parse(item.event.at)));
  }
});

test("缺少或无效正文保留完整应用，不补调模型；超长正文不静默截断", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  for (const content of [fullHtml, JSON.stringify({ html: fullHtml }), JSON.stringify({ html: fullHtml, assistantReply: { text: "invalid" } }), JSON.stringify({ html: fullHtml, assistantReply: " " })]) {
    let calls = 0;
    modelFetch(async () => { calls++; return Response.json({ choices: [{ finish_reason: "stop", message: { content } }] }); });
    const result = (await events(await POST(streamedRequest()))).at(-1);
    assert.equal(result.type, "result"); assert.equal(result.result.html, fullHtml); assert.equal(result.assistantReply, null); assert.equal(calls, 1);
  }
  modelFetch(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ html: fullHtml, assistantReply: "x".repeat(32001) }) } }] }));
  const output = await events(await POST(streamedRequest()));
  assert.equal(output.at(-1).result.html, fullHtml);
  assert.equal(output.at(-1).assistantReply, null);
  assert.ok(output.some(item => item.event?.detail.includes("正文超过 32000 字符限制")));
});

test("模型、提取、结构失败均发出实际失败与终态，不透传敏感错误", async () => {
  process.env.DEEPSEEK_API_KEY = "test-secret";
  const cases = [
    { response: new Response("test-secret", { status: 401 }), step: "model" },
    { response: Response.json({ choices: [{ finish_reason: "length", message: { content: fullHtml } }] }), step: "model" },
    { response: Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"html":' } }] }), step: "extract" },
    { response: Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ html: "<!DOCTYPE html><html><head></head><body>incomplete", assistantReply: "完整说明" }) } }] }), step: "html" },
  ];
  for (const {response, step} of cases) {
    modelFetch(async () => response);
    const output = await events(await POST(streamedRequest()));
    assert.equal(output.at(-2).event.status, "failed"); assert.equal(output.at(-2).event.stepId, step); assert.equal(output.at(-1).type, "error");
    assert.equal(output.some(x => x.type === "result"), false); assert.doesNotMatch(JSON.stringify(output), /test-secret/);
  }
});

test("客户端收到产物后连接异常也不提交成功；取消读取会取消上游", async () => {
  const { readGeneration } = await import("../src/lib/generation-client");
  const encoder = new TextEncoder();
  let interrupt!: () => void;
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(JSON.stringify({ type: "result", taskId: "client-task", result: { html: fullHtml, model: "test", durationMs: 1, generatedAt: new Date().toISOString() }, assistantReply: "完整说明" }) + "\n"));
    interrupt = () => controller.error(new Error("connection interrupted"));
  } }), { headers: { "Content-Type": "application/x-ndjson" } });
  const pending = readGeneration(response, "client-task", () => {});
  interrupt();
  await assert.rejects(pending, /connection interrupted/);

  process.env.DEEPSEEK_API_KEY = "test-key";
  let aborted = false;
  modelFetch(async (_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener("abort", () => { aborted = true; reject(new Error("cancelled")); });
  }));
  const streaming = await POST(streamedRequest());
  const reader = streaming.body!.getReader();
  for (let n=0;n<3;n++) await reader.read();
  await reader.cancel();
  assert.equal(aborted, true);
});

test("修改沿用同次正文协议与实时事件，保留完整上下文和缺正文降级", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  for (const missing of [false, true]) {
    let calls = 0;
    modelFetch(async (_url, options) => {
      calls++;
      const payload = JSON.parse(String(options?.body));
      assert.match(payload.messages[0].content, /assistantReply/);
      assert.equal(payload.max_tokens, 12288);
      assert.deepEqual(JSON.parse(payload.messages.at(-1).content).successfulModifications, ["上一轮"]);
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ html: fullHtml, ...(missing ? {} : { assistantReply: "本轮真实说明" }) }) } }] });
    });
    const req = editRequest({ baseHtml: fullHtml, modification: "本轮修改", context: ["上一轮"] });
    req.headers.set("Accept", "application/x-ndjson"); req.headers.set("X-Atoms-Task-Id", "modification-task");
    const output = await events(await POST(req));
    assert.equal(calls, 1); assert.equal(output.at(-1).assistantReply, missing ? null : "本轮真实说明");
    assert.equal(output.at(-1).result.html, fullHtml);
    assert.ok(output.filter(x => x.type === "step").every(x => x.event.taskId === "modification-task"));
  }
});
