import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { createRedisClient } from "../utils/redis";

const router = Router();

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// GET /events — authenticated server-sent events for real-time OTP updates
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const channel = `new_otp:${userId}`;
  const subscriber = createRedisClient("events-subscriber");

  let closed = false;
  let heartbeat: NodeJS.Timeout | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    subscriber.unsubscribe(channel).catch(() => {});
    subscriber.disconnect();
    console.log(`[Events] Client disconnected for user ${userId}`);
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  writeSse(res, "connected", { connectedAt: new Date().toISOString() });

  heartbeat = setInterval(() => {
    if (!closed) writeSse(res, "heartbeat", { at: new Date().toISOString() });
  }, 25_000);

  req.on("close", close);

  subscriber.on("message", (receivedChannel, message) => {
    if (closed || receivedChannel !== channel) return;

    res.write("event: new_otp\n");
    res.write(`data: ${message}\n\n`);
  });

  subscriber.on("error", (err) => {
    console.error(`[Events] Redis subscriber error for user ${userId}:`, err);
    if (!closed) writeSse(res, "error", { message: "Redis subscriber error" });
  });

  try {
    await subscriber.subscribe(channel);
    console.log(`[Events] Client subscribed for user ${userId}`);
  } catch (err) {
    console.error(`[Events] Failed to subscribe user ${userId}:`, err);
    close();
    res.end();
  }
});

export default router;
