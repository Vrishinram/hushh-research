import "server-only";

import { SignJWT, jwtVerify } from "jose";

import {
  PORTFOLIO_SHARE_SCHEMA_VERSION,
  sanitizePortfolioSharePayload,
  type PortfolioSharePayload,
} from "@/lib/portfolio-share/contract";

const PORTFOLIO_SHARE_ISSUER = "hushh-portfolio-share";
const PORTFOLIO_SHARE_AUDIENCE = "portfolio-share-public";
const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

const secretKey =
  process.env.PORTFOLIO_SHARE_SECRET ||
  process.env.SESSION_SECRET ||
  "dev-portfolio-share-secret-change-in-prod";
const key = new TextEncoder().encode(secretKey);

interface PortfolioShareTokenPayload {
  p: PortfolioSharePayload;
  v: number;
}

export async function createPortfolioShareToken(
  payloadInput: unknown
): Promise<{ token: string; expiresAt: string }> {
  const payload = sanitizePortfolioSharePayload(payloadInput);
  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + DEFAULT_EXPIRY_SECONDS;

  const token = await new SignJWT({
    p: payload,
    v: PORTFOLIO_SHARE_SCHEMA_VERSION,
  } satisfies PortfolioShareTokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(PORTFOLIO_SHARE_ISSUER)
    .setAudience(PORTFOLIO_SHARE_AUDIENCE)
    .setExpirationTime(expiresAtEpochSeconds)
    .sign(key);

  return {
    token,
    expiresAt: new Date(expiresAtEpochSeconds * 1000).toISOString(),
  };
}

export async function verifyPortfolioShareToken(
  token: string
): Promise<PortfolioSharePayload | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: PORTFOLIO_SHARE_ISSUER,
      audience: PORTFOLIO_SHARE_AUDIENCE,
    });

    const record = payload as unknown as Record<string, unknown>;
    return sanitizePortfolioSharePayload(record.p);
  } catch {
    return null;
  }
}
