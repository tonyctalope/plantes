import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random secret (256 bits by default). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256, base64url. Secrets (tokens, codes, session ids) are only ever stored hashed. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** RFC 7636 S256 code challenge of a PKCE verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** RFC 7636 §4.1: 43–128 characters from the unreserved set. */
export function isValidPkceVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier);
}

/** S256 challenges are base64url SHA-256 digests: exactly 43 characters. */
export function isValidPkceChallenge(challenge: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(challenge);
}
