(async()=>{
phase='trial';const f=page.frameLocator('iframe');
const baseline=JSON.parse((await import('node:fs')).readFileSync(out+'/initial-saved.json','utf8'));
const before=await snapshot();assert.deepEqual(before.data,baseline.data);assert.deepEqual(before.project,baseline.project);
for(const name of ['验收甲·三体','验收乙·人类简史']){await expect(f.getByRole('combobox',{name:`修改《${name}》的阅读状态`,exact:true})).toBeEnabled();await expect(f.getByRole('combobox',{name:`修改《${name}》的评分`,exact:true})).toHaveValue('');}
await capture('candidate-defaults');
await f.getByRole('combobox',{name:'修改《验收甲·三体》的评分',exact:true}).selectOption('5');await expect(page.getByText('试用数据已更新 · 仅本轮会话有效，未写入正式数据',{exact:true})).toBeVisible();
await f.getByRole('combobox',{name:'按评分筛选',exact:true}).selectOption('5');await expect(f.getByText('验收甲·三体',{exact:true})).toBeVisible();await expect(f.getByText('验收乙·人类简史',{exact:true})).toHaveCount(0);
await f.getByRole('combobox',{name:'按阅读状态筛选',exact:true}).selectOption('在读');await expect(f.locator('.book-item')).toHaveCount(0);
await f.getByRole('combobox',{name:'按阅读状态筛选',exact:true}).selectOption('已读');await expect(f.locator('.book-item')).toHaveCount(1);await capture('candidate-filtered');
await f.getByRole('combobox',{name:'按评分筛选',exact:true}).selectOption('none');await expect(f.locator('.book-item')).toHaveCount(0);
await f.getByRole('combobox',{name:'按阅读状态筛选',exact:true}).selectOption('all');await expect(f.getByText('验收乙·人类简史',{exact:true})).toBeVisible();
await f.getByRole('combobox',{name:'按评分筛选',exact:true}).selectOption('all');
await f.getByRole('textbox',{name:'书名',exact:true}).fill('仅试用·不应写回');await f.getByRole('button',{name:'添加阅读记录',exact:true}).click();await expect(f.getByText('仅试用·不应写回',{exact:true})).toBeVisible();
await f.getByRole('combobox',{name:'修改《验收乙·人类简史》的阅读状态',exact:true}).selectOption('已读');
await f.getByRole('button',{name:'删除《验收甲·三体》',exact:true}).click();await expect(f.getByText('验收甲·三体',{exact:true})).toHaveCount(0);
await expect(page.getByText('试用数据已更新 · 仅本轮会话有效，未写入正式数据',{exact:true})).toBeVisible();assert.deepEqual(await snapshot(),before);
save('trial-checks',{defaults:'both unrated',rating5Filter:'A only',combinedInProgress5:'empty',combinedCompleted5:'A only',unratedFilter:'B only',trialAdded:'仅试用·不应写回',trialDeleted:'验收甲·三体',trialStatus:'B completed',officialProjectAndDataUnchanged:true});
await capture('trial-mutated');
const geometry=[];for(const viewport of [{width:1440,height:900},{width:1280,height:720}]){
await page.setViewportSize(viewport);
const items={};for(const [key,locator] of Object.entries({input:page.getByLabel('追加修改需求'),preview:page.locator('iframe'),adopt:page.getByRole('button',{name:'采用修改',exact:true}),discard:page.getByRole('button',{name:'放弃本轮修改',exact:true}),notice:page.locator('.candidate-actions')})){
await expect(locator).toBeVisible();const b=await locator.boundingBox();assert(b && b.x>=0 && b.y>=0 && b.x+b.width<=viewport.width+1 && b.y+b.height<=viewport.height+1,key);items[key]=b;}
geometry.push({viewport,items});await capture(`candidate-${viewport.width}`);}
save('desktop-geometry',geometry);await page.setViewportSize({width:1440,height:900});return 'TRIAL PASS';
})()
