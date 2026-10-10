#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const BASE_COMMIT = "1d4d81791b3b48c51e0311f1af7e842a13d9cd1f";
const FAULT_COMMIT = "886f933c3015d3c810f85662812c5bc201a478f7";
const PARTIAL_COMMIT = "3be65e0734f21382ff77f5b2b5c6e8a0ca8d30a1";
const REFERENCE_COMMIT = "7c604dce257b0b8a57ee261610d1501c186b6065";
const VARIANTS = {
  A: { label: "historical-fault-reconstruction", source: FAULT_COMMIT },
  B: { label: "incomplete-fix-reconstruction", source: PARTIAL_COMMIT },
  reference: { label: "fixed-reference", source: REFERENCE_COMMIT },
};
const TARGET_FILES = ["src/lib/team/socket.ts", "src/lib/team/client.ts"];
const PROBE = "tests/team/heartbeat-lifecycle.mjs";
const UNIT_FILES = ["tests/generate.test.ts", "tests/team.test.ts", "tests/team-socket.test.ts", "tests/team-client.test.ts", "tests/preview-policy.test.ts"];
const TOOL_PATHS = ["tools/team-cancel-environment/", ".agents/skills/team-cancel-environment/"];
const OWNER = "atoms-team-cancel-environment-v1";
const DEFAULT_ROOT = join(tmpdir(), "atoms-team-cancel-environment");
const NODE24_BIN = dirname(process.execPath);

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

function repoRoot() {
  let current = resolve(dirname(fileURLToPath(import.meta.url)));
  while (current !== dirname(current)) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "runtime", "team"))) return current;
    current = dirname(current);
  }
  fail("cannot locate the Atoms repository root");
}

function parseArgs(argv) {
  const values = { command: argv[0] ?? "help", root: process.env.ATOMS_TEAM_ENV_ROOT ?? DEFAULT_ROOT };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") values.root = resolve(argv[++index] ?? fail("--root needs a path"));
    else if (arg === "--run") values.run = argv[++index] ?? fail("--run needs a run id");
    else if (arg === "--variant") values.variant = argv[++index] ?? fail("--variant needs A, B, or reference");
    else if (arg === "--node-modules-source") values.nodeModulesSource = resolve(argv[++index] ?? fail("--node-modules-source needs a path"));
    else if (arg === "--metagpt-source") values.metagptSource = resolve(argv[++index] ?? fail("--metagpt-source needs a path"));
    else if (arg === "--python") values.python = resolve(argv[++index] ?? fail("--python needs a path"));
    else if (arg === "--pid") values.pid = Number(argv[++index] ?? fail("--pid needs a number"));
    else if (arg === "--internal-pid") values.internalPid = Number(argv[++index] ?? fail("--internal-pid needs a number"));
    else if (arg === "--port") values.port = Number(argv[++index] ?? fail("--port needs a number"));
    else if (arg === "--keep") values.keep = true;
    else fail(`unknown argument: ${arg}`);
  }
  values.root = resolve(values.root);
  return values;
}

function ensureBase(repo) {
  // Tool commits may advance; product material always comes from this immutable
  // commit. A descendant with product changes is a different fixture source.
  const base = run("git", ["-C", repo, "rev-parse", "--verify", `${BASE_COMMIT}^{commit}`]).trim();
  if (base !== BASE_COMMIT) fail(`missing fixed product base ${BASE_COMMIT}`);
  const head = run("git", ["-C", repo, "rev-parse", "HEAD"]).trim();
  try { run("git", ["-C", repo, "merge-base", "--is-ancestor", BASE_COMMIT, head]); }
  catch { fail(`tool checkout must descend from fixed product base ${BASE_COMMIT}; got ${head}`); }
  const paths = args => run("git", ["-C", repo, ...args]).split("\0").filter(Boolean);
  const changed = new Set([
    ...paths(["diff", "--name-only", "-z", BASE_COMMIT, head]),
    ...paths(["diff", "--name-only", "-z"]),
    ...paths(["diff", "--cached", "--name-only", "-z", "HEAD"]),
    ...paths(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const productChanges = [...changed].filter(path => !TOOL_PATHS.some(prefix => path.startsWith(prefix)));
  if (productChanges.length) fail(`source has committed or uncommitted changes outside environment tooling: ${productChanges.join(", ")}; use a tool-only checkout based on ${BASE_COMMIT}`);
  return { commit: head, scriptSha256: sha256(new URL(import.meta.url)), runtimeSha256: sha256(new URL("./runtime.mjs", import.meta.url)), dirty: run("git", ["-C", repo, "status", "--porcelain", "-uall"]).length > 0 };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceFileHash(repo, commit, path) {
  return createHash("sha256").update(run("git", ["-C", repo, "show", `${commit}:${path}`])).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function ensureOwner(root, create = false) {
  const ownerPath = join(root, ".owner.json");
  if (!existsSync(root)) {
    if (!create) fail(`environment root does not exist: ${root}`);
    mkdirSync(root, { recursive: true });
  }
  if (existsSync(ownerPath)) {
    const owner = readJson(ownerPath);
    if (owner.owner !== OWNER) fail(`refuse to use an environment owned by ${owner.owner ?? "unknown"}: ${root}`);
  } else if (readdirSync(root).length > 0) {
    fail(`environment root exists without this tool's ownership marker: ${root}`);
  } else if (create) {
    writeFileSync(ownerPath, `${JSON.stringify({ owner: OWNER, createdAt: new Date().toISOString() }, null, 2)}\n`);
  } else {
    fail(`environment root has no ownership marker: ${root}`);
  }
}

function findExecutable(name) {
  for (const directory of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const executable = resolve(directory, name);
    try { accessSync(executable, constants.X_OK); return executable; } catch {}
  }
  fail(`required executable is not on PATH: ${name}`);
}

function findNodeModules(explicit, repo) {
  const candidates = explicit ? [explicit] : [join(repo, "node_modules")];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, ".modules.yaml"))) {
      const lock = join(candidate, "..", "pnpm-lock.yaml");
      if (!existsSync(lock) || sha256(lock) !== sourceFileHash(repo, BASE_COMMIT, "pnpm-lock.yaml")) fail("dependency seed must have the fixed base pnpm-lock.yaml beside node_modules");
      return candidate;
    }
  }
  fail(`no verified node_modules seed found; pass --node-modules-source PATH (checked ${candidates.join(", ")})`);
}

function cloneNodeModules(source, destination) {
  run("cp", ["-cR", source, destination]);
}

function archiveSource(repo, destination) {
  mkdirSync(destination, { recursive: true });
  const archive = join(dirname(destination), "source.tar");
  run("git", ["-C", repo, "archive", "--format=tar", BASE_COMMIT, "-o", archive]);
  run("tar", ["-xf", archive, "-C", destination]);
  rmSync(archive, { force: true });
  for (const path of ["docs/verification", ".env", ".env.local", ".env.example"]) {
    rmSync(join(destination, path), { recursive: true, force: true });
  }
}

function installVariantFiles(repo, candidate, variant) {
  const source = VARIANTS[variant].source;
  for (const path of TARGET_FILES) {
    const destination = join(candidate, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, run("git", ["-C", repo, "show", `${source}:${path}`]));
  }
}

function initializeCandidateRepo(candidate) {
  run("git", ["-C", candidate, "init", "--quiet"]);
  run("git", ["-C", candidate, "config", "user.name", "Atoms experiment"]);
  run("git", ["-C", candidate, "config", "user.email", "atoms-experiment@localhost"]);
  run("git", ["-C", candidate, "add", "--all"]);
  run("git", ["-C", candidate, "commit", "--quiet", "--no-gpg-sign", "-m", "initial project state"]);
  return run("git", ["-C", candidate, "rev-parse", "HEAD"]).trim();
}

function createRun(values) {
  const repo = repoRoot();
  const tool = ensureBase(repo);
  if (process.versions.node.split(".")[0] !== "24") fail("Run this CLI with Node 24; its executable is inherited by the supplied runtime");
  if (!VARIANTS[values.variant]) fail("--variant must be A, B, or reference");
  const nodeModulesSource = findNodeModules(values.nodeModulesSource, repo);
  const python = values.python ?? join(values.root, "python-env", "bin", "python");
  const metagptSource = values.metagptSource ?? join(values.root, "metagpt-src");
  if (!existsSync(python)) fail(`supply an existing Python 3.11 environment with --python: ${python}`);
  if (!existsSync(metagptSource)) fail(`supply the pinned MetaGPT checkout with --metagpt-source: ${metagptSource}`);
  findExecutable("pnpm");
  findExecutable("uv");
  ensureOwner(values.root, true);
  values.root = realpathSync(values.root);
  mkdirSync(join(values.root, "runs"), { recursive: true });
  const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
  const runRoot = join(values.root, "runs", runId);
  mkdirSync(runRoot);
  const candidate = join(runRoot, "atoms");
  const evidence = join(runRoot, "evidence");
  const runtimeHome = join(runRoot, "runtime-home");
  const browserProfile = join(runRoot, "browser-profile");
  mkdirSync(evidence);
  mkdirSync(runtimeHome);
  mkdirSync(browserProfile);
  archiveSource(repo, candidate);
  installVariantFiles(repo, candidate, values.variant);
  const candidateCommit = initializeCandidateRepo(candidate);
  cloneNodeModules(nodeModulesSource, join(candidate, "node_modules"));
  const identity = Object.fromEntries(TARGET_FILES.map(path => [path, sha256(join(candidate, path))]));
  const manifest = {
    owner: OWNER,
    runId,
    createdAt: new Date().toISOString(),
    tool,
    source: { repo, baseCommit: BASE_COMMIT, variant: values.variant, variantLabel: VARIANTS[values.variant].label, targetSourceCommit: VARIANTS[values.variant].source },
    candidate: { path: candidate, gitMetadata: "single synthetic commit", commit: candidateCommit, excluded: ["docs/verification", ".env*"], targetSha256: identity },
    resources: { evidence, runtimeHome, browserProfile, nodeModulesSource, createdPorts: [], createdPids: [] },
    expected: { heartbeatAbortCalibration: values.variant === "reference" ? "green" : "red", page: "offline fixture path available; page does not prove pending-heartbeat correctness" },
  };
  createRuntime(runRoot, candidate, values);
  writeFileSync(join(runRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(evidence, "creation.json"), `${JSON.stringify({ ...manifest, checkedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(JSON.stringify({ runId, runRoot, candidate, runtime: join(runRoot, "runtime", "run"), handoff: join(runRoot, "runtime", "HANDOFF.md"), evidence, variant: values.variant, targetSha256: identity }, null, 2));
}

function resolveRun(values) {
  ensureOwner(values.root);
  values.root = realpathSync(values.root);
  if (!values.run || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(values.run)) fail("--run must be a single run id (letters, digits, _ or -)");
  const runRoot = join(values.root, "runs", values.run);
  if (existsSync(runRoot) && realpathSync(runRoot) !== join(realpathSync(values.root), "runs", values.run)) fail("run path must not traverse a symlink");
  const manifestPath = join(runRoot, "manifest.json");
  if (!existsSync(manifestPath)) fail(`unknown run or missing manifest: ${values.run}`);
  const manifest = readJson(manifestPath);
  if (manifest.owner !== OWNER || manifest.runId !== values.run) fail("run ownership marker mismatch");
  if (!["candidate", "atoms"].some(name => manifest.candidate.path === join(runRoot, name)) || manifest.resources.evidence !== join(runRoot, "evidence")) fail("manifest paths do not belong to this run");
  for (const name of ["candidate", "atoms", "evidence", "runtime-home", "browser-profile", "runtime"]) {
    const path = join(runRoot, name);
    if (existsSync(path) && realpathSync(path) !== join(realpathSync(runRoot), name)) fail(`run resource must not be a symlink: ${name}`);
  }
  return { runRoot, manifest, candidate: manifest.candidate.path, evidence: manifest.resources.evidence };
}

function inspectRun(values) {
  const run = resolveRun(values);
  const observed = Object.fromEntries(TARGET_FILES.map(path => [path, sha256(join(run.candidate, path))]));
  const expected = run.manifest.candidate.targetSha256;
  const targetMatch = JSON.stringify(observed) === JSON.stringify(expected);
  const leakage = ["docs/verification", ".env", ".env.local"].filter(path => existsSync(join(run.candidate, path)));
  const candidateCommit = run.manifest.candidate.commit;
  const gitIdentity = existsSync(join(run.candidate, ".git")) && runCommand(run.candidate, "git", ["rev-list", "--count", "HEAD"]).trim() === "1";
  const result = { runId: values.run, candidate: run.candidate, variant: run.manifest.source.variant, targetMatch, observed, expected, leakage, gitIdentity, candidateCommit, nodeModules: existsSync(join(run.candidate, "node_modules", ".modules.yaml")), evidenceExists: existsSync(run.evidence) };
  writeFileSync(join(run.evidence, "inspect.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!targetMatch || leakage.length || !result.gitIdentity || !result.nodeModules || !result.evidenceExists) process.exitCode = 1;
}

function targetIdentity(candidate) {
  return Object.fromEntries(TARGET_FILES.map(path => [path, sha256(join(candidate, path))]));
}

function sameIdentity(left, right) {
  return Object.keys(right).every(path => left?.[path] === right[path]) && Object.keys(left ?? {}).length === Object.keys(right).length;
}

function sourceIdentity(candidate) {
  // Bind the verdict to the actual candidate, including uncommitted new files.
  const paths = run("git", ["-C", candidate, "ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean).sort();
  const files = Object.fromEntries(paths.map(path => [path, existsSync(join(candidate, path)) ? sha256(join(candidate, path)) : null]));
  return { files, sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}

function executeCheck(candidate, args, directory, name, timeout) {
  const stdoutPath = join(directory, `${name}.stdout.log`), stderrPath = join(directory, `${name}.stderr.log`);
  const child = spawnSync(process.execPath, args, {
    cwd: candidate, encoding: "utf8", timeout, maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, PATH: [NODE24_BIN, process.env.PATH].filter(Boolean).join(":"), NEXT_TELEMETRY_DISABLED: "1", TEAM_CLIENT_EVIDENCE_DIR: "" },
  });
  const stdout = child.stdout ?? "", stderr = child.stderr ?? "";
  const exitCode = child.status, signal = child.signal, errorCode = child.error?.code ?? null;
  writeFileSync(stdoutPath, stdout); writeFileSync(stderrPath, stderr);
  return { command: [process.execPath, ...args], exitCode, signal, errorCode, stdout, stderr, stdoutPath, stderrPath };
}

function probeEvidence(execution, identity) {
  if (execution.signal || execution.errorCode) fail("heartbeat probe did not complete normally");
  let evidence;
  try { evidence = JSON.parse(execution.stdout); }
  catch { fail("heartbeat probe emitted no valid structured result (environment/entrypoint failure)"); }
  const cleanupKeys = ["intervals", "timeouts", "abortListeners", "pagehideListeners", "socketListeners", "sentAfterEnd"];
  if (evidence.scenario !== "abort" || evidence.heartbeatCount !== 1 || evidence.providerCalls !== 0 ||
      evidence.outcome?.status !== "rejected" || evidence.outcome.name !== "AbortError" ||
      !sameIdentity(evidence.identity, identity) || !/^v24\./.test(evidence.node ?? "") ||
      !Number.isFinite(evidence.elapsedMs) || evidence.elapsedMs < 4000 ||
      !Array.isArray(evidence.unhandledRejections) || !Array.isArray(evidence.uncaughtExceptions) ||
      !evidence.cleanup || Object.keys(evidence.cleanup).length !== cleanupKeys.length ||
      !cleanupKeys.every(key => Number.isInteger(evidence.cleanup[key]) && evidence.cleanup[key] >= 0)) {
    fail("heartbeat result does not prove the expected production trigger, runtime, or source identity");
  }
  return evidence;
}

function checkRun(values, acceptance = false) {
  const selected = resolveRun(values);
  const variant = selected.manifest.source.variant;
  const mode = acceptance ? "accept" : "calibrate";
  const checkId = `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${randomBytes(3).toString("hex")}`;
  const directory = join(selected.evidence, `${mode}-${checkId}`);
  mkdirSync(directory);
  const result = { runId: values.run, variant, mode, scope: acceptance ? "heartbeat-abort and fixed deterministic unit suite; not page/product-wide acceptance" : "pristine seed heartbeat-abort only", checkedAt: new Date().toISOString(), passed: false, classification: "inconclusive", evidence: directory };
  try {
    if (!VARIANTS[variant] || selected.manifest.source.baseCommit !== BASE_COMMIT) fail("unsupported seed identity; recreate with this tool");
    const repo = repoRoot();
    result.tool = { commit: run("git", ["-C", repo, "rev-parse", "HEAD"]).trim(), scriptSha256: sha256(new URL(import.meta.url)) };
    const expectedTargets = Object.fromEntries(TARGET_FILES.map(path => [path, sourceFileHash(repo, VARIANTS[variant].source, path)]));
    if (!sameIdentity(selected.manifest.candidate.targetSha256, expectedTargets)) fail("manifest target hashes disagree with the fixed variant source");
    // The known-good test entrypoints are held fixed even while product code is
    // being repaired; otherwise an edited test could manufacture a pass/red.
    for (const path of [PROBE, ...(acceptance ? UNIT_FILES : [])]) {
      if (!existsSync(join(selected.candidate, path)) || sha256(join(selected.candidate, path)) !== sourceFileHash(repo, BASE_COMMIT, path)) fail(`verification entrypoint differs from fixed base: ${path}`);
    }
    result.targetSha256 = targetIdentity(selected.candidate);
    result.sourceBefore = sourceIdentity(selected.candidate);
    if (!acceptance) {
      if (!sameIdentity(result.targetSha256, expectedTargets)) fail("seed changed; use accept for a repaired candidate or create a fresh run");
      const initial = selected.manifest.candidate.commit;
      if (run("git", ["-C", selected.candidate, "rev-parse", "HEAD"]).trim() !== initial || run("git", ["-C", selected.candidate, "status", "--porcelain", "-uall"]).trim()) fail("calibration requires the untouched initial candidate; use accept after repair");
    }
    const execution = executeCheck(selected.candidate, ["--import", "tsx", PROBE, "abort"], directory, "heartbeat-abort", 25000);
    result.probe = execution;
    const evidence = probeEvidence(execution, result.targetSha256);
    result.probeEvidence = evidence;
    const zeroCleanup = Object.entries(evidence.cleanup).every(([key, value]) => value === (variant === "A" && !acceptance && key === "socketListeners" ? 4 : 0));
    const green = execution.exitCode === 0 && execution.stderr === "" && evidence.unhandledRejections.length === 0 && evidence.uncaughtExceptions.length === 0 && Object.values(evidence.cleanup).every(value => value === 0);
    const faultA = execution.exitCode === 1 && zeroCleanup && evidence.unhandledRejections.length === 0 && evidence.uncaughtExceptions.length === 1 && evidence.uncaughtExceptions[0] === "TypeError [ERR_INVALID_STATE]: Invalid state: Controller is already closed";
    const faultB = execution.exitCode === 1 && zeroCleanup && evidence.uncaughtExceptions.length === 0 && evidence.unhandledRejections.length === 1 && evidence.unhandledRejections[0] === "AbortError: This operation was aborted";
    result.expected = acceptance || variant === "reference" ? "green" : variant === "A" ? "controller-already-closed + four socket listeners" : "unhandled heartbeat AbortError";
    result.passed = acceptance || variant === "reference" ? green : variant === "A" ? faultA : faultB;
    result.classification = result.passed ? (acceptance ? "slice-accepted" : "seed-calibrated") : "unexpected-probe-result";
    if (acceptance && green) {
      const unit = executeCheck(selected.candidate, ["--import", "tsx", "--test", "--test-reporter=tap", ...UNIT_FILES], directory, "unit", 120000);
      result.unit = unit;
      const completed = /^# tests 54$/m.test(unit.stdout) && ["fail", "cancelled", "skipped", "todo"].every(key => new RegExp(`^# ${key} 0$`, "m").test(unit.stdout));
      result.passed = unit.exitCode === 0 && !unit.signal && !unit.errorCode && completed;
      result.classification = result.passed ? "slice-accepted" : "unit-suite-failed-or-incomplete";
    }
    result.sourceAfter = sourceIdentity(selected.candidate);
    if (result.sourceBefore.sha256 !== result.sourceAfter.sha256) fail("candidate source changed during verification; verdict is inconclusive");
  } catch (error) {
    result.passed = false; result.classification = "inconclusive";
    result.error = error instanceof Error ? error.message : String(error);
  }
  // Reports are append-only by invocation; an acceptance never overwrites the
  // initial red calibration or a previous failed attempt.
  writeFileSync(join(directory, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ runId: values.run, variant, mode, passed: result.passed, classification: result.classification, error: result.error, result: join(directory, "result.json") }, null, 2));
  if (!result.passed) process.exitCode = 1;
}

function createRuntime(runRoot, candidate, values) {
  const runtime = join(runRoot, "runtime");
  mkdirSync(runtime);
  const python = values.python ?? join(values.root, "python-env", "bin", "python");
  if (!existsSync(python)) fail(`verified Python executable does not exist: ${python}`);
  const fixedPaths = run("git", ["-C", candidate, "ls-files", "tests", "playwright.config.ts", ".agents/skills/verify-atoms/scripts/doctor.mjs", "runtime/team/config2.yaml"]).trim().split("\n");
  const settings = { candidate, python, node: process.execPath, pnpm: findExecutable("pnpm"), uv: findExecutable("uv"),
    metagptSource: values.metagptSource ?? join(values.root, "metagpt-src"),
    home: join(runRoot, "runtime-home"), profile: join(runRoot, "browser-profile"), evidence: join(runRoot, "evidence", "runtime"),
    fixedFiles: Object.fromEntries(fixedPaths.map(path => [path, sha256(join(candidate, path))])) };
  writeFileSync(join(runtime, "settings.json"), JSON.stringify(settings, null, 2) + "\n");
  writeFileSync(join(runtime, "control.mjs"), readFileSync(new URL("./runtime.mjs", import.meta.url)));
  writeFileSync(join(runtime, "run"), `#!/bin/sh\nexec ${shellQuote(settings.node)} ${shellQuote(join(runtime, "control.mjs"))} "$@"\n`, { mode: 0o700 });
  writeFileSync(join(runtime, "HANDOFF.md"), `# Local offline runtime

Project: ${candidate}
Runtime entry: ${join(runtime, "run")}
Evidence retained after cleanup: ${settings.evidence}

Run these commands in order from any directory:

\`\`\`sh
${shellQuote(join(runtime, "run"))} prepare
${shellQuote(join(runtime, "run"))} build
${shellQuote(join(runtime, "run"))} start
${shellQuote(join(runtime, "run"))} doctor
${shellQuote(join(runtime, "run"))} test-stop
${shellQuote(join(runtime, "run"))} test
${shellQuote(join(runtime, "run"))} stop
\`\`\`

Dependencies are provisioned: Node ${settings.node}, pnpm ${settings.pnpm}, project node_modules, Python ${python}, MetaGPT source ${settings.metagptSource}, and checker ${settings.uv}. Reading these supplied dependencies is allowed. prepare verifies them without installing or changing the shared Python environment; it creates this run's dummy config under ${join(runtime, "config")}. HOME is ${settings.home}; host provider variables and user config are excluded.

prepare exercises ps/lsof; start also checks OS inspection permission before launching. If the OS denies process inspection or listening, use the tool’s normal permission/escalation path and rerun; never fabricate Doctor results. start prints the URL and owned PIDs. The real gateway and Python runner use tests/team/fixture_transport.py to explicitly replace provider calls. test-stop runs the unchanged native first-generation and modification stop cases; test runs the unchanged 54-test suite. Existing tests and config are fixed; add separate regression files for additional checks. After source edits run stop, build, start, doctor, test-stop, test, stop. Source changes invalidate the prior build.

Use this entry's exec node/pnpm/python subcommand for extra checks with the same isolated environment. Each invocation preserves logs and source/config identities in a new evidence directory, including failed attempts. Call stop before handing back. Work only with this project, its runtime and the supplied dependencies; organizer manifests and other runs are outside the repair task.
`);
}

function createWrapper(values) {
  const run = resolveRun(values);
  const python = values.python ?? join(values.root, "python-env", "bin", "python");
  if (!existsSync(python)) fail(`verified Python executable does not exist: ${python}`);
  const fixture = join(run.candidate, "tests", "team", "fixture_transport.py");
  const wrapper = join(run.runRoot, "offline-python");
  writeFileSync(wrapper, `#!/bin/sh\nexec ${shellQuote(python)} ${shellQuote(fixture)} "$@"\n`, { mode: 0o700 });
  const result = { runId: values.run, python, fixture, wrapper, createdAt: new Date().toISOString() };
  writeFileSync(join(run.evidence, "wrapper.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function recordRun(values) {
  const run = resolveRun(values);
  if (!Number.isInteger(values.pid) || !Number.isInteger(values.internalPid) || !Number.isInteger(values.port)) fail("record needs --pid, --internal-pid, and --port");
  const instance = { owner: OWNER, runId: values.run, recordedAt: new Date().toISOString(), pids: [values.pid, values.internalPid], ports: [values.port, values.port + 1], browserProfile: run.manifest.resources.browserProfile, evidence: run.evidence };
  writeFileSync(join(run.runRoot, "instance.json"), `${JSON.stringify(instance, null, 2)}\n`);
  console.log(JSON.stringify(instance, null, 2));
}

function runCommand(cwd, command, args, options = {}) {
  const path = [NODE24_BIN, process.env.PATH].filter(Boolean).join(":");
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PATH: path, NEXT_TELEMETRY_DISABLED: "1", TEAM_CLIENT_EVIDENCE_DIR: "" }, ...options });
}

function cleanupRun(values) {
  const run = resolveRun(values);
  const records = [join(run.runRoot, "instance.json"), join(run.runRoot, "runtime", "state.json")].filter(existsSync).map(readJson);
  for (const instance of records) {
    const pids = instance.pids ?? [instance.pid, ...(instance.internalPids ?? [])].filter(Boolean);
    const live = pids.filter(pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } });
    if (live.length) fail(`refuse to remove run with live recorded pids: ${live.join(", ")}`);
    const ports = instance.ports ?? (instance.port ? [instance.port, instance.port + 1] : []);
    for (const port of ports) {
      const check = spawnSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
      if (check.error || ![0, 1].includes(check.status)) fail("could not verify recorded port release");
      if (check.stdout.trim()) fail(`refuse cleanup while recorded port ${port} has a listener`);
    }
  }
  const runtimePath = join(run.runRoot, "runtime");
  if (existsSync(runtimePath)) cpSync(runtimePath, join(run.evidence, "runtime-control"), { recursive: true, filter: path => path !== join(runtimePath, "logs") });
  const legacyLogs = join(run.runRoot, "runtime", "logs");
  if (existsSync(legacyLogs)) cpSync(legacyLogs, join(run.evidence, "legacy-runtime-logs"), { recursive: true, errorOnExist: true, force: false });
  const removed = ["candidate", "atoms", "runtime-home", "browser-profile", "offline-python", "runtime"].map(name => join(run.runRoot, name));
  for (const path of removed) rmSync(path, { recursive: true, force: true });
  const result = { runId: values.run, cleanedAt: new Date().toISOString(), removed, evidence: run.evidence, recoverable: false };
  writeFileSync(join(run.evidence, "cleanup.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

function help() {
  console.log(`Usage:\n  node tools/team-cancel-environment/env.mjs create --variant A|B|reference [--root PATH] [--python PATH --metagpt-source PATH]\n  node tools/team-cancel-environment/env.mjs wrapper --run RUN_ID [--python PATH]\n  node tools/team-cancel-environment/env.mjs record --run RUN_ID --pid PID --internal-pid PID --port PORT\n  node tools/team-cancel-environment/env.mjs inspect --run RUN_ID [--root PATH]\n  node tools/team-cancel-environment/env.mjs check --run RUN_ID [--root PATH]  # pristine seed calibration\n  node tools/team-cancel-environment/env.mjs accept --run RUN_ID [--root PATH] # current candidate must pass probe + unit suite\n  node tools/team-cancel-environment/env.mjs cleanup --run RUN_ID [--root PATH]\n\nA = historical socket/client pair; B = incomplete client fix with base-equivalent socket; reference = fixed reference.\ncheck accepts only the exact expected red (A/B) or green (reference). accept requires green regardless of initial variant.\nNeither command proves page acceptance. Each invocation preserves a separate evidence directory.\nEach create makes a new single-commit candidate, APFS-cloned writable node_modules, runtime HOME, browser profile and evidence directory.`);
}

const values = parseArgs(process.argv.slice(2));
try {
  if (values.command === "create") createRun(values);
  else if (values.command === "wrapper") createWrapper(values);
  else if (values.command === "record") recordRun(values);
  else if (values.command === "inspect") inspectRun(values);
  else if (values.command === "check") checkRun(values);
  else if (values.command === "accept") checkRun(values, true);
  else if (values.command === "cleanup") cleanupRun(values);
  else help();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
