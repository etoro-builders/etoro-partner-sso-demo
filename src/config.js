// Configuration for the demo. Every value is written here, in the open, so you can see what
// the demo uses and where each value belongs in your own product.
//
// The values below belong to eToro's demo application. To try your own application, replace
// them with the values eToro gave you. Each value says where a real partner keeps it:
//   - normal configuration: addresses, ids, and names. Not secret, but kept per environment.
//   - vault: the client secret and the application key. Never in code, git, a browser, a URL,
//     or a log line.
//
// This module never reports a value. It only reports the *names* of settings that are
// empty or invalid, so a page can say what is missing and stop instead of guessing.

// SECRETS. eToro gives you both through the agreed secret channel. Keep them in your vault,
// and have your server read them from the vault when it starts.
//
// The demo reads them once, here, from
// environment variables of the machine that runs it, and Docker Compose passes them into the
// container. The secret of eToro's demo application is not published.
//
// Client secret: proves your server is yours. Flows A, B, and C.
const ETORO_CLIENT_SECRET = (process.env.ETORO_CLIENT_SECRET ?? '').trim();
// Application key (x-api-key): sent with every user key to the eToro public API. Flow B.
const ETORO_APP_KEY = (process.env.ETORO_APP_KEY ?? '').trim();

// The port the demo listens on. Docker Compose publishes it on the same port.
const PORT = 3000;

// eToro HOSTS. Production, as written in the eToro partner brief.
// Keep them in your normal configuration, one set per environment.
//
// eToro gives you a separate set of hosts for testing. Testing and production have different
// hosts, keys, and tokens, and a token from one environment never works on another. So the
// hosts move together: to use another environment, replace every line below with the hosts
// eToro gave you for that environment.
const HOSTS = Object.freeze({
  ETORO_AUTHORIZE_URL: 'https://www.etoro.com/sso/',
  ETORO_TOKEN_URL: 'https://www.etoro.com/api/sso/v1/token',
  ETORO_REVOKE_URL: 'https://www.etoro.com/api/sso/v1/token/revoke',
  ETORO_JWKS_URL: 'https://www.etoro.com/.well-known/jwks.json',
  ETORO_ISSUER: 'https://www.etoro.com',
  ETORO_SUB_ACCOUNTS_URL: 'https://public-api.etoro.com/api/v1/sub-accounts/me/accounts',
  ETORO_PARTNER_LOGIN_TOKEN_URL: 'https://www.etoro.com/api/sso/v2/silent-login/partner-login-token',
});

// YOUR APPLICATION. These values belong to eToro's demo application on production, which only
// eToro's test account can sign in to. Replace them with your own application's values.
// None of them is secret. Keep them in your normal configuration, per environment.
const APPLICATION = Object.freeze({
  // Application id (client_id). Identifies your product to eToro. Given by eToro in writing.
  ETORO_CLIENT_ID: '7e24a989-6069-4735-9bc5-16d75494fd96',

  // Your flow A callback, exactly as registered with eToro for this client id, character for
  // character. eToro accepts http only for localhost. Anywhere else it must be HTTPS, for
  // example https://your-app.example.com/api/auth/callback.
  ETORO_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',

  // Your flow C callback, exactly as registered with eToro for this client id. Anywhere but
  // localhost it must be HTTPS, for example https://your-app.example.com/api/auth/silent-login/callback.
  ETORO_FLOW_C_REDIRECT_URI: 'http://localhost:3000/api/auth/silent-login/callback',

  // Flow B: the user-key call address eToro gave you for this environment, in writing.
  // Never guessed. Flow B stops while it is empty.
  ETORO_USER_KEY_URL: '',

  // Flow B: the provider name eToro agreed with you for sub-account create.
  ETORO_PROVIDER_NAME: '',

  // Flow C: the eToro initiate page address eToro gave you for this environment, in writing.
  ETORO_INITIATE_PAGE_URL: '',

  // Optional: only if you agreed with eToro to report events. The partner-events call address
  // eToro gave you in writing, and the event type you agreed on.
  ETORO_PARTNER_EVENTS_URL: '',
  ETORO_EVENT_TYPE: '',
});

const SETTINGS = Object.freeze({ ...APPLICATION, ETORO_CLIENT_SECRET, ETORO_APP_KEY });

const HOST_NAMES = Object.keys(HOSTS);

const URL_SETTINGS = new Set([
  'ETORO_REDIRECT_URI',
  'ETORO_FLOW_C_REDIRECT_URI',
  'ETORO_USER_KEY_URL',
  'ETORO_INITIATE_PAGE_URL',
  'ETORO_PARTNER_EVENTS_URL',
]);

// What each journey needs before it may start.
const SIGN_IN = ['ETORO_CLIENT_ID', 'ETORO_CLIENT_SECRET', 'ETORO_REDIRECT_URI'];
const REQUIRED_BY_JOURNEY = Object.freeze({
  // Flow A: the login link, the callback, and the code exchange.
  signIn: SIGN_IN,
  // Flow B, the sign-in: the same login link, callback, and code exchange as flow A.
  continueWithEtoro: SIGN_IN,
  // Flow B, after the sign-in: the user key and the sub-account. eToro sets these up for a
  // partner. Without them, flow B still signs the customer in and skips the link.
  linkAccount: ['ETORO_USER_KEY_URL', 'ETORO_APP_KEY', 'ETORO_PROVIDER_NAME'],
  // Flow C: the eToro initiate page, the flow C callback, and the machine token.
  openEtoro: ['ETORO_CLIENT_ID', 'ETORO_CLIENT_SECRET', 'ETORO_FLOW_C_REDIRECT_URI', 'ETORO_INITIATE_PAGE_URL'],
  // Optional partner events, only after flow B has stored the link.
  partnerEvent: ['ETORO_PARTNER_EVENTS_URL', 'ETORO_EVENT_TYPE'],
});

const JOURNEY_LABELS = Object.freeze({
  signIn: 'Sign in with eToro (flow A)',
  continueWithEtoro: 'Continue with eToro (flow B)',
  linkAccount: 'Link the eToro account (flow B)',
  openEtoro: 'Open eToro (flow C)',
  partnerEvent: 'Partner event (optional)',
});

function isAbsoluteHttpUrl(value) {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === 'https:' || protocol === 'http:';
}

function hostProblems() {
  const problems = [];
  for (const name of HOST_NAMES) {
    if (!HOSTS[name]) {
      problems.push(name);
    } else if (!isAbsoluteHttpUrl(HOSTS[name])) {
      problems.push(`${name} (not an absolute URL)`);
    }
  }
  // Without the trailing slash, eToro redirects and encodes the query a second time,
  // and the login page shows a generic error.
  if (HOSTS.ETORO_AUTHORIZE_URL && !HOSTS.ETORO_AUTHORIZE_URL.endsWith('/sso/')) {
    problems.push('ETORO_AUTHORIZE_URL (must end in /sso/)');
  }
  return problems;
}

/**
 * Names of the settings that stop a journey, or an empty list when it may start.
 * @param {'signIn' | 'continueWithEtoro' | 'linkAccount' | 'openEtoro' | 'partnerEvent'} journey
 * @returns {string[]}
 */
export function missingSettings(journey) {
  const problems = hostProblems();
  for (const name of REQUIRED_BY_JOURNEY[journey]) {
    const value = SETTINGS[name];
    if (!value) {
      problems.push(name);
    } else if (URL_SETTINGS.has(name) && !isAbsoluteHttpUrl(value)) {
      problems.push(`${name} (not an absolute URL)`);
    }
  }
  return problems;
}

/** Lines for the startup log. Names only, never values. */
export function describeSetup() {
  const lines = [];
  for (const journey of Object.keys(REQUIRED_BY_JOURNEY)) {
    const missing = missingSettings(journey);
    lines.push(`${JOURNEY_LABELS[journey]}: ${missing.length ? `missing ${missing.join(', ')}` : 'ready'}`);
  }
  return lines;
}

export const config = Object.freeze({
  port: PORT,

  clientId: SETTINGS.ETORO_CLIENT_ID,
  clientSecret: SETTINGS.ETORO_CLIENT_SECRET,
  appKey: SETTINGS.ETORO_APP_KEY,

  redirectUri: SETTINGS.ETORO_REDIRECT_URI,
  flowCRedirectUri: SETTINGS.ETORO_FLOW_C_REDIRECT_URI,
  userKeyUrl: SETTINGS.ETORO_USER_KEY_URL,
  providerName: SETTINGS.ETORO_PROVIDER_NAME,
  initiatePageUrl: SETTINGS.ETORO_INITIATE_PAGE_URL,
  partnerEventsUrl: SETTINGS.ETORO_PARTNER_EVENTS_URL,
  eventType: SETTINGS.ETORO_EVENT_TYPE,

  authorizeUrl: HOSTS.ETORO_AUTHORIZE_URL,
  tokenUrl: HOSTS.ETORO_TOKEN_URL,
  revokeUrl: HOSTS.ETORO_REVOKE_URL,
  jwksUrl: HOSTS.ETORO_JWKS_URL,
  issuer: HOSTS.ETORO_ISSUER,
  subAccountsUrl: HOSTS.ETORO_SUB_ACCOUNTS_URL,
  partnerLoginTokenUrl: HOSTS.ETORO_PARTNER_LOGIN_TOKEN_URL,
});
