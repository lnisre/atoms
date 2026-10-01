"""Local developer-only provider wrapper for one real modification repair.
Initial generation is untouched. No repaired HTML or review is manufactured.
Use only after authorization, with a dedicated empty evidence directory.
"""
import json
import os
import re
import runpy
import sys
from pathlib import Path
import httpx

OriginalClient = httpx.AsyncClient
injected = False
out = Path(os.environ['ATOMS_DEFECT_EVIDENCE_DIR'])
if out.exists() and any(out.iterdir()):
    raise RuntimeError('Refusing to overwrite defect evidence')
out.mkdir(parents=True, exist_ok=True)


class Client(OriginalClient):
    async def post(self, *args, **kwargs):
        global injected
        messages = kwargs.get('json', {}).get('messages', [])
        system = messages[0].get('content', '') if messages else ''
        context = json.loads(messages[1]['content']) if len(messages) > 1 else {}
        response = await super().post(*args, **kwargs)
        if (not injected and response.status_code == 200 and
                system.startswith('You implement') and context.get('modification')):
            body = response.json()
            artifact = json.loads(body['choices'][0]['message']['content'])
            original = artifact['html']
            broken, count = re.subn(r'(?:window\.)?atoms\.saveState\(', 'Promise.resolve(', original)
            if not count:
                raise RuntimeError('Cannot inject: no explicit save calls')
            out.joinpath('engineer-before-injection.html').write_text(original)
            out.joinpath('rejected.html').write_text(broken)
            out.joinpath('injection.json').write_text(json.dumps({
                'kind': 'developer controlled modification defect, not natural failure',
                'operation': 'replace explicit saveState calls with Promise.resolve',
                'replacements': count, 'requirement': context['requirement'],
                'modification': context['modification'], 'spec': context['spec'],
            }, ensure_ascii=False, indent=2))
            artifact['html'] = broken
            body['choices'][0]['message']['content'] = json.dumps(artifact, ensure_ascii=False)
            response = httpx.Response(200, json=body, request=response.request)
            injected = True
        return response


httpx.AsyncClient = Client
runpy.run_path(sys.argv[1], run_name='__main__')
