(async()=>{
 let f=page.frameLocator('iframe');await expect(f.getByRole('heading',{name:'关闭重开候选验收',exact:true})).toBeVisible();
 await f.getByLabel('新任务描述').fill('M2关闭前-试用新增');await f.getByRole('button',{name:'添加',exact:true}).click();await expect(f.getByText('M2关闭前-试用新增',{exact:true})).toBeVisible();await intact();await page.screenshot({path:out+'/before-close.png',fullPage:true});
 await context.close();context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:{width:1440,height:1100}});
 let requests=0;context.on('request',r=>{if(r.url().endsWith('/api/generate'))requests++});page=await context.newPage();await page.goto('https://v0-test0-nine.vercel.app');await page.getByRole('region',{name:'已有项目'}).getByRole('button',{name:/M1 修复前复现/}).click();assert.equal(page.url(),url);
 f=page.frameLocator('iframe');await expect(f.getByText('旧项目修复第二条',{exact:true})).toBeVisible();await expect(f.getByText('M2关闭前-试用新增',{exact:true})).toHaveCount(0);await expect(f.getByRole('heading',{name:'关闭重开候选验收',exact:true})).toHaveCount(0);await expect(page.getByLabel('本轮对话')).toHaveCount(0);
 const evidence={fullBrowserRestart:true,reopenedFromProjectList:true,candidateAndTrialAndDialogueGone:true,generationRequests:requests,formalIntact:await intact(),dom:await f.locator('body').innerText()};assert.equal(requests,0);writeFileSync(out+'/close-reopen.json',JSON.stringify(evidence,null,2));await page.screenshot({path:out+'/close-reopen.png',fullPage:true});return evidence;
})()
