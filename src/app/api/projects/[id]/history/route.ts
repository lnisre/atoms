import { projectInput, changeCloudHistory, listCloudHistory, projectResponse } from "@/lib/cloud-projects/server";
export const runtime = "nodejs";
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return projectResponse(request, async identity => listCloudHistory(identity, (await context.params).id));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return projectResponse(request, async identity => changeCloudHistory(identity, id, await projectInput(request, 4096)));
}
