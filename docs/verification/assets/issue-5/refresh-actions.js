(async()=>{
 let requests=0;const count=r=>{if(r.url().endsWith('/api/generate'))requests++};page.on('request',count);
 await page.reload();const f=page.frameLocator('iframe');
 await expect(f.getByText('旧项目修复第二条',{exact:true})).toBeVisible();
 await expect(f.getByText('M2刷新前-试用新增',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('本轮对话')).toHaveCount(0);await expect(page.getByLabel('追加修改需求')).toHaveValue('');
 await expect(page.locator('.preview-toolbar')).toContainText('已采用应用');assert.equal(requests,0);
 const evidence={refreshRestoredOriginal:true,dialogueCleared:true,generationRequests:requests,formalIntact:await intact(),dom:await f.locator('body').innerText()};writeFileSync(out+'/refresh.json',JSON.stringify(evidence,null,2));await page.screenshot({path:out+'/refresh.png',fullPage:true});page.off('request',count);return evidence;
})()
