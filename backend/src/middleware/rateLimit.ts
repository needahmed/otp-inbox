import rateLimit from "express-rate-limit";
import { AuthRequest } from "./auth";

export const globalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

export const userRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => {
    const authReq = req as AuthRequest;
    return authReq.userId ?? req.ip ?? "unknown";
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded." },
});
