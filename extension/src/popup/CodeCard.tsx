import React, { useState, useCallback } from "react";
import { StoredCode } from "../utils/storage";
import { markCopied } from "../utils/api";
import { getJwt } from "../utils/storage";

interface Props {
  code: StoredCode;
}

function relativeTime(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function isExpired(code: StoredCode): boolean {
  if (code.expiresAt) return new Date(code.expiresAt) < new Date();
  // Treat as expired after 10 minutes if no explicit expiry
  const age = Date.now() - new Date(code.receivedAt).getTime();
  return age > 10 * 60 * 1000;
}

function formatSender(sender: string): string {
  const match = sender.match(/<(.+)>/);
  return match ? match[1] : sender;
}

function formatCode(code: string, codeType: string): React.ReactNode {
  if (codeType === "magic_link") return null;
  return (
    <div className="flex items-center justify-center gap-1 my-3">
      {code.split("").map((digit, i) => (
        <span
          key={i}
          className="w-8 h-10 flex items-center justify-center bg-slate-700 rounded text-xl font-bold font-mono text-white border border-slate-600"
        >
          {digit}
        </span>
      ))}
    </div>
  );
}

export default function CodeCard({ code }: Props) {
  const [copied, setCopied] = useState(false);
  const expired = isExpired(code);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code.code);
    } catch {
      // Fallback for restricted contexts
      const el = document.createElement("textarea");
      el.value = code.code;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);

    const jwt = await getJwt();
    if (jwt) markCopied(jwt, code.id).catch(() => {});
  }, [code]);

  const handleOpenLink = useCallback(() => {
    chrome.tabs.create({ url: code.code });
  }, [code.code]);

  return (
    <div
      className={`rounded-lg border p-3 transition-opacity ${
        expired
          ? "border-slate-700 bg-slate-800/50 opacity-60"
          : "border-slate-700 bg-slate-800"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="text-xs text-slate-400 truncate" title={code.sender}>
            {code.codeType === "magic_link" ? "🔗" : "✉️"} {formatSender(code.sender)}
          </div>
          <div className="text-sm text-slate-200 font-medium truncate" title={code.subject}>
            {code.subject}
          </div>
        </div>
        <div className="flex-shrink-0">
          {expired ? (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">
              Expired
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-900/50 text-green-400 border border-green-800">
              Active
            </span>
          )}
        </div>
      </div>

      {/* Code display */}
      {code.codeType !== "magic_link" && formatCode(code.code, code.codeType)}

      {/* Footer row */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-slate-500">
          ⏱ {relativeTime(code.receivedAt)}
        </span>

        {code.codeType === "magic_link" ? (
          <button
            onClick={handleOpenLink}
            className="px-3 py-1 text-xs rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
          >
            Open Link
          </button>
        ) : (
          <button
            onClick={handleCopy}
            disabled={copied}
            className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
              copied
                ? "bg-green-700 text-white cursor-default"
                : "bg-indigo-600 hover:bg-indigo-500 text-white"
            }`}
          >
            {copied ? "✅ Copied!" : "Copy Code"}
          </button>
        )}
      </div>
    </div>
  );
}
