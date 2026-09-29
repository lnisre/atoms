(async()=>{
phase='initial-use';const f=page.frameLocator('iframe');
async function add(title,status){await f.getByRole('textbox',{name:'书名',exact:true}).fill(title);await f.getByRole('combobox',{name:'阅读状态',exact:true}).selectOption(status);await f.getByRole('button',{name:'添加阅读记录'}).click();await expect(f.getByText(title,{exact:true})).toBeVisible();await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();}
await add('验收甲·三体','想读');await add('验收乙·人类简史','在读');
await f.getByRole('combobox',{name:'修改《验收甲·三体》的阅读状态',exact:true}).selectOption('已读');await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();
await add('验收丙·删除验证','想读');await f.getByRole('button',{name:'删除《验收丙·删除验证》',exact:true}).click();await expect(f.getByText('验收丙·删除验证',{exact:true})).toHaveCount(0);await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();
return capture('initial-saved');
})()
