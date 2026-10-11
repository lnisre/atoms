// Default prints a manifest only. Existing isolated profiles must be signed in
// through the actual email UI before --execute; never inject a fabricated cookie.
import {chromium} from '@playwright/test';
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {cloudCrossAppWorkflow,cloudReadingRequirement} from './cloud-cross-app-workflow';
import {readingChanges,acceptanceScenarios} from './cross-app-scenarios';
import {hash} from './independent-check';
async function main(){
 const manifest={requirement:cloudReadingRequirement,changes:readingChanges,taskCount:3,perTask:{deadlineMs:240000,modelRequests:20},data:'only new synthetic test project; no existing user business data',identity:'two independently authenticated browser profiles of the same normal account',planHashes:[false,true].map(rated=>hash(JSON.stringify(acceptanceScenarios('reading',rated))))};
 if(!process.argv.includes('--execute')){console.log(JSON.stringify(manifest,null,2));return;}
 const {TEST_BASE_URL,TEAM_EVIDENCE_DIR,CLOUD_PROFILE_A,CLOUD_PROFILE_B}=process.env;
 if(!TEST_BASE_URL||!TEAM_EVIDENCE_DIR||!CLOUD_PROFILE_A||!CLOUD_PROFILE_B)throw new Error('Target, fresh evidence directory and two authenticated isolated profiles required');
 const target=new URL(TEST_BASE_URL);if(target.username||target.password||target.search||target.hash||target.pathname!=='/'||!['https:','http:'].includes(target.protocol))throw new Error('Plain target origin required');
 const profiles=[CLOUD_PROFILE_A,CLOUD_PROFILE_B].map(p=>resolve(p));if(profiles[0]===profiles[1]||profiles.some(p=>!existsSync(p)))throw new Error('Distinct existing isolated profiles required');
 const out=resolve(TEAM_EVIDENCE_DIR);mkdirSync(out);const evidence=(name:string,value:unknown)=>writeFileSync(`${out}/${name}.json`,JSON.stringify(value,null,2));
 evidence('manifest',{...manifest,target:target.origin,deploymentId:process.env.TEAM_DEPLOYMENT_ID??null,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),driverHash:hash(readFileSync('tests/team/cloud-cross-app-workflow.ts','utf8'))});
 const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].flatMap(k=>process.env[k]?[[k,process.env[k]!]]:[]));
 const contexts=[];let completed=false;
 try{
  for(const profile of profiles){const context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,baseURL:target.origin,env});contexts.push(context);
   const bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;if(bypass)await context.route(url=>url.origin===target.origin,route=>route.continue({headers:{...route.request().headers(),'x-vercel-protection-bypass':bypass}}));
  }
  await cloudCrossAppWorkflow(contexts[0],contexts[1],target.origin,evidence);completed=true;
 }finally{for(const context of contexts)await context.close();evidence('summary',{completed,kind:'real Auth/BFF/model target, independent developer business checks',profiles:'retained as credential-bearing local profiles; never commit/upload',additionalAcceptance:'cross-account denial, expiry, concurrent writes, lost response and deployment latency are separate checks'});}
 console.log(JSON.stringify({completed,evidence:out}));
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Live cloud verification failed');process.exitCode=1;});
