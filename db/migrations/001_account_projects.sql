-- Applied in one transaction by migrate.mjs. Runtime has no management key.
-- CloudBase's RPC gateway must not be treated as an EXECUTE-permission gate:
-- every exposed definer checks JWT role + subject and scopes every row access.
CREATE SCHEMA IF NOT EXISTS atoms_private;
REVOKE ALL ON SCHEMA atoms_private FROM PUBLIC, anon, authenticated;
CREATE TABLE public.atoms_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  state jsonb,
  has_data boolean NOT NULL DEFAULT false,
  code_version integer NOT NULL DEFAULT 1 CHECK (code_version > 0),
  data_version integer NOT NULL DEFAULT 1 CHECK (data_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX atoms_projects_owner_updated ON public.atoms_projects(owner_id, updated_at DESC, id);
ALTER TABLE public.atoms_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atoms_projects FORCE ROW LEVEL SECURITY;
CREATE POLICY atoms_projects_owner_read ON public.atoms_projects FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated' AND owner_id = auth.uid());
REVOKE ALL ON public.atoms_projects FROM PUBLIC, anon, authenticated;
-- Reads also have RLS. Writes have no table grants: version/operation checks
-- cannot be bypassed by directly calling a table's REST endpoint.
GRANT SELECT ON public.atoms_projects TO authenticated;
CREATE TABLE atoms_private.operations (
  owner_id text NOT NULL,
  operation_id uuid NOT NULL,
  request_hash text NOT NULL,
  receipt jsonb NOT NULL,
  PRIMARY KEY (owner_id, operation_id)
);
CREATE TABLE atoms_private.templates (
  id text PRIMARY KEY,
  document jsonb NOT NULL,
  state jsonb NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA atoms_private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION atoms_private.require_user() RETURNS text LANGUAGE plpgsql STABLE
SET search_path = pg_catalog AS $fn$
DECLARE uid text := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR uid IS NULL OR length(uid) = 0 THEN
    RAISE SQLSTATE 'PT401' USING MESSAGE = 'authenticated user required';
  END IF;
  RETURN uid;
END $fn$;

CREATE FUNCTION public.atoms_list_projects() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $fn$
DECLARE uid text := atoms_private.require_user(); result jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.document->>'title',
    'updatedAt', p.updated_at, 'exampleSource', p.document->'exampleSource') ORDER BY p.updated_at DESC, p.id), '[]'::jsonb)
    INTO result FROM public.atoms_projects p WHERE p.owner_id = uid;
  RETURN result;
END $fn$;

CREATE FUNCTION public.atoms_get_project(p_project_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $fn$
DECLARE uid text := atoms_private.require_user(); p public.atoms_projects; restricted boolean;
BEGIN
  SELECT * INTO p FROM public.atoms_projects WHERE id = p_project_id AND owner_id = uid;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'project unavailable'; END IF;
  restricted := coalesce(p.document->'previewPolicy'->>'dataMode' = 'trial', false)
    OR coalesce(p.document->'previewPolicy'->>'status' = 'blocked', false);
  RETURN jsonb_build_object('project', p.document || jsonb_build_object('id', p.id, 'updatedAt', p.updated_at),
    'version', jsonb_build_object('code', p.code_version, 'data', p.data_version),
    'state', CASE WHEN restricted THEN NULL ELSE p.state END, 'hasData', NOT restricted AND p.has_data);
END $fn$;

CREATE FUNCTION public.atoms_copy_example(p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
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
  INSERT INTO public.atoms_projects(owner_id, document, state, has_data)
    VALUES(uid, template.document, template.state, true) RETURNING * INTO p;
  receipt := jsonb_build_object('projectId', p.id, 'version', jsonb_build_object('code', p.code_version, 'data', p.data_version), 'updatedAt', p.updated_at);
  INSERT INTO atoms_private.operations VALUES (uid, p_operation_id, request_hash, receipt);
  RETURN receipt;
END $fn$;

CREATE FUNCTION public.atoms_get_data(p_project_id uuid, p_code_version integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $fn$
DECLARE uid text := atoms_private.require_user(); p public.atoms_projects;
BEGIN
  SELECT * INTO p FROM public.atoms_projects WHERE id = p_project_id AND owner_id = uid;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE = 'project unavailable'; END IF;
  IF p_code_version IS DISTINCT FROM p.code_version THEN RAISE SQLSTATE 'PT409' USING MESSAGE = 'stale code'; END IF;
  IF p.document->'previewPolicy'->>'dataMode' = 'trial' OR p.document->'previewPolicy'->>'status' = 'blocked' THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'formal data restricted';
  END IF;
  RETURN jsonb_build_object('state', p.state, 'hasData', p.has_data, 'version', jsonb_build_object('code', p.code_version, 'data', p.data_version));
END $fn$;

CREATE FUNCTION public.atoms_save_data(p_project_id uuid, p_operation_id uuid, p_code_version integer, p_data_version integer, p_state jsonb)
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
  UPDATE public.atoms_projects SET state = p_state, has_data = true, data_version = data_version + 1, updated_at = clock_timestamp()
    WHERE id = p_project_id AND owner_id = uid RETURNING * INTO p;
  receipt := jsonb_build_object('projectId', p.id, 'version', jsonb_build_object('code', p.code_version, 'data', p.data_version), 'updatedAt', p.updated_at);
  INSERT INTO atoms_private.operations VALUES (uid, p_operation_id, request_hash, receipt);
  RETURN receipt;
END $fn$;

REVOKE ALL ON FUNCTION public.atoms_list_projects(), public.atoms_get_project(uuid), public.atoms_copy_example(uuid),
  public.atoms_get_data(uuid, integer), public.atoms_save_data(uuid, uuid, integer, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atoms_list_projects(), public.atoms_get_project(uuid), public.atoms_copy_example(uuid),
  public.atoms_get_data(uuid, integer), public.atoms_save_data(uuid, uuid, integer, integer, jsonb) TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atoms_private FROM PUBLIC, anon, authenticated;
