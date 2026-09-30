import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const results=[];
for(const [taskId,body] of [['http-entry-regression',{requirement:''}],['http-modification',{requirement:'原应用',modification:'修改',baseHtml:'',context:[]}]]){
 const response=await fetch('https://v0-test0-nine.vercel.app/api/generate',{method:'POST',headers:{Accept:'application/x-ndjson','Content-Type':'application/json','X-Atoms-Task-Id':taskId},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200);const events=(await response.text()).trim().split('\n').map(x=>JSON.parse(x));assert.deepEqual(events.map(x=>x.type),['step','step','error']);assert.equal(events[1].event.status,'failed');assert.equal(events[2].taskId,taskId);assert.equal(events.some(x=>x.event?.stepId==='model'),false);results.push({taskId,status:response.status,events});
}
writeFileSync('/tmp/atoms-issue18/http-boundaries.json',JSON.stringify(results,null,2));console.log('2/2 HTTP validation failures have correct terminal events and no model step');
