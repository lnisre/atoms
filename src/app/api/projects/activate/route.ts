import { projectInput, projectResponse, projectRpc } from "@/lib/cloud-projects/server";
export const runtime = "nodejs";
export function POST(request: Request) { return projectResponse(request, async identity => {
  const body = await projectInput(request);
  return projectRpc(identity, "activate_project", {p_project_id: body.projectId, p_operation_id: body.operationId, p_code_version: body.expected?.code, p_data_version: body.expected?.data});
}); }
