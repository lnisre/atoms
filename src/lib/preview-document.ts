// This bridge is injected before generated scripts. The application never chooses
// a project ID; the parent binds this frame/session to its own project record.
export function previewDocument(html: string, channel: string, origin: string) {
  const config = JSON.stringify({ channel, origin }).replace(/</g, "\\u003c");
  const guard = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><script>(()=>{
    const {channel,origin}=${config};
    const pending=new Map();let sequence=0;
    let saves=0,lockedBody,wasInert=false,focused;
    // Lock synchronously at the API boundary, including for previously saved HTML.
    // React/parent message delivery is too late to stop the next application event.
    function lock(){
      if(saves++!==0)return;
      lockedBody=document.body;focused=document.activeElement;
      if(lockedBody){wasInert=lockedBody.inert;lockedBody.inert=true;}
    }
    function unlock(){
      if(--saves!==0)return;
      if(lockedBody)lockedBody.inert=wasInert;
      if(focused?.isConnected)focused.focus({preventScroll:true});
    }
    // Also guard handlers in modal dialogs (which can escape ancestor inertness).
    for(const type of ['click','dblclick','pointerdown','pointerup','mousedown','mouseup','keydown','keyup','beforeinput','input','change','submit','touchstart','touchend','drop']){
      addEventListener(type,event=>{if(saves){event.preventDefault();event.stopImmediatePropagation();}},{capture:true,passive:false});
    }
    const send=(message)=>parent.postMessage({...message,channel},origin);
    const report=()=>send({type:'atoms:preview-error'});
    addEventListener('error',report);addEventListener('unhandledrejection',report);
    addEventListener('message',event=>{
      const m=event.data;
      if(event.source!==parent||event.origin!==origin||m?.channel!==channel||m.type!=='atoms:state-result')return;
      const request=pending.get(m.id);if(!request)return;
      pending.delete(m.id);clearTimeout(request.timer);
      if(m.ok)request.resolve(m.state);else request.reject(new Error(m.error));
    });
    function request(method,state){
      if(method==='save')lock();
      return new Promise((resolve,reject)=>{
        const id=++sequence;
        const finish=(callback,value)=>{
          callback(value);
          // Let the application's await/catch update its state before new input.
          if(method==='save')queueMicrotask(unlock);
        };
        const timer=setTimeout(()=>{pending.delete(id);send({type:'atoms:storage-error'});finish(reject,new Error('应用数据读写超时，请保留页面并检查浏览器存储。'));},25000);
        pending.set(id,{resolve:value=>finish(resolve,value),reject:error=>finish(reject,error),timer});
        try{send({type:'atoms:state',id,method,state});}
        catch(error){clearTimeout(timer);pending.delete(id);send({type:'atoms:storage-error'});finish(reject,error);}
      });
    }
    Object.defineProperty(window,'atoms',{value:Object.freeze({loadState:()=>request('load'),saveState:state=>request('save',state)}),writable:false,configurable:false});
  })();</script>`;
  return html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + guard);
}
