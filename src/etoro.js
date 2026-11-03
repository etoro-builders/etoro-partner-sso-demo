// Copyright 2026 etoro Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
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

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readJson(response) {
  return parseJson(await response.text());
}

async function expectOk(callName, response) {
  const text = await response.text();
  const body = parseJson(text);
  if (!response.ok) {
    const oauthError = typeof body?.error === 'string' ? body.error : undefined;
    // Temporary diagnostic: a 5xx is eToro's own infra failing, so the body is a gateway
    // error page or similar, never customer data. Logging a short snippet helps tell a
    // real upstream outage apart from a request we built wrong.
    if (response.status >= 500 && text) {
      console.warn(`[market] ${callName} ${response.status} body: ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
    }
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
 * The create response does not contain externalUserId. After a 201 or a 409, read it
 * with findSubAccount.
 *
 * Outcomes, from the brief:
 * - 201: the sub-account is created.
 * - 202: eToro is still processing. The link is not stored yet.
 * - 409: the sub-account already exists, for example from a second sign-in at the same
 *   moment. Never create another one.
 *
 * @returns {Promise<'created' | 'processing' | 'exists'>}
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
  // Read the body so the connection is released; nothing in it is needed.
  await readJson(response);
  if (response.status === 201) return 'created';
  if (response.status === 202) return 'processing';
  if (response.status === 409) return 'exists';
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
 *
 * The page reads only these three names, in snake case like the login link. The names
 * fromClientId and redirectUri belong to the call the page makes, not to the page.
 */
export function buildInitiatePageUrl({ state }) {
  const url = new URL(config.initiatePageUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.flowCRedirectUri);
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

// --- After sign-in: the partner's own view of the real account -------------------------

/**
 * The real portfolio, for the connected page. One read, with the user key saved in flow B
 * and the application key. The browser never calls this.
 *
 * Returns a small summary: available cash, open profit and loss, up to five positions,
 * up to five pending orders, and up to four copy relationships. A 401 or 403 is a result,
 * not a failure of sign-in: the application is not allowed to read the real account.
 * Names that cannot be resolved stay as "Instrument" plus the id. Customer ids are not
 * copied into the summary.
 *
 * @param {string} userKey
 * @returns {Promise<{ status: 'ok', credit: number | null, pnl: number | null, openCount: number,
 *   positions: { name: string, side: string, pnl: number | null }[],
 *   orders: { name: string, side: string, amount: number | null, leverage: number | null, kind: string }[],
 *   copies: { name: string, invested: number | null, closedPnl: number | null, paused: boolean }[]
 * } | { status: 'forbidden' }>}
 */
export async function readRealPortfolio(userKey) {
  const headers = {
    'x-request-id': randomUUID(),
    'x-api-key': config.appKey,
    'x-user-key': userKey,
  };
  const url = new URL('/api/v1/trading/info/real/pnl', config.subAccountsUrl);
  const response = await send(url, { method: 'GET', headers });
  if (response.status === 401 || response.status === 403) {
    await readJson(response);
    console.warn(`[portfolio] portfolio failed with status ${response.status}`);
    return { status: 'forbidden' };
  }
  const body = await expectOk('portfolio', response);
  const portfolio = body?.clientPortfolio ?? {};
  const listed = listedPositions(portfolio)
    .map((position) => ({
      instrumentId: position.instrumentID,
      side: `${position.isCopy ? 'Copy · ' : ''}${position.isBuy === false ? 'Sell' : 'Buy'}`,
      pnl: typeof position.unrealizedPnL?.pnL === 'number' ? position.unrealizedPnL.pnL : null,
    }))
    .filter((position) => Number.isInteger(position.instrumentId))
    .sort((a, b) => Math.abs(b.pnl ?? 0) - Math.abs(a.pnl ?? 0));
  const shown = listed.slice(0, 5);
  const orders = listedOrders(portfolio);
  const names = await instrumentNames(
    [...shown.map((position) => position.instrumentId), ...orders.map((order) => order.instrumentId)],
    headers,
  );
  const nameOf = (instrumentId) => names.get(instrumentId) ?? `Instrument ${instrumentId}`;
  return {
    status: 'ok',
    credit: typeof portfolio.credit === 'number' ? portfolio.credit : null,
    pnl: typeof portfolio.unrealizedPnL === 'number' ? portfolio.unrealizedPnL : null,
    openCount: listed.length,
    positions: shown.map((position) => ({
      name: nameOf(position.instrumentId),
      side: position.side,
      pnl: position.pnl,
    })),
    orders: orders.map((order) => ({
      name: nameOf(order.instrumentId),
      side: order.side,
      amount: order.amount,
      leverage: order.leverage,
      kind: order.kind,
    })),
    copies: listedCopies(portfolio),
    held: heldInstruments(listed),
  };
}

function heldInstruments(listed) {
  const byId = new Map();
  for (const position of listed) {
    const current = byId.get(position.instrumentId);
    if (!current || Math.abs(position.pnl ?? 0) > Math.abs(current.pnl ?? 0)) {
      byId.set(position.instrumentId, {
        id: position.instrumentId,
        pnl: position.pnl,
        side: typeof position.side === 'string' ? position.side : '',
      });
    }
  }
  return [...byId.values()];
}

function listedOrders(portfolio) {
  const rows = [];
  const take = (list, kind) => {
    for (const order of Array.isArray(list) ? list : []) {
      const instrumentId = order?.instrumentId ?? order?.instrumentID;
      if (!Number.isInteger(instrumentId)) continue;
      rows.push({
        instrumentId,
        side: order.isBuy === false ? 'Sell' : 'Buy',
        amount: typeof order.amount === 'number' ? order.amount : null,
        leverage: Number.isInteger(order.leverage) ? order.leverage : null,
        kind,
      });
    }
  };
  take(portfolio.orders, 'Limit');
  take(portfolio.ordersForOpen, 'Opening');
  return rows.slice(0, 5);
}

function listedCopies(portfolio) {
  const mirrors = Array.isArray(portfolio.mirrors) ? portfolio.mirrors : [];
  return mirrors.slice(0, 4).map((mirror) => ({
    name: typeof mirror?.parentUsername === 'string' && mirror.parentUsername !== ''
      ? mirror.parentUsername
      : 'Trader',
    invested: typeof mirror?.initialInvestment === 'number' ? mirror.initialInvestment : null,
    closedPnl: typeof mirror?.closedPositionsNetProfit === 'number' ? mirror.closedPositionsNetProfit : null,
    paused: mirror?.isPaused === true,
  }));
}

function listedPositions(portfolio) {
  const own = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  const copied = (Array.isArray(portfolio.mirrors) ? portfolio.mirrors : []).flatMap((mirror) =>
    (Array.isArray(mirror?.positions) ? mirror.positions : []).map((position) => ({
      ...position,
      isCopy: true,
    })),
  );
  return [...own, ...copied];
}

async function instrumentNames(ids, headers) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const url = new URL('/api/v1/market-data/instruments', config.subAccountsUrl);
  url.searchParams.set('instrumentIds', unique.join(','));
  try {
    const response = await send(url, {
      method: 'GET',
      headers: { ...headers, 'x-request-id': randomUUID() },
    });
    const body = await expectOk('instruments', response);
    const items = Array.isArray(body?.instrumentDisplayDatas) ? body.instrumentDisplayDatas : [];
    const names = new Map();
    for (const item of items) {
      const name = item?.instrumentDisplayName || item?.symbolFull;
      if (Number.isInteger(item?.instrumentID) && typeof name === 'string' && name !== '') {
        names.set(item.instrumentID, name);
      }
    }
    return names;
  } catch (err) {
    console.warn(`[portfolio] instrument names: ${err instanceof EtoroCallError ? err.message : 'unavailable'}`);
    return new Map();
  }
}

// --- The Edge-style board: watchlist, chart, quote. No orders are sent. ---------------

const FALLBACK_QUERIES = ['AAPL', 'BTC', 'ETH', 'TSLA', 'SPX500', 'EURUSD', 'GOLD', 'NVDA'];

function marketHeaders(userKey) {
  return {
    'x-request-id': randomUUID(),
    'x-api-key': config.appKey,
    'x-user-key': userKey,
  };
}

async function marketGet(userKey, url, callName) {
  const response = await send(url, { method: 'GET', headers: marketHeaders(userKey) });
  return expectOk(callName, response);
}

/**
 * Watchlist, prices, and an hourly chart for the connected page.
 * A missing watchlist falls back to a short list of markets. A 401 or 403 from every
 * source is `forbidden`. Customer ids are not copied out.
 *
 * @param {string} userKey
 * @param {number | undefined} selectedId
 */
export async function readMarketBoard(userKey, selectedId) {
  let blocked = false;
  let throttled = false;
  const noteBlock = (err) => {
    if (err instanceof EtoroCallError && (err.status === 401 || err.status === 403)) blocked = true;
    if (err instanceof EtoroCallError && err.status === 429) throttled = true;
  };

  let instruments = [];
  let source = 'Markets';
  try {
    instruments = await loadWatchlist(userKey);
    if (instruments.length) source = 'My watchlist';
  } catch (err) {
    noteBlock(err);
    console.warn(`[market] watchlist: ${err instanceof EtoroCallError ? err.message : 'unavailable'}`);
  }
  if (!instruments.length) {
    try {
      instruments = await loadFallbackMarkets(userKey);
    } catch (err) {
      noteBlock(err);
      console.warn(`[market] search: ${err instanceof EtoroCallError ? err.message : 'unavailable'}`);
    }
  }
  if (!instruments.length) return { status: blocked ? 'forbidden' : 'unavailable' };

  instruments = instruments.slice(0, 10);
  const ids = instruments.map((item) => item.id);
  const selected = ids.includes(selectedId) ? selectedId : ids[0];

  const [rates, candles, dailyChanges] = await Promise.all([
    loadRates(userKey, ids).catch((err) => {
      noteBlock(err);
      console.warn(`[market] rates: ${err instanceof EtoroCallError ? err.message : 'unavailable'}`);
      return new Map();
    }),
    loadCandles(userKey, selected, 'OneHour', 48).catch((err) => {
      noteBlock(err);
      console.warn(`[market] candles: ${err instanceof EtoroCallError ? err.message : 'unavailable'}`);
      return [];
    }),
    loadDayChangeFallback(userKey, ids).catch((err) => {
      noteBlock(err);
      console.warn(`[market] day change: ${err instanceof EtoroCallError ? err.message : 'unavailable'}`);
      return new Map();
    }),
  ]);

  if (blocked && rates.size === 0 && candles.length === 0) return { status: 'forbidden' };

  // Daily candles are the primary day-change source. The bulk closing-price call is only
  // used when those candles come back empty, because that history route is returning 502
  // from eToro's own gateway on staging.
  const closes = dailyChanges.size === 0
    ? await loadPreviousCloses(userKey).catch((err) => {
      noteBlock(err);
      console.warn(`[market] closing prices: ${err instanceof EtoroCallError ? err.message : 'unavailable'}`);
      return new Map();
    })
    : new Map();

  const items = instruments.map((item) => {
    const rate = rates.get(item.id);
    const price = rate?.bid ?? rate?.ask;
    return {
      id: item.id,
      symbol: item.symbol,
      name: item.name,
      bid: rate?.bid ?? null,
      ask: rate?.ask ?? null,
      changePct: dailyChanges.get(item.id) ?? dayChange(closes.get(item.id), price) ?? null,
    };
  });
  return {
    status: 'ok',
    throttled,
    source,
    selectedId: selected,
    items,
    candles,
    quote: items.find((item) => item.id === selected) ?? items[0],
  };
}

/**
 * One market, so choosing a symbol updates the chart without rebuilding the page.
 * A 401 or 403 is `forbidden`. Customer ids are not copied out.
 * @param {string} userKey
 * @param {number} instrumentId
 */
export async function readInstrumentQuote(userKey, instrumentId) {
  try {
    const [briefs, rates, candles, closes] = await Promise.all([
      instrumentBriefs(userKey, [instrumentId]).catch(() => new Map()),
      loadRates(userKey, [instrumentId]),
      loadCandles(userKey, instrumentId, 'OneHour', 48).catch((err) => {
        if (err instanceof EtoroCallError && (err.status === 401 || err.status === 403)) throw err;
        return [];
      }),
      loadPreviousCloses(userKey).catch(() => new Map()),
    ]);
    const brief = briefs.get(instrumentId);
    const rate = rates.get(instrumentId);
    return {
      status: 'ok',
      id: instrumentId,
      symbol: brief?.symbol ?? String(instrumentId),
      name: brief?.name ?? `Instrument ${instrumentId}`,
      bid: rate?.bid ?? null,
      ask: rate?.ask ?? null,
      changePct: dayChange(closes.get(instrumentId), rate?.bid ?? rate?.ask) ?? dayChangeFromHourly(candles),
      candles,
    };
  } catch (err) {
    if (err instanceof EtoroCallError && (err.status === 401 || err.status === 403)) return { status: 'forbidden' };
    throw err;
  }
}

/**
 * Tiles for the heatmap: the user's watchlist plus open positions, drawn once.
 * The fallback market list is not included. Four or fewer instruments draw nothing.
 * Customer ids are not copied out.
 * @param {string} userKey
 * @param {{ id: number, symbol?: string, name?: string, changePct?: number | null }[]} watchItems
 * @param {{ id: number, pnl?: number | null }[]} held
 */
export async function readHeatmap(userKey, watchItems, held) {
  const byId = new Map();
  for (const item of Array.isArray(watchItems) ? watchItems : []) {
    if (!Number.isInteger(item?.id)) continue;
    byId.set(item.id, {
      id: item.id,
      symbol: typeof item.symbol === 'string' ? item.symbol : '',
      name: typeof item.name === 'string' ? item.name : '',
      changePct: typeof item.changePct === 'number' ? item.changePct : null,
      bid: typeof item.bid === 'number' ? item.bid : null,
      ask: typeof item.ask === 'number' ? item.ask : null,
      pnl: null,
      side: '',
      attempted: true,
    });
  }
  for (const position of Array.isArray(held) ? held : []) {
    if (!Number.isInteger(position?.id)) continue;
    const existing = byId.get(position.id);
    if (existing) {
      existing.pnl = typeof position.pnl === 'number' ? position.pnl : null;
      existing.side = typeof position.side === 'string' ? position.side : '';
      continue;
    }
    byId.set(position.id, {
      id: position.id,
      symbol: '',
      name: '',
      changePct: null,
      bid: null,
      ask: null,
      pnl: typeof position.pnl === 'number' ? position.pnl : null,
      side: typeof position.side === 'string' ? position.side : '',
    });
  }
  if (byId.size <= 4) return [];

  let tiles = [...byId.values()];
  if (tiles.length > 16) {
    tiles.sort((a, b) => {
      const named = (tile) => (tile.symbol ? 1 : 0);
      const rank = named(b) - named(a);
      if (rank !== 0) return rank;
      return Math.abs(b.pnl ?? 0) - Math.abs(a.pnl ?? 0);
    });
    tiles = tiles.slice(0, 16);
  }

  // Watchlist tiles were already asked for in readMarketBoard. Asking again only doubles
  // the calls that eToro throttles, so only positions outside the watchlist are fetched.
  const needChange = tiles.filter((tile) => !tile.attempted && tile.changePct == null).map((tile) => tile.id);
  const needName = tiles.filter((tile) => tile.symbol === '').map((tile) => tile.id);
  const needRate = tiles.filter((tile) => !tile.attempted && tile.bid == null && tile.ask == null).map((tile) => tile.id);
  const [briefs, rates, fallbackChanges] = await Promise.all([
    needName.length ? instrumentBriefs(userKey, needName).catch(() => new Map()) : Promise.resolve(new Map()),
    needRate.length ? loadRates(userKey, needRate).catch(() => new Map()) : Promise.resolve(new Map()),
    needChange.length ? loadDayChangeFallback(userKey, needChange).catch(() => new Map()) : Promise.resolve(new Map()),
  ]);

  const stillMissing = needChange.filter((id) => !fallbackChanges.has(id));
  const closes = stillMissing.length
    ? await loadPreviousCloses(userKey).catch(() => new Map())
    : new Map();

  const drawn = [];
  for (const tile of tiles) {
    const brief = briefs.get(tile.id);
    const rate = rates.get(tile.id);
    const price = tile.bid ?? tile.ask ?? rate?.bid ?? rate?.ask;
    const changePct = tile.changePct ?? dayChange(closes.get(tile.id), price) ?? fallbackChanges.get(tile.id) ?? null;
    if (typeof changePct !== 'number') continue;
    drawn.push({
      id: tile.id,
      symbol: tile.symbol || brief?.symbol || String(tile.id),
      name: tile.name || brief?.name || `Instrument ${tile.id}`,
      changePct,
      bid: tile.bid ?? rate?.bid ?? null,
      ask: tile.ask ?? rate?.ask ?? null,
      pnl: typeof tile.pnl === 'number' ? tile.pnl : null,
      side: typeof tile.side === 'string' ? tile.side : '',
    });
  }
  return drawn.length > 4 ? drawn : [];
}

async function loadWatchlist(userKey) {
  const url = new URL('/api/v1/watchlists', config.subAccountsUrl);
  const body = await marketGet(userKey, url, 'watchlists');
  const lists = Array.isArray(body?.watchlists) ? body.watchlists : [];
  const list = lists.find((item) => item?.isUserSelectedDefault && item.items?.length)
    ?? lists.find((item) => Array.isArray(item?.items) && item.items.length);
  const ids = (list?.items ?? [])
    .filter((item) => !item?.itemType || item.itemType === 'Instrument')
    .map((item) => item?.itemId)
    .filter((id) => Number.isInteger(id))
    .slice(0, 10);
  if (!ids.length) return [];
  const briefs = await instrumentBriefs(userKey, ids);
  if (!briefs.size && ids.length) {
    return ids.map((id) => ({ id, symbol: String(id), name: `Instrument ${id}` }));
  }
  return ids.map((id) => briefs.get(id) ?? { id, symbol: String(id), name: `Instrument ${id}` });
}

async function loadFallbackMarkets(userKey) {
  const found = await Promise.all(FALLBACK_QUERIES.map((query) => searchOne(userKey, query).catch(() => null)));
  const seen = new Set();
  const items = [];
  for (const item of found) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

async function searchOne(userKey, query) {
  const url = new URL('/api/v2/market-data/instruments/search', config.subAccountsUrl);
  url.searchParams.set('query', query);
  url.searchParams.set('limit', '1');
  const body = await marketGet(userKey, url, 'search');
  const item = Array.isArray(body?.results) ? body.results[0] : undefined;
  if (!Number.isInteger(item?.instrumentId)) return null;
  const symbol = typeof item.symbol === 'string' && item.symbol !== '' ? item.symbol : query;
  const name = typeof item.displayName === 'string' && item.displayName !== '' ? item.displayName : symbol;
  return { id: item.instrumentId, symbol, name };
}

async function instrumentBriefs(userKey, ids) {
  const url = new URL('/api/v1/market-data/instruments', config.subAccountsUrl);
  url.searchParams.set('instrumentIds', [...new Set(ids)].join(','));
  const body = await marketGet(userKey, url, 'instruments');
  const rows = Array.isArray(body?.instrumentDisplayDatas) ? body.instrumentDisplayDatas : [];
  const briefs = new Map();
  for (const row of rows) {
    if (!Number.isInteger(row?.instrumentID)) continue;
    const name = row.instrumentDisplayName || row.symbolFull || `Instrument ${row.instrumentID}`;
    const symbol = row.symbolFull || name;
    briefs.set(row.instrumentID, { id: row.instrumentID, symbol, name });
  }
  return briefs;
}

async function loadRates(userKey, ids) {
  const url = new URL('/api/v1/market-data/instruments/rates', config.subAccountsUrl);
  url.searchParams.set('instrumentIds', ids.join(','));
  const body = await marketGet(userKey, url, 'rates');
  const rates = new Map();
  for (const rate of Array.isArray(body?.rates) ? body.rates : []) {
    if (!Number.isInteger(rate?.instrumentID)) continue;
    rates.set(rate.instrumentID, {
      bid: typeof rate.bid === 'number' ? rate.bid : null,
      ask: typeof rate.ask === 'number' ? rate.ask : null,
    });
  }
  return rates;
}

const DATA_INTERVAL = { OneHour: '1h', OneDay: '1d' };

function asPrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toCandles(points) {
  return points
    .map((point) => ({
      open: asPrice(point?.open),
      high: asPrice(point?.high),
      low: asPrice(point?.low),
      close: asPrice(point?.close),
    }))
    .filter((point) => [point.open, point.high, point.low, point.close].every((value) => typeof value === 'number'));
}

async function loadCandles(userKey, instrumentId, interval, count) {
  const mapped = DATA_INTERVAL[interval];
  if (mapped) {
    try {
      const url = new URL(`/api/v1/data/instruments/${instrumentId}/candles`, config.subAccountsUrl);
      url.searchParams.set('interval', mapped);
      url.searchParams.set('limit', String(count));
      url.searchParams.set('side', 'bid');
      const body = await marketGet(userKey, url, 'price candles');
      const rows = Array.isArray(body?.results) ? body.results : [];
      const points = toCandles([...rows].reverse());
      if (points.length) return points;
    } catch (err) {
      if (err instanceof EtoroCallError && (err.status === 401 || err.status === 403)) throw err;
      console.warn(`[market] price candles: ${err instanceof EtoroCallError ? err.message : 'unavailable'}`);
    }
  }

  const url = new URL(
    `/api/v1/market-data/instruments/${instrumentId}/history/candles/asc/${interval}/${count}`,
    config.subAccountsUrl,
  );
  const body = await marketGet(userKey, url, 'candles');
  const groups = Array.isArray(body?.candles) ? body.candles : [];
  const points = Array.isArray(groups[0]?.candles) ? groups[0].candles : [];
  return toCandles(points);
}

function dayChange(previousClose, price) {
  if (typeof previousClose !== 'number' || previousClose <= 0) return null;
  if (typeof price !== 'number' || !Number.isFinite(price)) return null;
  return ((price - previousClose) / previousClose) * 100;
}

// Free: the chart already loaded 48 hourly candles (two days). Reuses them instead of an
// extra call. ~24 candles back approximates the previous close.
function dayChangeFromHourly(candles) {
  if (!Array.isArray(candles) || candles.length < 2) return null;
  const last = candles[candles.length - 1]?.close;
  if (typeof last !== 'number') return null;
  const back = Math.max(candles.length - 25, 0);
  const prior = candles[back]?.close;
  return dayChange(prior, last);
}

// Fallback only: one OneDay-candle call per instrument, used solely when the single bulk
// closing-price call fails outright. Callers cap `ids` (10 for the watchlist, 16 for the
// heat map) so a flaky bulk endpoint cannot turn back into one call per instrument always.
async function loadDayChangeFallback(userKey, ids, onError) {
  const pairs = await Promise.all(ids.map(async (id) => {
    try {
      const candles = await loadCandles(userKey, id, 'OneDay', 2);
      if (candles.length < 2 || !candles[0].close) return [id, null];
      return [id, dayChange(candles[0].close, candles[candles.length - 1].close)];
    } catch (err) {
      if (typeof onError === 'function') onError(err);
      return [id, null];
    }
  }));
  return new Map(pairs.filter((pair) => typeof pair[1] === 'number'));
}

// One call returns the previous close for every instrument. Kept briefly so the heat map
// and a symbol click do not download it again.
const previousCloseCache = new Map();
const PREVIOUS_CLOSE_MS = 30_000;

async function loadPreviousCloses(userKey) {
  const hit = previousCloseCache.get(userKey);
  if (hit && Date.now() - hit.at < PREVIOUS_CLOSE_MS) return hit.closes;
  const url = new URL('/api/v1/market-data/instruments/history/closing-price', config.subAccountsUrl);
  const body = await marketGet(userKey, url, 'closing prices');
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(body?.items)
      ? body.items
      : [];
  const closes = new Map();
  for (const row of rows) {
    const id = row?.instrumentId ?? row?.instrumentID;
    const price = row?.closingPrices?.daily?.price;
    if (!Number.isInteger(id) || typeof price !== 'number' || price <= 0) continue;
    closes.set(id, price);
  }
  previousCloseCache.set(userKey, { at: Date.now(), closes });
  return closes;
}
