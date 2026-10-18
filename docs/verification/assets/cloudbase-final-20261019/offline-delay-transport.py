"""Verification-only delay transport around the existing scripted provider.

Executes the actual production runner and fixed MetaGPT; makes no provider calls.
The two opt-in markers exercise real wall-clock runtime and cancellation budgets.
"""
import asyncio
import json
import runpy
import sys
import httpx

original_run = runpy.run_path
runner = sys.argv[1]
fixture = '/Users/gaowenlong/.codex/worktrees/cloudbase-migration-90/atoms/tests/team/fixture_transport.py'

def run_actual_runner(path, *args, **kwargs):
    if path == runner:
        scripted_client = httpx.AsyncClient
        class DelayedScriptedClient(scripted_client):
            async def post(self, *args, **kwargs):
                messages = kwargs['json']['messages']
                data = json.loads(messages[1]['content'])
                if messages[0]['content'].startswith('You implement'):
                    requirement = data.get('requirement', '')
                    if 'CLOUDBASE_LONG_SUCCESS' in requirement:
                        await asyncio.sleep(420)
                    if 'CLOUDBASE_LONG_TIMEOUT' in requirement:
                        await asyncio.sleep(600)
                return await super().post(*args, **kwargs)
        httpx.AsyncClient = DelayedScriptedClient
    return original_run(path, *args, **kwargs)

runpy.run_path = run_actual_runner
original_run(fixture, run_name='__main__')
