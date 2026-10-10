import { commitArtifact } from "@/lib/cloud-projects/artifacts";
import { projectInput, projectResponse } from "@/lib/cloud-projects/server";
export const runtime = "nodejs";
export function POST(request: Request) { return projectResponse(request, async identity => {
  const body = await projectInput(request, 12_000_000);
  return commitArtifact(identity, body.proof, body.operationId);
}); }
