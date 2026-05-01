import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { GmailAccount } from "@prisma/client";
import { prisma } from "../index";
import { encrypt, decrypt } from "../utils/encryption";

export interface MessageSummary {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  plainText: string;
  html: string;
  receivedAt: Date;
  internalDate: string;
}

function buildOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export async function getAuthenticatedClient(account: GmailAccount): Promise<OAuth2Client> {
  const client = buildOAuth2Client();

  const accessToken = decrypt(account.accessToken);
  const refreshToken = decrypt(account.refreshToken);

  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: account.tokenExpiry.getTime(),
  });

  // Refresh if expired or expiring within 5 minutes
  if (Date.now() >= account.tokenExpiry.getTime() - 5 * 60 * 1000) {
    const { credentials } = await client.refreshAccessToken();
    const newExpiry = new Date(credentials.expiry_date ?? Date.now() + 3600 * 1000);
    await prisma.gmailAccount.update({
      where: { id: account.id },
      data: {
        accessToken: encrypt(credentials.access_token ?? accessToken),
        tokenExpiry: newExpiry,
      },
    });
    client.setCredentials(credentials);
  }

  return client;
}

function decodeBase64Url(encoded: string): string {
  return Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function extractParts(
  payload: { mimeType?: string; body?: { data?: string }; parts?: unknown[] } | undefined
): { plain: string; html: string } {
  if (!payload) return { plain: "", html: "" };

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return { plain: decodeBase64Url(payload.body.data), html: "" };
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return { plain: "", html: decodeBase64Url(payload.body.data) };
  }

  if (payload.parts) {
    let plain = "";
    let html = "";
    for (const part of payload.parts as typeof payload[]) {
      const { plain: p, html: h } = extractParts(part);
      plain += p;
      html += h;
    }
    return { plain, html };
  }

  return { plain: "", html: "" };
}

export async function listNewMessages(
  account: GmailAccount,
  sinceHistoryId?: string | null
): Promise<MessageSummary[]> {
  const auth = await getAuthenticatedClient(account);
  const gmail = google.gmail({ version: "v1", auth });

  let messageIds: string[] = [];
  let newHistoryId: string | undefined;

  if (sinceHistoryId) {
    try {
      const historyRes = await gmail.users.history.list({
        userId: "me",
        startHistoryId: sinceHistoryId,
        historyTypes: ["messageAdded"],
        labelId: "INBOX",
      });
      newHistoryId = historyRes.data.historyId ?? undefined;
      const history = historyRes.data.history ?? [];
      for (const entry of history) {
        for (const msg of entry.messagesAdded ?? []) {
          if (msg.message?.id) messageIds.push(msg.message.id);
        }
      }
    } catch {
      // History token expired — fall back to query
      sinceHistoryId = null;
    }
  }

  if (!sinceHistoryId) {
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread newer_than:1d",
      maxResults: 20,
    });
    messageIds = (listRes.data.messages ?? []).map((m) => m.id!).filter(Boolean);

    // Capture the real Gmail history cursor after the fallback query.
    const profile = await gmail.users.getProfile({ userId: "me" });
    newHistoryId = profile.data.historyId ?? undefined;
  }

  if (newHistoryId) {
    await prisma.gmailAccount.update({
      where: { id: account.id },
      data: { historyId: newHistoryId, lastCheckedAt: new Date() },
    });
  }

  const messages: MessageSummary[] = [];

  for (const id of messageIds) {
    try {
      const msgRes = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      });

      const msg = msgRes.data;
      const headers = msg.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

      const { plain, html } = extractParts(msg.payload as Parameters<typeof extractParts>[0]);

      messages.push({
        id,
        sender: getHeader("From"),
        subject: getHeader("Subject"),
        snippet: msg.snippet ?? "",
        plainText: plain,
        html,
        receivedAt: new Date(parseInt(msg.internalDate ?? "0")),
        internalDate: msg.internalDate ?? "0",
      });
    } catch (err) {
      console.error(`[Gmail] Failed to fetch message ${id}:`, err);
    }
  }

  return messages;
}

export async function setupGmailWatch(account: GmailAccount): Promise<void> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const topic = process.env.PUBSUB_TOPIC;
  if (!projectId || !topic) return;

  const auth = await getAuthenticatedClient(account);
  const gmail = google.gmail({ version: "v1", auth });

  const watchRes = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName: `projects/${projectId}/topics/${topic}`,
      labelIds: ["INBOX"],
    },
  });

  const historyId = watchRes.data.historyId;
  if (historyId && !account.historyId) {
    await prisma.gmailAccount.update({
      where: { id: account.id },
      data: { historyId, lastCheckedAt: new Date() },
    });
  }
}

export function makeOAuth2ClientForOAuth(): OAuth2Client {
  return buildOAuth2Client();
}
