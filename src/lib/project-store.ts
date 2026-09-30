import type { ExecutionEvent, InitialGeneration } from "./execution";
import type { GenerationResult } from "./generation";

export type ModificationRecord = {
  id: string;
  adoptedAt: string;
  requests: string[];
  summary: string;
};

export type SavedProject = {
  id: string;
  requirement: string;
  title: string;
  updatedAt: string;
  result: GenerationResult;
  modificationRecords?: ModificationRecord[];
  initialGeneration?: InitialGeneration;
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

export function listProjects() {
  return transaction<SavedProject[]>(["projects"], "readonly", (tx, done) => {
    tx.objectStore("projects").getAll().onsuccess = (event) => {
      const projects: SavedProject[] = (event.target as IDBRequest).result;
      done(projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    };
  });
}

export function saveProject(project: SavedProject) {
  return transaction<void>(["projects"], "readwrite", (tx) => {
    tx.objectStore("projects").put(project);
  });
}

// Code and its record commit together. Trial data is deliberately not an input.
export function adoptCandidate(
  projectId: string,
  result: GenerationResult,
  requests: string[],
) {
  const record: ModificationRecord = {
    id: crypto.randomUUID(),
    adoptedAt: new Date().toISOString(),
    requests: [...requests],
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
      if (!current?.initialGeneration || current.initialGeneration.taskId !== taskId) return tx.abort();
      const existing = current.initialGeneration.events;
      const keys = new Set(existing.map(item => `${item.source}:${item.sequence}`));
      const additions = events.filter(item => item.taskId === taskId && !keys.has(`${item.source}:${item.sequence}`));
      try { projects.put({ ...current, initialGeneration: { ...current.initialGeneration, events: [...existing, ...additions] } }); }
      catch { tx.abort(); }
    };
  });
}
