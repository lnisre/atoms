"use client";

import { useEffect, useRef, useState } from "react";
import { HomeEntry, type HomeView } from "@/components/home-entry";
import { AccountAccess, LoginDialog, authRequest } from "@/components/account-access";
import { AppPreview } from "@/components/app-preview";
import { ExampleConversation } from "@/components/example-conversation";
import { EXAMPLE_STATE, prepareBuiltinExample } from "@/lib/builtin-example";
import { PendingLoginAction, type Account, type LoginIntent } from "@/lib/auth/contract";
import type { SavedProject } from "@/lib/project-store";

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
  const pending = useRef(new PendingLoginAction());
  const epoch = useRef(0);
  const signingOut = useRef(false);
  const openingExample = useRef(false);
  useEffect(() => {
    let disposed = false;
    fetch("/api/auth/session", { cache: "no-store" }).then(async response => {
      if (response.status === 401) return null;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data.account as Account;
    }).then(account => { if (!disposed) setAccount(account); })
      .catch(() => { if (!disposed) setError("暂时无法确认登录状态，请重试登录。"); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, []);
  function continueAction(intent: LoginIntent, owner: Account) {
    // #67/#68 replace this handoff with account-owned cloud operations. Never
    // call the retired local workbench or claim an operation was saved here.
    void owner;
    setNotice(intent.kind === "generate" ? "登录成功，需求已保留。账号项目生成正在接入，尚未调用模型。" : "登录成功。个人示例保存正在接入，尚未创建副本。");
  }
  function requestAction(intent: LoginIntent) {
    setError(""); setNotice("");
    if (account) { continueAction(intent, account); return; }
    pending.current.set(intent); setContinuing(true); setLogin(true);
  }
  function signedIn(next: Account) {
    setAccount(next); setLogin(false); setError("");
    const intent = pending.current.take(); setContinuing(false);
    if (intent) continueAction(intent, next);
  }
  async function signOut() {
    if (signingOut.current) return;
    signingOut.current = true; setLoading(true); setError("");
    try {
      await authRequest("logout", {});
      epoch.current++; pending.current.clear();
      setAccount(null); setRequirement(""); setExample(null); setLogin(false); setContinuing(false); setNotice(""); setView("home");
      window.history.replaceState(null, "", "/");
    } catch (error) { setError(error instanceof Error ? error.message : "退出失败，请重试。"); }
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
  const accountSlot = <AccountAccess account={account} loading={loading} onLogin={() => { pending.current.clear(); setContinuing(false); setLogin(true); }} onLogout={() => void signOut()}/>;
  return <>
    {example ? <main className="public-example">
      <header><button className="secondary-button" onClick={() => setExample(null)}>返回首页</button><h1>小费计算器 · 只读示例</h1>{accountSlot}</header>
      <p>可以查看界面和制作说明。修改代码或业务数据前，请先保存到自己的账号。</p>
      <button className="primary-button" disabled={loading} onClick={() => requestAction({ id: crypto.randomUUID(), kind: "save-example", templateId: "tip-calculator" })}>保存此示例到我的项目</button>
      <div className="public-example-content"><section aria-label="示例说明">{example.exampleSource && <ExampleConversation source={example.exampleSource} readOnly/>}</section><AppPreview html={example.result.html} projectId="public-example" projectSaved={false} readOnly readOnlyState={EXAMPLE_STATE} onRetry={() => void openExample()}/></div>
    </main> : <HomeEntry view={view} onViewChange={setView} requirement={requirement} onRequirementChange={setRequirement} projects={[]} loadingProjects={loading} listError="" exampleError="" onRetryProjects={() => {}} examples={examples} onOpenProject={() => {}} onGenerate={() => { if (requirement.trim()) requestAction({ id: crypto.randomUUID(), kind: "generate", requirement: requirement.trim() }); }} accountSlot={accountSlot} onOpenExample={() => void openExample()}/>}
    {(notice || error) && <div className="account-notice" role={error ? "alert" : "status"}>{error || notice}<button aria-label="关闭提示" onClick={() => { setError(""); setNotice(""); }}>×</button></div>}
    {login && <LoginDialog continuing={continuing} onSuccess={signedIn} onClose={() => { pending.current.clear(); setContinuing(false); setLogin(false); }}/>}
  </>;
}
