import { useEffect, useState, useCallback, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./popup.css";

import { StoredCode, getStorage, setStorage } from "../utils/storage";
import { BACKEND_URL, consumeAuthSession, fetchCodes } from "../utils/api";
import AccountSwitcher from "./AccountSwitcher";
import CodeCard from "./CodeCard";

type View = "loading" | "logged_out" | "codes";

export default function Popup() {
  const [view, setView] = useState<View>("loading");
  const [codes, setCodes] = useState<StoredCode[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { jwt, codes: stored, accounts: accts, lastSynced: ls, pendingAuthState } = await getStorage([
      "jwt",
      "codes",
      "accounts",
      "lastSynced",
      "pendingAuthState",
    ]);

    if (!jwt && pendingAuthState) {
      try {
        const session = await consumeAuthSession(pendingAuthState);
        if (session) {
          const nextAccounts = accts ?? [];
          if (!nextAccounts.includes(session.email)) nextAccounts.push(session.email);

          await setStorage({
            jwt: session.token,
            accounts: nextAccounts,
            pendingAuthState: null,
          });
          chrome.runtime.sendMessage({ type: "AUTH_SUCCESS" });

          setCodes(stored ?? []);
          setAccounts(nextAccounts);
          setLastSynced(ls ?? null);
          setView("codes");
          return;
        }
      } catch {
        setError("Could not finish sign-in. Please try again.");
        await setStorage({ pendingAuthState: null });
      }
    }

    if (!jwt) {
      setView("logged_out");
      return;
    }

    setCodes(stored ?? []);
    setAccounts(accts ?? []);
    setLastSynced(ls ?? null);
    setView("codes");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const { jwt } = await getStorage(["jwt"]);
      if (!jwt) { setView("logged_out"); return; }

      const { codes: fresh, lastUpdated } = await fetchCodes(jwt);
      await setStorage({ codes: fresh, lastSynced: lastUpdated });
      setCodes(fresh);
      setLastSynced(lastUpdated);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg === "UNAUTHORIZED" ? "Session expired. Please reconnect." : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }, []);

  const startAuth = useCallback(async () => {
    const state = createAuthState();
    await setStorage({ pendingAuthState: state });
    chrome.tabs.create({ url: `${BACKEND_URL}/auth/google?state=${encodeURIComponent(state)}` });
    window.close();
  }, []);

  const handleLogout = useCallback(async () => {
    await setStorage({ jwt: null, accounts: [], codes: [], seenIds: [], pendingAuthState: null });
    setView("logged_out");
  }, []);

  const filteredCodes = selectedAccount
    ? codes.filter((c) => c.accountEmail === selectedAccount)
    : codes;

  if (view === "loading") {
    return (
      <div className="flex items-center justify-center h-24">
        <div className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (view === "logged_out") {
    return (
      <div className="flex flex-col items-center justify-center gap-5 p-6 text-center min-h-[220px]">
        <div className="text-4xl">🔐</div>
        <div>
          <h1 className="text-lg font-semibold text-slate-100 mb-1">OTP Inbox</h1>
          <p className="text-sm text-slate-400">Connect your Gmail to see OTP codes here</p>
        </div>
        <button
          onClick={startAuth}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Connect Gmail Account
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-[300px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔐</span>
          <span className="font-semibold text-slate-100">OTP Inbox</span>
        </div>
        <button
          onClick={handleLogout}
          title="Sign out"
          className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors text-xs"
        >
          ⎋
        </button>
      </div>

      {/* Account switcher */}
      {accounts.length > 0 && (
        <AccountSwitcher
          accounts={accounts}
          selected={selectedAccount}
          onSelect={setSelectedAccount}
          onAdd={startAuth}
        />
      )}

      {/* Error banner */}
      {error && (
        <div className="mx-3 mt-3 px-3 py-2 bg-red-900/40 border border-red-800 rounded text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Code list */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {filteredCodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-slate-500 gap-2">
            <span className="text-3xl">📭</span>
            <p className="text-sm">No OTP codes found yet.</p>
            <p className="text-xs">New codes appear here automatically.</p>
          </div>
        ) : (
          filteredCodes.map((c) => <CodeCard key={c.id} code={c} />)
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-slate-700 text-xs text-slate-500">
        <span>
          {lastSynced ? `Last synced: ${relativeTime(lastSynced)}` : "Never synced"}
        </span>
        <button
          onClick={handleRefresh}
          disabled={syncing}
          title="Sync now"
          className="flex items-center gap-1 text-slate-400 hover:text-slate-200 disabled:opacity-50 transition-colors"
        >
          <span className={syncing ? "animate-spin inline-block" : ""}>↻</span>
          {syncing ? "Syncing…" : "Sync"}
        </button>
      </div>
    </div>
  );
}

function relativeTime(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function createAuthState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Entry point
const root = document.getElementById("root")!;
createRoot(root).render(
  <StrictMode>
    <Popup />
  </StrictMode>
);
