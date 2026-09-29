import {
  GENERATION_TIMEOUT_MS,
  MAX_REQUIREMENT_LENGTH,
} from "@/lib/generation";

export const runtime = "nodejs";
export const maxDuration = 180;

const systemPrompt = `You build lightweight frontend applications from the user's requirements.
Return ONLY one complete HTML document, starting with <!DOCTYPE html> and ending with </html>. Include explicit head and body tags, inline CSS in style and vanilla JavaScript in script. No markdown or explanation.
Implement the requested interactions fully, with accessible labels, keyboard support and responsive layout. Match the user's language. Keep the implementation concise.
The document runs inside an iframe with sandbox="allow-scripts" and an opaque origin. It has NO direct storage or network access. The platform injects window.atoms BEFORE your scripts. Use its fixed Promise-based API for ALL application business data: await window.atoms.loadState() returns the last saved JSON state, or null for a new project; await window.atoms.saveState(jsonData) saves the whole state and resolves ONLY after storage commits. Do not implement, redefine or mock this API. On startup await loadState before enabling interactions; restore saved state exactly (including completed items and deletions), use defaults only when the result is null. If reading fails, show an error and keep editing disabled, never overwrite unread data. After EVERY user mutation (including add, complete, delete), call saveState with the complete current state synchronously in that same event handler, before any await, timer, debounce or other deferred work. The platform makes the preview inert and blocks editing events until saveState settles; do not bypass this lock or mutate business data from timers, asynchronous callbacks or background work. Use one async mutation handler: update state, render, show saving, await saveState(snapshot), then show saved; catch and display failures. Do not queue, debounce or skip saves with an isSaving flag. Do not independently enable editing while a save is pending. Catch errors and show them honestly; show saved only after the Promise resolves. Use JSON-compatible data, at most 1 MB. Never send project IDs or postMessage yourself; only use window.atoms. Do not use localStorage, sessionStorage, IndexedDB, cookies, fetch, external images, fonts, scripts, stylesheets, CDN, imports, packages, forms that navigate, popups or parent document access. Explain that recovery is limited to this browser and site, with site data retained. No backend, login or external services. Use inline SVG or CSS for graphics.
For any requested capability outside this environment, explain the limitation honestly inside the app; never simulate successful backend operations. Render user-entered text with textContent, not HTML interpolation. Do not use form elements or submit events (sandbox blocks them); use type="button" click handlers and input keydown for Enter. Use actual event handlers for the requested actions.`;

function failure(error: string, status: number) {
  return Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  // Opaque sandbox frames and cross-site forms must not invoke the paid endpoint.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return failure("请从本网站重新发起生成。", 403);
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return failure("请求格式不正确，请重新发起。", 415);
  }
  let requirement: unknown;
  try {
    const body = await request.text();
    if (body.length > 24_000) return failure("需求过长，请缩短后重试。", 413);
    requirement = JSON.parse(body)?.requirement;
  } catch {
    return failure("无法读取需求，请重新发起。", 400);
  }
  if (
    typeof requirement !== "string" ||
    !requirement.trim() ||
    requirement.trim().length > MAX_REQUIREMENT_LENGTH
  ) {
    return failure(`请输入 1–${MAX_REQUIREMENT_LENGTH} 字的应用需求。`, 400);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey)
    return failure("生成服务尚未配置，请联系维护者配置模型密钥。", 503);

  const started = Date.now();
  const timeout = AbortSignal.timeout(GENERATION_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: requirement.trim() },
        ],
        thinking: { type: "disabled" },
        max_tokens: 8192,
        stream: false,
      }),
      signal: AbortSignal.any([timeout, request.signal]),
      cache: "no-store",
    });
    if (!response.ok) {
      // Never forward provider bodies: these can contain credentials or internal details.
      if (response.status === 401 || response.status === 403)
        return failure("模型认证失败，请联系维护者检查服务端配置。", 502);
      if (response.status === 402)
        return failure("模型服务额度不足，请联系维护者。", 502);
      if (response.status === 429)
        return failure("模型服务繁忙，请稍后手动重试。", 429);
      return failure("模型服务暂时不可用，请稍后手动重试。", 502);
    }
    const data = await response.json();
    const choice = data?.choices?.[0];
    if (
      choice?.finish_reason !== "stop" ||
      typeof choice?.message?.content !== "string"
    ) {
      return failure("模型未返回完整应用，请缩小需求后重新生成。", 502);
    }
    // Providers can wrap the document in prose or a Markdown fence. Unwrap one
    // complete document without repairing, completing or substituting its code.
    const content: string = choice.message.content;
    const documents = content.match(/<!doctype html>[\s\S]*?<\/html>/gi);
    const html = documents?.length === 1 ? documents[0] : "";
    if (
      html.length > 500_000 ||
      !/^<!doctype html>/i.test(html) ||
      (content.match(/<!doctype html>/gi)?.length ?? 0) !== 1 ||
      !/<head(?:\s[^>]*)?>/i.test(html) ||
      !/<body(?:\s[^>]*)?>/i.test(html) ||
      !/<\/html>$/i.test(html)
    ) {
      return failure("模型返回的内容不是完整 HTML 应用，请重新生成。", 502);
    }
    return Response.json(
      {
        html,
        model:
          typeof data.model === "string" ? data.model : "deepseek-v4-flash",
        durationMs: Date.now() - started,
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    if (timeout.aborted)
      return failure("生成超过 120 秒，已结束等待。请缩小需求后重试。", 504);
    if (request.signal.aborted) return failure("本次生成已取消。", 499);
    return failure("无法连接模型服务或读取生成结果，请稍后重试。", 502);
  }
}
