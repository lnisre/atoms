import { prepareBuiltinExample, EXAMPLE_STATE, type ExampleSource } from "./builtin-example";
import { previewPolicy, type PreviewPolicy } from "./team/preview-policy";
import { reviewedTeam, artifactTeam } from "./team/review";
import { sha256 } from "./qa/contract";
import type { ExecutionEvent, InitialGeneration, ModificationGeneration } from "./execution";
import type { GenerationResult } from "./generation";

export type ModificationRecord = {
  id: string;
  adoptedAt: string;
  requests: string[];
  summary: string;
  generations?: ModificationGeneration[];
  codeTaskId?: string;
};

export type SavedProject = {
  id: string;
  exampleSource?: ExampleSource;
  retiredExampleSource?: ExampleSource;
  requirement: string;
  title: string;
  updatedAt: string;
  result: GenerationResult;
  modificationRecords?: ModificationRecord[];
  initialGeneration?: InitialGeneration;
  previewPolicy?: PreviewPolicy;
  // Older clients only know result: keep executable draft code out of that field.
  draftResult?: GenerationResult;
};

// Keep the database name/version stable across compatible deployments.
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("atoms-projects", 1);
    let settled = false;
    const timer = setTimeout(() => fail(), 10_000);
    function fail() {
      settled = true;
      clearTimeout(timer);
      reject(new Error("浏览器存储不可用"));
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("projects", { keyPath: "id" });
      db.createObjectStore("applicationData", { keyPath: "projectId" });
    };
    request.onerror = fail;
    request.onblocked = fail;
    request.onsuccess = () => {
      const db = request.result;
      if (settled) return db.close();
      clearTimeout(timer);
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction, result: (value: T) => void) => void,
): Promise<T> {
  const db = await openDatabase().catch(() => {
    throw new Error("浏览器存储不可用");
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T;
      const timer = setTimeout(() => tx.abort(), 10_000);
      tx.oncomplete = () => {
        clearTimeout(timer);
        resolve(value);
      };
      tx.onabort = tx.onerror = () => {
        clearTimeout(timer);
        reject(new Error("浏览器存储读写失败"));
      };
      try {
        run(tx, (next) => {
          value = next;
        });
      } catch {
        clearTimeout(timer);
        tx.abort();
        reject(new Error("浏览器存储读写失败"));
      }
    });
  } finally {
    db.close();
  }
}

function displayProjects(projects: SavedProject[]) {
  return projects.map(p => p.draftResult ? { ...p, result: p.draftResult } : p)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listProjects() {
  return transaction<SavedProject[]>(["projects"], "readonly", (tx, done) => {
    tx.objectStore("projects").getAll().onsuccess = (event) => {
      done(displayProjects((event.target as IDBRequest<SavedProject[]>).result));
    };
  });
}

// Keep markers in the existing store: old clients can still save/ adopt without
// a database version change. All reads below are raw persisted records, not the
// display projection that substitutes draftResult for result.
const FIRST_VISIT_KEY = "$atoms:workspace:first-visit";
const TIP_EXAMPLE_KEY = "$atoms:workspace:tip-calculator";
function initializeWorkspace(example?: SavedProject) {
  return transaction<{ projects: SavedProject[]; needsExample: boolean }>(
    ["projects", "applicationData"], "readwrite", (tx, done) => {
      const projects = tx.objectStore("projects");
      const metadata = tx.objectStore("applicationData");
      metadata.get(TIP_EXAMPLE_KEY).onsuccess = event => {
        const completed = Boolean((event.target as IDBRequest).result);
        try {
          projects.getAll().onsuccess = event => {
            const saved = (event.target as IDBRequest<SavedProject[]>).result;
            if (completed) {
              done({ projects: displayProjects(saved), needsExample: false });
              return;
            }
            const installed = saved.some(p => p.exampleSource?.templateId === "tip-calculator");
            if (!installed && !example) {
              done({ projects: displayProjects(saved), needsExample: true });
              return;
            }
            try {
              // Re-read under the final write lock after downloading. Only change
              // identity/title; preserve newer code, draft, records and unknown
              // fields saved by another tab. Never write old application data.
              const upgraded = saved.map(current => {
                if (current.exampleSource?.templateId !== "focus-pomodoro") return current;
                const retired = {
                  ...current,
                  title: current.title === "示例 · 专注番茄钟" ? "专注番茄钟" : current.title,
                  retiredExampleSource: current.exampleSource,
                };
                delete retired.exampleSource;
                projects.put(retired);
                return retired;
              });
              if (!installed && example) {
                projects.add(example);
                metadata.add({ projectId: example.id, state: structuredClone(EXAMPLE_STATE) });
                upgraded.push(example);
              }
              metadata.put({ projectId: FIRST_VISIT_KEY, kind: "workspace-initialization", completed: true });
              metadata.put({ projectId: TIP_EXAMPLE_KEY, kind: "workspace-initialization", completed: true });
              done({ projects: displayProjects(upgraded), needsExample: false });
            } catch { tx.abort(); }
          };
        } catch { tx.abort(); }
      };
    },
  );
}

export async function initializeHomeWorkspace(projectId?: string | null) {
  // A missing deep link remains missing; it is not a first-visit entry point.
  // Read failure is never interpreted as an empty workspace.
  const existing = await listProjects();
  if (projectId && !existing.some(p => p.id === projectId)) return { projects: existing, exampleError: "" };
  try {
    const first = await initializeWorkspace();
    if (!first.needsExample) return { projects: first.projects, exampleError: "" };
    const example = await prepareBuiltinExample();
    const final = await initializeWorkspace(example);
    return { projects: final.projects, exampleError: "" };
  } catch {
    return {
      projects: await listProjects(),
      exampleError: "示例暂时准备失败，请重试；若浏览器存储不可用，当前无法保证保存与恢复。",
    };
  }
}

export async function saveProject(project: SavedProject) {
  if (project.exampleSource || project.retiredExampleSource) throw new Error("内置来源只允许由工作区初始化创建");
  const team = project.initialGeneration?.team;
  if (team?.protocol === "atoms-team/3" && (!artifactTeam(team,await sha256(project.result.html),true) || JSON.stringify(project.previewPolicy) !== JSON.stringify(previewPolicy(team,project.result.html)))) throw new Error("项目代码、审查与预览策略不一致");
  return transaction<void>(["projects"], "readwrite", (tx) => {
    const isolated = project.previewPolicy?.dataMode === "trial" || project.previewPolicy?.status === "blocked";
    tx.objectStore("projects").put(isolated ? {...project,draftResult:project.result,result:{...project.result,html:'<!doctype html><html><head></head><body>此项目为待验证代码，请使用最新版工作台打开。旧版不会运行待验证代码。</body></html>'}} : project);
  });
}

// Code and its record commit together. Trial data is deliberately not an input.
export async function adoptCandidate(
  projectId: string,
  result: GenerationResult,
  requests: string[],
  generations: ModificationGeneration[] = [],
) {
  if (generations.some(item => item.projectId !== projectId || item.outcome !== "complete") ||
      (generations.length > 0 && (generations.length !== requests.length || generations.some((item, index) => item.requirement !== requests[index]))))
    throw new Error("候选消息与项目或需求不匹配，未采用。");
  for (const [index, generation] of generations.entries()) {
    const team = generation.team;
    if (team && (team.taskId !== generation.taskId || team.projectId !== projectId || !team.codeHash || !(team.protocol === "atoms-team/3" ? artifactTeam(team,team.codeHash,true) : reviewedTeam(team,team.codeHash))))
      throw new Error("候选缺少对应任务的通过审查，未采用。");
    const previous = generations[index - 1]?.team;
    if (team && previous && team.baseCodeHash !== previous.codeHash) throw new Error("成功修改轮次的代码来源不连续，未采用。");
  }
  const latest = generations.at(-1)?.team;
  if (latest && latest.codeHash !== await sha256(result.html)) throw new Error("候选代码与最后成功任务不符，未采用。");
  const policy = latest?.protocol === "atoms-team/3" ? previewPolicy(latest,result.html) : undefined;
  if (policy?.adoption === "blocked") throw new Error("存在执行或数据风险，暂不可采用；可继续修改。");
  const record: ModificationRecord = {
    id: crypto.randomUUID(),
    adoptedAt: new Date().toISOString(),
    requests: [...requests],
    ...(generations.length ? { generations: structuredClone(generations), codeTaskId: generations.at(-1)!.taskId } : {}),
    summary: `已采用 ${requests.length} 轮调整后的候选代码，继续使用原项目正式数据。`,
  };
  return transaction<SavedProject>(["projects"], "readwrite", (tx, done) => {
    const projects = tx.objectStore("projects");
    projects.get(projectId).onsuccess = (event) => {
      const current: SavedProject | undefined = (event.target as IDBRequest).result;
      if (!current) return tx.abort();
      const saved: SavedProject = {
        ...current,
        result,
        draftResult: undefined,
        previewPolicy: policy ? {...policy,dataMode:"formal"} : undefined,
        updatedAt: record.adoptedAt,
        modificationRecords: [...(current.modificationRecords ?? []), record],
      };
      try {
        projects.put(saved);
        done(saved);
      } catch {
        tx.abort();
      }
    };
  });
}

export function loadApplicationData(projectId: string) {
  return transaction<{ state: unknown } | undefined>(
    ["applicationData"],
    "readonly",
    (tx, done) => {
      tx.objectStore("applicationData").get(projectId).onsuccess = (event) => {
        done((event.target as IDBRequest).result);
      };
    },
  );
}

export function saveApplicationData(projectId: string, state: unknown) {
  return transaction<void>(
    ["projects", "applicationData"],
    "readwrite",
    (tx) => {
      const projects = tx.objectStore("projects");
      projects.get(projectId).onsuccess = (event) => {
        const project: SavedProject | undefined = (event.target as IDBRequest)
          .result;
        if (!project) return tx.abort();
        const updatedAt = new Date().toISOString();
        projects.put({ ...project, updatedAt });
        tx.objectStore("applicationData").put({ projectId, state, updatedAt });
      };
    },
  );
}

// Read/append in the same transaction. Never put a stale project snapshot after
// a preview save or adoption; neither code nor applicationData is an input here.
export function appendGenerationEvents(projectId: string, taskId: string, events: ExecutionEvent[]) {
  return transaction<void>(["projects"], "readwrite", tx => {
    const projects = tx.objectStore("projects");
    projects.get(projectId).onsuccess = event => {
      const current: SavedProject | undefined = (event.target as IDBRequest).result;
      if (!current) return tx.abort();
      const generation = current.initialGeneration?.taskId === taskId
        ? current.initialGeneration
        : current.modificationRecords?.flatMap(record => record.generations ?? []).find(item => item.taskId === taskId && item.projectId === projectId);
      if (!generation) return tx.abort();
      const keys = new Set(generation.events.map(item => `${item.source}:${item.sequence}`));
      const additions = events.filter(item => item.taskId === taskId && !keys.has(`${item.source}:${item.sequence}`));
      generation.events = [...generation.events, ...additions];
      try { projects.put(current); }
      catch { tx.abort(); }
    };
  });
}

// Explicit first use of an unreviewed draft only changes the code's data mode.
// No trial data is an input, and a racing code change aborts the transaction.
export async function activateProject(projectId: string, html: string) {
  const saved = (await listProjects()).find(p=>p.id === projectId);
  const team = saved?.modificationRecords?.at(-1)?.generations?.at(-1)?.team ?? saved?.initialGeneration?.team;
  if (!saved || saved.result.html !== html || !team || !artifactTeam(team,await sha256(html),true) || previewPolicy(team,html).adoption !== "allowed") throw new Error("该版本尚不能用于正式数据");
  return transaction<SavedProject>(["projects"],"readwrite",(tx,done)=>{
    const store=tx.objectStore("projects");
    store.get(projectId).onsuccess = event => {
      const current=(event.target as IDBRequest).result as SavedProject | undefined;
      if (!current || (current.draftResult ?? current.result).html !== html) return tx.abort();
      const next={...current,result:saved.result,draftResult:undefined,previewPolicy:{...previewPolicy(team,html),dataMode:"formal" as const}};
      store.put(next); done(next);
    };
  });
}
