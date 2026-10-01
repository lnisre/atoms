"""Deterministic native-loop tests. No network or paid model requests."""
import asyncio
import importlib.util
import json
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('runner.py'))
r = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = r
spec.loader.exec_module(r)

class Controls(unittest.IsolatedAsyncioTestCase):
    async def test_limit_prevents_twenty_first_provider_request(self):
        task = r.Task({'deadline':time.time()*1000+240000})
        task.calls = 20
        with patch.object(r.httpx, 'AsyncClient', side_effect=AssertionError('must not connect')):
            with self.assertRaisesRegex(RuntimeError, '20'):
                await task.ask('Mike', '', '', 1)
        self.assertEqual(task.calls, 20)

    async def test_expired_task_never_connects(self):
        task = r.Task({'deadline':time.time()*1000-1})
        with patch.object(r.httpx, 'AsyncClient', side_effect=AssertionError('must not connect')):
            with self.assertRaisesRegex(RuntimeError, '4'):
                await task.ask('Mike', '', '', 1)
        self.assertEqual(task.calls, 0)

    async def test_inflight_model_is_cancelled_without_followup(self):
        task = r.Task({'deadline':time.time()*1000+240000})
        entered = asyncio.Event()
        cancelled = asyncio.Event()
        class HangingClient:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def post(self, *args, **kwargs):
                entered.set()
                try: await asyncio.Future()
                finally: cancelled.set()
        with patch.object(r.httpx, 'AsyncClient', HangingClient):
            execution=asyncio.create_task(task.ask('Mike','','',1))
            await entered.wait()
            execution.cancel()
            with self.assertRaises(asyncio.CancelledError): await execution
        self.assertTrue(cancelled.is_set())
        self.assertEqual(task.calls, 1)

    async def test_transport_retry_keeps_unknown_call_count_and_limit(self):
        task=r.Task({'deadline':time.time()*1000+240000})
        task.calls=19
        class BrokenClient:
            def __init__(self,**kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self,*args): pass
            async def post(self,*args,**kwargs): raise r.httpx.RemoteProtocolError('synthetic disconnect')
        with patch.object(r.httpx,'AsyncClient',BrokenClient):
            with self.assertRaises(r.ModelTransportError): await task.ask('Reviewer','','',1)
        self.assertEqual(task.calls,20)

    async def test_format_and_transport_retries_are_counted(self):
        for fault in ('json','transport'):
            attempts=[]
            class Response:
                status_code=200
                def json(self):
                    content='invalid json' if fault=='json' and len(attempts)==1 else '{"ok":true}'
                    return {'id':'fixture-response','model':'fixture','usage':{'prompt_tokens':1,'completion_tokens':1},'choices':[{'finish_reason':'stop','message':{'content':content}}]}
            class Client:
                def __init__(self,**kwargs): pass
                async def __aenter__(self): return self
                async def __aexit__(self,*args): pass
                async def post(self,*args,**kwargs):
                    attempts.append(kwargs)
                    if fault=='transport' and len(attempts)==1: raise r.httpx.RemoteProtocolError('synthetic')
                    return Response()
            task=r.Task({'deadline':time.time()*1000+240000})
            with patch.object(r.httpx,'AsyncClient',Client):
                self.assertEqual(await task.ask('Requirements','JSON','test',100),{'ok':True})
            self.assertEqual(task.calls,2)
            self.assertEqual(len(attempts),2)

    async def test_native_action_cannot_bypass_exhausted_budget(self):
        task=r.Task({'deadline':time.time()*1000+240000,'requirement':'zero network control'})
        task.calls=20
        context=r.Context();team=r.Team(context=context,use_mgx=True)
        team.env.is_public_chat=False
        leader=r.BoundedLeader(context=context);task.leader=leader
        leader.set_actions([r.Decide(task=task,context=context)]);leader._watch([])
        team.hire([leader]);team.env.publish_message(r.Message(content='start',cause_by=r.RunCommand,send_to={'Mike'}))
        with patch.object(r.httpx,'AsyncClient',side_effect=AssertionError('must not connect')):
            await team.run(n_round=2,auto_archive=False)
        self.assertIn('20',task.failure)
        self.assertEqual(task.calls,20)

    async def test_review_correction_includes_bad_response_and_field_errors(self):
        task=r.Task({'deadline':time.time()*1000+240000,'requirement':'counter'})
        task.html='<html>counter</html>';task.spec={'summary':'counter'}
        bad={'approved':'yes','summary':'ok','issues':[]}
        contexts=[]
        async def ask(actor,system,context,tokens):
            contexts.append(json.loads(json.dumps(context)))
            self.assertEqual(actor,'Reviewer')
            self.assertIn('window.atoms.loadState',system)
            return bad if len(contexts)==1 else {'approved':True,'summary':'审查通过','issues':[]}
        task.ask=ask
        await r.Review(task=task).perform([])
        self.assertEqual(contexts[1]['previousResponse'],bad)
        self.assertTrue(any('approved' in error for error in contexts[1]['validationErrors']))
        self.assertEqual(task.review['codeHash'],task.code_hash())
        self.assertTrue(task.review['approved'])

    async def test_review_rejection_is_terminal_without_replanning(self):
        task=r.Task({'deadline':time.time()*1000+240000,'requirement':'counter'})
        task.html='<html>counter</html>';task.spec={}
        calls=[]
        async def ask(*args):
            calls.append(args)
            return {'approved':False,'summary':'缺少持久化','issues':['没有调用 saveState']}
        task.ask=ask
        await r.Review(task=task).run([])
        self.assertEqual(len(calls),1)
        self.assertIn('代码审查未通过',task.failure)
        self.assertFalse(task.review['approved'])

    async def test_review_cannot_approve_with_blockers_or_after_two_invalid_outputs(self):
        task=r.Task({'deadline':time.time()*1000+240000,'requirement':'counter'})
        task.html='code';task.spec={};calls=[]
        async def ask(*args):
            calls.append(args)
            return {'approved':True,'summary':'ok','issues':['blocking defect']}
        task.ask=ask
        await r.Review(task=task).run([])
        self.assertEqual(len(calls),2)
        self.assertIsNone(task.review)
        self.assertIn('格式重试后仍无效',task.failure)

    def test_six_core_files_match_fixed_upstream(self):
        import metagpt
        import hashlib
        core={
            'team.py':'af0398fce4109cadf8a0ac8e479d261ef0cb6347c60d0c3343ff7d6e22180bcc',
            'environment/base_env.py':'c3f0d6b7e9f0a4d1a1cbc4183a3230ba66d4f081a91e46c2e555f313cb035334',
            'environment/mgx/mgx_env.py':'aa1dda173a21c775a6c49b5dad2af99bc3db4a608fd23a9189ecc6522b08ec9b',
            'roles/role.py':'2dac0259a6f3733fa2ec0df8a43eb8dda1cac199410c31ef350aaaf70f6c939b',
            'roles/di/role_zero.py':'072d832e75fc90ed4b36673eea054cfe9f74145b11722312513970399d9090c4',
            'roles/di/team_leader.py':'a331cbab502865f53127726dcf97a130727767ac800575b48545ac5f25f3a683'}
        for file,expected in core.items():
            self.assertEqual(hashlib.sha256((Path(metagpt.__file__).parent/file).read_bytes()).hexdigest(),expected,file)

    async def test_native_team_routes_leader_to_worker_and_back(self):
        seen = []
        class Route(r.Action):
            async def run(self, history):
                seen.append('leader')
                if 'worker-complete' not in str(history[-1]):
                    leader.publish_team_message('work', 'Worker')
                return 'routed'
        class Work(r.Action):
            async def run(self, history):
                seen.append('worker')
                return r.AIMessage(content='worker-complete', sent_from='Worker',send_to={'Mike'},cause_by=r.RunCommand)
        context = r.Context()
        team = r.Team(context=context,use_mgx=True)
        team.env.is_public_chat=False
        leader = r.BoundedLeader(context=context)
        leader.set_actions([Route(context=context)]); leader._watch([])
        worker = r.Role(name='Worker',profile='Worker',context=context)
        worker.set_actions([Work(context=context)]); worker._watch([])
        team.hire([leader,worker])
        team.env.publish_message(r.Message(content='start',cause_by=r.RunCommand,send_to={'Mike'}))
        with patch.object(r.httpx, 'AsyncClient', side_effect=AssertionError('must not connect')):
            await team.run(n_round=5,auto_archive=False)
        self.assertEqual(seen,['leader','worker','leader'])
        self.assertEqual(r.BoundedLeader.run, r.TeamLeader.run)
        self.assertEqual(r.BoundedLeader._react, r.TeamLeader._react)

if __name__ == '__main__':
    unittest.main()
