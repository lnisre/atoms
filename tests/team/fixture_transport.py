"""Test-only scripted model transport; executes the REAL production runner.
No sockets, no provider credentials, no claims of real model reasoning.
"""
import json
import runpy
import sys
import httpx

html = '''<!DOCTYPE html><html><head><meta charset="utf-8"><title>受控计数器</title></head><body><h1>受控计数器</h1><p data-atoms-status>正在读取</p><button id="add" disabled>增加</button><output>0</output><script>
const b=document.querySelector('#add'),o=document.querySelector('output'),feedback=document.querySelector('[data-atoms-status]');let state={count:0};function render(){o.textContent=state.count;}
atoms.loadState().then(s=>{state=s===null?{count:0}:s;render();feedback.textContent='已读取';b.disabled=false}).catch(()=>{feedback.textContent='读取失败';b.disabled=true});
b.onclick=async()=>{const old=structuredClone(state);state.count++;feedback.textContent='正在保存';try{await atoms.saveState(state);render();feedback.textContent='已保存'}catch{state=old;render();feedback.textContent='保存失败'}};
</script></body></html>'''
spec={'dataContract':'{count:number,tag?:string}', 'summary':'受控测试夹具：计数与恢复','requirements':[{'id':'increment','description':'增加并保存 count'},{'id':'restore','description':'恢复旧 count'}],'probe':{'seed':{'count':4,'tag':'synthetic'},'prepare':[],'commitSelector':'#add','changed':{'path':['count'],'equals':5}}}
plan=[{'id':'increment','seed':{'count':4},'checks':[{'id':'wait','label':'load','command':{'op':'wait','ms':100}},{'id':'click','label':'increase','command':{'op':'click','selector':'#add'}},{'id':'settle','label':'save','command':{'op':'wait','ms':100}},{'id':'data','label':'count','command':{'op':'data','path':['count'],'equals':5}}]},{'id':'restore','seed':{'count':9},'checks':[{'id':'wait','label':'load','command':{'op':'wait','ms':100}},{'id':'restored','label':'restored','command':{'op':'assert','selector':'output','property':'text','equals':'9'}}]}]
class Response:
    status_code=200
    def __init__(self,value): self.value=value
    def json(self):return {'id':'scripted-no-provider-request','model':'deterministic-test-fixture','usage':{'prompt_tokens':0,'completion_tokens':0},'choices':[{'finish_reason':'stop','message':{'content':json.dumps(self.value,ensure_ascii=False)}}]}
class Client:
    def __init__(self,**kwargs):pass
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    async def post(self,url,headers,json):
        assert headers['Authorization']=='Bearer offline-test-placeholder'
        system=json['messages'][0]['content']; data=__import__('json').loads(json['messages'][1]['content'])
        if system.startswith('You are TeamLeader'):
            state=data['state']; target='Requirements' if state['spec'] is None else 'Engineer' if state['codeHash'] is None else 'Verifier' if state['qa'] is None else None
            result={'command':'assign' if target else 'finish','to':target,'reason':'DETERMINISTIC TEST FIXTURE','instruction':'Execute test fixture responsibility'}
        elif system.startswith('You own requirements'):result={k:v for k,v in spec.items() if k!='probe'}
        elif system.startswith('You implement'):result={'html':html,'assistantReply':'受控测试：增加计数，同浏览器恢复。'}
        elif system.startswith('You are independent QA. Inspect the actual HTML'):result=spec['probe']
        elif system.startswith('You are independent QA'):result={'tool':'BrowserAcceptance.run',**next(s for s in plan if s['id']==data['spec']['requirements'][0]['id'])}
        else:result={'passed':data['result']['status']=='passed','summary':'受控模型根据真实浏览器结果返回'}
        return Response(result)
httpx.AsyncClient=Client
runpy.run_path(sys.argv[1],run_name='__main__')
