(async()=>{
 const f=page.frameLocator('iframe');
 await expect(f.locator('#pendingList .priority-tag')).toHaveCount(3);
 const filter=await f.getByRole('group',{name:'按优先级筛选'}).boundingBox();const input=await f.getByLabel('新任务描述').boundingBox();assert.ok(filter.y<input.y);
 await f.getByLabel('任务优先级',{exact:true}).selectOption('high');await f.getByLabel('新任务描述').fill('M2刷新前-试用新增');await f.getByRole('button',{name:'添加',exact:true}).click();
 await expect(f.getByText('M2刷新前-试用新增',{exact:true})).toBeVisible();
 await f.getByRole('group',{name:'按优先级筛选'}).getByRole('button',{name:'高',exact:true}).click();await expect(f.getByText('关闭窗口第一条',{exact:true})).toHaveCount(0);await expect(f.getByText('M2刷新前-试用新增',{exact:true})).toBeVisible();
 await f.getByRole('group',{name:'按优先级筛选'}).getByRole('button',{name:'全部',exact:true}).click();
 const row=title=>f.locator('.task-item').filter({has:f.getByText(title,{exact:true})});
 await row('旧项目修复第一条').getByRole('button',{name:'标记为已完成',exact:true}).click();await expect(row('旧项目修复第一条').getByRole('button',{name:'标记为未完成',exact:true})).toBeVisible();
 await row('旧项目修复第二条').getByRole('button',{name:'删除任务',exact:true}).click();await expect(f.getByText('旧项目修复第二条',{exact:true})).toHaveCount(0);
 const evidence={twoRoundScenarioPassed:true,defaultPriority:'中',filterAboveInput:true,addCompleteDelete:true,filterWorks:true,formalIntact:await intact(),dom:await f.locator('body').innerText()};writeFileSync(out+'/round-5-behavior.json',JSON.stringify(evidence,null,2));await page.screenshot({path:out+'/round-5-passed.png',fullPage:true});return evidence;
})()
