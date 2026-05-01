import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../index";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { userRateLimit } from "../middleware/rateLimit";
import { cacheGet, cacheSet } from "../utils/redis";

const router = Router();

const CACHE_TTL = 30; // seconds

// GET /codes
router.get("/", requireAuth, userRateLimit, async (req: AuthRequest, res: Response) => {
  const query = z
    .object({
      accountId: z.string().optional(),
      limit: z.coerce.number().min(1).max(50).default(10),
    })
    .parse(req.query);

  const cacheKey = `codes:${req.userId!}:${query.accountId ?? "all"}:${query.limit}`;
  const cached = await cacheGet<unknown>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  // Verify account belongs to user
  const accountFilter = query.accountId
    ? { gmailAccountId: query.accountId, gmailAccount: { userId: req.userId! } }
    : { gmailAccount: { userId: req.userId! } };

  const codes = await prisma.otpCode.findMany({
    where: accountFilter,
    orderBy: { receivedAt: "desc" },
    take: query.limit,
    include: {
      gmailAccount: { select: { email: true } },
    },
  });

  const response = {
    codes: codes.map((c) => ({
      id: c.id,
      code: c.code,
      codeType: c.codeType,
      sender: c.sender,
      subject: c.subject,
      snippet: c.rawSnippet,
      receivedAt: c.receivedAt.toISOString(),
      expiresAt: c.expiresAt?.toISOString() ?? null,
      copiedAt: c.copiedAt?.toISOString() ?? null,
      accountEmail: c.gmailAccount.email,
      confidence: c.confidence,
    })),
    lastUpdated: new Date().toISOString(),
  };

  await cacheSet(cacheKey, response, CACHE_TTL);
  res.json(response);
});

// PATCH /codes/:id/copied
router.patch("/:id/copied", requireAuth, async (req: AuthRequest, res: Response) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);

  const code = await prisma.otpCode.findFirst({
    where: { id, gmailAccount: { userId: req.userId! } },
  });

  if (!code) {
    res.status(404).json({ error: "Code not found" });
    return;
  }

  await prisma.otpCode.update({
    where: { id },
    data: { copiedAt: new Date() },
  });

  res.json({ success: true });
});

export default router;
