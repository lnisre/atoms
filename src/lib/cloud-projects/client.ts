import { MAX_STATE_BYTES, ProjectError, validateCloudValue, type CloudProject, type CommitReceipt, type DataSave, type DataSnapshot, type ProjectSummary } from "./contract";

export async function cloudRequest<T>(owner: string, path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/projects${path}`, {
      method: options.method ?? "GET", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Atoms-Account": owner },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(22_000)]) : AbortSignal.timeout(22_000),
    });
  } catch { throw new ProjectError("unavailable", "无法确认云端保存结果。请保留页面，重试原保存或下载未保存副本。"); }
  const value = await response.json().catch(() => null);
  if (!response.ok || value === null) throw new ProjectError(value?.code ?? "unavailable", value?.error ?? "云端读取失败，请重试；尚未覆盖任何内容。", response.status);
  validateCloudValue(path === "" ? "list" : options.method === "POST" || options.method === "PUT" ? "receipt" : path.includes("/data?") ? "data" : "project", value);
  return value as T;
}
export const listProjects = (owner: string) => cloudRequest<ProjectSummary[]>(owner, "");
export const readProject = (owner: string, id: string) => cloudRequest<CloudProject>(owner, `/${encodeURIComponent(id)}`);
export const copyExample = (owner: string, operationId: string) => cloudRequest<CommitReceipt>(owner, "/example", { method: "POST", body: { operationId } });

export type DataSessionStatus = {
  phase: "unread" | "loading" | "ready" | "saving" | "failed";
  hasData?: boolean;
  error?: string;
  code?: string;
  pending?: DataSave;
};
// A session binds one account, project and running code version. Failed payloads
// and operation IDs live here, outside generated HTML, and are never persisted.
export class CloudDataSession {
  readonly instanceId = crypto.randomUUID();
  status: DataSessionStatus = { phase: "unread" };
  private snapshot?: DataSnapshot;
  private controller = new AbortController();
  private listeners = new Set<(status: DataSessionStatus) => void>();
  private flight?: Promise<void>;
  constructor(readonly owner: string, readonly projectId: string, readonly codeVersion: number,
    private committed?: (receipt: CommitReceipt) => void) {}
  subscribe(listener: (status: DataSessionStatus) => void) {
    this.listeners.add(listener); listener(this.status);
    return () => { this.listeners.delete(listener); };
  }
  private publish(status: DataSessionStatus) {
    if (this.controller.signal.aborted) return;
    this.status = status;
    this.listeners.forEach(listener => listener(status));
  }
  dispose() { this.controller.abort(); this.listeners.clear(); }
  private checkLive() { if (this.controller.signal.aborted) throw new ProjectError("disposed", "页面已离开，不能继续保存。", 409); }
  async load(): Promise<{ state: unknown } | undefined> {
    this.checkLive();
    if (this.status.pending) throw new ProjectError("pending", "原保存尚未确认，请先重试或下载副本后重新载入。", 409);
    if (this.snapshot) return this.snapshot.hasData ? { state: structuredClone(this.snapshot.state) } : undefined;
    this.publish({ phase: "loading" });
    try {
      const snapshot = await cloudRequest<DataSnapshot>(this.owner, `/${this.projectId}/data?codeVersion=${this.codeVersion}`, { signal: this.controller.signal });
      this.checkLive();
      if (snapshot.version.code !== this.codeVersion) throw new ProjectError("invalid_response", "代码版本已变化，请重新载入云端版本。", 409);
      this.snapshot = snapshot;
      this.publish({ phase: "ready", hasData: snapshot.hasData });
      return snapshot.hasData ? { state: structuredClone(snapshot.state) } : undefined;
    } catch (error) { this.failed(error); throw error; }
  }
  async save(state: unknown) {
    this.checkLive();
    if (!this.snapshot) throw new ProjectError("unread", "尚未成功读取云端数据，已阻止覆盖保存。", 409);
    if (this.status.pending) throw new ProjectError("pending", "原保存尚未确认，请先处理页面上保留的未保存内容。", 409);
    let json: string;
    try {
      const serialized = JSON.stringify(state);
      if (serialized === undefined) throw new Error();
      json = serialized;
    } catch {
      const error = new ProjectError("input", "应用数据必须是可序列化的 JSON 状态。", 400);
      this.failed(error); throw error;
    }
    const pending: DataSave = { operationId: crypto.randomUUID(), expected: { ...this.snapshot.version }, state: JSON.parse(json) };
    this.publish({ phase: "saving", pending });
    return this.attempt(pending);
  }
  retry() {
    this.checkLive();
    const pending = this.status.pending;
    if (!pending) return Promise.reject(new ProjectError("no_pending", "没有待重试的保存。", 400));
    return this.attempt(pending);
  }
  private attempt(pending: DataSave): Promise<void> {
    if (this.flight) return this.flight;
    this.publish({ phase: "saving", pending });
    this.flight = (async () => {
      try {
        if (new TextEncoder().encode(JSON.stringify(pending.state)).byteLength > MAX_STATE_BYTES) throw new ProjectError("input", "应用数据超过 1 MB，未保存内容仍可下载。", 413);
        const receipt = await cloudRequest<CommitReceipt>(this.owner, `/${this.projectId}/data`, { method: "PUT", body: pending, signal: this.controller.signal });
        this.checkLive();
        if (receipt.projectId !== this.projectId || receipt.version.code !== pending.expected.code || receipt.version.data !== pending.expected.data + 1) throw new ProjectError("invalid_response", "保存回执与本次操作不符，请保留页面后重试。");
        this.snapshot = { state: structuredClone(pending.state), hasData: true, version: receipt.version };
        this.publish({ phase: "ready", hasData: true });
        this.committed?.(receipt);
      } catch (error) { this.failed(error, pending); throw error; }
      finally { this.flight = undefined; }
    })();
    return this.flight;
  }
  private failed(error: unknown, pending?: DataSave) {
    this.publish({ phase: "failed", pending, error: error instanceof Error ? error.message : "云端读写失败，请保留页面后重试。", code: error instanceof ProjectError ? error.code : "unavailable" });
  }
}

export function unsavedCopy(project: CloudProject["project"], state?: unknown) {
  return {
    format: "atoms-unsaved-copy/v1", savedToCloud: false, importSupported: false,
    notice: "未保存副本：不表示已同步到云端；当前不支持导入。", exportedAt: new Date().toISOString(),
    title: project.title, requirement: project.requirement,
    code: (project.draftResult ?? project.result).html,
    ...(state === undefined ? {} : { businessState: state }),
  };
}
export function downloadUnsavedCopy(project: CloudProject["project"], state?: unknown) {
  const blob = new Blob([JSON.stringify(unsavedCopy(project, state), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = `atoms-${project.id}-未保存副本.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
