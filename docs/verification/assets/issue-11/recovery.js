(async()=>{
const baseline=await snapshot();const generationCount=requests.filter(x=>x.url.endsWith('/api/generate')).length;
async function verify(name){
await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();const f=page.frameLocator('iframe');
for(const [title,status,rating] of [['验收甲·三体','已读','5'],['验收乙·人类简史','想读','3']]){
await expect(f.getByText(title,{exact:true})).toBeVisible();await expect(f.getByRole('combobox',{name:`修改《${title}》的阅读状态`,exact:true})).toHaveValue(status);await expect(f.getByRole('combobox',{name:`修改《${title}》的阅读状态`,exact:true})).toBeEnabled();await expect(f.getByRole('combobox',{name:`修改《${title}》的评分`,exact:true})).toHaveValue(rating);await expect(f.getByRole('button',{name:`删除《${title}》`,exact:true})).toBeEnabled();}
await expect(f.getByText('仅试用·不应写回',{exact:true})).toHaveCount(0);
await expect(page.getByRole('region',{name:'已采用修改记录',exact:true})).toContainText(calls[1].requirement);
assert.deepEqual(await snapshot(),baseline);assert.equal(requests.filter(x=>x.url.endsWith('/api/generate')).length,generationCount);await capture(name);
}
phase='official-refresh';await page.reload();await verify('official-refreshed');
phase='complete-close';save('close-event',{at:new Date().toISOString(),profile,projectId:baseline.project.id,openPages:context.pages().length});await context.close();
phase='complete-reopen';await launch();await expect(page.getByRole('region',{name:'已有项目',exact:true}).getByRole('button')).toHaveCount(1);await page.screenshot({path:`${out}/reopened-list.png`});
await page.getByRole('region',{name:'已有项目',exact:true}).getByRole('button').click();await verify('complete-reopened');
phase='reopened-use';const f=page.frameLocator('iframe');
await f.getByRole('combobox',{name:'按评分筛选',exact:true}).selectOption('5');await expect(f.getByText('验收甲·三体',{exact:true})).toBeVisible();await expect(f.getByText('验收乙·人类简史',{exact:true})).toHaveCount(0);await f.getByRole('combobox',{name:'按评分筛选',exact:true}).selectOption('all');
await f.getByRole('combobox',{name:'修改《验收乙·人类简史》的阅读状态',exact:true}).selectOption('已读');await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();assert.equal((await snapshot()).data.state[1].status,'已读');
await f.getByRole('combobox',{name:'修改《验收乙·人类简史》的阅读状态',exact:true}).selectOption('想读');await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();assert.deepEqual((await snapshot()).data.state,baseline.data.state);await capture('reopened-editable');
save('recovery-checks',{refreshExact:true,completeBrowserClose:true,profile,projectListEntryCount:1,codeAndRecordsExactlyRestored:true,dataExactlyRestored:true,reopenedControlsEnabled:true,reopenedStatusChangesSaved:true,reopenedFilterWorks:true,generationCountBefore:generationCount,generationCountAfter:requests.filter(x=>x.url.endsWith('/api/generate')).length,recoveryGenerationCalls:0,projectId:baseline.project.id,htmlSha256:hash(baseline.project.result.html)});return 'RECOVERY PASS';
})()
