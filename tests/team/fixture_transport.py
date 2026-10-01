"""Test-only scripted model transport; executes the REAL production runner.
No sockets, no provider credentials, no claims of real model reasoning.
"""
import json
import asyncio
import runpy
import sys
import httpx

html = '''<!DOCTYPE html><html><head><meta charset="utf-8"><title>受控计数器</title></head><body><h1>受控计数器</h1><p data-atoms-status>正在读取</p><button id="add" disabled>增加</button><output>0</output><script>
const b=document.querySelector('#add'),o=document.querySelector('output'),feedback=document.querySelector('[data-atoms-status]');let state={count:0};function render(){o.textContent=state.count;}
atoms.loadState().then(s=>{state=s===null?{count:0}:s;render();feedback.textContent='已读取';b.disabled=false}).catch(()=>{feedback.textContent='读取失败';b.disabled=true});
b.onclick=async()=>{const old=structuredClone(state);state.count++;feedback.textContent='正在保存';try{await atoms.saveState(state);render();feedback.textContent='已保存'}catch{state=old;render();feedback.textContent='保存失败'}};
</script></body></html>'''
spec={'dataContract':'{count:number,tag?:string}', 'summary':'受控测试夹具：计数与恢复','requirements':[{'id':'increment','description':'增加并保存 count'},{'id':'restore','description':'恢复旧 count'}],'probe':{'seed':{'count':4,'tag':'synthetic'},'prepare':[],'commitSelector':'#add','changed':{'path':['count'],'equals':5}}}

review_calls = 0

class Response:
    status_code=200
    def __init__(self,value): self.value=value
    def json(self):return {'id':'scripted-no-provider-request','model':'deterministic-test-fixture','usage':{'prompt_tokens':0,'completion_tokens':0},'choices':[{'finish_reason':'stop','message':{'content':json.dumps(self.value,ensure_ascii=False)}}]}
class Client:
    def __init__(self,**kwargs):pass
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    async def post(self,url,headers,json):
        global review_calls
        assert headers['Authorization']=='Bearer offline-test-placeholder'
        system=json['messages'][0]['content']; data=__import__('json').loads(json['messages'][1]['content'])
        if data.get('modification'): data['requirement'] += '\n' + data['modification']
        if system.startswith('You are TeamLeader'):
            state=data['state']; target='Requirements' if state['spec'] is None else 'Engineer' if state['codeHash'] is None else 'Reviewer' if state['review'] is None else 'Engineer' if not state['review']['approved'] and state['implementations'] < 2 else None
            result={'command':'assign' if target else 'finish','to':target,'reason':'DETERMINISTIC TEST FIXTURE','instruction':'Execute test fixture responsibility'}
        elif system.startswith('You own requirements'):
            if '关键歧义' in data['requirement'] and '用户补充：' not in data['requirement']: result={'clarification':['计数是否允许负数？','重置时归零还是恢复初始值？']}
            elif '任意后端' in data['requirement']: result={'unsupported':'当前仅支持单文件前端；可改为同浏览器保存的计数器。'}
            else: result={k:v for k,v in spec.items() if k!='probe'}
        elif system.startswith('You implement'):
            repairing = data.get('rejectedHtml') is not None
            broken = ('一次修复' in data['requirement'] and not repairing) or '审查拒绝' in data['requirement']
            result={'html':(html.replace('state.count++;','state.count+=2;') if broken else html) + ('\n' if repairing and '相同代码' not in data['requirement'] else ''),'assistantReply':'受控测试：修复增加两次的问题，改为每次加一。' if repairing else '受控测试：增加计数，同浏览器恢复。'}
        elif system.startswith('You are an independent code Reviewer'):
            review_calls += 1
            if '停止返工' in data['requirement'] and data.get('priorReviews'): await asyncio.sleep(30)
            if '离开中止' in data['requirement']: await asyncio.sleep(30)
            rejected = '审查拒绝' in data['requirement'] or ('一次修复' in data['requirement'] and 'state.count+=2;' in data['html'])
            result={'approved':not rejected,'summary':'受控审查拒绝' if rejected else '受控静态审查通过，未执行浏览器验收','issues':['state.count+=2：点击增加时从 0 到 2，需求要求到 1'] if rejected else []}
            if '格式纠正' in data['requirement'] and (review_calls == 1 or '持续无效' in data['requirement']): result={'approved':'yes','summary':'受控无效审查','issues':[]}
        else: raise AssertionError('Unexpected model action')
        return Response(result)
httpx.AsyncClient=Client
runpy.run_path(sys.argv[1],run_name='__main__')
