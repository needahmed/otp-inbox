export interface StoredCode {
  id: string;
  code: string;
  codeType: "numeric_otp" | "alphanumeric" | "magic_link";
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  expiresAt: string | null;
  copiedAt: string | null;
  accountEmail: string;
  confidence: number;
}

export interface StorageData {
  jwt: string | null;
  accounts: string[];
  codes: StoredCode[];
  seenIds: string[];
  lastSynced: string | null;
  pendingAuthState: string | null;
}

export async function getStorage<K extends keyof StorageData>(
  keys: K[]
): Promise<Pick<StorageData, K>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys as string[], (result) => {
      resolve(result as Pick<StorageData, K>);
    });
  });
}

export async function setStorage(data: Partial<StorageData>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

export async function getJwt(): Promise<string | null> {
  const { jwt } = await getStorage(["jwt"]);
  return jwt ?? null;
}

export async function clearAuth(): Promise<void> {
  await setStorage({ jwt: null, accounts: [], codes: [], seenIds: [] });
}
