(async()=>{
 const before=await page.locator('iframe').getAttribute('srcdoc');
 await page.route('**/api/generate',r=>r.fulfill({status:502,json:{error:'验收注入：模型服务暂时不可用'}}));
 await page.getByLabel('追加修改需求').fill('本轮受控失败检查');await page.getByRole('button',{name:'生成候选',exact:true}).click();
 await expect(page.getByRole('region',{name:'对话修改'}).getByRole('alert')).toContainText('验收注入');
 assert.equal(await page.locator('iframe').getAttribute('srcdoc'),before);await intact();
 await page.screenshot({path:out+'/failure-keeps-real-candidate.png',fullPage:true});
 await page.unroute('**/api/generate');
 await page.getByRole('button',{name:'放弃本轮修改'}).click();
 const f=page.frameLocator('iframe');await expect(f.getByText('旧项目修复第二条',{exact:true})).toBeVisible();
 await expect(f.getByText('M2试用新增-高优先级',{exact:true})).toHaveCount(0);
 await expect(f.getByText('M2第三轮-低优先级',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('本轮对话')).toHaveCount(0);
 const evidence={controlledFailureRetainedRealCandidate:true,discardRestoredOriginal:true,formalIntact:await intact(),dom:await f.locator('body').innerText()};writeFileSync(out+'/discard.json',JSON.stringify(evidence,null,2));await page.screenshot({path:out+'/discard.png',fullPage:true});return evidence;
})()
