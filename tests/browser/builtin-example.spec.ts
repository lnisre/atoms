import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import type { SavedProject } from "../../src/lib/project-store";
import { fulfillGeneration } from "./team-fixture";
import history from "../../src/lib/examples/tip-calculator-history.json";
import { EXAMPLE_HASH } from "../../src/lib/builtin-example";
const card = (page: Page) => page.getByRole("region", {name:"已有项目"}).getByRole("button", {name:/示例 · 小费计算器/});
const frame = (page: Page) => page.frameLocator("iframe");
const expectedState = {bill:20, tipPercent:5, people:4, tipAmount:1, total:21, perPerson:5.25};
async function database(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("atoms-projects",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try { return await new Promise<{projects:SavedProject[];data:{projectId:string;state?:Record<string,unknown>;completed?:boolean}[]}>((resolve,reject)=>{
      const tx=db.transaction(["projects","applicationData"]),p=tx.objectStore("projects").getAll(),d=tx.objectStore("applicationData").getAll();
      tx.oncomplete=()=>resolve({projects:p.result,data:d.result});tx.onabort=()=>reject(tx.error);
    }); } finally {db.close();}
  });
}
async function openExample(page: Page) {
  await page.goto("/"); await card(page).click();
  await expect(frame(page).getByLabel("账单金额（元）")).toBeEnabled();
}
async function change(page: Page, label: string, value: string) {
  await frame(page).getByLabel(label,{exact:true}).fill(value);
  await expect(frame(page).locator('[data-atoms-status]')).toHaveText("已保存");
}

test("独立小费示例展示完整真实来源，两轮身份不写入用户任务，展开与恢复零模型调用", async ({page,browser},info)=>{
  let calls=0;page.on("request",r=>{if(r.url().includes("/api/generate"))calls++;});
  await page.goto("/");await expect(card(page)).toHaveCount(1);
  expect(new URL(page.url()).search).toBe("");
  const before=await database(page),project=before.projects[0];
  expect(before.projects).toHaveLength(1);expect(project.initialGeneration).toBeUndefined();expect(project.modificationRecords).toBeUndefined();
  expect(before.data.find(d=>d.projectId===project.id)?.state).toEqual(expectedState);
  expect(before.data.filter(d=>d.completed)).toHaveLength(2);
  expect(createHash("sha256").update(project.result.html).digest("hex")).toBe(EXAMPLE_HASH);
  const lastReview=JSON.parse(history.records[1].details.find(d=>d.label==="Reviewer · 代码审查")!.content);
  expect(lastReview.codeHash).toBe(history.codeHash);expect(lastReview.approved).toBe(true);
  const sourceHashes = history.records.map(record => {
    const engineer = JSON.parse(record.details.find(d=>d.label==="实现工程师 · 交付")!.content);
    const review = JSON.parse(record.details.find(d=>d.label==="Reviewer · 代码审查")!.content);
    expect(engineer.codeHash).toBe(review.codeHash);
    return engineer.codeHash;
  });
  expect(sourceHashes).toEqual(["1b0b9d7e2cc3a2380c869d5ff63f89971275d6608d628d1acc511780bfdd998c",history.codeHash]);
  await card(page).click();
  const source=page.getByRole("region",{name:"示例来源记录"});
  await expect(source.getByRole("heading",{name:"助手 首次生成 · 示例来源"})).toBeVisible();
  await expect(source.locator(".generation-record")).toHaveCount(2);
  await expect(source.getByText("模型调用与用量 · 8 次",{exact:true})).toHaveCount(1);
  await expect(source.getByText("模型调用与用量 · 7 次",{exact:true})).toHaveCount(1);
  await expect(source.locator(".execution-card time")).toHaveCount(72);
  await expect(source.locator('[data-status="failed"]')).toHaveCount(1);
  await expect(frame(page).locator("#perPersonVal")).toHaveText("¥5.25");
  const handle=await page.locator("iframe").elementHandle();
  await page.getByLabel("追加修改需求",{exact:true}).fill("保留未提交内容");
  await source.getByText("模型调用与用量 · 7 次",{exact:true}).click();
  await expect(source.getByText('"responseModel": "deepseek-flash"',{exact:false}).last()).toBeVisible();
  expect(await handle!.evaluate(el=>el===document.querySelector("iframe"))).toBe(true);
  await expect(page.getByLabel("追加修改需求",{exact:true})).toHaveValue("保留未提交内容");
  expect(await database(page)).toEqual(before);
  await page.screenshot({path:info.outputPath("source-history.png")});
  await page.reload();await expect(source.locator(".generation-record")).toHaveCount(2);
  await expect(frame(page).locator("#perPersonVal")).toHaveText("¥5.25");expect(await database(page)).toEqual(before);expect(calls).toBe(0);
  const other=await browser.newContext(),p2=await other.newPage();await openExample(p2);const independent=await database(p2);
  expect(independent.projects[0].id).not.toBe(project.id);expect(independent.data.find(d=>d.projectId===independent.projects[0].id)?.state).toEqual(expectedState);await other.close();
});


test("真实计算、非法输入不保存、未知字段保全及关闭重开恢复",async({page,context})=>{
  await openExample(page);const id=new URL(page.url()).searchParams.get("project")!;
  await page.evaluate(async id=>{const r=indexedDB.open("atoms-projects",1);await new Promise<void>(resolve=>{r.onsuccess=()=>{const tx=r.result.transaction("applicationData","readwrite"),s=tx.objectStore("applicationData");s.get(id).onsuccess=e=>{const row=(e.target as IDBRequest).result;row.state.extra={keep:[1,2]};s.put(row);};tx.oncomplete=()=>{r.result.close();resolve();};};});},id);
  await page.reload();await change(page,"账单金额（元）","80");await expect(frame(page).locator("#perPersonVal")).toHaveText("¥21.00");
  const saved=await database(page);expect(saved.data.find(d=>d.projectId===id)?.state?.extra).toEqual({keep:[1,2]});
  for(const [label,value] of [["账单金额（元）","-1"],["小费比例（%）","-1"],["人数","0"],["人数","1.5"],["人数",""]]){
    await page.reload();await expect(frame(page).getByLabel(label)).toBeEnabled();await frame(page).getByLabel(label).fill(value);await expect(frame(page).locator("#perPersonVal")).toHaveText("—");expect(await database(page)).toEqual(saved);
  }
  const url=page.url();await page.close();const reopened=await context.newPage();await reopened.goto(url);await expect(frame(reopened).locator("#perPersonVal")).toHaveText("¥21.00");expect(await database(reopened)).toEqual(saved);
});


test("应用读取失败禁止编辑和写入；保存失败完整回滚后可重试",async({page})=>{
  await openExample(page);const before=await database(page),id=before.projects[0].id;
  await page.addInitScript(id=>{const get=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(key){if(this.name==="applicationData"&&key===id)throw new DOMException("read failure");return get.call(this,key);};Object.assign(window,{restoreGet:()=>{IDBObjectStore.prototype.get=get;}});},id);
  await page.reload();await expect(frame(page).locator('[data-atoms-status]')).toHaveText("读取失败");for(const input of await frame(page).locator("input").all())await expect(input).toBeDisabled();expect(await database(page)).toEqual(before);
  // Restore the read method on every following document.
  await page.addInitScript(()=>Reflect.get(window,"restoreGet")?.());await page.reload();await expect(frame(page).getByLabel("账单金额（元）")).toBeEnabled();
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==="applicationData")throw new DOMException("full");return put.apply(this,args);};Object.assign(window,{restorePut:()=>{IDBObjectStore.prototype.put=put;}});});
  await frame(page).getByLabel("账单金额（元）").fill("200");await expect(frame(page).locator('[data-atoms-status]')).toHaveText("保存失败");await expect(frame(page).getByLabel("账单金额（元）")).toHaveValue("20");await expect(frame(page).locator("#perPersonVal")).toHaveText("¥5.25");expect(await database(page)).toEqual(before);
  await page.evaluate(()=>Reflect.get(window,"restorePut")());await change(page,"账单金额（元）","200");await expect(frame(page).locator("#perPersonVal")).toHaveText("¥52.50");
});


test("来源历史与本人修改分开；候选试用隔离、采用只换代码、重开恢复",async({page})=>{
  await openExample(page);await change(page,"账单金额（元）","80");const before=await database(page);let calls=0;
  await page.route("**/api/generate",async route=>{calls++;const body=route.request().postDataJSON();expect(body.requirement).toContain("左右两栏");expect(Object.keys(body).sort()).toEqual(["baseDataIssues","baseHtml","context","modification","projectId","requirement"]);await fulfillGeneration(route,{json:{html:body.baseHtml.replace("<h1>小费计算器</h1>","<h1>我的小费计算器</h1>"),model:"synthetic",durationMs:1,generatedAt:"modified"}});});
  await page.getByLabel("追加修改需求",{exact:true}).fill("标题改为我的小费计算器");await page.getByRole("button",{name:"生成候选",exact:true}).click();await expect(frame(page).getByRole("heading",{name:"我的小费计算器"})).toBeVisible();
  await change(page,"账单金额（元）","100");expect((await database(page)).data).toEqual(before.data);
  await page.getByRole("button",{name:"采用修改",exact:true}).click();await expect(frame(page).getByLabel("账单金额（元）")).toHaveValue("80");
  const after=await database(page);expect(after.data).toEqual(before.data);expect(after.projects[0].initialGeneration).toBeUndefined();expect(after.projects[0].modificationRecords).toHaveLength(1);expect(after.projects[0].exampleSource).toEqual(before.projects[0].exampleSource);
  await page.reload();await expect(page.getByRole("region",{name:"示例来源记录"}).locator(".generation-record")).toHaveCount(2);await expect(page.getByRole("region",{name:"已采用修改记录"}).getByRole("heading",{name:"助手 已保存修改",exact:true})).toBeVisible();await expect(frame(page).getByRole("heading",{name:"我的小费计算器"})).toBeVisible();expect(calls).toBe(1);
});

async function seedOld(page: Page) {
  await page.goto("/?project=old");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("找不到该项目");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("atoms-projects", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["projects", "applicationData"], "readwrite");
      tx.objectStore("projects").put({ id: "old", title: "旧项目", requirement: "旧需求", updatedAt: "2026-09-01", result: { html: "<!doctype html><html><head></head><body>旧应用</body></html>", model: "historical", generatedAt: "old", durationMs: 1 } });
      tx.objectStore("applicationData").put({ projectId: "old", state: { unknown: ["保留"] } });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close();
  });
}

test("并发首访只有一份，旧标签无需升级可枚举项目，删除后与模板更新均不重灌", async ({ page, context }) => {
  const p2 = await context.newPage();
  await Promise.all([page.goto("/"), p2.goto("/")]);
  await expect(card(page)).toHaveCount(1); await expect(card(p2)).toHaveCount(1);
  const before = await database(page); expect(before.projects).toHaveLength(1);
  let downloads = 0;
  await context.route("**/examples/tip-calculator-v1.html", route => { downloads++; return route.fulfill({ body: "future template" }); });
  await page.reload(); await expect(card(page)).toHaveCount(1);
  expect((await database(page)).projects).toEqual(before.projects);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("atoms-projects", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction("projects", "readwrite"); tx.objectStore("projects").clear(); tx.oncomplete = () => resolve(); }); db.close();
  });
  await page.reload(); await expect(page.getByText("正在读取已有项目…")).toHaveCount(0);
  await expect(card(page)).toHaveCount(0); expect(downloads).toBe(0);
  expect((await database(page)).data).toHaveLength(3);
});

test("素材校验失败可重试且不丢输入、不留半份记录", async ({ page }) => {
  await page.route("**/examples/tip-calculator-v1.html", r => r.fulfill({ body: "invalid release" }));
  await page.goto("/"); await expect(page.getByRole("main").getByRole("alert")).toContainText("示例暂时准备失败");
  await page.getByLabel("你想做什么？").fill("保留我的需求");
  expect(await database(page)).toEqual({ projects: [], data: [] });
  await page.unroute("**/examples/tip-calculator-v1.html");
  await page.getByRole("button", { name: "重试读取与准备" }).click();
  await expect(card(page)).toHaveCount(1);
  await expect(page.getByLabel("你想做什么？")).toHaveValue("保留我的需求");
});

test("初始化事务中止回滚项目与标记，重试成功", async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (this.name === "applicationData" && args[0].kind === "workspace-initialization") request.addEventListener("success", () => this.transaction.abort());
      return request;
    };
    Object.assign(window, { restorePut: () => { IDBObjectStore.prototype.put = put; } });
  });
  await page.goto("/"); await expect(page.getByRole("main").getByRole("alert")).toContainText("示例暂时准备失败");
  expect(await database(page)).toEqual({ projects: [], data: [] });
  await page.evaluate(() => Reflect.get(window, "restorePut")());
  await page.getByRole("button", { name: "重试读取与准备" }).click();
  await expect(card(page)).toHaveCount(1); expect((await database(page)).data).toHaveLength(3);
});

test("读库失败不请求素材、不写标记，存储恢复可重试", async ({ page }) => {
  let downloads = 0; page.on("request", r => { if (r.url().includes("/examples/")) downloads++; });
  await page.addInitScript(() => {
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function () { throw new DOMException("read failure"); };
    Object.assign(window, { restoreRead: () => { IDBObjectStore.prototype.getAll = getAll; } });
  });
  await page.goto("/"); await expect(page.getByRole("main").getByRole("alert")).toContainText("当前无法保证保存与恢复");
  expect(downloads).toBe(0);
  await page.evaluate(() => Reflect.get(window, "restoreRead")());
  expect(await database(page)).toEqual({ projects: [], data: [] });
  await page.getByRole("button", { name: "重试读取与准备" }).click(); await expect(card(page)).toHaveCount(1);
});

// Upgrade races now use real UI saves and adoption in workspace-upgrade.spec.ts.

test("已有项目的初始化标记写入失败仍显示旧项目与数据", async ({ page }) => {
  await seedOld(page);
  const before = await database(page);
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException("readonly"); };
  });
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("当前无法保证保存与恢复");
  await expect(page.getByRole("region", { name: "已有项目" }).getByRole("button", { name: /旧项目/ })).toBeVisible();
  expect(await database(page)).toEqual(before);
});

test("已有项目保全、记录已处理，缺失深链接不被示例替换", async ({ page }) => {
  await seedOld(page);
  const original = await database(page); expect(original.data).toHaveLength(1);
  await page.goto("/"); await expect(page.getByText("正在读取已有项目…")).toHaveCount(0);
  const after = await database(page);
  expect(after.projects.filter(p => p.id === "old")).toEqual(original.projects);
  expect(after.projects).toHaveLength(2);
  expect(after.data.find(d => d.projectId === "old")).toEqual(original.data[0]);
  expect(after.data.some(d => d.projectId === "$atoms:workspace:first-visit")).toBe(true);
  await expect(card(page)).toHaveCount(1);
  await page.goto("/?project=missing"); await expect(page.getByRole("main").getByRole("alert")).toContainText("找不到该项目");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.goto("/?project=old"); await expect(frame(page).getByText("旧应用")).toBeVisible();
});

// Prepared for #46 centralized acceptance; not part of T1's two executed browser cases.
test("小费示例在代码模式采用后继续修改、放弃与再次采用，个人记录追加且来源不变", async ({ page }) => {
  await openExample(page);
  const original = await database(page);
  let calls = 0;
  await page.route("**/api/generate", async route => {
    const body = route.request().postDataJSON();
    calls++;
    expect(body.baseHtml).toContain(calls === 1 ? "<h1>小费计算器</h1>" : "<h1>个人版本1</h1>");
    await fulfillGeneration(route, { json: { html: body.baseHtml.replace(/<h1>.*?<\/h1>/, `<h1>个人版本${calls}</h1>`), model: "synthetic", durationMs: 1, generatedAt: `modified-${calls}` } });
  });
  await page.getByRole("button", { name: "查看代码", exact: true }).click();
  for (const round of [1, 2, 3]) {
    await page.getByLabel("追加修改需求", { exact: true }).fill(`个人版本${round}`);
    await page.getByRole("button", { name: "生成候选", exact: true }).click();
    await expect(page.getByRole("button", { name: "采用修改", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "查看代码", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("pre code")).toContainText(`<h1>个人版本${round}</h1>`);
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await change(page, "账单金额（元）", String(round * 100));
    expect((await database(page)).data).toEqual(original.data);
    await page.getByRole("button", { name: "查看代码", exact: true }).click();
    await page.getByRole("button", { name: round === 2 ? "放弃本轮修改" : "采用修改", exact: true }).click();
    await expect(page.getByRole("button", { name: "采用修改", exact: true })).toHaveCount(0);
    await expect(page.locator("pre code")).toContainText(`<h1>个人版本${round === 2 ? 1 : round}</h1>`);
  }
  const saved = await database(page);
  expect(saved.data).toEqual(original.data);
  expect(saved.projects[0].modificationRecords).toHaveLength(2);
  expect(saved.projects[0].exampleSource).toEqual(original.projects[0].exampleSource);
  await page.reload();
  await expect(frame(page).getByRole("heading", { name: "个人版本3" })).toBeVisible();
  await expect(frame(page).getByLabel("账单金额（元）")).toHaveValue("20");
  await expect(page.getByRole("region", { name: "示例来源记录" }).locator(".generation-record")).toHaveCount(2);
  expect(calls).toBe(3);
});
