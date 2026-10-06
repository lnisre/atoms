// Offline integration reproduction: real readTeam + real adapter from fixed Git revisions.
// EventTarget/WebSocket is synthetic; neither timers nor ReadableStream are mocked.
// Error observers record failures; they do not repair product behavior.
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const revision = process.argv[2];
if (!['886f933c3015d3c810f85662812c5bc201a478f7', '3be65e0734f21382ff77f5b2b5c6e8a0ca8d30a1'].includes(revision)) throw new Error('Expected frozen review revision');
const source = file => execFileSync('git', ['show', `${revision}:${file}`], {encoding:'utf8'});
const hash = value => createHash('sha256').update(value).digest('hex');
const asModule = source => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64');
const socketSource = source('src/lib/team/socket.ts');
const clientSource = source('src/lib/team/client.ts');
const socketModule = asModule(socketSource);
const dependencies = [];
let client = stripTypeScriptTypes(clientSource);
client = client.replace(/from "([.][^"]+)"/g, (_, p) => {
 if (p === './socket') return 'from ' + JSON.stringify(socketModule);
 const path = new URL(p + '.ts', pathToFileURL(process.cwd() + '/src/lib/team/client.ts'));
 dependencies.push(path.href);
 return 'from ' + JSON.stringify(path.href);
});
const { readTeam } = await import(asModule(client));
const unhandledRejections = [], uncaughtExceptions = [];
process.on('unhandledRejection', reason => unhandledRejections.push(String(reason)));
process.on('uncaughtException', reason => uncaughtExceptions.push(String(reason)));
class Socket extends EventTarget {
 static OPEN=1; static CLOSING=2; static CLOSED=3; static latest;
 readyState=0; sent=[];
 constructor(){super();Socket.latest=this;}
 send(value){this.sent.push(JSON.parse(value));}
 close(){
  if(this.readyState >= Socket.CLOSING)return;
  this.readyState=Socket.CLOSING;
  queueMicrotask(()=>{this.readyState=Socket.CLOSED;this.dispatchEvent(new CloseEvent('close',{code:1000}));});
 }
}
globalThis.CloseEvent=class extends Event{constructor(type,init){super(type);this.code=init.code;}};
globalThis.WebSocket=Socket;
globalThis.location=new URL('http://fixture.invalid');
globalThis.window=new EventTarget();
const abort=new AbortController();
const response=new Response(JSON.stringify({protocol:'atoms-team/3',transport:'websocket',taskId:'task',ticket:'offline'}),{headers:{'content-type':'application/json'}});
const reading=readTeam(response,'task','project',abort.signal,()=>{},()=>{}).then(()=> 'unexpected success', e=>String(e));
await new Promise(r=>setTimeout(r,0));
const ws=Socket.latest;
ws.readyState=Socket.OPEN;ws.dispatchEvent(new Event('open'));
ws.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'session',protocol:'atoms-team/3',taskId:'task',projectId:'project',token:'offline'})}));
// Leave the actual heartbeat control unacknowledged to model the reachable in-flight race.
await new Promise(r=>setTimeout(r,4100));
if (!ws.sent.some(m=>m.action==='heartbeat')) throw new Error('No pending heartbeat; reproduction invalid');
abort.abort();
const readOutcome=await reading;
await new Promise(r=>setTimeout(r,30));
console.log(JSON.stringify({revision,node:process.version,identity:{'src/lib/team/socket.ts':hash(socketSource),'src/lib/team/client.ts':hash(clientSource)},dependencies,websocketFrames:ws.sent,readOutcome,unhandledRejections,uncaughtExceptions,providerCalls:0},null,2));
process.exitCode=unhandledRejections.length || uncaughtExceptions.length ? 1 : 0;
