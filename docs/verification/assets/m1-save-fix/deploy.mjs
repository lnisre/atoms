import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
const {VERCEL_TOKEN}=parseEnv(readFileSync('.vercel_atoms_agent.token','utf8'));
if(!VERCEL_TOKEN?.trim()||/[\r\n]/.test(VERCEL_TOKEN))throw new Error('Invalid token configuration');
const r=spawnSync(process.execPath,['/private/tmp/atoms-deploy-tools/node_modules/vercel/dist/index.js','deploy','--prod','--yes'],{cwd:process.cwd(),env:{...process.env,VERCEL_TOKEN:VERCEL_TOKEN.trim(),PATH:'/opt/homebrew/opt/node@24/bin:'+process.env.PATH},stdio:'inherit'});
process.exitCode=r.status??1;
