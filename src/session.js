// Server-side sessions and accounts for this single demo process.
//
// The browser holds one thing: `app_session`, an opaque random id in an HttpOnly cookie.
// It maps to a session here. The access token, refresh token, user key, and
// externalUserId all stay on this server and are never sent to the browser.
//
// Everything is kept in memory, so a restart signs everyone out and forgets every link.
// That is fine for a demo on one machine. A real partner:
// - keeps sessions and accounts in its own database, with refresh tokens and user keys
//   encrypted at rest, and the encryption key in a vault;
// - rebuilds the refresh schedule from the stored expiry after a restart, otherwise
//   every deploy signs every customer out;
// - when it runs more than one instance, lets only one instance refresh a given session
//   at a time (a lease or a lock). Two refreshes of the same refresh token give one
//   success and one invalid_grant, and the second breaks the session.

import { randomBytes } from 'node:crypto';
import { EtoroCallError, refreshTokens, revokeRefreshToken } from './etoro.js';

// Refresh about one minute before the access token expires (about ten minutes after it
// was issued). An expired access token is normal and never signs the customer out.
const REFRESH_LEAD_MS = 60_000;

// Transient refresh failures (network, 5xx) are retried with backoff. The session is only
// dropped when eToro answers invalid_grant, or when retries run out after the access
// token has already expired.
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 300_000];
const MAX_REFRESH_ATTEMPTS = 5;

/**
 * @typedef {object} Session
 * @property {string} id            Value of the app_session cookie.
 * @property {string} accountId     Your own account id. Here it is the id_token `sub`.
 * @property {string} accessToken
 * @property {string} refreshToken
 * @property {number} expiresAt     Access token expiry, ms since epoch.
 * @property {number} refreshAttempts
 * @property {string | undefined} notice  One-time message for the connected page.
 * @property {NodeJS.Timeout | undefined} timer
 */

/**
 * @typedef {object} Account
 * @property {string} id
 * @property {string | undefined} userKey         Flow B step 4. Returned once by eToro.
 * @property {string | undefined} externalUserId  Flow B step 6. Used by flow C and events.
 */

/** @type {Map<string, Session>} */
const sessions = new Map();

// The link between a customer and eToro belongs to the partner's account, not to one
// browser session: signing out and back in must not lose the stored externalUserId.
/** @type {Map<string, Account>} */
const accounts = new Map();

export function getAccount(accountId) {
  let account = accounts.get(accountId);
  if (!account) {
    account = { id: accountId, userKey: undefined, externalUserId: undefined };
    accounts.set(accountId, account);
  }
  return account;
}

/** Opens a session after a successful code exchange and schedules its first refresh. */
export function createSession(accountId, tokens) {
  const session = {
    id: randomBytes(32).toString('base64url'),
    accountId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresInSeconds * 1000,
    refreshAttempts: 0,
    notice: undefined,
    timer: undefined,
  };
  sessions.set(session.id, session);
  scheduleRefresh(session, session.expiresAt - REFRESH_LEAD_MS - Date.now());
  return session;
}

export function getSession(sessionId) {
  return sessions.get(sessionId);
}

/**
 * Removes the session and stops its refresh timer. Returns the removed session so the
 * caller can revoke its refresh token, or undefined if there was none.
 */
export function removeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  clearTimeout(session.timer);
  sessions.delete(sessionId);
  return session;
}

// setTimeout fires at once for any delay above this (about 24.8 days), which would turn
// a long-lived access token into a refresh loop. Refreshing earlier is harmless.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function scheduleRefresh(session, delayMs) {
  clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    refreshSession(session.id).catch((err) => {
      console.warn(`[refresh] unexpected failure: ${err?.name ?? 'Error'}`);
    });
  }, Math.min(Math.max(delayMs, 0), MAX_TIMER_DELAY_MS));
  session.timer.unref();
}

async function refreshSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  const previousRefreshToken = session.refreshToken;

  let tokens;
  try {
    tokens = await refreshTokens(previousRefreshToken);
  } catch (err) {
    handleRefreshFailure(session, err);
    return;
  }

  if (!sessions.has(sessionId)) {
    // The customer signed out while the refresh was in flight. Do not keep the new token.
    await revokeQuietly(tokens.refreshToken);
    return;
  }

  // Store the new tokens first, then revoke the one they replace. If the revoke fails,
  // the new tokens still work, so the failure is only logged.
  session.accessToken = tokens.accessToken;
  session.refreshToken = tokens.refreshToken;
  session.expiresAt = Date.now() + tokens.expiresInSeconds * 1000;
  session.refreshAttempts = 0;
  scheduleRefresh(session, session.expiresAt - REFRESH_LEAD_MS - Date.now());
  await revokeQuietly(previousRefreshToken);
}

function handleRefreshFailure(session, err) {
  if (err instanceof EtoroCallError && err.oauthError === 'invalid_grant') {
    // The refresh token chain is broken: revoked, expired, or already used. Only now is
    // the customer asked to sign in again, on their next visit.
    console.info('[refresh] invalid_grant: session ended, the customer signs in again');
    removeSession(session.id);
    return;
  }

  session.refreshAttempts += 1;
  const expired = Date.now() >= session.expiresAt;
  if (session.refreshAttempts >= MAX_REFRESH_ATTEMPTS && expired) {
    console.warn(`[refresh] giving up after ${session.refreshAttempts} attempts: ${describe(err)}`);
    removeSession(session.id);
    return;
  }
  const delay = RETRY_DELAYS_MS[Math.min(session.refreshAttempts - 1, RETRY_DELAYS_MS.length - 1)];
  console.warn(`[refresh] attempt ${session.refreshAttempts} failed, retrying in ${delay / 1000}s: ${describe(err)}`);
  scheduleRefresh(session, delay);
}

/** Revokes a refresh token and logs, rather than throws, on failure. */
export async function revokeQuietly(refreshToken) {
  try {
    await revokeRefreshToken(refreshToken);
  } catch (err) {
    console.warn(`[revoke] ${describe(err)}`);
  }
}

function describe(err) {
  return err instanceof EtoroCallError ? err.message : (err?.code ?? err?.name ?? 'error');
}
