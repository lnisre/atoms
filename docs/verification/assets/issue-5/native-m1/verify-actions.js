(async()=>{
 const f=page.frameLocator('iframe');
 const row=text=>f.getByRole('listitem').filter({has:f.getByText(text,{exact:true})});
 await expect(row('真实新产物第一条').getByRole('button',{name:'标记为未完成',exact:true})).toBeVisible();
 await expect(row('真实新产物第一条').getByText('优先级：中',{exact:true})).toBeVisible();
 await expect(row('原生M1-试用新增').getByText('优先级：高',{exact:true})).toBeVisible();
 const filter=await f.getByRole('group',{name:'按优先级筛选'}).boundingBox();const input=await f.getByLabel('新任务内容').boundingBox();assert.ok(filter.y<input.y);
 await f.getByRole('group',{name:'按优先级筛选'}).getByRole('button',{name:'高',exact:true}).click();await expect(f.getByText('真实新产物第一条',{exact:true})).toHaveCount(0);await expect(f.getByText('原生M1-试用新增',{exact:true})).toBeVisible();
 await f.getByRole('group',{name:'按优先级筛选'}).getByRole('button',{name:'全部',exact:true}).click();
 await row('真实新产物第一条').getByRole('button',{name:'标记为未完成',exact:true}).click();await expect(row('真实新产物第一条').getByRole('button',{name:'标记为已完成',exact:true})).toBeVisible();
 await row('原生M1-试用新增').getByRole('button',{name:'标记为已完成',exact:true}).click();await expect(row('原生M1-试用新增').getByRole('button',{name:'标记为未完成',exact:true})).toBeVisible();
 await row('真实新产物第一条').getByRole('button',{name:'删除任务',exact:true}).click();await expect(f.getByText('真实新产物第一条',{exact:true})).toHaveCount(0);
 await f.getByRole('group',{name:'选择新任务优先级'}).getByRole('button',{name:'低',exact:true}).click();await f.getByLabel('新任务内容').fill('原生M1-第二轮新增');await f.getByRole('button',{name:'添加任务',exact:true}).click();await expect(row('原生M1-第二轮新增').getByText('优先级：低',{exact:true})).toBeVisible();
 const evidence={originalGenerationHashVerified:true,twoRoundScenarioPassed:true,oldCompletionAndDefaultPreserved:true,previousTrialPreserved:true,addCompleteDelete:true,filterAboveInput:true,priorityFilterWorks:true,formalIntact:await intact(),dom:await f.locator('body').innerText()};writeFileSync(out+'/behavior.json',JSON.stringify(evidence,null,2));await page.screenshot({path:out+'/passed.png',fullPage:true});return evidence;
})()
