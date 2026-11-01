// Every call this server makes to eToro, one function per call, in the order of the
// partner brief. Step numbers below refer to that brief.
//
// Who calls: always this server, never the browser. Each call carries something the
// browser must never hold: the client secret, a customer token, a user key, or the
// application key.
//
// What is NOT here, on purpose:
// - The eToro login page (/sso/) is opened by the browser, not called from here.
// - The button inside eToro (flow B) belongs to eToro. eToro opens the landing page in
//   the browser; this server makes no call before that.
// - The flow C initiate page is opened by the browser, and eToro finishes the sign-in on
//   its own page after the browser reaches redirectUrl. This server never calls eToro's
//   verify step. It only works from the customer's browser.

import { randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from './config.js';

const REQUEST_TIMEOUT_MS = 10_000;

// Seconds of clock difference accepted when checking exp and iat.
const CLOCK_TOLERANCE_SECONDS = 120;

/**
 * A failed eToro call. The message holds only the call name, the HTTP status, and the
 * OAuth error code when eToro sends one (for example invalid_grant). It never holds a
 * token, a secret, or customer data, so it is safe to log.
 */
export class EtoroCallError extends Error {
  constructor(callName, status, oauthError) {
    super(`${callName} failed with status ${status}${oauthError ? ` (${oauthError})` : ''}`);
    this.name = 'EtoroCallError';
    this.callName = callName;
    this.status = status;
    this.oauthError = oauthError;
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function expectOk(callName, response) {
  const body = await readJson(response);
  if (!response.ok) {
    const oauthError = typeof body?.error === 'string' ? body.error : undefined;
    throw new EtoroCallError(callName, response.status, oauthError);
  }
  return body;
}

// Every outbound call goes to an address from config, never to one taken from a request.
// Redirects are refused so a request with credentials cannot be sent on to another host.
function send(url, init) {
  return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

// The token and revoke endpoints take a form body. URLSearchParams encodes each value
// exactly once, which is what eToro expects (redirect_uri shows %3A, never %253A).
function postForm(url, fields) {
  return send(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
}

function toTokenSet(callName, body, { expectIdToken }) {
  const expiresIn = Number(body?.expires_in);
  const valid =
    typeof body?.access_token === 'string' &&
    typeof body?.refresh_token === 'string' &&
    Number.isFinite(expiresIn) &&
    expiresIn > 0 &&
    (!expectIdToken || typeof body?.id_token === 'string');
  if (!valid) throw new Error(`${callName} returned an unexpected response body`);
  return {
    idToken: body.id_token,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresInSeconds: expiresIn,
  };
}

// --- Flow A: Sign in with eToro --------------------------------------------------------

/**
 * Flow A, step 1: the address the browser is sent to. This is not a server call.
 * The browser must navigate there itself (a 302 from our login route), because a fetch
 * would follow the redirects invisibly and the customer would never see the eToro page.
 *
 * Only scope=openid is requested. The demo adds no scope and asks for no new consent.
 */
export function buildAuthorizeUrl({ state, nonce, codeChallenge }) {
  const url = new URL(config.authorizeUrl); // ends in /sso/, checked in config.js
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * Flow A, step 3: swap the one-time code for tokens.
 *
 * Why the server: the call needs the client secret. redirect_uri must be the same value
 * as in step 1. code_verifier is the original, unhashed verifier from the PKCE cookie.
 * The client secret goes in the form body only. Do not also send an Authorization header.
 */
export async function exchangeCode({ code, codeVerifier }) {
  const response = await postForm(config.tokenUrl, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
    code,
    code_verifier: codeVerifier,
  });
  const body = await expectOk('code exchange', response);
  return toTokenSet('code exchange', body, { expectIdToken: true });
}

const jwksByUrl = new Map();

function jwks() {
  // jose fetches eToro's public keys on first use, caches them, and refetches when a
  // token arrives with a key id it has not seen.
  if (!jwksByUrl.has(config.jwksUrl)) {
    jwksByUrl.set(config.jwksUrl, createRemoteJWKSet(new URL(config.jwksUrl)));
  }
  return jwksByUrl.get(config.jwksUrl);
}

/**
 * Flow A, step 4: check the id_token before reading anything from it.
 *
 * jwtVerify checks the signature against eToro's keys first, then iss, aud, and exp.
 * No claim is trusted before the signature passes. iat must not be in the future.
 *
 * Returns `sub`: who signed in. Use it as the key for your own account record.
 * It is not externalUserId. That value comes from sub-account create in flow B.
 */
export async function validateIdToken(idToken, expectedNonce) {
  const { payload } = await jwtVerify(idToken, jwks(), {
    issuer: config.issuer,
    audience: config.clientId,
    algorithms: ['RS256'],
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
    requiredClaims: ['sub', 'iat', 'exp'],
  });
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.iat > nowSeconds + CLOCK_TOLERANCE_SECONDS) {
    throw new Error('id_token iat is in the future');
  }
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    throw new Error('id_token has no sub');
  }
  // The nonce must be the one this browser was sent with. Without this check an id_token
  // from another sign-in could be replayed into this one.
  if (typeof expectedNonce !== 'string' || expectedNonce === '' || payload.nonce !== expectedNonce) {
    throw new Error('id_token nonce does not match this sign-in');
  }
  return payload.sub;
}

/**
 * Flow A, step 6: get a new access token about a minute before the current one expires.
 * Each refresh returns a new refresh token. Store it before revoking the old one.
 * Only the server refreshes. The browser never calls the token endpoint.
 */
export async function refreshTokens(refreshToken) {
  const response = await postForm(config.tokenUrl, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const body = await expectOk('token refresh', response);
  return toTokenSet('token refresh', body, { expectIdToken: false });
}

/**
 * Flow A, steps 6 and 7: revoke a refresh token. Used on the token a refresh just
 * replaced, and on the current token when the customer signs out.
 */
export async function revokeRefreshToken(refreshToken) {
  const response = await postForm(config.revokeUrl, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    token: refreshToken,
  });
  await expectOk('token revoke', response);
}

// --- Flow B: A button inside eToro ------------------------------------------------------

/**
 * Flow B, step 4: turn the customer's access token into a user key for this customer.
 *
 * Use the access token from the code exchange (step 3). The address is the one eToro
 * gave you for this environment. The body is empty JSON. Do not add an IP list to the
 * body: your server IPs are registered with eToro once, for the whole application.
 *
 * The user key is returned once. Store it, encrypted in a real deployment.
 */
export async function mintUserKey(customerAccessToken) {
  const response = await send(config.userKeyUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${customerAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const body = await expectOk('user key', response);
  if (typeof body?.userKey !== 'string' || body.userKey === '') {
    throw new Error('user key response has no userKey');
  }
  return body.userKey;
}

/**
 * Flow B, step 5: find this customer's sub-account with your provider, if eToro already has one.
 *
 * eToro keeps one sub-account per customer and provider. Ask before you create one: the
 * customer may already be linked from another device, or from before your server lost its
 * record. Reusing that account's externalUserId keeps the customer on one sub-account.
 *
 * Same keys as the create call below, on the same address, with GET.
 *
 * @returns {Promise<{ externalUserId: string } | undefined>} undefined when there is none yet.
 */
export async function findSubAccount(userKey) {
  const response = await send(config.subAccountsUrl, {
    method: 'GET',
    headers: {
      'x-request-id': randomUUID(),
      'x-api-key': config.appKey,
      'x-user-key': userKey,
    },
  });
  const body = await expectOk('sub-account list', response);
  const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
  const account = accounts.find((candidate) => candidate?.providerName === config.providerName);
  if (!account) return undefined;
  if (typeof account.externalUserId !== 'string' || account.externalUserId === '') {
    throw new Error('sub-account list returned an account without externalUserId');
  }
  return { externalUserId: account.externalUserId };
}

/**
 * Flow B, step 6: create the customer's sub-account on the eToro public API. Call it only
 * after findSubAccount found none.
 *
 * Send the application key and this customer's user key. Do not also send
 * Authorization: Bearer on this request: use the two keys, or a bearer token, never both.
 * The call must come from one of the public IP addresses you registered with eToro.
 *
 * Outcomes, from the brief:
 * - 201: the link is stored. Keep account.externalUserId for every later call.
 * - 202: eToro is still processing. The link is not stored yet.
 * - 409: the link already exists, for example from a second sign-in at the same moment.
 *   Read it with findSubAccount. Never create another one.
 */
export async function createSubAccount(userKey) {
  const response = await send(config.subAccountsUrl, {
    method: 'POST',
    headers: {
      'x-request-id': randomUUID(),
      'x-api-key': config.appKey,
      'x-user-key': userKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ providerName: config.providerName, additionalParams: {} }),
  });
  const body = await readJson(response);
  if (response.status === 201) {
    const externalUserId = body?.account?.externalUserId;
    if (typeof externalUserId !== 'string' || externalUserId === '') {
      throw new Error('sub-account create returned 201 without account.externalUserId');
    }
    return { outcome: 'linked', externalUserId };
  }
  if (response.status === 202) return { outcome: 'processing' };
  if (response.status === 409) return { outcome: 'exists' };
  throw new EtoroCallError('sub-account create', response.status);
}

/**
 * Optional partner event. Only after the user key, the sub-account, and externalUserId
 * are saved. The address is the one eToro gave you; never guess the path.
 * A 202 means eToro accepted the event, not that processing has finished.
 */
export async function sendPartnerEvent(externalUserId) {
  const response = await send(config.partnerEventsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventMetadata: {
        externalUserId,
        correlationId: randomUUID(),
        eventType: config.eventType,
        createdAt: new Date().toISOString(),
      },
      eventData: {},
    }),
  });
  await expectOk('partner event', response);
}

// --- Flow C: Send your customer into eToro ----------------------------------------------

/**
 * Flow C, step 1: the eToro initiate page address the browser is sent to. Not a server
 * call. eToro's page places a short-lived cookie in the browser, then sends the browser
 * to our flow C callback with tid and state.
 */
export function buildInitiatePageUrl({ state }) {
  const url = new URL(config.initiatePageUrl);
  url.searchParams.set('fromClientId', config.clientId);
  url.searchParams.set('redirectUri', config.flowCRedirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * Flow C, step 3: a machine token. It identifies your application, not a customer.
 * Send the client secret in one place only: this form body, with no Authorization
 * header. Sending it twice returns invalid_request.
 */
export async function getMachineToken() {
  const response = await postForm(config.tokenUrl, {
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const body = await expectOk('machine token', response);
  if (typeof body?.access_token !== 'string' || body.access_token === '') {
    throw new Error('machine token response has no access_token');
  }
  return body.access_token;
}

/**
 * Flow C, step 4: ask eToro for the one-time link for this customer.
 *
 * Why the server: this is where the partner vouches for the customer, with its machine
 * token and the externalUserId it stored in flow B. Run it straight after the callback,
 * because tid lives only a few minutes.
 *
 * Returns redirectUrl. Send the browser there unchanged. Do not build that URL yourself,
 * and do not call eToro's verify step: eToro's page does that in the customer's browser.
 */
export async function mintPartnerLoginToken({ machineToken, tid, externalUserId }) {
  const response = await send(config.partnerLoginTokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${machineToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tid, externalUserId }),
  });
  const body = await expectOk('partner-login-token', response);
  const redirectUrl = body?.redirectUrl;
  // The eToro sign-in cookie from step 1 is a Secure cookie, so the eToro page that
  // reads it is always on https. Anything else is not a link we should send a customer to.
  if (typeof redirectUrl !== 'string' || !URL.canParse(redirectUrl) || new URL(redirectUrl).protocol !== 'https:') {
    throw new Error('partner-login-token returned no usable https redirectUrl');
  }
  return redirectUrl;
}
