-- History identity is independent of the monotonic code/data write versions.
-- Only the existing trusted commit paths create or seal points. No snapshot
-- document, policy or data is accepted from the browser.
ALTER TABLE public.atoms_projects ADD COLUMN data_saved_at timestamptz;
ALTER TABLE public.atoms_projects ADD COLUMN current_history_id uuid;
ALTER TABLE public.atoms_projects ADD COLUMN history_sequence integer NOT NULL DEFAULT 0;
CREATE TABLE atoms_private.history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.atoms_projects(id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  sequence integer NOT NULL CHECK(sequence > 0),
  origin text NOT NULL CHECK(origin IN ('baseline','initial','example','activated','adopted')),
  record_id text,
  summary text NOT NULL,
  paired_at timestamptz NOT NULL,
  data_saved_at timestamptz,
  next_sequence integer,
  document jsonb,
  state jsonb,
  has_data boolean NOT NULL,
  available boolean NOT NULL DEFAULT true,
  UNIQUE(project_id, sequence),
  CHECK(NOT available OR document IS NOT NULL)
);
REVOKE ALL ON atoms_private.history FROM PUBLIC,anon,authenticated;

CREATE FUNCTION atoms_private.history_eligible(doc jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT coalesce(NOT doc ? 'draftResult' AND jsonb_typeof(doc->'result'->'html')='string' AND (
   (doc->'previewPolicy'->>'status'='allowed' AND doc->'previewPolicy'->>'dataMode'='formal'
     AND doc->'previewPolicy'->>'adoption'='allowed')
   OR (NOT doc ? 'previewPolicy' AND doc->'exampleSource'->>'kind'='builtin-example')),false)
$fn$;

CREATE FUNCTION atoms_private.start_history(pid uuid, source text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE p public.atoms_projects; hid uuid:=gen_random_uuid(); last_record jsonb;
BEGIN
 SELECT * INTO p FROM public.atoms_projects WHERE id=pid FOR UPDATE;
 IF NOT atoms_private.history_eligible(p.document) THEN RETURN; END IF;
 IF p.current_history_id IS NOT NULL THEN RAISE EXCEPTION 'current history already exists'; END IF;
 last_record:=p.document->'modificationRecords'->-1;
 INSERT INTO atoms_private.history(id,project_id,owner_id,sequence,origin,record_id,summary,paired_at,data_saved_at,document,state,has_data)
 VALUES(hid,p.id,p.owner_id,p.history_sequence+1,source,last_record->>'id',
   coalesce((SELECT string_agg(value,'；') FROM jsonb_array_elements_text(coalesce(last_record->'requests','[]'::jsonb)) AS requests(value)),last_record->>'summary',p.document->>'requirement',''),clock_timestamp(),p.data_saved_at,p.document,p.state,p.has_data);
 UPDATE public.atoms_projects SET current_history_id=hid,history_sequence=history_sequence+1 WHERE id=pid;
END $fn$;

CREATE FUNCTION atoms_private.seal_history(pid uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE p public.atoms_projects;
BEGIN
 SELECT * INTO p FROM public.atoms_projects WHERE id=pid FOR UPDATE;
 IF NOT atoms_private.history_eligible(p.document) THEN RETURN; END IF;
 IF p.current_history_id IS NULL THEN RAISE EXCEPTION 'formal baseline missing'; END IF;
 UPDATE atoms_private.history SET document=p.document,state=p.state,has_data=p.has_data,
   paired_at=clock_timestamp(),data_saved_at=p.data_saved_at,next_sequence=p.history_sequence+1
   WHERE id=p.current_history_id AND project_id=p.id AND owner_id=p.owner_id AND available;
 IF NOT FOUND THEN RAISE EXCEPTION 'current history unavailable'; END IF;
 UPDATE public.atoms_projects SET current_history_id=NULL WHERE id=pid;
END $fn$;

-- Existing projects get an actual baseline now. Their previous data-save time
-- is unknown, never inferred from project updated_at or generation timestamps.
DO $baseline$ DECLARE p public.atoms_projects; BEGIN
 FOR p IN SELECT * FROM public.atoms_projects ORDER BY id FOR UPDATE LOOP
   IF atoms_private.history_eligible(p.document) THEN PERFORM atoms_private.start_history(p.id,'baseline'); END IF;
 END LOOP;
END $baseline$;

CREATE FUNCTION atoms_private.history_entry(h atoms_private.history, current_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $fn$
 SELECT jsonb_build_object('id',h.id,'sequence',h.sequence,'origin',h.origin,'recordId',h.record_id,'summary',h.summary,
   'pairedAt',h.paired_at,'dataSavedAt',h.data_saved_at,'hasData',h.has_data,'nextSequence',h.next_sequence,
   'status',CASE WHEN h.id=current_id THEN 'current' WHEN h.available THEN 'available' ELSE 'cleared' END)
$fn$;
CREATE FUNCTION public.atoms_list_history(p_project_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE uid text:=atoms_private.require_user(); p public.atoms_projects; entries jsonb;
BEGIN
 SELECT * INTO p FROM public.atoms_projects WHERE id=p_project_id AND owner_id=uid;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='project unavailable'; END IF;
 SELECT coalesce(jsonb_agg(atoms_private.history_entry(h,p.current_history_id) ORDER BY h.sequence DESC),'[]'::jsonb)
 INTO entries FROM atoms_private.history h WHERE h.project_id=p.id AND h.owner_id=uid;
 RETURN jsonb_build_object('projectId',p.id,'version',jsonb_build_object('code',p.code_version,'data',p.data_version),
   'currentId',p.current_history_id,'entries',entries);
END $fn$;
CREATE FUNCTION public.atoms_get_snapshot(p_project_id uuid,p_snapshot_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE uid text:=atoms_private.require_user(); p public.atoms_projects; h atoms_private.history;
BEGIN
 SELECT * INTO p FROM public.atoms_projects WHERE id=p_project_id AND owner_id=uid;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='project unavailable'; END IF;
 SELECT * INTO h FROM atoms_private.history WHERE id=p_snapshot_id AND project_id=p.id AND owner_id=uid;
 IF NOT FOUND OR NOT h.available OR h.document IS NULL THEN RAISE SQLSTATE 'PT410' USING MESSAGE='snapshot unavailable'; END IF;
 IF NOT atoms_private.history_eligible(h.document) THEN RAISE SQLSTATE 'PT403' USING MESSAGE='snapshot restricted'; END IF;
 RETURN jsonb_build_object('projectId',p.id,'entry',atoms_private.history_entry(h,p.current_history_id),
   'project',h.document||jsonb_build_object('id',p.id,'updatedAt',h.paired_at), 'state',h.state,'hasData',h.has_data);
END $fn$;
CREATE OR REPLACE FUNCTION public.atoms_copy_example(p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $fn$
DECLARE uid text := atoms_private.require_user(); receipt jsonb; previous_hash text;
  p public.atoms_projects; template atoms_private.templates; request_hash constant text := 'copy-example:tip-calculator:v1';
BEGIN
  IF p_operation_id IS NULL THEN RAISE SQLSTATE 'PT400' USING MESSAGE = 'operation required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid || ':' || p_operation_id::text, 0));
  SELECT o.receipt, o.request_hash INTO receipt, previous_hash FROM atoms_private.operations o
    WHERE o.owner_id = uid AND o.operation_id = p_operation_id;
  IF FOUND THEN
    IF previous_hash <> request_hash THEN RAISE SQLSTATE 'PT422' USING MESSAGE = 'operation mismatch'; END IF;
    RETURN receipt;
  END IF;
  SELECT * INTO template FROM atoms_private.templates WHERE id = 'tip-calculator:v1';
  IF NOT FOUND THEN RAISE SQLSTATE 'PT503' USING MESSAGE = 'template not installed'; END IF;
  INSERT INTO public.atoms_projects(owner_id, document, state, has_data, data_saved_at)
    VALUES(uid, template.document, template.state, true, clock_timestamp()) RETURNING * INTO p;
  PERFORM atoms_private.start_history(p.id,'example');
  receipt := jsonb_build_object('projectId', p.id, 'version', jsonb_build_object('code', p.code_version, 'data', p.data_version), 'updatedAt', p.updated_at);
  INSERT INTO atoms_private.operations VALUES (uid, p_operation_id, request_hash, receipt);
  RETURN receipt;
END $fn$;

CREATE OR REPLACE FUNCTION public.atoms_save_data(p_project_id uuid, p_operation_id uuid, p_code_version integer, p_data_version integer, p_state jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE uid text := atoms_private.require_user(); p public.atoms_projects; receipt jsonb; previous_hash text; request_hash text;
BEGIN
  p_state := coalesce(p_state, 'null'::jsonb);
  IF p_operation_id IS NULL OR p_code_version IS NULL OR p_data_version IS NULL
    OR p_code_version < 1 OR p_data_version < 1 OR octet_length(p_state::text) > 1000000 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'invalid save';
  END IF;
  request_hash := encode(sha256(convert_to(jsonb_build_array('data', p_project_id, p_code_version, p_data_version, p_state)::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(uid || ':' || p_operation_id::text, 0));
  SELECT o.receipt, o.request_hash INTO receipt, previous_hash FROM atoms_private.operations o
    WHERE o.owner_id = uid AND o.operation_id = p_operation_id;
  IF FOUND THEN
    IF previous_hash <> request_hash THEN RAISE SQLSTATE 'PT422' USING MESSAGE = 'operation mismatch'; END IF;
    RETURN receipt;
  END IF;
  SELECT * INTO p FROM public.atoms_projects WHERE id = p_project_id AND owner_id = uid FOR UPDATE;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'project unavailable'; END IF;
  IF p.code_version <> p_code_version OR p.data_version <> p_data_version THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'stale version';
  END IF;
  IF p.document->'previewPolicy'->>'dataMode' = 'trial' OR p.document->'previewPolicy'->>'status' = 'blocked' THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'formal data restricted';
  END IF;
  UPDATE public.atoms_projects SET state = p_state, has_data = true, data_saved_at = clock_timestamp(), data_version = data_version + 1, updated_at = clock_timestamp()
    WHERE id = p_project_id AND owner_id = uid RETURNING * INTO p;
  receipt := jsonb_build_object('projectId', p.id, 'version', jsonb_build_object('code', p.code_version, 'data', p.data_version), 'updatedAt', p.updated_at);
  INSERT INTO atoms_private.operations VALUES (uid, p_operation_id, request_hash, receipt);
  RETURN receipt;
END $fn$;

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
  END IF;
  commit_receipt:=jsonb_build_object('projectId',pid,'version',jsonb_build_object('code',p.code_version,'data',p.data_version),'updatedAt',p.updated_at);
  INSERT INTO atoms_private.operations VALUES(uid,p_operation_id,request_hash,commit_receipt);
  UPDATE atoms_private.tasks SET artifact_hash=request_hash,receipt=commit_receipt WHERE owner_id=uid AND task_id=tid;
  RETURN commit_receipt;
END $fn$;


CREATE OR REPLACE FUNCTION public.atoms_activate_project(p_project_id uuid,p_operation_id uuid,p_code_version integer,p_data_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE uid text:=atoms_private.require_user(); p public.atoms_projects; receipt jsonb; old_hash text;
  request_hash text:=encode(sha256(convert_to(jsonb_build_array('activate',p_project_id,p_code_version,p_data_version)::text,'UTF8')),'hex');
BEGIN
  IF p_operation_id IS NULL OR p_code_version IS NULL OR p_data_version IS NULL THEN RAISE SQLSTATE 'PT400' USING MESSAGE='invalid activation'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid||':'||p_operation_id::text,0));
  SELECT o.receipt,o.request_hash INTO receipt,old_hash FROM atoms_private.operations o WHERE o.owner_id=uid AND o.operation_id=p_operation_id;
  IF FOUND THEN
    IF old_hash<>request_hash THEN RAISE SQLSTATE 'PT422' USING MESSAGE='operation mismatch'; END IF; RETURN receipt;
  END IF;
  SELECT * INTO p FROM public.atoms_projects WHERE id=p_project_id AND owner_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='project unavailable'; END IF;
  IF p.code_version<>p_code_version OR p.data_version<>p_data_version THEN RAISE SQLSTATE 'PT409' USING MESSAGE='stale activation'; END IF;
  IF NOT p.document ? 'draftResult' OR p.document->'previewPolicy'->>'adoption' IS DISTINCT FROM 'allowed'
    OR p.document->'previewPolicy'->>'status' IS DISTINCT FROM 'allowed' THEN RAISE SQLSTATE 'PT403' USING MESSAGE='activation restricted'; END IF;
  UPDATE public.atoms_projects SET document=(document-'draftResult')||jsonb_build_object('result',document->'draftResult','previewPolicy',(document->'previewPolicy')||'{"dataMode":"formal"}'::jsonb),code_version=code_version+1,updated_at=clock_timestamp()
    WHERE id=p_project_id AND owner_id=uid RETURNING * INTO p;
  PERFORM atoms_private.start_history(p.id,'activated');
  receipt:=jsonb_build_object('projectId',p.id,'version',jsonb_build_object('code',p.code_version,'data',p.data_version),'updatedAt',p.updated_at);
  INSERT INTO atoms_private.operations VALUES(uid,p_operation_id,request_hash,receipt); RETURN receipt;
END $fn$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atoms_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.atoms_list_history(uuid),public.atoms_get_snapshot(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.atoms_list_history(uuid),public.atoms_get_snapshot(uuid,uuid) TO authenticated;
