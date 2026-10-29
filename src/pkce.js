// PKCE and state values for one sign-in attempt (flow A, step 1 of the partner brief).
//
// Why PKCE: the code_verifier proves that whoever exchanges the authorization code is
// whoever started the login. A code stolen from the callback URL is useless without it.
//
// Why S256: eToro receives only the SHA-256 hash of the verifier (the code_challenge),
// so the verifier itself never appears in a URL, a browser history, or a referrer.
//
// Where the verifier lives: this server generates it and stores it in an HttpOnly cookie
// on its own host (Pattern B). Page scripts cannot read it, the browser sends it back on
// the callback automatically, and the callback route reads it from that cookie only.
//
// A new state and a new verifier are generated for every attempt. Never reuse them.

import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes as base64url: 43 characters from the allowed PKCE alphabet. */
export function generateCodeVerifier() {
  return randomBytes(32).toString('base64url');
}

/** BASE64URL(SHA256(code_verifier)), with no padding. */
export function generateCodeChallenge(codeVerifier) {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

/** 128 random bits. The callback rejects any response whose state differs (CSRF check). */
export function generateState() {
  return randomBytes(16).toString('hex');
}
