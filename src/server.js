// The partner side of eToro sign-in, as one Express process.
//
// eToro already runs the login page, the button inside eToro, the initiate page, and the
// page that finishes flow C.
// This server owns only the partner's pages and routes:
//
//   Flow A  Sign in with eToro       GET /                    -> GET /api/auth/login
//                                     eToro /sso/              -> GET /api/auth/callback -> GET /connected
//   Flow B  A button inside eToro    GET /from-etoro          -> GET /api/auth/from-etoro
//                                     eToro /sso/              -> GET /api/auth/callback -> GET /connected
//   Flow C  Send into eToro          GET /api/auth/open-etoro -> eToro initiate page
//                                     GET /api/auth/silent-login/callback -> redirectUrl from eToro
//
// "Flow A/B/C" and step numbers refer to the eToro partner brief.
//
// Pattern B: this server creates PKCE, keeps the verifier in an HttpOnly cookie, and the
// browser follows normal links. The sign-in link, the callback, and the session cookie
// are on the same host, otherwise the callback would not receive the PKCE cookie.

import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, describeSetup, missingSettings } from './config.js';
import * as etoro from './etoro.js';
import * as pages from './pages.js';
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce.js';
import * as store from './session.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

// Short-lived cookies for one sign-in attempt. They are scoped to /api/auth, so only the
// routes that start and finish a sign-in receive them.
const PKCE_VERIFIER_COOKIE = 'etoro_pkce_verifier';
const PKCE_STATE_COOKIE = 'etoro_pkce_state';
const JOURNEY_COOKIE = 'etoro_journey';
const FLOW_C_STATE_COOKIE = 'etoro_flow_c_state';
const AUTH_COOKIE_PATH = '/api/auth';
const AUTH_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

// The only cookie that outlives a sign-in: an opaque id that maps to a server session.
const SESSION_COOKIE = 'app_session';
const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const JOURNEY_SIGN_IN = 'signIn';
const JOURNEY_CONTINUE = 'continueWithEtoro';
const JOURNEY_LINK = 'linkAccount';

// SameSite=Lax, never Strict: the eToro -> callback hop is a cross-site top-level
// navigation, and a Strict cookie would be dropped on it.
// Secure only when the request is HTTPS: on a plain-HTTP local run the browser would
// drop a Secure cookie, and the callback would have nothing to prove the login.
function authCookieOptions(req) {
  return { httpOnly: true, sameSite: 'lax', secure: req.secure, path: AUTH_COOKIE_PATH, maxAge: AUTH_COOKIE_MAX_AGE_MS };
}

function sessionCookieOptions(req) {
  return { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: SESSION_COOKIE_MAX_AGE_MS };
}

function clearAuthCookies(res, ...names) {
  for (const name of names) res.clearCookie(name, { path: AUTH_COOKIE_PATH });
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

function currentSession(req) {
  const id = req.cookies[SESSION_COOKIE];
  return isNonEmptyString(id) ? store.getSession(id) : undefined;
}

// Logs carry the call name, the HTTP status, and the OAuth error code only. Never a
// token, a secret, a user key, externalUserId, or customer details.
function describeError(err) {
  if (err instanceof etoro.EtoroCallError) return err.message;
  return err?.code ?? err?.name ?? 'error';
}

function sendMissing(res, title, names) {
  return res.status(500).send(pages.missingSettingsPage(title, names));
}

function sendMessage(res, status, title, message, options) {
  return res.status(status).send(pages.messagePage(title, message, options));
}

/** Ends a session on this server and revokes its refresh token at eToro. */
async function endSession(sessionId) {
  const session = store.removeSession(sessionId);
  if (session && config.clientId && config.clientSecret) {
    await store.revokeQuietly(session.refreshToken);
  }
}

const app = express();

// eToro accepts only HTTPS callback URLs, so a real run sits behind a TLS proxy. Trusting
// X-Forwarded-Proto from a proxy on a private network lets req.secure see HTTPS, and the
// cookies above get the Secure flag. Nothing here reads req.ip or req.hostname.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// Security headers. upgrade-insecure-requests is turned off so the stylesheet still loads
// on a plain-HTTP local run; every asset is same-origin, so it adds nothing here.
app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    setHeaders(res, filePath) {
      // icon.svg is the application icon registered with eToro. eToro's consent screen
      // loads it from another origin, which helmet's same-origin default would block.
      if (path.basename(filePath) === 'icon.svg') res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }),
);
app.use(cookieParser());
// Pages show signed-in state and the auth routes carry one-time values. Do not cache them.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// --- Pages ------------------------------------------------------------------------------

// Flow A, where the customer starts: the partner's own site with Sign in with eToro.
app.get('/', (req, res) => {
  res.send(pages.homePage());
});

// Flow B, step 1: the landing URL. eToro opens it in the browser after the customer clicks
// the button for this product inside eToro. Register this absolute URL with eToro as the
// landing URL. It is not the flow A callback, and it shows no login form. The page reads
// nothing from the request; it only offers Continue with eToro, which starts flow A.
app.get('/from-etoro', (req, res) => {
  res.send(pages.landingPage());
});

// Where flows A and B end. It says the account is connected and shows status words only.
app.get('/connected', (req, res) => {
  const session = currentSession(req);
  if (!session) return res.send(pages.signedOutPage());
  const account = store.getAccount(session.accountId);
  const notice = session.notice;
  session.notice = undefined;
  return res.send(
    pages.connectedPage({
      hasUserKey: Boolean(account.userKey),
      hasLink: Boolean(account.externalUserId),
      canSendEvent: Boolean(account.userKey && account.externalUserId),
      notice,
    }),
  );
});

// --- Flow A and flow B: start the sign-in -----------------------------------------------

// Flow A, step 1 (and flow B, step 2). Creates a fresh state and PKCE verifier, keeps
// both in HttpOnly cookies on this host, and answers 302 to eToro's login page.
//
// Why a 302 and not JSON: the browser must navigate to eToro itself. The page links here
// with <a href>, never fetch(), because fetch would follow the redirects invisibly.
function startSignIn(journey) {
  return (req, res) => {
    const title = journey === JOURNEY_CONTINUE ? 'Continue with eToro is not set up' : 'Sign in with eToro is not set up';
    const missing = missingSettings(journey);
    if (missing.length) return sendMissing(res, title, missing);

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const options = authCookieOptions(req);
    res.cookie(PKCE_VERIFIER_COOKIE, codeVerifier, options);
    res.cookie(PKCE_STATE_COOKIE, state, options);
    // Both journeys share one registered callback. This cookie tells the callback whether
    // the attempt came from the landing page, so it knows to run the flow B steps.
    res.cookie(JOURNEY_COOKIE, journey, options);

    return res.redirect(302, etoro.buildAuthorizeUrl({ state, codeChallenge: generateCodeChallenge(codeVerifier) }));
  };
}

// Flow A: the Sign in with eToro button on the home page.
app.get('/api/auth/login', startSignIn(JOURNEY_SIGN_IN));

// Flow B, step 2: the Continue with eToro button on the landing page. The customer is
// already signed in to eToro, so eToro shows no login form. Same parameters as flow A,
// including only scope=openid.
app.get('/api/auth/from-etoro', startSignIn(JOURNEY_CONTINUE));

// --- Flow A and flow B: the shared callback ---------------------------------------------

// Flow A, steps 2 to 5 (and flow B, step 3). eToro sends the browser here with code and
// state. Register this absolute URL with eToro, exactly as ETORO_REDIRECT_URI.
//
// Why state is checked first: it proves this response belongs to an attempt this browser
// started here. Without the check, another site could make the browser finish a login
// with an attacker's code (CSRF). The code is never sent to eToro before the check passes.
//
// Why the verifier comes from the cookie only: this is Pattern B. The browser never holds
// the verifier in script, and the route never accepts one from a request body.
app.get('/api/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const expectedState = req.cookies[PKCE_STATE_COOKIE];
  const codeVerifier = req.cookies[PKCE_VERIFIER_COOKIE];
  const journey = req.cookies[JOURNEY_COOKIE] === JOURNEY_CONTINUE ? JOURNEY_CONTINUE : JOURNEY_SIGN_IN;
  // One attempt, one use: clear the attempt cookies whatever happens next.
  clearAuthCookies(res, PKCE_VERIFIER_COOKIE, PKCE_STATE_COOKIE, JOURNEY_COOKIE);

  if (!isNonEmptyString(code) || !isNonEmptyString(state) || !isNonEmptyString(expectedState) || !isNonEmptyString(codeVerifier)) {
    return sendMessage(res, 400, 'Sign-in could not finish', 'This sign-in attempt has nothing saved to check it against. Start again.');
  }
  if (state !== expectedState) {
    return sendMessage(res, 400, 'Sign-in could not finish', 'The response does not match the sign-in this browser started. Start again.');
  }
  const missing = missingSettings(journey);
  if (missing.length) return sendMissing(res, 'Sign-in is not set up', missing);

  let tokens;
  let accountId;
  try {
    tokens = await etoro.exchangeCode({ code, codeVerifier });
    accountId = await etoro.validateIdToken(tokens.idToken);
  } catch (err) {
    console.warn(`[flow A] sign-in failed: ${describeError(err)}`);
    return sendMessage(res, 401, 'Sign-in could not finish', 'eToro did not complete the sign-in. Start again.');
  }

  // Flow A, step 5: open this site's own session. A new sign-in replaces an older one in
  // this browser, and the older refresh token is revoked.
  const previousSessionId = req.cookies[SESSION_COOKIE];
  if (isNonEmptyString(previousSessionId)) await endSession(previousSessionId);
  const session = store.createSession(accountId, tokens);

  if (journey === JOURNEY_CONTINUE) {
    const linkMissing = missingSettings(JOURNEY_LINK);
    if (linkMissing.length) {
      session.notice = `You are signed in. Linking your eToro account needs the partner setup from eToro, so it was skipped. Missing: ${linkMissing.join(', ')}.`;
    } else {
      await linkAccount(session, tokens.accessToken);
    }
  }

  res.cookie(SESSION_COOKIE, session.id, sessionCookieOptions(req));
  return res.redirect(302, '/connected');
});

// Flow B, steps 4 to 6, right after the code exchange. The customer stays signed in even
// if a step fails: the connected page shows a short notice and the log has the status.
//
// Why the access token from the code exchange: it is the token eToro issued to this
// application for this customer, which is what the user-key call expects.
async function linkAccount(session, customerAccessToken) {
  const account = store.getAccount(session.accountId);
  try {
    // A user key is returned once. Keep it, and do not mint another on every visit.
    if (!account.userKey) {
      account.userKey = await etoro.mintUserKey(customerAccessToken);
    }
    if (!account.externalUserId) {
      const result = await etoro.createSubAccount(account.userKey);
      if (result.outcome === 'linked') {
        account.externalUserId = result.externalUserId;
      } else if (result.outcome === 'processing') {
        session.notice = 'eToro is still processing your sub-account. The link is not stored yet. Use Continue with eToro again later.';
      } else {
        session.notice =
          'eToro already has a link for this customer, but this demo keeps links in memory and has no stored externalUserId to reuse.';
      }
    }
  } catch (err) {
    console.warn(`[flow B] ${describeError(err)}`);
    session.notice =
      err instanceof etoro.EtoroCallError && err.status === 403
        ? 'eToro rejected a call from this server\'s IP address. Send eToro the public IPv4 addresses your server calls from.'
        : 'Your account could not be linked yet. You are still signed in. Check the server log for the status code.';
  }
}

// --- Flow C: send the customer into eToro -----------------------------------------------

// Flow C, step 1. The customer is signed in here and this site has their externalUserId
// from flow B. Answers 302 to the eToro initiate page with client id, flow C callback, and
// a fresh state. eToro's page places its own short-lived cookie in the browser.
//
// Why this server does not call initiate itself: the eToro cookie must land in the
// customer's browser, and only eToro's page in that browser can place it.
app.get('/api/auth/open-etoro', (req, res) => {
  const session = currentSession(req);
  if (!session) return res.redirect(302, '/connected');
  const missing = missingSettings('openEtoro');
  if (missing.length) return sendMissing(res, 'Open eToro is not set up', missing);
  const account = store.getAccount(session.accountId);
  if (!account.externalUserId) {
    return sendMessage(res, 409, 'Open eToro needs a linked account', 'Use Continue with eToro first. It creates the sub-account link that Open eToro needs.', {
      backHref: '/connected',
      backLabel: 'Back to your account',
    });
  }

  const state = generateState();
  res.cookie(FLOW_C_STATE_COOKIE, state, authCookieOptions(req));
  return res.redirect(302, etoro.buildInitiatePageUrl({ state }));
});

// Flow C, steps 2 to 5. eToro sends the browser here with tid and state. Register this
// absolute URL with eToro, exactly as ETORO_FLOW_C_REDIRECT_URI.
//
// This route makes exactly two server calls, a machine token and partner-login-token,
// then sends the browser to the redirectUrl eToro returns. It never calls verify: verify
// runs on eToro's page, with the cookie that only the customer's browser holds.
// tid lives only a few minutes, so both calls run straight away.
app.get('/api/auth/silent-login/callback', async (req, res) => {
  const { tid, state } = req.query;
  const expectedState = req.cookies[FLOW_C_STATE_COOKIE];
  clearAuthCookies(res, FLOW_C_STATE_COOKIE);

  if (!isNonEmptyString(tid) || !isNonEmptyString(state) || !isNonEmptyString(expectedState) || state !== expectedState) {
    return sendMessage(res, 400, 'Could not open eToro', 'The response does not match the request this browser started. Start again.', {
      backHref: '/connected',
      backLabel: 'Back to your account',
    });
  }
  const session = currentSession(req);
  if (!session) {
    return sendMessage(res, 401, 'Could not open eToro', 'Sign in on this site first, then use Open eToro.');
  }
  const missing = missingSettings('openEtoro');
  if (missing.length) return sendMissing(res, 'Open eToro is not set up', missing);
  const account = store.getAccount(session.accountId);
  if (!account.externalUserId) {
    return sendMessage(res, 409, 'Open eToro needs a linked account', 'Use Continue with eToro first.', {
      backHref: '/connected',
      backLabel: 'Back to your account',
    });
  }

  try {
    const machineToken = await etoro.getMachineToken();
    const redirectUrl = await etoro.mintPartnerLoginToken({ machineToken, tid, externalUserId: account.externalUserId });
    return res.redirect(302, redirectUrl);
  } catch (err) {
    console.warn(`[flow C] ${describeError(err)}`);
    const message =
      err instanceof etoro.EtoroCallError && err.callName === 'partner-login-token' && err.status === 400
        ? 'eToro did not accept the stored link for this application. Use the externalUserId from flow B.'
        : 'eToro did not return a sign-in link. Try Open eToro again.';
    return sendMessage(res, 502, 'Could not open eToro', message, { backHref: '/connected', backLabel: 'Back to your account' });
  }
});

// --- Optional partner event -------------------------------------------------------------

// Only after flow B has saved the user key, the sub-account, and externalUserId. A POST
// form on the connected page triggers it, because it changes state at eToro.
app.post('/api/partner-event', async (req, res) => {
  const session = currentSession(req);
  if (!session) return res.redirect(303, '/connected');
  const account = store.getAccount(session.accountId);
  if (!account.userKey || !account.externalUserId) return res.redirect(303, '/connected');
  const missing = missingSettings('partnerEvent');
  if (missing.length) return sendMissing(res, 'Partner events are not set up', missing);

  try {
    await etoro.sendPartnerEvent(account.externalUserId);
    session.notice = 'eToro accepted the event. That does not mean processing has finished.';
  } catch (err) {
    console.warn(`[partner event] ${describeError(err)}`);
    session.notice = 'eToro did not accept the event. Check the server log for the status code.';
  }
  return res.redirect(303, '/connected');
});

// --- Sign out ---------------------------------------------------------------------------

// Flow A, step 7: revoke the current refresh token at eToro, then forget the session here.
app.get('/api/auth/logout', async (req, res) => {
  const sessionId = req.cookies[SESSION_COOKIE];
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  if (isNonEmptyString(sessionId)) await endSession(sessionId);
  return res.redirect(302, '/');
});

// --- Fallbacks --------------------------------------------------------------------------

app.use((req, res) => {
  sendMessage(res, 404, 'Page not found', 'This page is not part of the demo.');
});

// Express treats a handler as an error handler only when it takes four arguments.
app.use((err, req, res, next) => {
  console.error(`[server] ${describeError(err)}`);
  sendMessage(res, 500, 'Something went wrong', 'Start again from the home page.');
});

const server = app.listen(config.port, () => {
  console.log(`Partner demo listening on port ${config.port}`);
  for (const line of describeSetup()) console.log(`  ${line}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
