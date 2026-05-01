import { BACKEND_URL, fetchCodes } from "../utils/api";
import { getJwt, getStorage, setStorage, StoredCode } from "../utils/storage";

const ALARM_NAME = "otp-poll";
const POLL_INTERVAL_MINUTES = 0.25; // 15 seconds

// ── Lifecycle ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 0.1,
    periodInMinutes: POLL_INTERVAL_MINUTES,
  });
  console.log("[SW] OTP Inbox installed, alarm scheduled.");
});

// ── Alarm handler ──────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    pollCodes().catch(console.error);
  }
});

// ── Message handler (from popup / success.html) ───────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "AUTH_SUCCESS" || msg?.type === "FORCE_POLL") {
    pollCodes().catch(console.error);
  }
});

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "AUTH_SUCCESS_EXTERNAL") return;

  const senderOrigin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "");
  if (senderOrigin !== BACKEND_URL) {
    sendResponse({ ok: false, error: "Unexpected auth origin" });
    return;
  }

  const token = typeof msg.token === "string" ? msg.token : null;
  const email = typeof msg.email === "string" ? msg.email : null;

  if (!token) {
    sendResponse({ ok: false, error: "Missing token" });
    return;
  }

  (async () => {
    const { accounts } = await getStorage(["accounts"]);
    const nextAccounts = accounts ?? [];
    if (email && !nextAccounts.includes(email)) nextAccounts.push(email);

    await setStorage({ jwt: token, accounts: nextAccounts });
    sendResponse({ ok: true });
    pollCodes().catch(console.error);
  })().catch((err) => {
    console.error("[SW] Auth handoff failed", err);
    sendResponse({ ok: false, error: "Auth handoff failed" });
  });

  return true;
});

// ── Notification click: copy code to clipboard ────────────────────────────

chrome.notifications.onClicked.addListener((notifId) => {
  handleNotificationClick(notifId).catch(console.error);
});

async function handleNotificationClick(notifId: string): Promise<void> {
  // notifId is the OTP code ID prefixed with "otp-"
  const codeId = notifId.replace(/^otp-/, "");
  const { codes } = await getStorage(["codes"]);
  const found = (codes ?? []).find((c) => c.id === codeId);
  if (!found) return;

  await copyToClipboard(found.code);

  chrome.action.setBadgeText({ text: "✓" });
  chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
}

// ── Core poll function ────────────────────────────────────────────────────

async function pollCodes(): Promise<void> {
  const jwt = await getJwt();
  if (!jwt) return;

  let freshCodes: StoredCode[];
  try {
    const { codes } = await fetchCodes(jwt);
    freshCodes = codes;
  } catch (err) {
    if ((err as Error).message === "UNAUTHORIZED") {
      await setStorage({ jwt: null });
    }
    return;
  }

  const { seenIds } = await getStorage(["seenIds"]);
  const seen = new Set(seenIds ?? []);

  const newCodes = freshCodes.filter((c) => !seen.has(c.id));

  for (const code of newCodes) {
    seen.add(code.id);
    fireNotification(code);
  }

  await setStorage({
    codes: freshCodes,
    seenIds: [...seen].slice(-200), // cap stored IDs
    lastSynced: new Date().toISOString(),
  });
}

// ── Notification helper ───────────────────────────────────────────────────

function fireNotification(code: StoredCode): void {
  const sender = code.sender.replace(/.*<(.+)>/, "$1").trim();
  const display =
    code.codeType === "magic_link"
      ? "Magic link received"
      : code.code.split("").join(" ");

  chrome.notifications.create(`otp-${code.id}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("public/icons/icon128.png"),
    title: `New OTP from ${sender}`,
    message: `${display}  —  Click to copy`,
    priority: 2,
  });
}

// ── Clipboard helper (service worker context) ─────────────────────────────

async function copyToClipboard(text: string): Promise<void> {
  // Service workers can't use document.execCommand; use offscreen document approach
  try {
    await chrome.offscreen?.createDocument?.({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: "Copy OTP code to clipboard",
    });
  } catch {
    // Already exists — ignore
  }

  chrome.runtime.sendMessage({ type: "COPY_TO_CLIPBOARD", text });
}
