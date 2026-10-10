import { test, expect, type Page } from "@playwright/test";

// Synthetic Auth HTTP responses verify UI behavior only; real mail/Auth is #69.
async function authFixture(page: Page) {
  let signedIn = false, verifies = 0, modelCalls = 0;
  await page.route("**/api/projects", route => route.fulfill({json:[]}));
  await page.route("**/api/auth/session", route => route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { account: { id: "fixture", email: "fixture@example.invalid" } } : {error:"请先登录"} }));
  await page.route("**/api/auth/code", route => route.fulfill({json:{sent:true,retryAfter:60,expiresIn:600}}));
  await page.route("**/api/auth/verify", route => {
    verifies++;
    if(route.request().postDataJSON().code!=="123456")return route.fulfill({status:400,json:{error:"验证码错误，请重新输入。"}});
    signedIn=true;return route.fulfill({json:{account:{id:"fixture",email:"fixture@example.invalid"}}});
  });
  await page.route("**/api/auth/logout",route=>{signedIn=false;return route.fulfill({json:{signedOut:true}});});
  await page.route("**/api/generate",route=>{modelCalls++;return route.fulfill({status:500,json:{error:"unexpected model call"}});});
  return { stats: () => ({ verifies, modelCalls }) };
}
async function signIn(page: Page) {
  await page.getByLabel("邮箱地址",{exact:true}).fill("fixture@example.invalid");
  await page.getByRole("button",{name:"发送验证码",exact:true}).click();
  await page.getByLabel("6 位验证码",{exact:true}).fill("123456");
  await page.getByRole("button",{name:"验证并登录"}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("fixture@example.invalid",{exact:true})).toBeVisible();
}
test("游客只读示例阻断鼠标、键盘、API与原始数据桥；不创建或读取本地库",async({page},info)=>{
  const auth=await authFixture(page);
  await page.addInitScript(()=>{
    Object.assign(window,{idbCalls:0});
    const open=indexedDB.open.bind(indexedDB);
    indexedDB.open=(name,version)=>{if(name==="atoms-projects"){Reflect.set(window,"idbCalls",Reflect.get(window,"idbCalls")+1);throw new Error("old local DB must stay untouched");}return open(name,version);};
  });
  await page.goto("/");await page.getByRole("button",{name:"查看只读示例"}).click();
  const frame=page.frameLocator('iframe[title="生成的应用"]');
  await expect(frame.locator("#perPersonVal")).toHaveText("¥5.25");
  await expect(page.getByText("只读示例 · 未创建个人项目",{exact:true})).toBeVisible();
  const input=frame.getByLabel("账单金额（元）");const box=await input.boundingBox();expect(box).not.toBeNull();
  await page.mouse.click(box!.x+15,box!.y+15);await page.keyboard.type("999");await page.keyboard.press("Enter");
  await expect(input).toHaveValue("20");
  const api=await frame.locator("body").evaluate(async()=>{
    const atoms=Reflect.get(window,"atoms");const before=await atoms.loadState();let error="";
    try{await atoms.saveState({bill:999});}catch(e){error=String(e);}
    return {before,after:await atoms.loadState(),error,inert:document.body.inert};
  });
  expect(api.inert).toBe(true);expect(api.after).toEqual(api.before);expect(api.error).toContain("只读");
  // Bypass window.atoms: parent independently rejects a forged save from its
  // legitimate frame/channel. A UI-only guard would fail this assertion.
  const source=await page.locator("iframe").getAttribute("srcdoc");
  const config=JSON.parse(source!.match(/const \{channel,origin,readOnly\}=(.*);/)![1]);
  const applicationFrame = await (await page.locator("iframe").elementHandle())!.contentFrame();
  const bridge=await applicationFrame!.evaluate(({channel,origin})=>new Promise(resolve=>{
    addEventListener("message",function receive(event){if(event.data.id===98765){removeEventListener("message",receive);resolve(event.data);}});
    parent.postMessage({channel,type:"atoms:state",method:"save",id:98765,state:{bill:999}},origin);
  }),config);
  expect(bridge).toMatchObject({ok:false,error:expect.stringContaining("只读")});
  expect(await page.evaluate(()=>Reflect.get(window,"idbCalls"))).toBe(0);expect(auth.stats().modelCalls).toBe(0);
  await page.screenshot({path:info.outputPath("readonly-example.png"),fullPage:true});
});
test("登录错误保留需求，取消不续接；成功只验证一次且不提前调用未接入的生成",async({page},info)=>{
  const auth=await authFixture(page);await page.goto("/");
  const input=page.getByLabel("你想做什么？");await input.fill("保留这次明确发起的需求");await page.getByRole("button",{name:"开始生成",exact:true}).click();
  await expect(page.getByText("已保留刚才的操作与输入，登录后继续。")).toBeVisible();
  await page.getByLabel("邮箱地址",{exact:true}).fill("fixture@example.invalid");await page.getByRole("button",{name:"发送验证码",exact:true}).click();
  await page.getByLabel("6 位验证码",{exact:true}).fill("000000");await page.getByRole("button",{name:"验证并登录"}).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("验证码错误，请重新输入。");await expect(input).toHaveValue("保留这次明确发起的需求");
  await page.screenshot({path:info.outputPath("login-error.png")});
  await page.getByRole("button",{name:"关闭登录"}).click();
  await expect(input).toHaveValue("保留这次明确发起的需求");
  await page.getByRole("button",{name:"开始生成",exact:true}).click();
  await page.getByLabel("邮箱地址",{exact:true}).fill("fixture@example.invalid");await page.getByRole("button",{name:"发送验证码",exact:true}).click();
  await page.getByLabel("6 位验证码",{exact:true}).fill("123456");await page.getByRole("button",{name:"验证并登录"}).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page.getByRole("status").filter({hasText:"需求已保留"})).toBeVisible();
  expect(auth.stats()).toEqual({verifies:2,modelCalls:0});await expect(input).toHaveValue("保留这次明确发起的需求");
});
test("普通登录和有效会话恢复无生成/复制副作用；退出清除账号和输入，旧本地数据保留",async({page})=>{
  const auth=await authFixture(page);await page.goto("/");
  await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("atoms-projects",1);r.onupgradeneeded=()=>{r.result.createObjectStore("projects",{keyPath:"id"});r.result.createObjectStore("applicationData",{keyPath:"projectId"});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise<void>(resolve=>{const tx=db.transaction("projects","readwrite");tx.objectStore("projects").put({id:"old-project",title:"do not claim me"});tx.oncomplete=()=>resolve();});db.close();
  });
  await page.getByRole("button",{name:"登录 / 注册"}).click();await signIn(page);
  await expect(page.getByText(/需求已保留/)).toHaveCount(0);await expect(page.getByText("do not claim me")).toHaveCount(0);await expect(page.locator("iframe")).toHaveCount(0);
  await page.reload();await expect(page.getByText("fixture@example.invalid",{exact:true})).toBeVisible();
  await page.getByLabel("你想做什么？").fill("清除页面输入");await page.getByRole("button",{name:"退出登录"}).click();
  await expect(page.getByRole("button",{name:"登录 / 注册"})).toBeVisible();await expect(page.getByLabel("你想做什么？")).toHaveValue("");
  const rows=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("atoms-projects",1);r.onsuccess=()=>resolve(r.result);});const rows=await new Promise(resolve=>{const r=db.transaction("projects").objectStore("projects").getAll();r.onsuccess=()=>resolve(r.result);});db.close();return rows;});
  expect(rows).toEqual([{id:"old-project",title:"do not claim me"}]);expect(auth.stats().modelCalls).toBe(0);
});
