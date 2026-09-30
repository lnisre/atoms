import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/generate/route";

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
  globalThis.fetch = async () => {
    throw new Error("Must not call provider");
  };
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
    globalThis.fetch = async () =>
      new Response("test-secret-do-not-expose", { status });
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
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    const payload = JSON.parse(String(options?.body));
    assert.equal(payload.model, "deepseek-v4-flash");
    assert.equal(payload.messages[1].content, "做一个待办应用");
    assert.deepEqual(payload.thinking, { type: "disabled" });
    return Response.json({
      model: "deepseek-flash",
      choices: [{ finish_reason: "stop", message: { content: html } }],
    });
  };
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
    globalThis.fetch = async () =>
      Response.json({
        choices: [{ finish_reason: reason, message: { content } }],
      });
    const response = await POST(request());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).html, undefined);
  }
});
test("服务端超时结束请求并给出可重试错误", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  const controller = new AbortController();
  AbortSignal.timeout = () => controller.signal;
  globalThis.fetch = async () => {
    controller.abort();
    throw new DOMException("timeout", "TimeoutError");
  };
  const response = await POST(request());
  assert.equal(response.status, 504);
  assert.match((await response.json()).error, /120 秒/);
});

test("仅解包模型返回的唯一完整文档，不执行前后说明", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  const html = "<!DOCTYPE html><html><head></head><body>真实生成</body></html>";
  globalThis.fetch = async () =>
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "说明\n```html\n" + html + "\n```\n更多说明" },
        },
      ],
    });
  assert.equal((await (await POST(request())).json()).html, html);
  globalThis.fetch = async () =>
    Response.json({
      choices: [{ finish_reason: "stop", message: { content: html + html } }],
    });
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
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(String(options?.body));
    const input = JSON.parse(payload.messages.at(-1).content);
    assert.deepEqual(input, { originalRequirement: "原始待办需求", modification: "把筛选放到顶部", baseHtml, successfulModifications: ["增加优先级与筛选"] });
    assert.match(payload.messages[0].content, /window.atoms/);
    assert.match(payload.messages[1].content, /session-only trial copy/);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: html } }] });
  };
  assert.equal((await POST(editRequest({ baseHtml, modification: "把筛选放到顶部", context: ["增加优先级与筛选"] }))).status, 200);
});
test("缺失或超限修改输入明确失败，不丢弃上下文继续生成", async () => {
  globalThis.fetch = async () => { throw new Error("Must not call provider"); };
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
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: html } }] });
    const response = await POST(request());
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /完整 HTML/);
  }
});
