import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {strict as assert} from 'node:assert';
import {previewHeadOffset} from '/Users/gaowenlong/Desktop/atoms/src/lib/html-document.ts';
import {previewDocument} from '/Users/gaowenlong/Desktop/atoms/src/lib/preview-document.ts';
const root='/Users/gaowenlong/Desktop/atoms';
const list=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?list(join(dir,x.name)):x.name.endsWith('.html')?[join(dir,x.name)]:[]);
const files=['issue-5','issue-6'].flatMap(d=>list(join(root,'docs/verification/assets',d)));
const results=[];
for(const file of files){
 const html=readFileSync(file,'utf8'),offset=previewHeadOffset(html);
 assert.notEqual(offset,null,file);
 const output=previewDocument(html,'review-channel','https://example.invalid');
 const prefix=html.slice(0,offset!),suffix=html.slice(offset!);
 assert.equal(output.slice(0,prefix.length),prefix);
 assert.equal(output.slice(output.length-suffix.length),suffix);
 assert.ok(output.slice(prefix.length).startsWith('<meta http-equiv="Content-Security-Policy"'));
 results.push({file:file.replace(root+'/',''),accepted:true,sourcePreserved:true});
}
writeFileSync('/tmp/atoms-m2-rereview/spec-assembly.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({historicalHtml:results.length,allAccepted:true,sourcePreserved:true}));
