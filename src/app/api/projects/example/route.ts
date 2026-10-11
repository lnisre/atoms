import { copyCloudExample, projectInput, projectResponse } from "@/lib/cloud-projects/server";
export const runtime = "nodejs";
export function POST(request: Request) {
  return projectResponse(request, async identity => copyCloudExample(identity, (await projectInput(request)).operationId));
}
