import { Router, Request, Response } from "express";
import { google } from "googleapis";
import { z } from "zod";
import { prisma } from "../index";
import { encrypt, decrypt } from "../utils/encryption";
import { signToken } from "../utils/jwt";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { makeOAuth2ClientForOAuth } from "../services/gmail";

const router = Router();

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
];

const AUTH_SESSION_TTL_MS = 10 * 60 * 1000;

interface PendingAuthSession {
  token: string;
  email: string;
  expiresAt: number;
}

const pendingAuthSessions = new Map<string, PendingAuthSession>();

function consumePendingAuthSession(state: string): PendingAuthSession | null {
  const session = pendingAuthSessions.get(state);
  pendingAuthSessions.delete(state);

  if (!session || session.expiresAt < Date.now()) {
    return null;
  }

  return session;
}

// GET /auth/google — initiate OAuth flow
router.get("/google", (req: Request, res: Response) => {
  const { state } = req.query as { state?: string };
  const client = makeOAuth2ClientForOAuth();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
  res.redirect(url);
});

// GET /auth/google/callback — handle OAuth callback
router.get("/google/callback", async (req: Request, res: Response) => {
  const { code, error, state } = req.query as { code?: string; error?: string; state?: string };

  if (error || !code) {
    res.status(400).send(`<h2>OAuth Error: ${error ?? "No code provided"}</h2>`);
    return;
  }

  try {
    const client = makeOAuth2ClientForOAuth();
    const { tokens } = await client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      res.status(400).send("<h2>Failed to get tokens from Google</h2>");
      return;
    }

    // Get user info
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data: userInfo } = await oauth2.userinfo.get();

    if (!userInfo.email) {
      res.status(400).send("<h2>Could not retrieve email from Google</h2>");
      return;
    }

    const tokenExpiry = new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000);

    // Upsert user
    const existingAccount = await prisma.gmailAccount.findUnique({
      where: { email: userInfo.email },
      include: { user: true },
    });

    let userId: string;

    if (existingAccount) {
      userId = existingAccount.userId;
      await prisma.gmailAccount.update({
        where: { id: existingAccount.id },
        data: {
          accessToken: encrypt(tokens.access_token),
          refreshToken: encrypt(tokens.refresh_token),
          tokenExpiry,
          isActive: true,
        },
      });
    } else {
      const user = await prisma.user.create({ data: {} });
      userId = user.id;
      await prisma.gmailAccount.create({
        data: {
          userId,
          email: userInfo.email,
          accessToken: encrypt(tokens.access_token),
          refreshToken: encrypt(tokens.refresh_token),
          tokenExpiry,
        },
      });
    }

    const jwt = signToken(userId);

    if (state) {
      pendingAuthSessions.set(state, {
        token: jwt,
        email: userInfo.email,
        expiresAt: Date.now() + AUTH_SESSION_TTL_MS,
      });
    }

    res.setHeader("Content-Security-Policy", "script-src 'none'; object-src 'none'; base-uri 'none'");
    res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OTP Inbox Connected</title>
    <style>
      body {
        align-items: center;
        background: #0f172a;
        color: #f1f5f9;
        display: flex;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        justify-content: center;
        margin: 0;
        min-height: 100vh;
      }
      .card {
        background: #1e293b;
        border-radius: 12px;
        max-width: 360px;
        padding: 2rem;
        text-align: center;
      }
      h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
      p { color: #94a3b8; margin: 0; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Gmail Connected</h1>
      <p>${state ? "Open the OTP Inbox extension popup to finish signing in." : "Return to the OTP Inbox extension and try connecting again."}</p>
    </div>
  </body>
</html>`);
  } catch (err) {
    console.error("[Auth] OAuth callback error:", err);
    res.status(500).send("<h2>Authentication failed. Please try again.</h2>");
  }
});

// GET /auth/session/:state — extension claims a completed OAuth session
router.get("/session/:state", (req: Request, res: Response) => {
  const session = consumePendingAuthSession(req.params.state);

  if (!session) {
    res.status(404).json({ error: "Auth session not found or expired" });
    return;
  }

  res.json({ token: session.token, email: session.email });
});

// POST /auth/refresh — refresh expired access token
router.post("/refresh", requireAuth, async (req: AuthRequest, res: Response) => {
  const { accountId } = z.object({ accountId: z.string() }).parse(req.body);

  const account = await prisma.gmailAccount.findFirst({
    where: { id: accountId, userId: req.userId! },
  });

  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  try {
    const client = makeOAuth2ClientForOAuth();
    client.setCredentials({
      refresh_token: decrypt(account.refreshToken),
    });
    const { credentials } = await client.refreshAccessToken();
    const newExpiry = new Date(credentials.expiry_date ?? Date.now() + 3600 * 1000);
    await prisma.gmailAccount.update({
      where: { id: account.id },
      data: {
        accessToken: encrypt(credentials.access_token ?? decrypt(account.accessToken)),
        tokenExpiry: newExpiry,
      },
    });
    res.json({ success: true });
  } catch (err) {
    console.error("[Auth] Token refresh error:", err);
    res.status(500).json({ error: "Failed to refresh token" });
  }
});

// POST /auth/logout — revoke tokens
router.post("/logout", requireAuth, async (req: AuthRequest, res: Response) => {
  const { accountId } = z.object({ accountId: z.string().optional() }).parse(req.body ?? {});

  const where = accountId
    ? { id: accountId, userId: req.userId! }
    : { userId: req.userId! };

  await prisma.gmailAccount.updateMany({
    where,
    data: { isActive: false },
  });

  res.json({ success: true });
});

// GET /auth/accounts — list linked accounts
router.get("/accounts", requireAuth, async (req: AuthRequest, res: Response) => {
  const accounts = await prisma.gmailAccount.findMany({
    where: { userId: req.userId!, isActive: true },
    select: { id: true, email: true, lastCheckedAt: true, isActive: true },
  });
  res.json({ accounts });
});

export default router;
