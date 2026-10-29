// HTML for every page the partner owns in this demo.
//
// The pages carry no scripts. Every sign-in control is a plain <a href> link, so the
// browser itself follows the redirect chain to eToro and back, and applies each cookie
// along the way. Starting a sign-in with fetch() would follow the redirects invisibly
// and the customer would never see the eToro page.
//
// The pages never show a token, the id_token `sub`, externalUserId, a user key, an email
// address, or a name. The connected page shows status words only.
//
// Every value placed in the HTML goes through escapeHtml.

const BRAND = 'Example Partner';

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function htmlDocument(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - ${escapeHtml(BRAND)}</title>
<link rel="stylesheet" href="/demo.css">
</head>
<body>
${body}
</body>
</html>`;
}

function brand() {
  return `<div class="brand"><span class="logo" aria-hidden="true">P</span>${escapeHtml(BRAND)}</div>`;
}

function navLink(href, label, active) {
  return `<a${active ? ' class="active" aria-current="page"' : ''} href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

// The partner's own site: a left rail with the two journeys the customer can start from.
function withRail(title, active, main) {
  return htmlDocument(
    title,
    `<div class="shell">
  <aside>
    ${brand()}
    <nav>
      ${navLink('/', 'Sign in with eToro', active === 'home')}
      ${navLink('/from-etoro', 'Continue with eToro', active === 'landing')}
    </nav>
  </aside>
  <main class="main">
${main}
  </main>
</div>`,
  );
}

// The eToro logo, inline so the page needs no image request.
const ETORO_LOGO = `<svg viewBox="0 0 443 172" fill="none" aria-hidden="true" focusable="false"><path fill="#13C636" d="M220.973 0c15.807 0 29.717 3.38 42.152 10.139 12.435 6.76 21.919 16.476 28.663 28.938 9.063 16.053 10.327 33.585 10.538 51.54 0 2.534-2.108 4.646-4.637 4.646H180.086c.421 14.152 3.793 24.925 10.538 32.74 6.955 8.238 17.282 12.251 30.981 12.251 8.852 0 16.229-1.267 22.13-4.013 6.533-3.38 10.116-8.238 12.856-14.363.843-1.69 2.529-2.958 4.426-2.958h31.403c2.951 0 5.058 2.535 4.215 5.281-3.793 14.575-13.488 26.826-26.766 35.064-13.699 8.449-29.717 12.462-48.474 12.251-16.018 0-29.928-3.38-42.152-10.35-12.224-6.971-21.708-16.476-28.453-28.727-6.744-12.251-10.116-26.403-10.116-42.668v-6.548c0-16.687 3.372-31.05 10.116-43.512 6.745-12.674 16.229-22.39 28.453-29.36C191.678 3.38 205.588 0 221.184 0h-.211zm0 30.205c-13.067 0-23.183 4.436-30.349 13.519-5.058 6.337-8.431 14.786-9.695 25.136h81.353c-1.054-10.773-4.637-19.644-10.96-26.404-7.166-8.237-17.282-12.25-30.349-12.25zM381.613 19.742c-3.284-3.288-8.5-3.288-11.785 0l-11.978 11.99a8.294 8.294 0 000 11.797L399 84.72l-40.956 41a8.292 8.292 0 000 11.796l11.784 11.797c3.285 3.288 8.501 3.288 11.785 0l58.924-58.984a8.294 8.294 0 000-11.797l-58.924-58.791zM61.387 19.742a8.274 8.274 0 0111.785 0l11.978 11.99a8.294 8.294 0 010 11.797L44 84.72l40.956 41a8.293 8.293 0 010 11.796l-11.784 11.797a8.273 8.273 0 01-11.785 0L2.463 90.33a8.294 8.294 0 010-11.797l58.924-58.791z"/></svg>`;

// The eToro sign-in button. A normal link styled as a button, never a script, so the
// browser itself follows the redirect to eToro.
function etoroButton(href, label) {
  return `<a class="etoro" href="${escapeHtml(href)}">${ETORO_LOGO}<span>${escapeHtml(label)}</span></a>`;
}

function steps(items) {
  return `<ol>${items.map(([lead, rest]) => `<li><strong>${escapeHtml(lead)}</strong> ${escapeHtml(rest)}</li>`).join('')}</ol>`;
}

/** Flow A starts here: the partner's own site, where the customer clicks Sign in with eToro. */
export function homePage() {
  return withRail(
    'Sign in with eToro',
    'home',
    `<div class="stack">
  <section class="card">
    <p class="kicker">Flow A - Sign in with eToro</p>
    <h1>The customer starts on your site</h1>
    <p class="muted">This page stands in for your own site. The customer clicks Sign in with eToro. They sign in at eToro, or they are already signed in, and they come back here signed in.</p>
    ${etoroButton('/api/auth/login', 'Sign in with eToro')}
  </section>
  <section class="card">
    <h2>What you will see</h2>
    ${steps([
      ['eToro opens.', 'You sign in there, or carry on if you are already signed in.'],
      ['The first time, eToro may ask you to approve', 'what this product can access.'],
      ['You come back to this site.', 'The next page says your eToro account is connected.'],
    ])}
  </section>
</div>`,
  );
}

/** Flow B lands here: the landing URL eToro opens after the button inside eToro. */
export function landingPage() {
  return withRail(
    'Continue with eToro',
    'landing',
    `<div class="stack">
  <section class="card">
    <p class="kicker">Flow B - A button inside eToro</p>
    <h1>The customer arrives from eToro</h1>
    <p class="muted">This is your landing URL. eToro opens it after the customer clicks the button for your product inside eToro. There is no login form here. Continue with eToro finishes the sign-in, and the customer is already signed in to eToro.</p>
    ${etoroButton('/api/auth/from-etoro', 'Continue with eToro')}
  </section>
  <section class="card">
    <h2>What you will see</h2>
    ${steps([
      ['eToro opened this page.', 'You are already signed in to eToro, so no login form appears.'],
      ['The first time, eToro may ask you to approve', 'what this product can access.'],
      ['This site links your eToro account.', 'It gets a user key, creates your sub-account, and shows the connected page.'],
    ])}
  </section>
</div>`,
  );
}

function detailRow(label, value) {
  return `<div class="row"><div class="label">${escapeHtml(label)}</div><p class="value">${escapeHtml(value)}</p></div>`;
}

/**
 * Where flows A and B end. Status words only: no ids, no tokens, no profile data.
 * @param {{ hasUserKey: boolean, hasLink: boolean, canSendEvent: boolean, notice?: string }} status
 */
export function connectedPage({ hasUserKey, hasLink, canSendEvent, notice }) {
  const openEtoro = hasLink
    ? `${etoroButton('/api/auth/open-etoro', 'Open eToro')}
    <p class="muted small">Flow C. eToro signs you in on its own page. This site never sees your eToro password.</p>`
    : `<p class="muted">Open eToro needs your sub-account link. Use <a href="/from-etoro">Continue with eToro</a> to create it.</p>`;

  // A form, not a link: sending an event changes state, so it is a POST. The session
  // cookie is SameSite=Lax, so another site cannot submit this form as the customer.
  const partnerEvent = canSendEvent
    ? `<form method="post" action="/api/partner-event"><button type="submit" class="ghost">Send a partner event</button></form>`
    : '';

  return htmlDocument(
    'Connected',
    `<header class="topbar">
  ${brand()}
  <a class="ghost" href="/api/auth/logout">Sign out</a>
</header>
<main class="stage">
  <p class="eyebrow"><span class="dot" aria-hidden="true"></span>Signed in</p>
  <h1>Your eToro account is connected</h1>
  <p class="muted">Your session on this site is ready. The eToro tokens stay on this server. Your browser holds only a session cookie.</p>
  <section class="card details">
    ${detailRow('Signed in with', 'eToro')}
    ${detailRow('User key', hasUserKey ? 'Saved' : 'Not set up yet')}
    ${detailRow('Sub-account', hasLink ? 'Linked' : 'Not linked yet')}
  </section>
  ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ''}
  <div class="actions">
    ${openEtoro}
    ${partnerEvent}
  </div>
</main>`,
  );
}

/** /connected without a session. */
export function signedOutPage() {
  return withRail(
    'Signed out',
    '',
    `<div class="stack">
  <section class="card">
    <h1>You are signed out</h1>
    <p class="muted">Sign in from this site, or continue from eToro.</p>
    ${etoroButton('/api/auth/login', 'Sign in with eToro')}
  </section>
</div>`,
  );
}

/** A required setting is empty or invalid. Names only, never values. */
export function missingSettingsPage(title, names) {
  return withRail(
    title,
    '',
    `<div class="stack">
  <section class="card">
    <p class="kicker">Setup needed</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="muted">These settings are empty or invalid. eToro gives you these values for one environment. The demo stops here instead of guessing a host, a client id, or a secret.</p>
    <ul class="names">${names.map((name) => `<li><code>${escapeHtml(name)}</code></li>`).join('')}</ul>
    <p class="muted">Set them in <code>.env</code>, then restart with <code>docker compose up</code>.</p>
    <p><a href="/">Back</a></p>
  </section>
</div>`,
  );
}

/** A short, generic message. Details go to the server log as error codes only. */
export function messagePage(title, message, { backHref = '/', backLabel = 'Back' } = {}) {
  return withRail(
    title,
    '',
    `<div class="stack">
  <section class="card">
    <h1>${escapeHtml(title)}</h1>
    <p class="muted">${escapeHtml(message)}</p>
    <p><a href="${escapeHtml(backHref)}">${escapeHtml(backLabel)}</a></p>
  </section>
</div>`,
  );
}
