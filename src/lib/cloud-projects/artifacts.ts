import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { requireIdentity } from "../auth/server";
import type { ExecutionEvent, ModificationGeneration } from "../execution";
import type { GenerationResult } from "../generation";
import { MAX_REQUIREMENT_LENGTH } from "../generation";
import type { TeamInput } from "../team/input";
import type { TeamRecord } from "../team/contract";
import { artifactTeam, unresolvedDataIssues } from "../team/review";
import { previewPolicy } from "../team/preview-policy";
import { getCloudProject, projectRpc } from "./server";
import { ProjectError, UUID, type CommitReceipt, type ProjectVersion } from "./contract";
import { MAX_PROOF_BYTES, type Artifact, type ArtifactProof, type GenerationRequest } from "./artifact-contract";

type Identity = Awaited<ReturnType<typeof requireIdentity>>;
export type GenerationBinding = {
  ownerId: string; taskId: string; input: TeamInput; expected: ProjectVersion | null;
  baseHash?: string; generations: ModificationGeneration[];
};
export const codeHash = (html: string) => createHash("sha256").update(html).digest("hex");
function secret() {
  const key = process.env.ATOMS_ARTIFACT_SECRET;
  if (!key || !/^[a-f\d]{64}$/i.test(key)) throw new ProjectError("not_configured", "可信产物保存尚未配置，未启动生成。");
  return Buffer.from(key, "hex");
}
export function signProof(value: object): ArtifactProof {
  const payload = JSON.stringify(value);
  if (Buffer.byteLength(payload) > MAX_PROOF_BYTES) throw new ProjectError("input", "本轮记录过长，请采用或放弃当前候选后再继续。", 413);
  return { payload, signature: createHmac("sha256", secret()).update(payload).digest("hex") };
}
export function verifyArtifact(proof: ArtifactProof, owner: string): Artifact {
  if (!proof || typeof proof.payload !== "string" || Buffer.byteLength(proof.payload) > MAX_PROOF_BYTES || !/^[a-f\d]{64}$/.test(proof.signature ?? "")) throw new ProjectError("proof", "产物证明无效，请保留页面并下载副本。", 403);
  const expected = createHmac("sha256", secret()).update(proof.payload).digest();
  if (!timingSafeEqual(expected, Buffer.from(proof.signature, "hex"))) throw new ProjectError("proof", "产物已改变，不能保存或采用。", 403);
  const value = JSON.parse(proof.payload) as Artifact;
  if (value.v !== 1 || value.kind !== "artifact" || value.ownerId !== owner) throw new ProjectError("proof", "产物不属于当前账号。", 403);
  return value;
}
function sameVersion(a: ProjectVersion | undefined, b: ProjectVersion) {
  return a?.code === b.code && a?.data === b.data;
}
export async function prepareGeneration(identity: Identity, request: GenerationRequest, taskId: string): Promise<GenerationBinding> {
  secret();
  if (!UUID.test(taskId) || !request || !UUID.test(request.projectId) || Object.keys(request).some(k => !["projectId", "requirement", "modification", "expected", "parent"].includes(k))) throw new ProjectError("input", "生成输入无效。", 400);
  const { projectId } = request;
  if (request.modification === undefined) {
    if (request.expected || request.parent || typeof request.requirement !== "string" || !request.requirement.trim() || request.requirement.length > MAX_REQUIREMENT_LENGTH) throw new ProjectError("input", "请填写有效需求。", 400);
    return { ownerId: identity.account.id, taskId, expected: null, generations: [], input: { projectId, requirement: request.requirement.trim() } };
  }
  if (typeof request.modification !== "string" || !request.modification.trim() || request.modification.length > MAX_REQUIREMENT_LENGTH) throw new ProjectError("input", "请填写有效修改需求。", 400);
  const cloud = await getCloudProject(identity, projectId);
  if (!sameVersion(request.expected, cloud.version)) throw new ProjectError("conflict", "云端已有更新，请保留候选并重新载入。", 409);
  const official = cloud.project.draftResult ?? cloud.project.result;
  const parent = request.parent ? verifyArtifact(request.parent, identity.account.id) : undefined;
  if (parent && (parent.projectId !== projectId || !parent.expected || !sameVersion(parent.expected, cloud.version) || parent.baseHash !== codeHash(official.html))) throw new ProjectError("conflict", "候选基础版本已变化，不能继续覆盖。", 409);
  const team = parent?.generations.at(-1)?.team ?? cloud.project.modificationRecords?.at(-1)?.generations?.at(-1)?.team ?? cloud.project.initialGeneration?.team;
  const generations = parent?.generations ?? [];
  const context = [...(cloud.project.modificationRecords ?? []).flatMap(r => r.requests), ...generations.map(g => g.requirement)];
  if (JSON.stringify(context).length > 32000 || JSON.stringify(generations).length > 3_000_000) throw new ProjectError("input", "修改上下文过长，未启动任务。", 413);
  return { ownerId: identity.account.id, taskId, expected: cloud.version, baseHash: codeHash(official.html), generations,
    input: { projectId, requirement: cloud.project.requirement, modification: request.modification.trim(), baseHtml: (parent?.result ?? official).html, context,
      baseDataIssues: team?.protocol === "atoms-team/3" ? unresolvedDataIssues(team) : [] } };
}
export async function claimGeneration(identity: Identity, binding: GenerationBinding) {
  const proof = signProof({ v: 1, kind: "start", ownerId: binding.ownerId, projectId: binding.input.projectId, taskId: binding.taskId, expected: binding.expected, baseHash: binding.baseHash });
  await projectRpc<CommitReceipt>(identity, "claim_task", { p_payload: proof.payload, p_signature: proof.signature });
}
export function attestArtifact(binding: GenerationBinding, result: GenerationResult, assistantReply: string | null, team: TeamRecord, events: ExecutionEvent[], started: number): ArtifactProof {
  if (team.taskId !== binding.taskId || team.projectId !== binding.input.projectId || !artifactTeam(team, codeHash(result.html), true)) throw new ProjectError("proof", "任务产物不完整，不能取得保存资格。", 403);
  const record = { taskId: binding.taskId, startedAt: new Date(started).toISOString(), assistantReply, team, events: structuredClone(events) };
  return signProof({ v: 1, kind: "artifact", ownerId: binding.ownerId, projectId: binding.input.projectId, taskId: binding.taskId,
    requirement: binding.input.requirement, expected: binding.expected, baseHash: binding.baseHash, result,
    policy: previewPolicy(team, result.html), ...(binding.expected ? {} : { initialGeneration: record }),
    generations: binding.expected ? [...binding.generations, { ...record, projectId: binding.input.projectId, requirement: binding.input.modification!, outcome: "complete" }] : [],
  } satisfies Artifact);
}
export async function commitArtifact(identity: Identity, proof: ArtifactProof, operationId: string) {
  const artifact = verifyArtifact(proof, identity.account.id);
  if (!UUID.test(operationId)) throw new ProjectError("input", "保存操作标识无效。", 400);
  const receipt = await projectRpc<CommitReceipt>(identity, "commit_artifact", { p_operation_id: operationId, p_payload: proof.payload, p_signature: proof.signature });
  const record = artifact.initialGeneration ?? artifact.generations.at(-1)!;
  const sequence = Math.max(0, ...record.events.filter(e => e.source === "server").map(e => e.sequence)) + 1;
  const logProof = signProof({ v: 1, kind: "events", ownerId: identity.account.id, projectId: artifact.projectId, taskId: artifact.taskId,
    events: [{ taskId: artifact.taskId, source: "server", sequence, stepId: "cloud-commit", label: "云端事务提交", status: "completed", at: receipt.updatedAt, detail: "代码与对应记录已在同一事务提交；试用数据未写入。" }] });
  return { ...receipt, logProof };
}
