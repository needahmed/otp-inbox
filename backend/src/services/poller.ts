import cron from "node-cron";
import { prisma } from "../index";
import { listNewMessages } from "./gmail";
import { extractOtp } from "./otpExtractor";
import { cacheSet, publishEvent, cacheDel } from "../utils/redis";

async function pollAccount(accountId: string): Promise<void> {
  const account = await prisma.gmailAccount.findUnique({ where: { id: accountId } });
  if (!account || !account.isActive) return;

  try {
    const messages = await listNewMessages(account, account.historyId);

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

      // Cache individual code for 10 minutes
      await cacheSet(`otp:${account.id}:${stored.id}`, stored, 600);

      // Bust the codes list cache
      await cacheDel(`codes:${account.userId}:all:10`);
      await cacheDel(`codes:${account.userId}:${account.id}:10`);

      // Notify extension via pub/sub channel
      await publishEvent(`new_otp:${account.userId}`, {
        id: stored.id,
        code: stored.code,
        codeType: stored.codeType,
        sender: stored.sender,
        subject: stored.subject,
        receivedAt: stored.receivedAt.toISOString(),
        accountEmail: account.email,
      });

      console.log(`[Poller] New OTP for ${account.email}: ${stored.code.slice(0, 2)}****`);
    }
  } catch (err) {
    console.error(`[Poller] Error polling account ${account.email}:`, err);
  }
}

export async function runPollCycle(): Promise<void> {
  const accounts = await prisma.gmailAccount.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  await Promise.allSettled(accounts.map((a) => pollAccount(a.id)));
}

let task: cron.ScheduledTask | null = null;

export function startPoller(): void {
  if (task) return;
  // Poll every 15 seconds
  task = cron.schedule("*/15 * * * * *", () => {
    runPollCycle().catch((err) => console.error("[Poller] Cycle error:", err));
  });
  console.log("[Poller] Started (15s interval)");
}

export function stopPoller(): void {
  task?.stop();
  task = null;
}
