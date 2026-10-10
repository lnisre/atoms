"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HomeEntry, type HomeView } from "@/components/home-entry";
import { AccountAccess, LoginDialog, authRequest } from "@/components/account-access";
import { AppPreview } from "@/components/app-preview";
import { CloudProjectView, UnsavedDialog } from "@/components/cloud-project-view";
import { ExampleConversation } from "@/components/example-conversation";
import { EXAMPLE_STATE, prepareBuiltinExample } from "@/lib/builtin-example";
import { PendingLoginAction, type Account, type LoginIntent } from "@/lib/auth/contract";
import { CloudDataSession, copyExample, downloadUnsavedCopy, listProjects, readProject } from "@/lib/cloud-projects/client";
import type { CloudProject, ProjectSummary } from "@/lib/cloud-projects/contract";
import type { SavedProject } from "@/lib/project-store";

type ExampleSave = { owner: Account; operationId: string; example: SavedProject };
const examples = [
  { name: "待办清单", text: "做一个支持添加、完成、删除任务的待办应用。中文界面，适配手机。" },
  { name: "番茄钟", text: "做一个专注番茄钟，支持开始、暂停、重置，默认专注 25 分钟，休息 5 分钟。" },
  { name: "小费计算器", text: "做一个小费计算器，可以输入账单金额、小费比例和人数，显示每人应付金额。" },
];
export default function Home() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [login, setLogin] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [view, setView] = useState<HomeView>("home");
  const [requirement, setRequirement] = useState("");
  const [example, setExample] = useState<SavedProject | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [listError, setListError] = useState("");
  const [listAttempt, setListAttempt] = useState(0);
  const [opened, setOpened] = useState<{ cloud: CloudProject; session: CloudDataSession } | null>(null);
  const [copyPending, setCopyPending] = useState<ExampleSave | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [leaving, setLeaving] = useState<{ action: string; run: () => void } | null>(null);
  const pending = useRef(new PendingLoginAction());
  const epoch = useRef(0);
  const accountRef = useRef<Account | null>(null);
  const sessionRef = useRef<CloudDataSession | null>(null);
  const copyRef = useRef<ExampleSave | null>(null);
  const copying = useRef(false);
  const signingOut = useRef(false);
  const openingExample = useRef(false);
  const openSequence = useRef(0);
  useEffect(() => {
    let disposed = false;
    fetch("/api/auth/session", { cache: "no-store" }).then(async response => {
      if (response.status === 401) return null;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data.account as Account;
    }).then(account => { if (!disposed) { accountRef.current = account; setAccount(account); } })
      .catch(() => { if (!disposed) setError("暂时无法确认登录状态，请重试登录。"); })
      .finally(() => { if (!disposed) setLoading(false); });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (copyRef.current || sessionRef.current?.status.pending) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { disposed = true; sessionRef.current?.dispose(); window.removeEventListener("beforeunload", beforeUnload); };
  }, []);

  const openProject = useCallback(async (owner: Account, id: string) => {
    const current = epoch.current, sequence = ++openSequence.current;
    const pendingAtStart = sessionRef.current?.status.pending;
    setNotice("正在读取云端项目…"); setError("");
    try {
      const cloud = await readProject(owner.id, id);
      if (current !== epoch.current || sequence !== openSequence.current || accountRef.current?.id !== owner.id) return;
      if (sessionRef.current?.status.pending && sessionRef.current.status.pending !== pendingAtStart) {
        setNotice(""); setError("读取期间产生了新的未确认保存，已保留当前页面。请先重试或下载，再重新载入。"); return;
      }
      sessionRef.current?.dispose();
      const session = new CloudDataSession(owner.id, id, cloud.version.code, receipt => {
        if (current !== epoch.current) return;
        setProjects(items => items.map(p => p.id === id ? { ...p, updatedAt: receipt.updatedAt } : p).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      });
      sessionRef.current = session;
      setOpened({ cloud, session }); setExample(null); setNotice(""); setProjects(items => [cloud.project, ...items.filter(p => p.id !== cloud.project.id)]);
      window.history.replaceState(null, "", `/?project=${encodeURIComponent(id)}`);
    } catch (error) { if (current === epoch.current && sequence === openSequence.current) { setNotice(""); setError(error instanceof Error ? error.message : "项目读取失败，请重试。"); } }
  }, []);
  useEffect(() => {
    if (!account) return;
    let disposed = false;
    // Schedule state updates with the async request, keeping StrictMode's first
    // discarded effect from publishing results into the live account view.
    const current = epoch.current;
    Promise.resolve().then(() => { if (!disposed) setLoadingProjects(true); });
    listProjects(account.id).then(items => {
      if (disposed || current !== epoch.current) return;
      setProjects(items); setListError("");
    }).catch(error => { if (!disposed && current === epoch.current) setListError(error instanceof Error ? error.message : "项目列表读取失败，请重试。"); })
      .finally(() => { if (!disposed && current === epoch.current) setLoadingProjects(false); });
    const id = new URLSearchParams(window.location.search).get("project");
    if (id && !sessionRef.current) void openProject(account, id);
    return () => { disposed = true; };
  }, [account, listAttempt, openProject]);
  async function saveExample(task: ExampleSave) {
    if (copying.current || accountRef.current?.id !== task.owner.id) return;
    copying.current = true; setCopyBusy(true); setCopyError("");
    copyRef.current = task; setCopyPending(task);
    const current = epoch.current;
    try {
      const receipt = await copyExample(task.owner.id, task.operationId);
      if (current !== epoch.current || accountRef.current?.id !== task.owner.id || copyRef.current !== task) return;
      copyRef.current = null; setCopyPending(null);
      setListAttempt(value => value + 1);
      await openProject(task.owner, receipt.projectId);
    } catch (error) { if (current === epoch.current) setCopyError(error instanceof Error ? error.message : "无法确认保存结果，请重试原保存。"); }
    finally { copying.current = false; if (current === epoch.current) setCopyBusy(false); }
  }
  function continueAction(intent: LoginIntent, owner: Account) {
    if (intent.kind === "save-example" && example && !copyRef.current) void saveExample({ owner, operationId: intent.id, example });
    else if (intent.kind === "generate") setNotice("登录成功，需求已保留。账号项目生成正在接入，尚未调用模型。");
  }
  function requestAction(intent: LoginIntent) {
    setError(""); setNotice("");
    if (account) { continueAction(intent, account); return; }
    pending.current.set(intent); setContinuing(true); setLogin(true);
  }
  function signedIn(next: Account) {
    if (accountRef.current && accountRef.current.id !== next.id) {
      // Verification has changed the cookie; never let old content write with it.
      epoch.current++; openSequence.current++; sessionRef.current?.dispose(); sessionRef.current = null;
      setOpened(null); setProjects([]); setNotice("登录账号已改变，旧账号内容不能在此账号保存。");
      // Retain a failed example only for download; its owner prevents retry.
    }
    accountRef.current = next; setAccount(next); setLogin(false); setError("");
    const intent = pending.current.take(); setContinuing(false);
    if (intent) continueAction(intent, next);
  }
  function protectLeave(action: string, run: () => void) {
    if (copyRef.current || sessionRef.current?.status.pending) setLeaving({ action, run });
    else run();
  }
  function downloadPending() {
    if (copyRef.current) downloadUnsavedCopy(copyRef.current.example, EXAMPLE_STATE);
    else if (opened) downloadUnsavedCopy(opened.cloud.project, opened.session.status.pending?.state);
  }
  async function signOut() {
    if (signingOut.current) return;
    signingOut.current = true; setLoading(true); setError("");
    // Invalidate the page before awaiting network; late data responses cannot
    // restore a logged-out view. A committed transaction is never undone.
    epoch.current++; openSequence.current++; sessionRef.current?.dispose(); sessionRef.current = null;
    pending.current.clear(); copyRef.current = null; accountRef.current = null;
    setOpened(null); setCopyPending(null); setCopyBusy(false); setCopyError(""); setProjects([]); setLoadingProjects(false); setListError(""); setExample(null); setRequirement("");
    setAccount(null); setLogin(false); setContinuing(false); setNotice(""); setView("home");
    window.history.replaceState(null, "", "/");
    try { await authRequest("logout", {}); setLogoutFailed(false); }
    catch (error) { setLogoutFailed(true); setError(error instanceof Error ? error.message : "退出失败，请重试。"); }
    finally { signingOut.current = false; setLoading(false); }
  }
  async function openExample() {
    if (openingExample.current) return;
    openingExample.current = true;
    const ownerEpoch = epoch.current;
    try { const prepared = await prepareBuiltinExample(); if (ownerEpoch === epoch.current) { setExample(prepared); setError(""); } }
    catch { if (ownerEpoch === epoch.current) setError("示例暂时无法读取，请重试。"); }
    finally { openingExample.current = false; }
  }
  function back() {
    protectLeave("返回项目列表", () => {
      openSequence.current++; sessionRef.current?.dispose(); sessionRef.current = null;
      setOpened(null); setExample(null); setView("projects"); setNotice(""); setError("");
      window.history.replaceState(null, "", "/"); setListAttempt(value => value + 1);
    });
  }
  const loginAgain = () => { pending.current.clear(); setContinuing(false); setLogin(true); };
  const accountSlot = <AccountAccess account={account} loading={loading} onLogin={loginAgain} onLogout={() => protectLeave("退出登录", () => void signOut())}/>;
  return <>
    {opened ? <CloudProjectView key={opened.session.instanceId} {...opened} accountSlot={accountSlot} onBack={back} onReload={() => protectLeave("重新载入", () => { if (account) void openProject(account, opened.cloud.project.id); })} onLogin={loginAgain}/> : example ? <main className="public-example">
      <header><button className="secondary-button" onClick={() => protectLeave("返回首页", () => { copyRef.current = null; setCopyPending(null); setExample(null); })}>返回首页</button><h1>小费计算器 · 只读示例</h1>{accountSlot}</header>
      <p>可以查看界面和制作说明。修改代码或业务数据前，请先保存到自己的账号。</p>
      <button className="primary-button" disabled={loading || !!copyPending} onClick={() => requestAction({ id: crypto.randomUUID(), kind: "save-example", templateId: "tip-calculator" })}>保存此示例到我的项目</button>
      {copyPending && <div className="cloud-save-panel"><p role={copyError ? "alert" : "status"}>{copyBusy ? "正在保存个人副本…云端提交后才会确认" : copyError || "个人副本尚未确认保存。"}</p>
        <button className="primary-button" disabled={copyBusy || account?.id !== copyPending.owner.id} onClick={() => void saveExample(copyPending)}>重试原保存</button>
        <button className="secondary-button" onClick={downloadPending}>下载未保存副本</button>
        <button className="secondary-button" onClick={loginAgain}>重新登录原账号</button>
        <p>未确认保存的内容仅保留在当前页面，刷新或关闭后无法恢复。</p>
      </div>}
      <div className="public-example-content"><section aria-label="示例说明">{example.exampleSource && <ExampleConversation source={example.exampleSource} readOnly/>}</section><AppPreview html={example.result.html} projectId="public-example" projectSaved={false} readOnly readOnlyState={EXAMPLE_STATE} onRetry={() => void openExample()}/></div>
    </main> : <HomeEntry view={view} onViewChange={setView} requirement={requirement} onRequirementChange={setRequirement} projects={projects} loadingProjects={loading || loadingProjects} listError={listError} exampleError="" onRetryProjects={() => setListAttempt(value => value + 1)} examples={examples} onOpenProject={project => { if (account) void openProject(account, project.id); }} onGenerate={() => { if (requirement.trim()) requestAction({ id: crypto.randomUUID(), kind: "generate", requirement: requirement.trim() }); }} accountSlot={accountSlot} onOpenExample={() => void openExample()}/>}
    {(notice || error) && <div className="account-notice" role={error ? "alert" : "status"}>{error || notice}<button aria-label="关闭提示" onClick={() => { setError(""); setNotice(""); }}>×</button></div>}
    {logoutFailed && <div className="cloud-save-panel" role="alert">页面已清除，云端退出尚未成功。<button onClick={() => void signOut()}>重试退出登录</button></div>}
    {(error || listError) && account && <button className="reauth-button secondary-button" onClick={loginAgain}>重新登录原账号</button>}
    {login && <LoginDialog continuing={continuing} expectedEmail={account?.email} onSuccess={signedIn} onClose={() => { pending.current.clear(); setContinuing(false); setLogin(false); }}/>}
    {leaving && <UnsavedDialog action={leaving.action} onDownload={downloadPending} onCancel={() => setLeaving(null)} onConfirm={() => { const run = leaving.run; setLeaving(null); run(); }}/>}
  </>;
}
