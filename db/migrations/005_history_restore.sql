-- Reversible business history never includes task claims or operation receipts.
ALTER TABLE public.atoms_projects ADD COLUMN history_revision integer NOT NULL DEFAULT 0;
CREATE TABLE atoms_private.restore_backup (
 project_id uuid PRIMARY KEY REFERENCES public.atoms_projects(id) ON DELETE CASCADE,
 id uuid NOT NULL, target_id uuid NOT NULL, target_sequence integer NOT NULL, restored_at timestamptz NOT NULL,
 document jsonb NOT NULL, state jsonb, has_data boolean NOT NULL, data_saved_at timestamptz,
 current_history_id uuid NOT NULL, history_sequence integer NOT NULL, history jsonb NOT NULL
);
REVOKE ALL ON atoms_private.restore_backup FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.atoms_get_project(p_project_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE uid text:=atoms_private.require_user(); p public.atoms_projects; restricted boolean; undo jsonb;
BEGIN
 SELECT * INTO p FROM public.atoms_projects WHERE id=p_project_id AND owner_id=uid;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='project unavailable'; END IF;
 restricted:=coalesce(p.document->'previewPolicy'->>'dataMode'='trial',false) OR coalesce(p.document->'previewPolicy'->>'status'='blocked',false);
 SELECT jsonb_build_object('id',b.id,'targetId',b.target_id,'sequence',b.target_sequence,'restoredAt',b.restored_at) INTO undo
 FROM atoms_private.restore_backup b WHERE b.project_id=p.id;
 RETURN jsonb_build_object('project',p.document||jsonb_build_object('id',p.id,'updatedAt',p.updated_at),
 'version',jsonb_build_object('code',p.code_version,'data',p.data_version),'state',CASE WHEN restricted THEN NULL ELSE p.state END,
 'hasData',NOT restricted AND p.has_data,'restore',undo,'historyRevision',p.history_revision);
END $fn$;

CREATE OR REPLACE FUNCTION public.atoms_list_history(p_project_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE uid text:=atoms_private.require_user(); p public.atoms_projects; entries jsonb; backup jsonb;
BEGIN
 SELECT * INTO p FROM public.atoms_projects WHERE id=p_project_id AND owner_id=uid;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='project unavailable'; END IF;
 SELECT history INTO backup FROM atoms_private.restore_backup WHERE project_id=p.id;
 SELECT coalesce(jsonb_agg(atoms_private.history_entry(h,p.current_history_id)||jsonb_build_object('protectedReason',
 CASE WHEN h.id=p.current_history_id THEN 'current' WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(backup) dep WHERE dep->>'id'=h.id::text AND (dep->>'available')::boolean) THEN 'undo' ELSE NULL END)
 ORDER BY h.sequence DESC),'[]'::jsonb) INTO entries FROM atoms_private.history h WHERE h.project_id=p.id AND h.owner_id=uid;
 RETURN jsonb_build_object('projectId',p.id,'version',jsonb_build_object('code',p.code_version,'data',p.data_version),'currentId',p.current_history_id,'entries',entries,'revision',p.history_revision);
END $fn$;

-- Prepare returns the trusted target for the BFF's current deterministic policy
-- check. Apply repeats every owner/version/eligibility check under the row lock.
-- Both phases recognize an existing receipt before looking up a truncated target.
CREATE FUNCTION public.atoms_change_history(p_project_id uuid,p_operation_id uuid,p_action text,p_target_id uuid,
 p_code_version integer,p_data_version integer,p_history_revision integer,p_apply boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE uid text:=atoms_private.require_user(); p public.atoms_projects; h atoms_private.history; b atoms_private.restore_backup;
 receipt jsonb; old_hash text; request_hash text; target_doc jsonb; history_before jsonb;
BEGIN
 IF p_operation_id IS NULL OR p_target_id IS NULL OR p_action IS NULL OR p_action NOT IN ('restore','undo','clear') OR p_apply IS NULL
 OR p_history_revision IS NULL OR p_history_revision<0 OR p_code_version IS NULL OR p_data_version IS NULL OR p_code_version<1 OR p_data_version<1 THEN
 RAISE SQLSTATE 'PT400' USING MESSAGE='invalid history operation'; END IF;
 request_hash:=encode(sha256(convert_to(jsonb_build_array('history',p_project_id,p_action,p_target_id,p_code_version,p_data_version,p_history_revision)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(uid||':'||p_operation_id::text,0));
 SELECT o.receipt,o.request_hash INTO receipt,old_hash FROM atoms_private.operations o WHERE o.owner_id=uid AND o.operation_id=p_operation_id;
 IF FOUND THEN
 IF old_hash<>request_hash THEN RAISE SQLSTATE 'PT422' USING MESSAGE='operation mismatch'; END IF;
 RETURN jsonb_build_object('receipt',receipt); END IF;
 SELECT * INTO p FROM public.atoms_projects WHERE id=p_project_id AND owner_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='project unavailable'; END IF;
 IF p.code_version<>p_code_version OR p.data_version<>p_data_version OR p.history_revision<>p_history_revision THEN RAISE SQLSTATE 'PT409' USING MESSAGE='stale confirmation'; END IF;
 SELECT * INTO b FROM atoms_private.restore_backup WHERE project_id=p.id;
 IF p_action='undo' THEN
 IF b.id IS NULL OR b.id<>p_target_id THEN RAISE SQLSTATE 'PT412' USING MESSAGE='undo unavailable'; END IF;
 target_doc:=b.document;
 ELSE
 SELECT * INTO h FROM atoms_private.history WHERE id=p_target_id AND project_id=p.id AND owner_id=uid;
 IF NOT FOUND OR NOT h.available OR h.document IS NULL THEN RAISE SQLSTATE 'PT410' USING MESSAGE='snapshot unavailable'; END IF;
 IF h.id=p.current_history_id THEN RAISE SQLSTATE 'PT423' USING MESSAGE='current snapshot protected'; END IF;
 IF p_action='clear' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.history) dep WHERE dep->>'id'=h.id::text AND (dep->>'available')::boolean) THEN
 RAISE SQLSTATE 'PT423' USING MESSAGE='undo dependency protected'; END IF;
 target_doc:=h.document;
 END IF;
 IF p_action<>'clear' AND NOT atoms_private.history_eligible(target_doc) THEN RAISE SQLSTATE 'PT403' USING MESSAGE='target restricted'; END IF;
 IF NOT p_apply THEN RETURN jsonb_build_object('receipt',NULL,'project',target_doc||jsonb_build_object('id',p.id,'updatedAt',p.updated_at)); END IF;
 IF p_action='restore' THEN
 SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sequence) INTO history_before FROM atoms_private.history x WHERE x.project_id=p.id;
 -- Allocate the complete replacement backup before touching the live state.
 INSERT INTO atoms_private.restore_backup VALUES(p.id,p_operation_id,h.id,h.sequence,clock_timestamp(),p.document,p.state,p.has_data,p.data_saved_at,p.current_history_id,p.history_sequence,history_before)
 ON CONFLICT(project_id) DO UPDATE SET id=excluded.id,target_id=excluded.target_id,target_sequence=excluded.target_sequence,restored_at=excluded.restored_at,
 document=excluded.document,state=excluded.state,has_data=excluded.has_data,data_saved_at=excluded.data_saved_at,current_history_id=excluded.current_history_id,history_sequence=excluded.history_sequence,history=excluded.history;
 DELETE FROM atoms_private.history WHERE project_id=p.id AND sequence>h.sequence;
 UPDATE public.atoms_projects SET document=h.document,state=h.state,has_data=h.has_data,data_saved_at=h.data_saved_at,current_history_id=h.id,history_sequence=h.sequence,
 code_version=code_version+1,data_version=data_version+1,history_revision=history_revision+1,updated_at=clock_timestamp() WHERE id=p.id RETURNING * INTO p;
 ELSIF p_action='undo' THEN
 DELETE FROM atoms_private.history WHERE project_id=p.id;
 INSERT INTO atoms_private.history SELECT * FROM jsonb_populate_recordset(NULL::atoms_private.history,b.history);
 UPDATE public.atoms_projects SET document=b.document,state=b.state,has_data=b.has_data,data_saved_at=b.data_saved_at,current_history_id=b.current_history_id,history_sequence=b.history_sequence,
 code_version=code_version+1,data_version=data_version+1,history_revision=history_revision+1,updated_at=clock_timestamp() WHERE id=p.id RETURNING * INTO p;
 DELETE FROM atoms_private.restore_backup WHERE project_id=p.id;
 ELSE
 UPDATE atoms_private.history SET available=false,document=NULL,state=NULL WHERE id=h.id;
 -- Invalidate historical confirmations without invalidating a candidate or data write.
 UPDATE public.atoms_projects SET history_revision=history_revision+1,updated_at=clock_timestamp() WHERE id=p.id RETURNING * INTO p;
 END IF;
 receipt:=jsonb_build_object('projectId',p.id,'version',jsonb_build_object('code',p.code_version,'data',p.data_version),'updatedAt',p.updated_at);
 INSERT INTO atoms_private.operations VALUES(uid,p_operation_id,request_hash,receipt);
 RETURN jsonb_build_object('receipt',receipt);
END $fn$;
REVOKE ALL ON FUNCTION public.atoms_change_history(uuid,uuid,text,uuid,integer,integer,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.atoms_change_history(uuid,uuid,text,uuid,integer,integer,integer,boolean) TO authenticated;

-- A successful trusted adoption is the only forward edit ending undo.
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
    PERFORM atoms_private.start_history(pid,'initial');
  ELSE
    SELECT * INTO p FROM public.atoms_projects WHERE id=pid AND owner_id=uid FOR UPDATE;
    IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='project unavailable'; END IF;
    IF p.code_version IS DISTINCT FROM (expected->>'code')::integer OR p.data_version IS DISTINCT FROM (expected->>'data')::integer
      OR encode(sha256(convert_to(coalesce(p.document->'draftResult',p.document->'result')->>'html','UTF8')),'hex') IS DISTINCT FROM b->>'baseHash' THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE='stale candidate'; END IF;
    IF policy->>'adoption' IS DISTINCT FROM 'allowed' OR policy->>'status' IS DISTINCT FROM 'allowed' THEN
      RAISE SQLSTATE 'PT403' USING MESSAGE='adoption restricted'; END IF;
    PERFORM atoms_private.seal_history(pid);
    rec:=jsonb_build_object('id',p_operation_id,'adoptedAt',clock_timestamp(),'requests',(SELECT jsonb_agg(g->>'requirement') FROM jsonb_array_elements(b->'generations') g),
      'summary','已采用候选代码，继续使用原项目正式数据。','generations',b->'generations','codeTaskId',tid);
    UPDATE public.atoms_projects SET document=(document-'draftResult')||jsonb_build_object('result',b->'result','previewPolicy',policy||'{"dataMode":"formal"}'::jsonb,
      'modificationRecords',coalesce(document->'modificationRecords','[]'::jsonb)||jsonb_build_array(rec)),code_version=code_version+1,updated_at=clock_timestamp()
      WHERE id=pid AND owner_id=uid RETURNING * INTO p;
    PERFORM atoms_private.start_history(pid,'adopted');
    DELETE FROM atoms_private.restore_backup WHERE project_id=pid;
  END IF;
  commit_receipt:=jsonb_build_object('projectId',pid,'version',jsonb_build_object('code',p.code_version,'data',p.data_version),'updatedAt',p.updated_at);
  INSERT INTO atoms_private.operations VALUES(uid,p_operation_id,request_hash,commit_receipt);
  UPDATE atoms_private.tasks SET artifact_hash=request_hash,receipt=commit_receipt WHERE owner_id=uid AND task_id=tid;
  RETURN commit_receipt;
END $fn$;


