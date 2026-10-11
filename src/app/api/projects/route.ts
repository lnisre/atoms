import { listCloudProjects, projectResponse } from "@/lib/cloud-projects/server";
export const runtime = "nodejs";
export function GET(request: Request) { return projectResponse(request, listCloudProjects); }
