import {test} from '@playwright/test';
import {fixture} from '../helpers/cloud-browser-fixture';
import {crossAppFixture} from '../team/cross-app-fixture';
import {cloudCrossAppWorkflow} from '../team/cloud-cross-app-workflow';

test('current account cloud cross-app workflow and independent generated-app contract checks',async({context,browser,baseURL},info)=>{
 test.setTimeout(120000);
 const store=await fixture();store.render(revision=>crossAppFixture('reading',revision>1,revision>2));await store.connect(context);
 const second=await browser.newContext({baseURL});await store.connect(second);
 try{await cloudCrossAppWorkflow(context,second,baseURL!, (name,value)=>{void info.attach(name,{body:JSON.stringify(value),contentType:'application/json'});});}finally{await second.close();}
});
