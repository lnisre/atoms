import { projectInput, projectResponse, projectRpc } from "@/lib/cloud-projects/server";
export const runtime = "nodejs";
export function POST(request: Request) { return projectResponse(request, async identity => {
  const body = await projectInput(request, 1_000_000);
  return projectRpc(identity, "append_events", {p_operation_id: body.operationId, p_payload: body.proof?.payload, p_signature: body.proof?.signature});
}); }
