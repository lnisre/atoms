import {cpSync} from 'node:fs';
cpSync('.next/static','.next/standalone/.next/static',{recursive:true});
cpSync('runtime/team/runner.py','.next/standalone/runtime/team/runner.py');

cpSync('runtime/team/review.schema.json','.next/standalone/runtime/team/review.schema.json');

cpSync('public','.next/standalone/public',{recursive:true});
