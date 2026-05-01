import cron from "node-cron";
import { prisma } from "../index";
import { setupGmailWatch } from "./gmail";

function getPubSubConfig(): { projectId: string; topic: string } | null {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const topic = process.env.PUBSUB_TOPIC;

  if (!projectId || !topic || projectId === "your_project_id") {
    return null;
  }

  return { projectId, topic };
}

// Re-register Gmail watch every 6 days (Google requires renewal every 7 days)
export function startWatchRenewal(): void {
  if (!getPubSubConfig()) {
    console.log("[PubSub] Watch renewal disabled (Pub/Sub env vars not configured)");
    return;
  }

  cron.schedule("0 0 */6 * *", async () => {
    console.log("[PubSub] Renewing Gmail watch subscriptions...");
    const accounts = await prisma.gmailAccount.findMany({
      where: { isActive: true },
    });
    for (const account of accounts) {
      try {
        await setupGmailWatch(account);
        console.log(`[PubSub] Watch renewed for ${account.email}`);
      } catch (err) {
        console.error(`[PubSub] Watch renewal failed for ${account.email}:`, err);
      }
    }
  });

  console.log("[PubSub] Watch renewal scheduled (every 6 days)");
}

export async function registerWatchForAllAccounts(): Promise<void> {
  if (!getPubSubConfig()) {
    console.log("[PubSub] Skipping watch registration (Pub/Sub env vars not configured)");
    return;
  }

  const accounts = await prisma.gmailAccount.findMany({ where: { isActive: true } });
  for (const account of accounts) {
    try {
      await setupGmailWatch(account);
      console.log(`[PubSub] Watch registered for ${account.email}`);
    } catch (err) {
      console.error(`[PubSub] Watch registration failed for ${account.email}:`, err);
    }
  }
}
