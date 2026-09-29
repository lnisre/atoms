(async()=>{
phase='adoption';const f=page.frameLocator('iframe');const baseline=JSON.parse((await import('node:fs')).readFileSync(out+'/initial-saved.json','utf8'));
await page.getByRole('button',{name:'采用修改',exact:true}).click();await expect(page.getByText('项目已保存',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'采用修改',exact:true})).toHaveCount(0);await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();
await expect(f.getByText('仅试用·不应写回',{exact:true})).toHaveCount(0);
for(const name of ['验收甲·三体','验收乙·人类简史']){await expect(f.getByText(name,{exact:true})).toBeVisible();await expect(f.getByRole('combobox',{name:`修改《${name}》的评分`,exact:true})).toHaveValue('');await expect(f.getByRole('button',{name:`删除《${name}》`,exact:true})).toBeEnabled();}
await expect(f.getByRole('combobox',{name:'修改《验收乙·人类简史》的阅读状态',exact:true})).toHaveValue('在读');
const adopted=await snapshot();assert.deepEqual(adopted.data,baseline.data);assert.equal(adopted.project.result.html,(await import('node:fs')).readFileSync(out+'/model-2.html','utf8'));assert.equal(adopted.project.modificationRecords.length,1);assert.equal(adopted.project.modificationRecords[0].requests[0],calls[1].requirement);await capture('adopted-original-data');
phase='official-use';
await f.getByRole('combobox',{name:'修改《验收甲·三体》的评分',exact:true}).selectOption('5');await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();
await f.getByRole('combobox',{name:'修改《验收乙·人类简史》的评分',exact:true}).selectOption('3');await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();
await f.getByRole('combobox',{name:'修改《验收乙·人类简史》的阅读状态',exact:true}).selectOption('想读');await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();
await f.getByRole('combobox',{name:'按阅读状态筛选',exact:true}).selectOption('想读');await f.getByRole('combobox',{name:'按评分筛选',exact:true}).selectOption('3');await expect(f.getByText('验收乙·人类简史',{exact:true})).toBeVisible();await expect(f.getByText('验收甲·三体',{exact:true})).toHaveCount(0);await capture('official-filtered');
await f.getByRole('combobox',{name:'按评分筛选',exact:true}).selectOption('5');await expect(f.locator('.book-item')).toHaveCount(0);
await f.getByRole('combobox',{name:'按阅读状态筛选',exact:true}).selectOption('已读');await expect(f.getByText('验收甲·三体',{exact:true})).toBeVisible();
await f.getByRole('combobox',{name:'按阅读状态筛选',exact:true}).selectOption('all');await f.getByRole('combobox',{name:'按评分筛选',exact:true}).selectOption('all');
await capture('official-saved');save('adoption-checks',{onlyCodeAdopted:true,dataExactlyPreserved:true,trialAdditionAbsent:true,trialDeletionReverted:true,trialStatusReverted:true,trialRatingReverted:true,recordRequestPreserved:true,officialFilter:'want-to-read + 3 = B; want-to-read + 5 = empty; completed + 5 = A'});return 'ADOPTION AND OFFICIAL USE PASS';
})()
