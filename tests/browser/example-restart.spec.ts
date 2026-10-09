import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SavedProject } from "../../src/lib/project-store";
import { fulfillGeneration } from "./team-fixture";

// A legacy snapshot establishes the pre-upgrade state. All later mutations,
// adoption and recovery use the public UI and a real persistent Chrome profile.
test("完整浏览器重启同时恢复旧副本、新示例个人采用代码、正式数据与来源记录", async ({}, info) => {
  test.setTimeout(90_000);
  const baseURL = info.project.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("A verified app origin is required");
  const profile = await mkdtemp(join(tmpdir(), "atoms-example-restart-"));
  const originalHtml = await readFile("public/examples/pomodoro-v1.html", "utf8");
  const legacy: SavedProject = {
    id: "restart-legacy", title: "示例 · 专注番茄钟", requirement: "旧番茄钟个人副本",
    updatedAt: "2026-10-02T00:00:00Z",
    exampleSource: {kind:"builtin-example", templateId:"focus-pomodoro",version:1,sourceCodeHash:"a6c8df564b6088fc986ae137286e2b039d0cb9c10ab678d17a56bccd11dfc489",codeHash:"d1d6944ff3eda19b7f5150e9895cacc71579313be13e1e40232153f5b747871f"},
    result: {html: originalHtml.replace("<h1>专注番茄钟</h1>", "<h1>我的旧计时器</h1>"),model:"legacy-fixture",generatedAt:"2026-10-02T00:00:00Z",durationMs:0},
    modificationRecords: [{id:"old-change",adoptedAt:"2026-10-02T01:00:00Z",requests:["修改旧标题"],summary:"已保存的旧个人修改"}],
  };
  let context: BrowserContext | undefined;
  const requests: {round:number;path:string}[] = [];
  const generations: number[] = [];
  async function launch(round: number) {
    context = await chromium.launchPersistentContext(profile,{channel:"chrome",headless:true,baseURL,viewport:{width:1440,height:900}});
    await context.route("**/*",async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==new URL(baseURL!).origin){await route.abort();return;}
      if(url.pathname.startsWith("/api/"))requests.push({round,path:url.pathname});
      if(url.pathname==="/api/generate"){
        generations.push(round);
        if(round!==1){await route.abort();return;}
        const body=route.request().postDataJSON();
        expect(body.modification).toBe("标题改为我的小费工具");
        await fulfillGeneration(route,{json:{html:body.baseHtml.replace("<h1>小费计算器</h1>","<h1>我的小费工具</h1>"),model:"synthetic",generatedAt:"restart-adopted",durationMs:1,assistantReply:"已更新标题（受控响应）"}});
      }else if(url.pathname.startsWith("/api/"))await route.abort();
      else await route.continue();
    });
    return context.newPage();
  }
  async function close() {
    if(!context)return;
    const current=context;context=undefined;
    // Playwright Test owns tracing for these contexts, including closed ones.
    await current.close();
  }
  async function snapshot(page: Page) {
    return page.evaluate(async()=>{
      const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("atoms-projects",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      try{return await new Promise<{projects:SavedProject[];data:{projectId:string;state?:Record<string,unknown>}[]}>((resolve,reject)=>{
        const tx=db.transaction(["projects","applicationData"]),p=tx.objectStore("projects").getAll(),d=tx.objectStore("applicationData").getAll();
        tx.oncomplete=()=>resolve({projects:p.result,data:d.result});tx.onabort=()=>reject(tx.error);
      });}finally{db.close();}
    });
  }
  const card=(page:Page)=>page.getByRole("region",{name:"已有项目"}).getByRole("button",{name:/示例 · 小费计算器/});
  const frame=(page:Page)=>page.frameLocator("iframe");
  try {
    let page=await launch(1);
    await page.goto("/?project=restart-missing");await expect(page.getByRole("main").getByRole("alert")).toContainText("找不到该项目");
    await page.evaluate(async serialized=>{
      const project: SavedProject = JSON.parse(serialized);
      const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("atoms-projects",1);r.onsuccess=()=>resolve(r.result);});
      await new Promise<void>((resolve,reject)=>{const tx=db.transaction(["projects","applicationData"],"readwrite");
        tx.objectStore("projects").put(project);tx.objectStore("applicationData").put({projectId:project.id,state:{mode:"focus",remaining:987,running:false,completedFocusCount:4,custom:{keep:true}}});
        tx.objectStore("applicationData").put({projectId:"$atoms:workspace:first-visit",completed:true});
        tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
      });db.close();
    },JSON.stringify(legacy));
    await page.goto("/?project=restart-legacy");
    await expect(frame(page).locator("#timeDisplay")).toHaveText("16:27");
    await frame(page).getByRole("button",{name:"开始",exact:true}).press("Enter");
    await expect(frame(page).locator("#timeDisplay")).not.toHaveText("16:27");
    await frame(page).getByRole("button",{name:"暂停",exact:true}).press("Enter");
    await expect(frame(page).locator("#status")).toHaveText("已保存");
    const pausedTime=await frame(page).locator("#timeDisplay").innerText();
    await page.getByRole("button",{name:"Atoms 首页",exact:true}).click();await card(page).click();
    await expect(frame(page).locator("#perPersonVal")).toHaveText("¥5.25");
    const previewHandle=await page.locator("iframe").elementHandle();
    for(const viewport of [{width:1440,height:900},{width:1280,height:720},{width:736,height:900}]) {
      await page.setViewportSize(viewport);
      await page.getByRole("region",{name:"项目对话与详情"}).evaluate(el=>{el.scrollTop=0;});
      const chat=await page.locator(".project-panel").boundingBox(),result=await page.getByRole("region",{name:"项目成果"}).boundingBox();
      expect(chat).not.toBeNull();expect(result).not.toBeNull();
      expect(chat!.x+chat!.width).toBeLessThanOrEqual(result!.x+1);
      expect(result!.x+result!.width).toBeLessThanOrEqual(viewport.width);
      await expect(page.getByLabel("追加修改需求",{exact:true})).toBeVisible();
      await expect(page.getByRole("button",{name:"查看代码",exact:true})).toBeVisible();
      expect(await previewHandle!.evaluate(el=>el===document.querySelector("iframe"))).toBe(true);
      await page.screenshot({path:info.outputPath(`tip-layout-${viewport.width}.png`)});
    }
    await page.setViewportSize({width:1440,height:900});
    await frame(page).getByLabel("账单金额（元）").fill("80");await expect(frame(page).locator('[data-atoms-status]')).toHaveText("已保存");
    await page.getByLabel("追加修改需求",{exact:true}).fill("标题改为我的小费工具");await page.getByRole("button",{name:"生成候选",exact:true}).click();
    await expect(frame(page).getByRole("heading",{name:"我的小费工具"})).toBeVisible();
    await frame(page).getByLabel("账单金额（元）").fill("100");await expect(frame(page).locator('[data-atoms-status]')).toHaveText("已保存");
    await page.getByRole("button",{name:"查看代码",exact:true}).click();
    await page.getByRole("button",{name:"采用修改",exact:true}).click();await expect(page.getByRole("button",{name:"采用修改",exact:true})).toHaveCount(0);
    await expect(page.getByText("执行记录正在保存",{exact:false})).toHaveCount(0);
    await page.getByRole("button",{name:"预览",exact:true}).click();await expect(frame(page).getByLabel("账单金额（元）")).toHaveValue("80");
    const tipURL=page.url(),before=await snapshot(page),tipId=new URL(tipURL).searchParams.get("project")!;
    expect(before.projects).toHaveLength(2);expect(before.projects.find(p=>p.id===tipId)?.modificationRecords).toHaveLength(1);
    expect(before.projects.find(p=>p.id===legacy.id)?.result).toEqual(legacy.result);
    await writeFile(info.outputPath("restart-before.json"),JSON.stringify(before,null,2));
    await close();
    page=await launch(2);await page.goto("/");await expect(card(page)).toHaveCount(1);await card(page).click();
    await expect(page).toHaveURL(tipURL);await expect(page.getByRole("button",{name:"预览",exact:true})).toHaveAttribute("aria-pressed","true");
    await expect(frame(page).getByRole("heading",{name:"我的小费工具"})).toBeVisible();await expect(frame(page).locator("#perPersonVal")).toHaveText("¥21.00");
    await expect(page.getByRole("region",{name:"示例来源记录"}).locator(".generation-record")).toHaveCount(2);
    await expect(page.getByRole("region",{name:"已采用修改记录"})).toContainText("标题改为我的小费工具");
    await page.getByRole("button",{name:"查看代码",exact:true}).click();await expect(page.locator("pre code")).toHaveText(before.projects.find(p=>p.id===tipId)!.result.html);
    await page.goto("/?project=restart-legacy");await expect(frame(page).locator("#timeDisplay")).toHaveText(pausedTime);await expect(frame(page).locator("#countDisplay")).toHaveText("已完成专注 4 次");
    await expect(page.getByRole("region",{name:"已采用修改记录"})).toContainText("已保存的旧个人修改");
    await page.getByRole("button",{name:"查看代码",exact:true}).click();await expect(page.locator("pre code")).toHaveText(legacy.result.html);
    const after=await snapshot(page);expect(after).toEqual(before);expect(generations).toEqual([1]);expect(requests.filter(r=>r.round===2)).toHaveLength(0);
    await writeFile(info.outputPath("restart-after.json"),JSON.stringify(after,null,2));await writeFile(info.outputPath("restart-requests.json"),JSON.stringify({requests,generations,providerCalls:0},null,2));
    await page.screenshot({path:info.outputPath("restart-restored.png")});
  } finally {await close();await rm(profile,{recursive:true,force:true});}
});
