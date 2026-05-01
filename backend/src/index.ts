import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

import { globalRateLimit } from "./middleware/rateLimit";
import authRouter from "./routes/auth";
import codesRouter from "./routes/codes";
import webhooksRouter from "./routes/webhooks";
import { startPoller } from "./services/poller";
import { startWatchRenewal, registerWatchForAllAccounts } from "./services/pubsub";

export const prisma = new PrismaClient();

const app = express();

// One reverse proxy (e.g. ngrok) — lets req.ip / rate-limit use X-Forwarded-For safely
app.set("trust proxy", 1);

// Security headers
app.use(helmet());

// CORS — only allow the Chrome extension origin
const extensionOrigin = process.env.EXTENSION_ID
  ? `chrome-extension://${process.env.EXTENSION_ID}`
  : undefined;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // server-to-server
      if (extensionOrigin && origin === extensionOrigin) return callback(null, true);
      if (process.env.NODE_ENV === "development") return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(globalRateLimit);

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// Routes
app.use("/auth", authRouter);
app.use("/codes", codesRouter);
app.use("/webhooks", webhooksRouter);

// 404 handler
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[Error]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  await prisma.$connect();
  console.log("[DB] Connected to PostgreSQL");

  startPoller();
  startWatchRenewal();

  // Register Pub/Sub watches (non-blocking)
  registerWatchForAllAccounts().catch(console.error);

  app.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT} (${process.env.NODE_ENV ?? "development"})`);
  });
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
