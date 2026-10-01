"""Developer-only controlled defect injection. Real provider remains in use.
Never uploaded as production runtime; no repaired code is prewritten.
"""
import json, os, re, runpy, sys
from pathlib import Path
import httpx
OriginalClient=httpx.AsyncClient
injected=False
out=Path(os.environ['ATOMS_DEFECT_EVIDENCE_DIR'])
out.mkdir(parents=True,exist_ok=True)
class Client(OriginalClient):
    async def post(self, *args, **kwargs):
        global injected
        response=await super().post(*args,**kwargs)
        system=kwargs.get('json',{}).get('messages',[{}])[0].get('content','')
        if not injected and response.status_code==200 and system.startswith('You implement'):
            body=response.json();artifact=json.loads(body['choices'][0]['message']['content'])
            original=artifact['html']
            broken,count=re.subn(r'(?:window\.)?atoms\.saveState\(', 'Promise.resolve(', original)
            if not count:raise RuntimeError('Controlled injection could not find explicit save calls')
            out.joinpath('engineer-before-injection.html').write_text(original)
            out.joinpath('rejected.html').write_text(broken)
            out.joinpath('injection.json').write_text(json.dumps({'kind':'developer controlled defect, not natural model defect','operation':'replace actual atoms.saveState calls with Promise.resolve','replacements':count}))
            artifact['html']=broken
            body['choices'][0]['message']['content']=json.dumps(artifact,ensure_ascii=False)
            response=httpx.Response(200,json=body,request=response.request)
            injected=True
        return response
httpx.AsyncClient=Client
runpy.run_path(sys.argv[1],run_name='__main__')
