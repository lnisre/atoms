"use client";

import { useEffect, useRef, useState } from "react";
import type { Account } from "@/lib/auth/contract";
import styles from "./account-access.module.css";

export async function authRequest(path: string, body?: unknown) {
  const response = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "登录服务暂时不可用，请重试。");
  return data;
}
export function AccountAccess({ account, loading, onLogin, onLogout }: { account: Account | null; loading: boolean; onLogin: () => void; onLogout: () => void }) {
  return <div className={styles.account}>
    <span title={account?.email}>{loading ? "正在确认账号…" : account?.email || "游客"}</span>
    <button type="button" onClick={account ? onLogout : onLogin} disabled={loading}>{account ? "退出登录" : "登录 / 注册"}</button>
  </div>;
}
export function LoginDialog({ onClose, onSuccess, continuing }: { onClose: () => void; onSuccess: (account: Account) => void; continuing: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const live = useRef(true);
  const pending = useRef(false);
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    live.current = true;
    dialog.current?.showModal();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { live.current = false; clearInterval(timer); };
  }, []);
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));
  async function submit(send: boolean) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (send) {
        const data = await authRequest("code", { email });
        if (!live.current) return;
        setSentEmail(email.trim()); setCode(""); setNow(Date.now()); setRetryAt(Date.now() + data.retryAfter * 1000);
      } else {
        const data = await authRequest("verify", { code });
        if (live.current) onSuccess(data.account);
      }
    } catch (error) { if (live.current) setError(error instanceof Error ? error.message : "网络连接失败，请重试。"); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  }
  return <dialog className={styles.dialog} ref={dialog} aria-labelledby="login-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <button className={styles.close} type="button" aria-label="关闭登录" disabled={busy} onClick={onClose}>×</button>
    <h2 id="login-title">邮箱登录</h2>
    <p>输入验证码即可登录，未注册的邮箱会自动创建账号。</p>
    {continuing && <p className={styles.note}>已保留刚才的操作与输入，登录后继续。</p>}
    <form onSubmit={event => { event.preventDefault(); void submit(!sentEmail); }}>
      <label htmlFor="login-email">邮箱地址</label>
      <input id="login-email" type="email" autoComplete="email" maxLength={254} required value={email} disabled={!!sentEmail || busy} onChange={event => setEmail(event.target.value)}/>
      {sentEmail && <>
        <p role="status">验证码已发送至 {sentEmail}，请在有效期内输入。</p>
        <label htmlFor="login-code">6 位验证码</label>
        <input id="login-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy} onChange={event => setCode(event.target.value)}/>
      </>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "请稍候…" : sentEmail ? "验证并登录" : "发送验证码"}</button>
      {sentEmail && <div className={styles.links}>
        <button type="button" disabled={busy || remaining > 0} onClick={() => void submit(true)}>{remaining > 0 ? `${remaining} 秒后可重发` : "重新发送验证码"}</button>
        <button type="button" disabled={busy} onClick={() => { setSentEmail(""); setCode(""); setError(""); }}>更换邮箱</button>
      </div>}
    </form>
  </dialog>;
}
