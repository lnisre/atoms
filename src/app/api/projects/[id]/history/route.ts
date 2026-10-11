import { listCloudHistory, projectResponse } from "@/lib/cloud-projects/server";
export const runtime = "nodejs";
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return projectResponse(request, async identity => listCloudHistory(identity, (await context.params).id));
}
