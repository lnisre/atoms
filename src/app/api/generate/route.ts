import { teamEntry } from "@/lib/team/server";
export const runtime = "nodejs";
export const maxDuration = 300;
// Compatibility requests use the same authenticated project/task boundary.
// The old arbitrary baseHtml / unreviewed direct-model path is no longer exposed.
export const POST = teamEntry;
