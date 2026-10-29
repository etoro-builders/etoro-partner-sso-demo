// Configuration for the demo, read once from environment variables.
//
// A real partner keeps these same values in its own configuration system.
// Addresses belong in normal configuration. The client secret and the application key
// belong in a vault. None of them ever goes into git, a browser, a URL, or a log line.
//
// This module never reports a value. It only reports the *names* of settings that are
// empty or invalid, so a page can say what is missing and stop instead of guessing.

function read(name) {
  return (process.env[name] ?? '').trim();
}

// Production addresses, as written in the eToro partner brief. They are only defaults.
//
// eToro gives you a separate set of hosts for testing. Testing and production have
// different hosts, keys, and tokens, and a token from one environment never works on
// another. So the hosts move together: if you set any of these variables, you must set
// all of them, from the same environment. A partial set stops every journey.
const PRODUCTION_HOSTS = Object.freeze({
  ETORO_AUTHORIZE_URL: 'https://www.etoro.com/sso/',
  ETORO_TOKEN_URL: 'https://www.etoro.com/api/sso/v1/token',
  ETORO_REVOKE_URL: 'https://www.etoro.com/api/sso/v1/token/revoke',
  ETORO_JWKS_URL: 'https://www.etoro.com/.well-known/jwks.json',
  ETORO_ISSUER: 'https://www.etoro.com',
  ETORO_SUB_ACCOUNTS_URL: 'https://public-api.etoro.com/api/v1/sub-accounts/me/accounts',
  ETORO_PARTNER_LOGIN_TOKEN_URL: 'https://www.etoro.com/api/sso/v2/silent-login/partner-login-token',
});

const HOST_NAMES = Object.keys(PRODUCTION_HOSTS);
const HOST_OVERRIDES = Object.fromEntries(HOST_NAMES.map((name) => [name, read(name)]));
const USING_HOST_OVERRIDES = HOST_NAMES.some((name) => HOST_OVERRIDES[name] !== '');
const HOSTS = USING_HOST_OVERRIDES ? HOST_OVERRIDES : PRODUCTION_HOSTS;

// DEMO APPLICATION. These defaults belong to eToro's own demo application on production,
// which only eToro's test account can sign in to. Put your own application's details here,
// or set the ETORO_CLIENT_ID, ETORO_REDIRECT_URI, and ETORO_FLOW_C_REDIRECT_URI variables.
// Change all three together: the callbacks must be the ones registered for that client id.
//
// The client secret has no default and never goes in code. It comes from the
// ETORO_CLIENT_SECRET variable, which a real partner fills from a vault.
const DEMO_APPLICATION = Object.freeze({
  ETORO_CLIENT_ID: '603b0448-e525-4a4d-8c23-50cd3d6d15fa',
  ETORO_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
  ETORO_FLOW_C_REDIRECT_URI: 'http://localhost:3000/api/auth/silent-login/callback',
});

// The remaining values have no default. eToro gives each of them to you, per environment.
// The user-key address and the partner-events address are never guessed: eToro sends
// them in writing, and this demo stops if they are empty.
const SETTINGS = Object.freeze({
  ETORO_CLIENT_ID: read('ETORO_CLIENT_ID') || DEMO_APPLICATION.ETORO_CLIENT_ID,
  ETORO_CLIENT_SECRET: read('ETORO_CLIENT_SECRET'),
  ETORO_REDIRECT_URI: read('ETORO_REDIRECT_URI') || DEMO_APPLICATION.ETORO_REDIRECT_URI,
  ETORO_FLOW_C_REDIRECT_URI: read('ETORO_FLOW_C_REDIRECT_URI') || DEMO_APPLICATION.ETORO_FLOW_C_REDIRECT_URI,
  ETORO_USER_KEY_URL: read('ETORO_USER_KEY_URL'),
  ETORO_APP_KEY: read('ETORO_APP_KEY'),
  ETORO_PROVIDER_NAME: read('ETORO_PROVIDER_NAME'),
  ETORO_INITIATE_PAGE_URL: read('ETORO_INITIATE_PAGE_URL'),
  ETORO_PARTNER_EVENTS_URL: read('ETORO_PARTNER_EVENTS_URL'),
  ETORO_EVENT_TYPE: read('ETORO_EVENT_TYPE'),
});

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
  // Flow B: flow A, then the user key and the sub-account.
  continueWithEtoro: [...SIGN_IN, 'ETORO_USER_KEY_URL', 'ETORO_APP_KEY', 'ETORO_PROVIDER_NAME'],
  // Flow C: the eToro initiate page, the flow C callback, and the machine token.
  openEtoro: ['ETORO_CLIENT_ID', 'ETORO_CLIENT_SECRET', 'ETORO_FLOW_C_REDIRECT_URI', 'ETORO_INITIATE_PAGE_URL'],
  // Optional partner events, only after flow B has stored the link.
  partnerEvent: ['ETORO_PARTNER_EVENTS_URL', 'ETORO_EVENT_TYPE'],
});

const JOURNEY_LABELS = Object.freeze({
  signIn: 'Sign in with eToro (flow A)',
  continueWithEtoro: 'Continue with eToro (flow B)',
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
  const emptyHosts = HOST_NAMES.filter((name) => !HOSTS[name]);
  if (emptyHosts.length) {
    problems.push(`${emptyHosts.join(', ')} (set every eToro host together, or none of them)`);
  }
  for (const name of HOST_NAMES) {
    if (HOSTS[name] && !isAbsoluteHttpUrl(HOSTS[name])) {
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
 * @param {'signIn' | 'continueWithEtoro' | 'openEtoro' | 'partnerEvent'} journey
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
  const lines = [
    USING_HOST_OVERRIDES
      ? 'eToro hosts: taken from the ETORO_*_URL and ETORO_ISSUER variables'
      : 'eToro hosts: production defaults from the partner brief',
  ];
  for (const journey of Object.keys(REQUIRED_BY_JOURNEY)) {
    const missing = missingSettings(journey);
    lines.push(`${JOURNEY_LABELS[journey]}: ${missing.length ? `missing ${missing.join(', ')}` : 'ready'}`);
  }
  return lines;
}

export const config = Object.freeze({
  port: Number(read('PORT')) || 3000,

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
