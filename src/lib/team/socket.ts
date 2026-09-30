// Adapt the pinned bidirectional connection to the existing bounded event reader.
// No reconnect: reconnecting would be a new task, not budget-preserving recovery.
export async function openTeamSocket(ticket: unknown, signal: AbortSignal) {
  const url = new URL('/api/team/socket', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url);
  let closed = false, sequence = 0;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const pending = new Map<number, {resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const close = () => ws.close(1000);
  const stream = new ReadableStream<Uint8Array>({start(c){streamController=c;},cancel(){close();}});
  const fail = (reason: string) => {
    if (closed) return; closed=true;
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(reason));}pending.clear();
    streamController.error(new Error(reason));close();
  };
  signal.addEventListener('abort', close, {once:true});
  ws.addEventListener('open',()=>{if(signal.aborted)close();else ws.send(JSON.stringify({action:'start',ticket}));});
  ws.addEventListener('message',event=>{
    try {
      const message=JSON.parse(event.data);
      if(message.type==='socket-error'){fail(message.error);return;}
      if(message.type==='control-ack'){
        const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);
        if(message.ok)p.resolve();else p.reject(new Error(message.error||'工具回传被拒绝'));
      }else if(!closed)streamController.enqueue(new TextEncoder().encode(event.data+'\n'));
    }catch{fail('团队连接协议错误');}
  });
  ws.addEventListener('error',()=>fail('无法连接四角色执行器。'));
  ws.addEventListener('close',event=>{
    signal.removeEventListener('abort',close);
    if(closed)return;
    if(event.code!==1000){fail('团队连接中断，未恢复后台执行。');return;}
    closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('团队连接已结束'));}pending.clear();streamController.close();
  });
  const control=(body: Record<string,unknown>)=>new Promise<void>((resolve,reject)=>{
    if(ws.readyState!==WebSocket.OPEN){reject(new Error('团队连接不可用'));return;}
    const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('工具回传超时'));close();},10000);
    pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({...body,id}));
  });
  return {response:new Response(stream,{headers:{'Content-Type':'application/x-ndjson'}}),control,close};
}
