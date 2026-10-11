-- Correct the receipt variable qualification in the installed 002 function.
CREATE OR REPLACE FUNCTION public.atoms_commit_artifact(p_operation_id uuid,p_payload text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE uid text:=atoms_private.require_user(); b jsonb:=atoms_private.proof(p_payload,p_signature,'artifact');
  pid uuid:=(b->>'projectId')::uuid; tid uuid:=(b->>'taskId')::uuid; p public.atoms_projects; task atoms_private.tasks;
  expected jsonb:=nullif(b->'expected','null'::jsonb); commit_receipt jsonb; old_hash text;
  request_hash text:=encode(sha256(convert_to('artifact:'||p_payload,'UTF8')),'hex'); doc jsonb; policy jsonb:=b->'policy'; rec jsonb;
BEGIN
  IF p_operation_id IS NULL OR pid IS NULL OR tid IS NULL THEN RAISE SQLSTATE 'PT400' USING MESSAGE='invalid commit'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid||':'||p_operation_id::text,0));
  SELECT o.receipt,o.request_hash INTO commit_receipt,old_hash FROM atoms_private.operations o WHERE o.owner_id=uid AND o.operation_id=p_operation_id;
  IF FOUND THEN
    IF old_hash<>request_hash THEN RAISE SQLSTATE 'PT422' USING MESSAGE='operation mismatch'; END IF;
    RETURN commit_receipt;
  END IF;
  SELECT * INTO task FROM atoms_private.tasks WHERE owner_id=uid AND task_id=tid FOR UPDATE;
  IF NOT FOUND OR task.project_id<>pid OR task.expected IS DISTINCT FROM expected OR task.base_hash IS DISTINCT FROM b->>'baseHash' THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE='task binding mismatch'; END IF;
  IF task.receipt IS NOT NULL THEN
    IF task.artifact_hash<>request_hash THEN RAISE SQLSTATE 'PT422' USING MESSAGE='task artifact mismatch'; END IF;
    RETURN task.receipt;
  END IF;
  IF expected IS NULL THEN
    doc:=jsonb_build_object('title',left(b->>'requirement',48),'requirement',b->>'requirement','result',b->'result','previewPolicy',policy,'initialGeneration',b->'initialGeneration','modificationRecords','[]'::jsonb);
    IF policy->>'dataMode'='trial' OR policy->>'status'='blocked' THEN
      doc:=doc||jsonb_build_object('draftResult',b->'result','result',(b->'result')||jsonb_build_object('html','<!doctype html><html><head></head><body>待验证代码，请使用最新版工作台打开。</body></html>'));
    END IF;
    INSERT INTO public.atoms_projects(id,owner_id,document) VALUES(pid,uid,doc) RETURNING * INTO p;
  ELSE
    SELECT * INTO p FROM public.atoms_projects WHERE id=pid AND owner_id=uid FOR UPDATE;
    IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='project unavailable'; END IF;
    IF p.code_version IS DISTINCT FROM (expected->>'code')::integer OR p.data_version IS DISTINCT FROM (expected->>'data')::integer
      OR encode(sha256(convert_to(coalesce(p.document->'draftResult',p.document->'result')->>'html','UTF8')),'hex') IS DISTINCT FROM b->>'baseHash' THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE='stale candidate'; END IF;
    IF policy->>'adoption' IS DISTINCT FROM 'allowed' OR policy->>'status' IS DISTINCT FROM 'allowed' THEN
      RAISE SQLSTATE 'PT403' USING MESSAGE='adoption restricted'; END IF;
    rec:=jsonb_build_object('id',p_operation_id,'adoptedAt',clock_timestamp(),'requests',(SELECT jsonb_agg(g->>'requirement') FROM jsonb_array_elements(b->'generations') g),
      'summary','已采用候选代码，继续使用原项目正式数据。','generations',b->'generations','codeTaskId',tid);
    UPDATE public.atoms_projects SET document=(document-'draftResult')||jsonb_build_object('result',b->'result','previewPolicy',policy||'{"dataMode":"formal"}'::jsonb,
      'modificationRecords',coalesce(document->'modificationRecords','[]'::jsonb)||jsonb_build_array(rec)),code_version=code_version+1,updated_at=clock_timestamp()
      WHERE id=pid AND owner_id=uid RETURNING * INTO p;
  END IF;
  commit_receipt:=jsonb_build_object('projectId',pid,'version',jsonb_build_object('code',p.code_version,'data',p.data_version),'updatedAt',p.updated_at);
  INSERT INTO atoms_private.operations VALUES(uid,p_operation_id,request_hash,commit_receipt);
  UPDATE atoms_private.tasks SET artifact_hash=request_hash,receipt=commit_receipt WHERE owner_id=uid AND task_id=tid;
  RETURN commit_receipt;
END $fn$;
