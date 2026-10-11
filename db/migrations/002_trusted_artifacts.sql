-- Incremental: 001 remains immutable. Ordinary JWT + server attestation are
-- both required. The signing key grants no database identity or direct writes.
CREATE TABLE atoms_private.artifact_key (singleton boolean PRIMARY KEY CHECK(singleton), secret bytea NOT NULL CHECK(octet_length(secret)=32));
CREATE TABLE atoms_private.tasks (
  owner_id text NOT NULL, task_id uuid NOT NULL, project_id uuid NOT NULL,
  expected jsonb, base_hash text, artifact_hash text, receipt jsonb,
  PRIMARY KEY(owner_id,task_id)
);
CREATE UNIQUE INDEX atoms_initial_task_project ON atoms_private.tasks(project_id) WHERE expected IS NULL;
REVOKE ALL ON ALL TABLES IN SCHEMA atoms_private FROM PUBLIC, anon, authenticated;

-- HMAC-SHA256 using built-in SHA256, independent of extension search paths.
CREATE FUNCTION atoms_private.proof(p_payload text,p_signature text,p_kind text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $fn$
DECLARE uid text := atoms_private.require_user(); k bytea; ipad bytea := decode(repeat('36',64),'hex');
  opad bytea := decode(repeat('5c',64),'hex'); mac text; b jsonb; i integer;
BEGIN
  IF p_payload IS NULL OR octet_length(p_payload)>6000000 OR p_signature IS NULL OR p_signature !~ '^[a-f0-9]{64}$' THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE='invalid proof'; END IF;
  SELECT secret INTO k FROM atoms_private.artifact_key WHERE singleton;
  IF k IS NULL THEN RAISE SQLSTATE 'PT503' USING MESSAGE='proof key missing'; END IF;
  FOR i IN 0..31 LOOP
    ipad:=set_byte(ipad,i,get_byte(ipad,i)#get_byte(k,i));
    opad:=set_byte(opad,i,get_byte(opad,i)#get_byte(k,i));
  END LOOP;
  mac:=encode(sha256(opad||sha256(ipad||convert_to(p_payload,'UTF8'))),'hex');
  IF mac<>p_signature THEN RAISE SQLSTATE 'PT403' USING MESSAGE='invalid proof'; END IF;
  b:=p_payload::jsonb;
  IF b->>'ownerId' IS DISTINCT FROM uid OR b->>'kind' IS DISTINCT FROM p_kind OR b->>'v' IS DISTINCT FROM '1' THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE='proof owner or kind mismatch'; END IF;
  RETURN b;
END $fn$;

CREATE FUNCTION public.atoms_claim_task(p_payload text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE uid text:=atoms_private.require_user(); b jsonb:=atoms_private.proof(p_payload,p_signature,'start');
  pid uuid:=(b->>'projectId')::uuid; tid uuid:=(b->>'taskId')::uuid; p public.atoms_projects;
  expected jsonb:=nullif(b->'expected','null'::jsonb);
BEGIN
  IF pid IS NULL OR tid IS NULL THEN RAISE SQLSTATE 'PT400' USING MESSAGE='missing task'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid||':'||tid::text,0));
  IF EXISTS(SELECT 1 FROM atoms_private.tasks WHERE owner_id=uid AND task_id=tid) THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE='task already started'; END IF;
  IF expected IS NULL THEN
    IF EXISTS(SELECT 1 FROM public.atoms_projects WHERE id=pid) OR EXISTS(SELECT 1 FROM atoms_private.tasks WHERE project_id=pid AND tasks.expected IS NULL) THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE='project already allocated'; END IF;
  ELSE
    SELECT * INTO p FROM public.atoms_projects WHERE id=pid AND owner_id=uid FOR UPDATE;
    IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='project unavailable'; END IF;
    IF p.code_version IS DISTINCT FROM (expected->>'code')::integer OR p.data_version IS DISTINCT FROM (expected->>'data')::integer
      OR encode(sha256(convert_to(coalesce(p.document->'draftResult',p.document->'result')->>'html','UTF8')),'hex') IS DISTINCT FROM b->>'baseHash' THEN
      RAISE SQLSTATE 'PT409' USING MESSAGE='stale generation base'; END IF;
  END IF;
  INSERT INTO atoms_private.tasks(owner_id,task_id,project_id,expected,base_hash) VALUES(uid,tid,pid,expected,b->>'baseHash');
  RETURN jsonb_build_object('projectId',pid,'version',coalesce(expected,'{"code":1,"data":1}'::jsonb),'updatedAt',clock_timestamp());
END $fn$;

CREATE FUNCTION public.atoms_commit_artifact(p_operation_id uuid,p_payload text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE uid text:=atoms_private.require_user(); b jsonb:=atoms_private.proof(p_payload,p_signature,'artifact');
  pid uuid:=(b->>'projectId')::uuid; tid uuid:=(b->>'taskId')::uuid; p public.atoms_projects; task atoms_private.tasks;
  expected jsonb:=nullif(b->'expected','null'::jsonb); receipt jsonb; old_hash text;
  request_hash text:=encode(sha256(convert_to('artifact:'||p_payload,'UTF8')),'hex'); doc jsonb; policy jsonb:=b->'policy'; rec jsonb;
BEGIN
  IF p_operation_id IS NULL OR pid IS NULL OR tid IS NULL THEN RAISE SQLSTATE 'PT400' USING MESSAGE='invalid commit'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid||':'||p_operation_id::text,0));
  SELECT o.receipt,o.request_hash INTO receipt,old_hash FROM atoms_private.operations o WHERE o.owner_id=uid AND o.operation_id=p_operation_id;
  IF FOUND THEN
    IF old_hash<>request_hash THEN RAISE SQLSTATE 'PT422' USING MESSAGE='operation mismatch'; END IF;
    RETURN receipt;
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
  receipt:=jsonb_build_object('projectId',pid,'version',jsonb_build_object('code',p.code_version,'data',p.data_version),'updatedAt',p.updated_at);
  INSERT INTO atoms_private.operations VALUES(uid,p_operation_id,request_hash,receipt);
  UPDATE atoms_private.tasks SET artifact_hash=request_hash,receipt=atoms_commit_artifact.receipt WHERE owner_id=uid AND task_id=tid;
  RETURN receipt;
END $fn$;

CREATE FUNCTION public.atoms_activate_project(p_project_id uuid,p_operation_id uuid,p_code_version integer,p_data_version integer) RETURNS jsonb
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
  receipt:=jsonb_build_object('projectId',p.id,'version',jsonb_build_object('code',p.code_version,'data',p.data_version),'updatedAt',p.updated_at);
  INSERT INTO atoms_private.operations VALUES(uid,p_operation_id,request_hash,receipt); RETURN receipt;
END $fn$;

-- Only server-attested events can be added. Merge under the row lock into the
-- latest document; there is no client project snapshot, code or state input.
CREATE FUNCTION atoms_private.merge_events(record jsonb, additions jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT record||jsonb_build_object('events',coalesce(record->'events','[]'::jsonb)||coalesce((
   SELECT jsonb_agg(e) FROM jsonb_array_elements(additions) e WHERE NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(coalesce(record->'events','[]'::jsonb)) old
     WHERE old->>'source'=e->>'source' AND old->>'sequence'=e->>'sequence')),'[]'::jsonb))
$fn$;
CREATE FUNCTION public.atoms_append_events(p_operation_id uuid,p_payload text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE uid text:=atoms_private.require_user(); b jsonb:=atoms_private.proof(p_payload,p_signature,'events');
  pid uuid:=(b->>'projectId')::uuid; tid text:=b->>'taskId'; p public.atoms_projects; doc jsonb; receipt jsonb; old_hash text; matched boolean:=false;
  request_hash text:=encode(sha256(convert_to('events:'||p_payload,'UTF8')),'hex'); r jsonb; g jsonb; records jsonb:='[]'; generations jsonb;
BEGIN
  IF p_operation_id IS NULL THEN RAISE SQLSTATE 'PT400' USING MESSAGE='operation required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid||':'||p_operation_id::text,0));
  SELECT o.receipt,o.request_hash INTO receipt,old_hash FROM atoms_private.operations o WHERE o.owner_id=uid AND o.operation_id=p_operation_id;
  IF FOUND THEN
    IF old_hash<>request_hash THEN RAISE SQLSTATE 'PT422' USING MESSAGE='operation mismatch'; END IF; RETURN receipt;
  END IF;
  SELECT * INTO p FROM public.atoms_projects WHERE id=pid AND owner_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='project unavailable'; END IF;
  doc:=p.document;
  IF doc->'initialGeneration'->>'taskId'=tid THEN
    doc:=jsonb_set(doc,'{initialGeneration}',atoms_private.merge_events(doc->'initialGeneration',b->'events')); matched:=true;
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(doc->'modificationRecords','[]')) LOOP
    generations:='[]';
    FOR g IN SELECT * FROM jsonb_array_elements(coalesce(r->'generations','[]')) LOOP
      IF g->>'taskId'=tid THEN g:=atoms_private.merge_events(g,b->'events'); matched:=true; END IF;
      generations:=generations||jsonb_build_array(g);
    END LOOP;
    records:=records||jsonb_build_array(r||jsonb_build_object('generations',generations));
  END LOOP;
  IF NOT matched THEN RAISE SQLSTATE 'PT404' USING MESSAGE='saved task unavailable'; END IF;
  UPDATE public.atoms_projects SET document=doc||jsonb_build_object('modificationRecords',records) WHERE id=pid AND owner_id=uid;
  receipt:=jsonb_build_object('projectId',pid,'version',jsonb_build_object('code',p.code_version,'data',p.data_version),'updatedAt',p.updated_at);
  INSERT INTO atoms_private.operations VALUES(uid,p_operation_id,request_hash,receipt); RETURN receipt;
END $fn$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atoms_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.atoms_claim_task(text,text),public.atoms_commit_artifact(uuid,text,text),public.atoms_activate_project(uuid,uuid,integer,integer),public.atoms_append_events(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.atoms_claim_task(text,text),public.atoms_commit_artifact(uuid,text,text),public.atoms_activate_project(uuid,uuid,integer,integer),public.atoms_append_events(uuid,text,text) TO authenticated;
