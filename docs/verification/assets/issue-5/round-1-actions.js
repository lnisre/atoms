(async()=>{
 const f=page.frameLocator('iframe');
 await f.getByRole('group',{name:'选择新任务优先级'}).getByRole('button',{name:'高',exact:true}).click();
 await f.getByLabel('新任务描述').fill('M2试用新增-高优先级');
 await f.getByRole('button',{name:'添加',exact:true}).click();
 await expect(f.getByText('M2试用新增-高优先级',{exact:true})).toBeVisible();
 await f.getByRole('group',{name:'按优先级筛选'}).getByRole('button',{name:'高',exact:true}).click();
 await expect(f.getByText('关闭窗口第一条',{exact:true})).toHaveCount(0);
 await expect(f.getByText('M2试用新增-高优先级',{exact:true})).toBeVisible();
 await f.getByRole('group',{name:'按优先级筛选'}).getByRole('button',{name:'全部',exact:true}).click();
 await f.getByRole('button',{name:'标记为已完成：旧项目修复第一条',exact:true}).click();
 await expect(f.getByRole('button',{name:'标记为未完成：旧项目修复第一条',exact:true})).toBeVisible();
 await f.getByRole('button',{name:'删除任务：旧项目修复第二条',exact:true}).click();
 const result={dom:await f.locator('body').innerText(),deleted:await f.getByText('旧项目修复第二条',{exact:true}).count()===0,formalIntact:await intact()};
 writeFileSync(out+'/round-1-behavior.json',JSON.stringify(result,null,2));
 await page.screenshot({path:out+'/round-1-behavior.png',fullPage:true});return result;
})()
