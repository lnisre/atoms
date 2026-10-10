import { getCloudData, saveCloudData, projectInput, projectResponse } from "@/lib/cloud-projects/server";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return projectResponse(request, async identity => getCloudData(identity, (await context.params).id, Number(new URL(request.url).searchParams.get("codeVersion"))));
}
export function PUT(request: Request, context: Context) {
  return projectResponse(request, async identity => saveCloudData(identity, (await context.params).id, await projectInput(request)));
}
