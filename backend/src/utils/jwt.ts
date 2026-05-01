import jwt from "jsonwebtoken";

export interface JwtPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

export function signToken(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return jwt.sign({ userId }, secret, {
    expiresIn: (process.env.JWT_EXPIRY ?? "7d") as jwt.SignOptions["expiresIn"],
  });
}

export function verifyToken(token: string): JwtPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return jwt.verify(token, secret) as JwtPayload;
}
