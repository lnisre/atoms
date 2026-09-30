import { expect, test, type Page } from "@playwright/test";

const html = `<!DOCTYPE html><html><head></head><body><button disabled>增加</button><output>0</output><script>
let n=0; const button=document.querySelector('button'),output=document.querySelector('output');
atoms.loadState().then(state=>{n=state??0;output.textContent=n;button.disabled=false});
button.onclick=()=>{output.textContent=++n;atoms.saveState(n)};
</script></body></html>`;
const explanation = '<script>window.explanationExecuted=true</script>\n本次生成了一个计数器，使用“增加”按钮。\n' + '这段是完整正文。'.repeat(300) + '\n正文结尾标记';
const result = { html, model: "controlled-fixture", durationMs: 10, generatedAt: "2026-09-30T09:00:00Z" };
async function start(page: Page) {
  await page.goto("/");
  await page.getByLabel("你想做什么？").fill("首次生成计数器");
  await page.getByRole("button", { name: "开始生成" }).click();
}
async function fixture(page: Page, assistantReply: unknown = explanation) {
  let calls = 0;
  await page.route("**/api/generate", route => {
    calls++;
    const taskId = route.request().headers()["x-atoms-task-id"];
    return route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "result", taskId, result, assistantReply }) + "\n" });
  });
  return () => calls;
}

test("完整说明安全显示，真实预览/数据步骤保存，刷新和同浏览器重开零调用", async ({ page, context }) => {
  const calls = await fixture(page);
  await start(page);
  const record = page.getByRole("region", { name: "首次生成记录" });
  await expect(record.locator(".assistant-reply")).toHaveText(explanation);
  expect(await page.evaluate(() => (window as unknown as { explanationExecuted?: boolean }).explanationExecuted)).toBeUndefined();
  const button = page.frameLocator("iframe").getByRole("button", { name: "增加" });
  await expect(button).toBeEnabled();
  await button.press("Enter");
  await expect(page.getByText("应用数据已保存", { exact: true })).toBeVisible();
  await expect(record.getByText("保存应用数据", { exact: true })).toBeVisible();
  await page.getByLabel("追加修改需求").fill("展开详情不清空输入");
  await record.getByText("载入隔离预览", { exact: true }).click();
  await expect(record.getByText(/已观察到 iframe load/)).toBeVisible();
  await expect(page.frameLocator("iframe").locator("output")).toHaveText("1");
  await expect(page.getByLabel("追加修改需求")).toHaveValue("展开详情不清空输入");
  // Wait for the actual journal transaction, not an arbitrary delay.
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r=indexedDB.open("atoms-projects",1); r.onsuccess=()=>resolve(r.result); });
    const tx=db.transaction("projects");
    const items = await new Promise<Array<{ initialGeneration: { events: Array<{label:string;status:string}> } }>>(resolve=>{const r=tx.objectStore("projects").getAll();r.onsuccess=()=>resolve(r.result)});
    db.close(); return items[0]?.initialGeneration.events.some(e=>e.label==="保存应用数据"&&e.status==="completed");
  })).toBe(true);
  const url=page.url();
  await page.reload();
  await expect(record.locator(".assistant-reply")).toHaveText(explanation);
  await expect(page.frameLocator("iframe").locator("output")).toHaveText("1");
  await expect(record.getByText("保存应用数据", { exact: true })).toBeVisible();
  await page.close();
  const reopened=await context.newPage();
  let restorationCalls=0; reopened.on("request", req=>{if(req.url().endsWith("/api/generate"))restorationCalls++});
  await reopened.goto(url);
  await expect(reopened.locator(".assistant-reply")).toHaveText(explanation);
  await expect(reopened.frameLocator("iframe").locator("output")).toHaveText("1");
  expect(calls()).toBe(1); expect(restorationCalls).toBe(0);
});

test("等待期间观察到流事件，完成前不显示正文或运行 HTML", async ({ page }) => {
  await page.addInitScript(({result, explanation}) => {
    const original=window.fetch;
    window.fetch=async (...args) => {
      if(args[0]!=="/api/generate")return original(...args);
      const taskId=new Headers(args[1]?.headers).get("X-Atoms-Task-Id");
      const encoder=new TextEncoder();
      const stream=new ReadableStream({start(controller){
        const event={taskId,source:"server",sequence:1,stepId:"model",label:"调用模型",status:"started",at:new Date().toISOString(),detail:"受控上游正在等待"};
        const line=JSON.stringify({type:"step",event})+"\n";
        // Split a real UTF-8 code point across chunks.
        const bytes=encoder.encode(line); const split=bytes.findIndex(x=>x>127)+1;
        controller.enqueue(bytes.slice(0,split));controller.enqueue(bytes.slice(split));
        Object.assign(window,{finishControlledGeneration:()=>{
          controller.enqueue(encoder.encode(JSON.stringify({type:"step",event:{...event,sequence:2,status:"completed",at:new Date().toISOString()}})+"\n"));
          controller.enqueue(encoder.encode(JSON.stringify({type:"result",taskId,result,assistantReply:explanation})+"\n"));controller.close();
        }});
      }});
      return new Response(stream,{headers:{"Content-Type":"application/x-ndjson"}});
    };
  }, {result, explanation});
  await start(page);
  await expect(page.getByText("调用模型", {exact:true})).toBeVisible();
  await expect(page.getByText("等待模型完整说明…")).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as {finishControlledGeneration:()=>void}).finishControlledGeneration());
  await expect(page.locator(".assistant-reply")).toHaveText(explanation);
  await expect(page.frameLocator("iframe").getByRole("button",{name:"增加"})).toBeEnabled();
});

test("正文缺失降级保留应用，缺失状态也能恢复且不补调模型", async ({ page }) => {
  const calls=await fixture(page, null);
  await start(page);
  await expect(page.getByText("本次未取得助手说明", {exact:true})).toBeVisible();
  await expect(page.frameLocator("iframe").getByRole("button",{name:"增加"})).toBeEnabled();
  await page.reload();
  await expect(page.getByText("本次未取得助手说明", {exact:true})).toBeVisible();
  expect(calls()).toBe(1);
});

test("传输中断、任务错配和无效 HTML 均结束等待，不保存或运行产物", async ({ page }) => {
  for (const failure of ["partial", "mismatch", "html"]) {
    await page.route("**/api/generate", route => {
      const taskId=route.request().headers()["x-atoms-task-id"];
      const body= failure==="partial" ? '{"type":"result",' : JSON.stringify({type:"result",taskId:failure==="mismatch"?"wrong-task":taskId,result:{...result,html:"<!DOCTYPE html><html><head></head><body>截断"},assistantReply:"看起来完整的说明"})+"\n";
      return route.fulfill({contentType:"application/x-ndjson",body});
    });
    await start(page);
    await expect(page.getByRole("heading",{name:"生成未完成"})).toBeVisible();
    await expect(page.getByRole("button",{name:"重新生成",exact:true})).toBeEnabled();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.getByText("项目已保存",{exact:true})).toHaveCount(0);
    await page.unroute("**/api/generate");
  }
});

test("日志事务失败明确提示，已提交项目和数据不被日志覆盖", async ({ page }) => {
  await fixture(page);
  await start(page);
  await expect(page.frameLocator("iframe").getByRole("button",{name:"增加"})).toBeEnabled();
  await page.evaluate(() => {
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,...args){
      const request=put.call(this,value,...args);
      if(this.name==="projects" && this.transaction.objectStoreNames.length===1) request.addEventListener("success",()=>this.transaction.abort());
      return request;
    };
  });
  await page.frameLocator("iframe").getByRole("button",{name:"增加"}).press("Enter");
  await expect(page.getByText("应用数据已保存",{exact:true})).toBeVisible();
  await expect(page.getByText(/执行记录保存失败，最新步骤可能无法恢复/)).toBeVisible();
  await page.reload();
  await expect(page.frameLocator("iframe").locator("output")).toHaveText("1");
  await expect(page.locator(".assistant-reply")).toHaveText(explanation);
});

test("新项目进入 M2 多轮修改与采用后保留首次说明，日志不覆盖采用代码", async ({ page }) => {
  let calls=0;
  await page.route("**/api/generate",route=>{
    calls++;
    if(route.request().postDataJSON().modification)return route.fulfill({json:{...result,html:html.replace('<output>0</output>',`<h1>修改版本 ${calls}</h1><output>0</output>`),generatedAt:`candidate-${calls}`}});
    return route.fulfill({contentType:"application/x-ndjson",body:JSON.stringify({type:"result",taskId:route.request().headers()["x-atoms-task-id"],result,assistantReply:explanation})+"\n"});
  });
  await start(page);
  await expect(page.frameLocator("iframe").getByRole("button",{name:"增加"})).toBeEnabled();
  await page.frameLocator("iframe").getByRole("button",{name:"增加"}).press("Enter");
  await expect(page.getByText("应用数据已保存",{exact:true})).toBeVisible();
  for(const request of ["增加标题", "调整标题"]){
    await page.getByLabel("追加修改需求").fill(request);
    await page.getByRole("button",{name:"生成候选",exact:true}).click();
    await expect(page.getByRole("button",{name:"采用修改",exact:true})).toBeEnabled();
  }
  await page.frameLocator("iframe").getByRole("button",{name:"增加"}).press("Enter");
  await page.getByRole("button",{name:"采用修改",exact:true}).click();
  await expect(page.getByText("运行预览 · 已采用应用")).toBeVisible();
  await expect(page.getByText("执行记录正在保存，请等待完成再离开。")).toHaveCount(0);
  await page.reload();
  await expect(page.frameLocator("iframe").getByRole("heading",{name:"修改版本 3"})).toBeVisible();
  await expect(page.frameLocator("iframe").locator("output")).toHaveText("1");
  await expect(page.locator(".assistant-reply")).toHaveText(explanation);
  expect(calls).toBe(3);
});


test("真实 Next.js 请求代理可进入流接口，校验失败不调用模型", async ({ request }) => {
  const response = await request.post("/api/generate", {
    headers: { Accept: "application/x-ndjson", "X-Atoms-Task-Id": "http-entry-regression" },
    data: { requirement: "" },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/x-ndjson");
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  expect(events.map(item => item.type)).toEqual(["step", "step", "error"]);
  expect(events[0].event.stepId).toBe("context");
  expect(events[1].event.status).toBe("failed");
  expect(events[2].error).toContain("请输入");
});
