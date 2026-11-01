# eToro partner SSO demo

A small Node.js app that shows the partner side of signing customers in between eToro and your product, without signing in twice. It covers both directions: from eToro into your product (Sign in with eToro, and Continue with eToro from a button inside eToro), and from your product into eToro (Open eToro).

It is for developers at a company that has agreed an integration with eToro and wants to see working code before building it into their own product. It is a demo, not a library. Read it, run it, and copy the parts you need.

eToro already runs the login page, the consent screen, the button inside eToro, and the pages that finish a sign-in on the eToro side. This app owns only the partner's pages and routes, and the server calls the partner makes.

## The three journeys

There are three flows. They all use **one application** that eToro registers for you, so you never need a second registration to add a flow later.

| Flow | The customer starts | The customer ends up signed in | In this demo |
|---|---|---|---|
| A. Sign in with eToro | On your site or app | In your product | Home page, then the connected page |
| B. A button inside eToro | Inside eToro | In your product, with no login form | Landing page, then the connected page |
| C. Send your customer into eToro | In your product | In eToro, with no eToro password | The Open eToro button on the connected page |

### Pages and routes

| Route | Flow | What happens |
|---|---|---|
| `GET /` | A | Your site. The customer clicks **Sign in with eToro**. |
| `GET /api/auth/login` | A | The server creates `state` and a PKCE pair, keeps them in HttpOnly cookies, and sends the browser to eToro. |
| `GET /from-etoro` | B | Your landing URL. eToro opens it after the customer clicks the button for your product inside eToro. The customer clicks **Continue with eToro**. |
| `GET /api/auth/from-etoro` | B | Same as `/api/auth/login`, and remembers that this sign-in came from eToro. |
| `GET /api/auth/callback` | A and B | eToro sends the browser back with `code` and `state`. The server checks `state`, exchanges the code, checks the `id_token`, and opens a session. For flow B it then gets the user key and links the sub-account: it reuses the customer's existing sub-account with your provider, and creates one only when there is none. Without the partner setup it skips those steps and says so. |
| `GET /connected` | A and B | Says the eToro account is connected. Shows status words only, never an id or a token. |
| `GET /api/auth/open-etoro` | C | Sends the browser to the eToro initiate page with your `client_id`, your flow C callback URL, and a new `state`. |
| `GET /api/auth/silent-login/callback` | C | eToro sends the browser back with `tid` and `state`. The server gets a machine token, asks eToro for the one-time link, and sends the browser to the `redirectUrl` eToro returned. |
| `POST /api/partner-event` | Optional | Reports one event, only after the sub-account link is saved. |
| `GET /api/auth/logout` | A and B | Revokes the current refresh token and ends the session. |

The server never calls eToro's verify step. It only works from the customer's browser, so the browser goes to `redirectUrl` and eToro finishes the sign-in on its own page.

Every sign-in control is a normal link. The browser follows the redirects to eToro and back. Nothing starts the redirect with `fetch`.

## What you need from eToro first

| Item | What it is | How you receive it | Setting |
|---|---|---|---|
| Application id (`client_id`) | Identifies your product to eToro. | In writing. | `ETORO_CLIENT_ID` |
| Client secret | Proves your server is yours. | The agreed secret channel. | `ETORO_CLIENT_SECRET` |
| Application key (`x-api-key`) | Sent with every user key when your server calls the eToro public API. | The agreed secret channel. | `ETORO_APP_KEY` |
| Environment hosts | The addresses for testing and for production. | In writing. | `ETORO_*_URL`, `ETORO_ISSUER` |
| The user-key call address | Where your server turns a customer's access token into a user key (flow B). | In writing. | `ETORO_USER_KEY_URL` |
| The provider name | The name your server sends when it creates the sub-account (flow B). | In writing. | `ETORO_PROVIDER_NAME` |
| The initiate page address | Where flow C starts. | In writing. | `ETORO_INITIATE_PAGE_URL` |
| The partner-events call address | Only if you report events. | In writing. | `ETORO_PARTNER_EVENTS_URL`, `ETORO_EVENT_TYPE` |

The demo never guesses an address. If a value a journey needs is empty, that journey's page names the missing settings and stops.

## What you give eToro

Replace `YOUR_HOST` with the HTTPS address the demo runs on.

| Item | In this demo | Used by |
|---|---|---|
| Your callback URL, absolute HTTPS, exactly as you will send it | `https://YOUR_HOST/api/auth/callback` | Flow A and the end of flow B |
| Your landing URL, absolute HTTPS | `https://YOUR_HOST/from-etoro` | Flow B |
| Your flow C callback URL | `https://YOUR_HOST/api/auth/silent-login/callback` | Flow C |
| The public IPv4 addresses your servers call eToro from | The machine that runs the demo | Every server call with a user key |
| An icon URL and your product name | Your own | The consent screen |

The demo sends `scope=openid` and needs no other permission. eToro grants the permissions registered for your application, whatever the request asks for, so register as few as you can.

When your IP addresses change, send the new list before you switch traffic. Calls from any other address are rejected.

## Run it with Docker

You need Docker with Compose and an eToro account. Nothing else is installed on your machine.

1. Register your own application on the [eToro Builders portal](https://builders.etoro.com/app-registration):
   - Redirect URIs: `http://localhost:3000/api/auth/callback` and `http://localhost:3000/api/auth/silent-login/callback`.
   - Icon URL: an image at a public HTTPS address. The portal does not accept `localhost` here. You can use this repository's icon: `https://cdn.jsdelivr.net/gh/etoro-builders/etoro-partner-sso-demo@main/public/icon.svg`.
   - Permissions: the portal needs at least one. `profile` is enough. The consent screen shows it as Public Profile.

   You become the application's admin, so you can sign in to it with your own eToro account while it is still in development. The portal shows the client secret only once, so keep it. If the portal says your account may not create applications, ask eToro to allow it for your account.
2. Put your client id in `ETORO_CLIENT_ID` in [`src/config.js`](src/config.js).
3. Start the demo with your client secret in the environment of the shell that runs it:

   ```bash
   export ETORO_CLIENT_SECRET='<your client secret>'
   docker compose up --build
   ```

   In Windows PowerShell, use `$env:ETORO_CLIENT_SECRET = '<your client secret>'` instead of `export`.

Open <http://localhost:3000> and click **Sign in with eToro**. That is flow A. Open <http://localhost:3000/from-etoro> and click **Continue with eToro** to try flow B, which signs you in the same way.

Linking the eToro account at the end of flow B, and flow C, need the partner setup listed in [What you need from eToro first](#what-you-need-from-etoro-first). Until then flow B signs you in and skips the link, and the connected page names the settings still needed. The startup log lists the same names, never the values.

The client id that ships in `src/config.js` belongs to eToro's own demo application. Any eToro account can sign in to it, but its client secret is not published, so to run the demo yourself you register your own application as above.

eToro must have registered your callback URLs. Outside your own machine they must be HTTPS. Put the demo behind an HTTPS address you control, for example a reverse proxy or a tunnel to port 3000, register that address with eToro, put it in `src/config.js`, and restart with `docker compose up --build`. The cookies get the `Secure` flag when the request arrives over HTTPS.

Stop it with `Ctrl+C`, or `docker compose down`.

## Settings

Every setting is written in one file, [`src/config.js`](src/config.js), next to a comment that says where a real partner keeps it. The values there belong to eToro's demo application. Replace them with yours.

| Setting | Needed by | Where a real partner keeps it | In this demo |
|---|---|---|---|
| `ETORO_CLIENT_ID` | A, B, C | Normal configuration | eToro's demo application |
| `ETORO_CLIENT_SECRET` | A, B, C | Vault | Not in code. See [Secrets](#secrets). |
| `ETORO_REDIRECT_URI` | A, B | Normal configuration | `http://localhost:3000/api/auth/callback` |
| `ETORO_USER_KEY_URL` | B | Normal configuration | Empty |
| `ETORO_APP_KEY` | B | Vault | Not in code. See [Secrets](#secrets). |
| `ETORO_PROVIDER_NAME` | B | Normal configuration | Empty |
| `ETORO_FLOW_C_REDIRECT_URI` | C | Normal configuration | `http://localhost:3000/api/auth/silent-login/callback` |
| `ETORO_INITIATE_PAGE_URL` | C | Normal configuration | Empty |
| `ETORO_PARTNER_EVENTS_URL` | Events | Normal configuration | Empty. Optional. |
| `ETORO_EVENT_TYPE` | Events | Normal configuration | Empty. Optional. |
| `ETORO_AUTHORIZE_URL` | Hosts | Normal configuration | `https://www.etoro.com/sso/`. Must end in `/sso/`. |
| `ETORO_TOKEN_URL` | Hosts | Normal configuration | `https://www.etoro.com/api/sso/v1/token` |
| `ETORO_REVOKE_URL` | Hosts | Normal configuration | `https://www.etoro.com/api/sso/v1/token/revoke` |
| `ETORO_JWKS_URL` | Hosts | Normal configuration | `https://www.etoro.com/.well-known/jwks.json` |
| `ETORO_ISSUER` | Hosts | Normal configuration | `https://www.etoro.com` |
| `ETORO_SUB_ACCOUNTS_URL` | Hosts | Normal configuration | `https://public-api.etoro.com/api/v1/sub-accounts/me/accounts` |
| `ETORO_PARTNER_LOGIN_TOKEN_URL` | Hosts | Normal configuration | `https://www.etoro.com/api/sso/v2/silent-login/partner-login-token` |

The callbacks, user-key address, provider name, initiate page, and hosts are all per environment. Your callbacks must match what you registered with eToro, character for character.

### One environment at a time

Testing and production use different hosts, keys, and tokens. A token from one environment never works on another. The file holds the production hosts from the partner brief. To use another environment, replace **every** host with the hosts eToro gave you for it.

### Secrets

The client secret and the application key belong in a vault. Your server reads them from the vault when it starts. Never put them in code, in git, in a browser, in a mobile app, in a URL, or in a log line.

They are the only settings `src/config.js` does not hold. To run the demo with them, set `ETORO_CLIENT_SECRET`, and for flow B `ETORO_APP_KEY`, as environment variables in the shell that runs `docker compose up`. Docker Compose passes them into the container.

The browser holds only this site's session cookie. The tokens, the user key, and `externalUserId` stay on the server, and no page shows them.

## Limits of this demo

- Sessions and account links live in memory, in one process. A restart forgets them, and a second instance would not see them. A real partner stores them in its own database. It stores the user key encrypted against the customer, and stores `externalUserId` against its own account id for that customer.
- The demo refreshes each access token about a minute before it expires. It stores the new refresh token, then revokes the old one. A refresh that fails with `invalid_grant` ends the session. With more than one instance, only one may refresh a session at a time.
- There is one demo customer account per eToro `sub`, so signing out and in again keeps the sub-account link.
- Each customer gets one sub-account with your provider. Before it creates one, the demo asks eToro for the customer's sub-accounts (`GET` on the same address) and reuses the `externalUserId` of the existing one. So a restart, a second device, or a lost record never creates a second sub-account.

## Errors you are most likely to see

| Where | What you see | What it means |
|---|---|---|
| Any token call | `invalid_grant` | The code or refresh token was used, expired, or revoked, or `redirect_uri` does not match. Start the flow again. |
| Flow C machine token | `invalid_request` | You sent the client secret twice, in the header and in the body. Send it once. |
| Any call with a user key | `403` | The call came from an IP address eToro does not have for you. |
| Sub-account create | `409` | The link already exists, for example from a second sign-in at the same moment. Read it back with `GET` and use its `externalUserId`. Never create another one. |
| Flow C partner-login-token | `400` | The `externalUserId` does not belong to your application. Use the value from flow B. |
| Flow C callback URL | `403` | The callback URL does not match what you registered. |

The server log shows the call name, the HTTP status, and the OAuth error code. It never shows a token, a key, or customer details. The customer sees a short generic message.

## Files

```text
LICENSE             Apache License 2.0
NOTICE              Copyright notice
Dockerfile          The image: Node.js 24, production dependencies only
docker-compose.yml  The whole runtime
public/demo.css     The partner site's look
public/icon.svg     An application icon you can register for the consent screen
src/config.js       Every setting, where each belongs, and the names of what is missing
src/pkce.js         state, code_verifier, and code_challenge
src/etoro.js        Every call to eToro, one function each
src/session.js      In-memory sessions, refresh, and revoke
src/pages.js        The HTML pages
src/server.js       The routes for flows A, B, and C
```

Each file starts with a comment that explains what it does and why. Each call to eToro says who calls it and what must not be sent.

## Further reading

The full partner documentation is on the eToro API portal.

- [SSO with OAuth 2.0](https://api-portal.etoro.com/core/getting-started/sso-oauth): application registration, the authorization request with PKCE, the code exchange, ID token validation, and the security checklist. Flows A and B follow it.
- [Partner integration flow](https://api-portal.etoro.com/partners/integration): what a partner does after sign-in, such as linking the accounts and reporting events back to eToro.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

You may copy this code into your own product, open or closed. Keep the license and the notice with the copied code. The license does not let you use the eToro name or logo, except to say where the code comes from. This is a demo, provided as is, without warranty.
