import { StoredCode } from "./storage";

export const BACKEND_URL = "https://beaming-overpresumptuous-lelah.ngrok-free.dev";

interface CodesResponse {
  codes: StoredCode[];
  lastUpdated: string;
}

interface AuthSessionResponse {
  token: string;
  email: string;
}

export async function fetchCodes(
  jwt: string,
  accountId?: string
): Promise<CodesResponse> {
  const params = new URLSearchParams({ limit: "20" });
  if (accountId) params.set("accountId", accountId);

  const res = await fetch(`${BACKEND_URL}/codes?${params}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("UNAUTHORIZED");
    throw new Error(`API error: ${res.status}`);
  }

  return res.json() as Promise<CodesResponse>;
}

export async function markCopied(jwt: string, codeId: string): Promise<void> {
  await fetch(`${BACKEND_URL}/codes/${codeId}/copied`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${jwt}` },
  });
}

export async function fetchAccounts(
  jwt: string
): Promise<{ id: string; email: string; lastCheckedAt: string }[]> {
  const res = await fetch(`${BACKEND_URL}/auth/accounts`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json() as { accounts: { id: string; email: string; lastCheckedAt: string }[] };
  return data.accounts;
}

export async function consumeAuthSession(
  state: string
): Promise<AuthSessionResponse | null> {
  const res = await fetch(`${BACKEND_URL}/auth/session/${encodeURIComponent(state)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<AuthSessionResponse>;
}
