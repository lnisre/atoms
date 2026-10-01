// Runs BEFORE application scripts. Capture native DOM operations and retain a
// private MessagePort in the closure; application window messages are not proof.
export function qaFrameScript(channel: string, origin: string): string {
  return `<script>(()=>{
    const channel=${JSON.stringify(channel)},origin=${JSON.stringify(origin)};
    const query=Document.prototype.querySelectorAll.bind(document);
    const text=Object.getOwnPropertyDescriptor(Node.prototype,'textContent').get;
    const matches=Element.prototype.matches;
    const closest=Element.prototype.closest;
    const inputValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
    const areaValue=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
    const selectValue=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
    const click=HTMLElement.prototype.click,dispatch=EventTarget.prototype.dispatchEvent,EventClass=Event;
    const later=setTimeout.bind(window);
    const port=new MessageChannel();const send=port.port1.postMessage.bind(port.port1);
    let sequence=0;
    function one(selector){const all=query(selector);if(all.length!==1)throw Error('selector must match exactly one element: '+all.length);return all[0];}
    function blocked(el){return matches.call(el,':disabled')||!!closest.call(el,'[inert]');}
    function valueDescriptor(el){const tag=el.tagName;return tag==='INPUT'?inputValue:tag==='TEXTAREA'?areaValue:tag==='SELECT'?selectValue:null;}
    function observe(c){const all=query(c.selector);if(c.property==='count')return all.length;const el=one(c.selector);
      if(c.property==='text')return text.call(el).slice(0,8000);
      if(c.property==='disabled')return matches.call(el,':disabled');
      if(c.property==='inert')return !!closest.call(el,'[inert]');
      if(c.property==='value'){const d=valueDescriptor(el);if(!d)throw Error('not a value control');return d.get.call(el);}
      throw Error('unknown observation');}
    port.port1.onmessage=async event=>{
      const m=event.data;if(m?.sequence!==sequence+1)return;sequence=m.sequence;
      try{const c=m.command;let actual;
        if(c.op==='observe'||c.op==='assert')actual=observe(c);
        else if(c.op==='input'){const el=one(c.selector);if(blocked(el))throw Error('input is disabled or inert');const d=valueDescriptor(el);if(!d)throw Error('not an input');d.set.call(el,c.value);dispatch.call(el,new EventClass('input',{bubbles:true}));dispatch.call(el,new EventClass('change',{bubbles:true}));actual=d.get.call(el);}
        else if(c.op==='click'){const el=one(c.selector);if(blocked(el)&&!c.probeWhileInert)throw Error('click is disabled or inert');click.call(el);actual='executed';}
        else if(c.op==='wait'){await new Promise(resolve=>later(resolve,c.ms));actual=c.ms;}
        else throw Error('unsupported command');
        send({sequence:m.sequence,ok:true,actual});
      }catch(e){send({sequence:m.sequence,ok:false,error:String(e)});}
    };
    // Remove the bootstrap's source before application code starts. This is
    // hardening against accidental interference, not a hostile-code enclave.
    document.currentScript.remove();
    parent.postMessage({type:'atoms:qa-ready',channel},origin,[port.port2]);
  })();</script>`;
}
