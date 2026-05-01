export type CodeType = "numeric_otp" | "alphanumeric" | "magic_link";

export interface ExtractedCode {
  code: string;
  codeType: CodeType;
  confidence: number;
  snippet: string;
  expiryMinutes: number | null;
}

// High-signal context phrases that appear near OTP codes
const CONTEXT_KEYWORDS = [
  "your code is",
  "your otp",
  "your one-time",
  "one-time password",
  "one-time code",
  "verification code",
  "verifikation",
  "verify your",
  "confirm your",
  "security code",
  "authentication code",
  "login code",
  "sign-in code",
  "signin code",
  "access code",
  "passcode",
  "pass code",
  "use code",
  "enter code",
  "enter the code",
  "temporary code",
  "temporary password",
  "confirmation code",
  "2fa",
  "two-factor",
  "two factor",
  "auth code",
  "otp:",
  "code:",
  "pin:",
  "token:",
];

// Trusted sender patterns
const TRUSTED_SENDER_PATTERNS = [
  /^(noreply|no-reply|donotreply|do-not-reply)@/i,
  /^(security|account|accounts|auth|verify|verification|confirm|notification|alerts|info)@/i,
  /@(google|apple|microsoft|amazon|facebook|meta|twitter|github|stripe|twilio|sendgrid)\./i,
];

// Magic link URL path patterns
const MAGIC_LINK_PATH_PATTERNS = [
  /verify/i,
  /confirm/i,
  /activate/i,
  /\blogin\b/i,
  /\bsignin\b/i,
  /\bsign-in\b/i,
  /\bauth\b/i,
  /\btoken\b/i,
  /\bmagic\b/i,
];

// Expiry patterns: "expires in X minutes/hours"
const EXPIRY_PATTERNS = [
  /(?:valid|expires?|expiry|expiring)\s+(?:for|in)\s+(\d+)\s+(minute|min|hour|hr)/i,
  /(\d+)[- ](minute|min|hour|hr)\s+(?:expiry|window|validity)/i,
  /good\s+for\s+(\d+)\s+(minute|min|hour|hr)/i,
];

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function getSnippet(text: string, index: number, length: number, snippetLen = 120): string {
  const start = Math.max(0, index - snippetLen / 2);
  const end = Math.min(text.length, index + length + snippetLen / 2);
  return text.slice(start, end).trim();
}

function hasContextNear(text: string, index: number, windowChars = 200): boolean {
  const window = text.slice(Math.max(0, index - windowChars), index + windowChars).toLowerCase();
  return CONTEXT_KEYWORDS.some((kw) => window.includes(kw));
}

function senderTrustScore(sender: string): number {
  if (TRUSTED_SENDER_PATTERNS.some((p) => p.test(sender))) return 0.25;
  return 0;
}

function parseExpiry(text: string): number | null {
  for (const pattern of EXPIRY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();
      if (unit.startsWith("hour") || unit.startsWith("hr")) return value * 60;
      return value; // minutes
    }
  }
  return null;
}

function extractMagicLinks(html: string, text: string): ExtractedCode | null {
  const hrefPattern = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefPattern.exec(html)) !== null) {
    const url = match[1];
    if (MAGIC_LINK_PATH_PATTERNS.some((p) => p.test(url))) {
      return {
        code: url,
        codeType: "magic_link",
        confidence: 0.85,
        snippet: getSnippet(text, 0, 50),
        expiryMinutes: parseExpiry(text),
      };
    }
  }
  return null;
}

interface CodeCandidate {
  code: string;
  codeType: CodeType;
  confidence: number;
  index: number;
  snippet: string;
}

export function extractOtp(
  plainText: string,
  html: string,
  sender: string,
  subject: string
): ExtractedCode | null {
  const text = plainText || stripHtml(html);
  const lower = text.toLowerCase();
  const subjectLower = subject.toLowerCase();
  const trust = senderTrustScore(sender);

  // Subject keyword bonus
  const subjectBonus = CONTEXT_KEYWORDS.some((kw) => subjectLower.includes(kw)) ? 0.15 : 0;

  const candidates: CodeCandidate[] = [];

  // --- Numeric OTP patterns ---
  const numericPatterns: [RegExp, number][] = [
    [/\b(\d{6})\b/g, 0.7],  // 6-digit (most common)
    [/\b(\d{4})\b/g, 0.5],  // 4-digit
    [/\b(\d{8})\b/g, 0.6],  // 8-digit
    [/\b(\d{3})[\s\-–](\d{3})\b/g, 0.65], // spaced 3-3
  ];

  for (const [pattern, baseScore] of numericPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      const code = match[1] + (match[2] ?? "");
      const contextBonus = hasContextNear(lower, match.index) ? 0.2 : 0;
      const confidence = Math.min(1, baseScore + trust + subjectBonus + contextBonus);
      candidates.push({
        code,
        codeType: "numeric_otp",
        confidence,
        index: match.index,
        snippet: getSnippet(text, match.index, match[0].length),
      });
    }
  }

  // --- Alphanumeric patterns ---
  const alphaPatterns: [RegExp, number][] = [
    [/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/g, 0.65],
    [/\b([A-Z]{2,}[0-9]{2,}[A-Z0-9]*|[0-9]{2,}[A-Z]{2,}[A-Z0-9]*)\b/g, 0.5],
  ];

  for (const [pattern, baseScore] of alphaPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1].length < 6 || match[1].length > 10) continue;
      const contextBonus = hasContextNear(lower, match.index) ? 0.2 : 0;
      const confidence = Math.min(1, baseScore + trust + subjectBonus + contextBonus);
      candidates.push({
        code: match[1],
        codeType: "alphanumeric",
        confidence,
        index: match.index,
        snippet: getSnippet(text, match.index, match[1].length),
      });
    }
  }

  // --- Magic links (only from HTML) ---
  if (html) {
    const magicLink = extractMagicLinks(html, text);
    if (magicLink) {
      return magicLink;
    }
  }

  if (candidates.length === 0) return null;

  // Pick candidate with highest confidence; on tie prefer numeric
  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.codeType === "numeric_otp" ? -1 : 1;
  });

  const best = candidates[0];
  if (best.confidence < 0.6) return null;

  return {
    code: best.code,
    codeType: best.codeType,
    confidence: best.confidence,
    snippet: best.snippet,
    expiryMinutes: parseExpiry(text),
  };
}
