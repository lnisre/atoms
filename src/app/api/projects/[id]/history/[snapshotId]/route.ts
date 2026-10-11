import { getCloudSnapshot, projectResponse } from "@/lib/cloud-projects/server";
export const runtime = "nodejs";
export function GET(request: Request, context: { params: Promise<{ id: string; snapshotId: string }> }) {
  return projectResponse(request, async identity => {
    const { id, snapshotId } = await context.params;
    return getCloudSnapshot(identity, id, snapshotId);
  });
}
