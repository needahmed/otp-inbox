import { Router, Request, Response } from "express";
import { prisma } from "../index";
import { listNewMessages } from "../services/gmail";
import { extractOtp } from "../services/otpExtractor";
import { cacheSet, publishEvent, cacheDel } from "../utils/redis";

const router = Router();

interface PubSubMessage {
  data: string;
  messageId: string;
}

interface GmailPushPayload {
  emailAddress: string;
  historyId: string;
}

// POST /webhooks/gmail — Google Pub/Sub push endpoint
router.post("/gmail", async (req: Request, res: Response) => {
  // Acknowledge immediately to prevent redelivery
  res.status(204).send();

  const message: PubSubMessage = req.body?.message;
  if (!message?.data) return;

  let payload: GmailPushPayload;
  try {
    payload = JSON.parse(Buffer.from(message.data, "base64").toString("utf-8"));
  } catch {
    console.warn(`[Webhook] Ignoring Pub/Sub message ${message.messageId}: invalid payload`);
    return;
  }

  console.log(
    `[Webhook] Gmail notification ${message.messageId} for ${payload.emailAddress} (history ${payload.historyId})`
  );

  const account = await prisma.gmailAccount.findUnique({
    where: { email: payload.emailAddress },
  });

  if (!account || !account.isActive) {
    console.warn(`[Webhook] No active account for ${payload.emailAddress}`);
    return;
  }

  try {
    const messages = await listNewMessages(account, account.historyId);
    console.log(`[Webhook] Found ${messages.length} new Gmail message(s) for ${account.email}`);

    for (const msg of messages) {
      const existing = await prisma.otpCode.findFirst({ where: { emailId: msg.id } });
      if (existing) continue;

      const extracted = extractOtp(msg.plainText, msg.html, msg.sender, msg.subject);
      if (!extracted || extracted.confidence < 0.6) continue;

      const expiresAt = extracted.expiryMinutes
        ? new Date(msg.receivedAt.getTime() + extracted.expiryMinutes * 60 * 1000)
        : null;

      const stored = await prisma.otpCode.create({
        data: {
          gmailAccountId: account.id,
          emailId: msg.id,
          sender: msg.sender,
          subject: msg.subject,
          code: extracted.code,
          codeType: extracted.codeType,
          confidence: extracted.confidence,
          rawSnippet: extracted.snippet,
          receivedAt: msg.receivedAt,
          expiresAt,
        },
      });

      await cacheSet(`otp:${account.id}:${stored.id}`, stored, 600);

      // Invalidate codes list cache for this user
      await cacheDel(`codes:${account.userId}:all:10`);
      await cacheDel(`codes:${account.userId}:${account.id}:10`);

      await publishEvent(`new_otp:${account.userId}`, {
        id: stored.id,
        code: stored.code,
        codeType: stored.codeType,
        sender: stored.sender,
        subject: stored.subject,
        receivedAt: stored.receivedAt.toISOString(),
        accountEmail: account.email,
      });

      console.log(`[Webhook] Stored OTP event for ${account.email} from ${stored.sender}`);
    }
  } catch (err) {
    console.error("[Webhook] Gmail processing error:", err);
  }
});

export default router;
