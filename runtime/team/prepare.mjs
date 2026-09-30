import {cpSync} from 'node:fs';
cpSync('.next/static','.next/standalone/.next/static',{recursive:true});
cpSync('runtime/team/runner.py','.next/standalone/runtime/team/runner.py');
