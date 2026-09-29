const { chromium } = require('/Users/gaowenlong/Desktop/atoms/node_modules/@playwright/test');
const fs = require('fs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage();
 await page.evaluate(()=>{window.writes=[];window.atoms={loadState:async()=>null,saveState:data=>new Promise(resolve=>window.writes.push({data:structuredClone(data),resolve}))}});
 await page.setContent(fs.readFileSync('/private/tmp/atoms-m1-review/snapshot/docs/verification/assets/issue-3/production-todo.html','utf8'));
 await page.getByLabel('新任务描述').waitFor();
 const result=await page.evaluate(async()=>{
  const input=document.querySelector('#taskInput'),button=document.querySelector('#addBtn');
  input.value='A';button.click();
  input.value='B';button.click();
  window.writes[0].resolve();
  await Promise.resolve();await Promise.resolve();
  return {visibleTasks:[...document.querySelectorAll('.task-title')].map(x=>x.textContent),saveStatus:document.querySelector('#saveStatus').textContent,writesIssued:window.writes.length,persistedSnapshot:window.writes[0].data};
 });
 console.log(JSON.stringify(result,null,2));
 await browser.close();
})()
