import type { Check, Command, Json, Scenario } from "./contract";
export type FixtureName = "todo" | "reading";
export type Variant = "normal" | "read-bug" | "save-bug" | "tamper" | "no-result" | "timeout" | "slow";
export const variants: Variant[] = ["normal", "read-bug", "save-bug", "tamper", "no-result", "timeout", "slow"];

// Handwritten qualification artifacts, not model output or a four-role run.
export function qualificationFixture(name: FixtureName, variant: Variant) {
  const todo = name === "todo";
  const input = todo ? "task-title" : "book-name", add = todo ? "add-task" : "record-book";
  const collection = todo ? "tasks" : "books", field = todo ? "title" : "name";
  const title = todo ? "待办" : "阅读记录", sample = todo ? "检查待办" : "合成书名";
  const old: Json = todo ? { title: "旧待办", done: false } : { name: "旧书", status: "reading" };
  const seed: Json = { [collection]: [old] };
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>
<h1>${title} · 手写检查夹具</h1><p id="feedback">正在读取</p>
<input id="${input}" aria-label="${title}名称" disabled><button id="${add}" disabled>添加</button><ul id="records"></ul>
<script>
const input=document.getElementById('${input}'),add=document.getElementById('${add}'),feedback=document.getElementById('feedback'),list=document.getElementById('records');
let state={${collection}:[]};
function render(){list.replaceChildren();state.${collection}.forEach((record,index)=>{const li=document.createElement('li');li.textContent=record.${field}+' · '+${todo ? "(record.done?'完成':'待办')" : "(record.status||'reading')+' · '+(record.rating??0)"};const button=document.createElement('button');button.textContent='${todo ? "完成" : "读完"}';button.className='change';button.onclick=()=>persist(()=>{${todo ? "record.done=true" : "record.status='finished';record.rating=5"}});li.append(button);list.append(li);});}
async function persist(change){const before=structuredClone(state);change();feedback.textContent='正在保存';try{await atoms.saveState(state);render();feedback.textContent='已保存';}catch{state=before;render();feedback.textContent='${variant === "save-bug" ? "已保存" : "保存失败"}';}}
add.onclick=()=>{if(!input.value.trim())return;const value=input.value;persist(()=>state.${collection}.push(${todo ? "{title:value,done:false}" : "{name:value,status:'reading',rating:0}"}));};
(async()=>{try{const loaded=await atoms.loadState();state=loaded||state;render();feedback.textContent='已读取';input.disabled=false;add.disabled=false;}catch{feedback.textContent='读取失败';${variant === "read-bug" ? "input.disabled=false;add.disabled=false;atoms.saveState(state).catch(()=>{});" : "input.disabled=true;add.disabled=true;"}}})();
${variant === "tamper" ? "Document.prototype.querySelectorAll=()=>[];Node.prototype.__defineGetter__('textContent',()=> 'forged');parent.postMessage({type:'atoms:qa-result',status:'passed'},'*');" : ""}
</script></body></html>`;
  let n = 0;
  const c = (label: string, command: Command): Check => ({ id: String(++n), label, command });
  const wait = (ms: number) => c("等待实际异步读写", { op: "wait", ms });
  const assert = (selector: string, property: "text" | "count" | "disabled" | "inert", equals: Json) => c(`${selector} ${property}`, { op: "assert", selector, property, equals });
  const data = (path: string[], equals: Json) => c("核对合成数据", { op: "data", path, equals });
  const bridge = (property: "saveAttempts" | "rejectedSaves" | "commits", equals: number) => c("核对父桥行为", { op: "bridge", property, equals });
  const inputStep = c("输入名称", { op: "input", selector: `#${input}`, value: sample });
  const click = c("点击添加", { op: "click", selector: `#${add}` });
  const scenarios: Scenario[] = [
    { id: "normal-and-timing", seed, loadDelayMs: 450, saveDelayMs: 450, checks: [
      assert(`#${input}`, "disabled", true), assert(`#${add}`, "disabled", true), wait(600),
      c("观察旧记录与缺省字段", { op: "observe", selector: "#records", property: "text" }),
      assert("#records li", "count", 1), inputStep, click,
      assert("body", "inert", true), assert("#feedback", "text", "正在保存"),
      c("保存中尝试再次点击，验证平台捕获保护", { op: "click", selector: `#${add}`, probeWhileInert: true }),
      data([collection, "length"], 1), wait(600),
      assert("#feedback", "text", "已保存"), assert("body", "inert", false),
      data([collection, "1", field], sample), data([collection, "length"], 2), bridge("saveAttempts", 1),
      c("完成/读完旧记录", { op: "click", selector: "#records li:first-child .change" }),
      wait(600), data([collection, "0", todo ? "done" : "status"], todo ? true : "finished"),
      ...(todo ? [] : [data([collection, "0", "rating"], 5)]), bridge("commits", 2),
    ] },
    { id: "read-failure", seed, fault: "read", checks: [wait(100), assert("#feedback", "text", "读取失败"), assert(`#${input}`, "disabled", true), assert(`#${add}`, "disabled", true), bridge("saveAttempts", 0), bridge("rejectedSaves", 0), data([collection, "0", field], todo ? "旧待办" : "旧书"), bridge("commits", 0)] },
    { id: "save-failure", seed, fault: "save", saveDelayMs: 450, checks: [wait(100), inputStep, click, assert("body", "inert", true), wait(600), assert("#feedback", "text", "保存失败"), assert("#records li", "count", 1), data([collection, "length"], 1), bridge("rejectedSaves", 1), bridge("commits", 0)] },
  ];
  if (variant === "no-result") scenarios[0].fault = "no-result";
  if (variant === "slow" || variant === "timeout") scenarios[0].checks.unshift(wait(2500));
  return { html, scenarios, timeoutMs: variant === "timeout" ? 300 : 20_000 };
}
