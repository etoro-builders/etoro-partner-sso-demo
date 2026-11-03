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
      ['This site links your eToro account.', 'It gets a user key and creates your sub-account, once eToro has set up linking for this product. Then it shows the connected page.'],
    ])}
  </section>
</div>`,
  );
}

function detailRow(label, value) {
  return `<div class="row"><div class="label">${escapeHtml(label)}</div><p class="value">${escapeHtml(value)}</p></div>`;
}

function formatUsd(value, signed) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    signDisplay: signed ? 'exceptZero' : 'auto',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function pnlClass(value) {
  if (typeof value !== 'number' || value === 0) return '';
  return value > 0 ? 'up' : 'down';
}

/**
 * The real account, read by this server. Figures only: no customer id, no token.
 * @param {{ status: string, credit?: number | null, pnl?: number | null, openCount?: number,
 *   positions?: { name: string, side: string, pnl: number | null }[] }} portfolio
 */
export function portfolioSection(portfolio) {
  const head = `<div class="panel-head">
  <p class="eyebrow"><span class="dot" aria-hidden="true"></span>Real account</p>
  <h1>Portfolio</h1>
</div>`;
  if (!portfolio || portfolio.status === 'needs-link') {
    return `<section class="card portfolio-panel">
  ${head}
  <p class="muted">This fills in after Continue with eToro. That step saves the user key this server uses to read the real account.</p>
</section>`;
  }
  if (portfolio.status !== 'ok') {
    const message = portfolio.status === 'forbidden'
      ? 'eToro did not share this portfolio. Sign in again from Continue with eToro and approve the portfolio read. The rest of this page still works.'
      : 'The portfolio could not be read just now. The rest of this page still works.';
    return `<section class="card portfolio-panel">
  ${head}
  <p class="muted">${message}</p>
</section>`;
  }

  const count = portfolio.openCount ?? 0;
  const shown = portfolio.positions ?? [];
  const countLine = count === 0
    ? 'No open positions.'
    : shown.length < count
      ? `Showing ${shown.length} of ${count} open positions, largest move first.`
      : `${count} open ${count === 1 ? 'position' : 'positions'}.`;
  const cards = shown.map((position) => `<article class="holding">
  <p class="name">${escapeHtml(position.name)}</p>
  <p class="side">${escapeHtml(position.side)}</p>
  <p class="pnl ${pnlClass(position.pnl)}">${position.pnl == null ? '—' : escapeHtml(formatUsd(position.pnl, true))}</p>
</article>`).join('');

  return `<section class="card portfolio-panel">
  ${head}
  <div class="metrics">
    <div class="metric">
      <div class="label">Available</div>
      <p class="value">${portfolio.credit == null ? '—' : escapeHtml(formatUsd(portfolio.credit))}</p>
    </div>
    <div class="metric">
      <div class="label">Open profit / loss</div>
      <p class="value ${pnlClass(portfolio.pnl)}">${portfolio.pnl == null ? '—' : escapeHtml(formatUsd(portfolio.pnl, true))}</p>
    </div>
    <div class="metric">
      <div class="label">Open positions</div>
      <p class="value">${count}</p>
    </div>
  </div>
  <p class="muted small">${countLine}</p>
  ${cards ? `<div class="holdings">${cards}</div>` : ''}
</section>`;
}

function miniCard(title, lines) {
  return `<article class="holding">
  <p class="name">${escapeHtml(title)}</p>
  ${lines.map((line) => `<p class="side">${escapeHtml(line)}</p>`).join('')}
</article>`;
}

function formatPrice(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const digits = Math.abs(value) >= 1 ? 2 : 5;
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits }).format(value);
}

function formatPct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function candleSvg(candles) {
  if (!candles?.length) return '<p class="muted">No chart for this market.</p>';
  const width = 640;
  const height = 260;
  const pad = 10;
  const max = Math.max(...candles.map((candle) => candle.high));
  const min = Math.min(...candles.map((candle) => candle.low));
  const span = max - min || 1;
  const slot = width / candles.length;
  const body = Math.max(slot * 0.55, 1.2);
  const y = (price) => pad + ((max - price) / span) * (height - pad * 2);
  const bars = candles.map((candle, index) => {
    const x = index * slot + slot / 2;
    const up = candle.close >= candle.open;
    const color = up ? '#13c636' : '#ff5d5d';
    const top = y(Math.max(candle.open, candle.close));
    const bottom = y(Math.min(candle.open, candle.close));
    const bar = Math.max(bottom - top, 1);
    return `<line x1="${x.toFixed(2)}" y1="${y(candle.high).toFixed(2)}" x2="${x.toFixed(2)}" y2="${y(candle.low).toFixed(2)}" stroke="${color}" stroke-width="1"/><rect x="${(x - body / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${body.toFixed(2)}" height="${bar.toFixed(2)}" fill="${color}"/>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Hourly chart">${bars}</svg>`;
}

function heatFill(pct) {
  const clamped = Math.max(-3, Math.min(3, pct));
  const stops = [
    [-3, [122, 24, 28]],
    [-1.4, [176, 58, 46]],
    [-0.15, [92, 62, 58]],
    [0.15, [24, 78, 56]],
    [1.4, [18, 140, 68]],
    [3, [110, 214, 104]],
  ];
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let index = 0; index < stops.length - 1; index += 1) {
    if (clamped >= stops[index][0] && clamped <= stops[index + 1][0]) {
      lower = stops[index];
      upper = stops[index + 1];
      break;
    }
  }
  const span = upper[0] - lower[0] || 1;
  const t = (clamped - lower[0]) / span;
  const channels = lower[1].map((channel, index) => Math.round(channel + (upper[1][index] - channel) * t));
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

function squarify(items, x, y, width, height) {
  const rects = [];
  const place = (row, rowX, rowY, rowWidth, rowHeight) => {
    const vertical = rowWidth < rowHeight;
    const weight = row.reduce((sum, item) => sum + item.weight, 0);
    let offset = 0;
    for (const item of row) {
      const span = (item.weight / weight) * (vertical ? rowHeight : rowWidth);
      const thickness = vertical ? rowWidth : rowHeight;
      rects.push(vertical
        ? { item, x: rowX, y: rowY + offset, width: thickness, height: span }
        : { item, x: rowX + offset, y: rowY, width: span, height: thickness });
      offset += span;
    }
  };
  const worst = (row, side, area) => {
    const weight = row.reduce((sum, item) => sum + item.weight, 0);
    const thickness = area / side;
    return Math.max(...row.map((item) => {
      const length = (item.weight / weight) * side;
      return Math.max(length / thickness, thickness / length);
    }));
  };
  const layout = (rest, rowX, rowY, rowWidth, rowHeight) => {
    if (!rest.length || rowWidth <= 0 || rowHeight <= 0) return;
    if (rest.length === 1) {
      rects.push({ item: rest[0], x: rowX, y: rowY, width: rowWidth, height: rowHeight });
      return;
    }
    const vertical = rowWidth < rowHeight;
    const side = vertical ? rowHeight : rowWidth;
    const area = rowWidth * rowHeight;
    const total = rest.reduce((sum, item) => sum + item.weight, 0);
    const row = [];
    let used = 0;
    for (const item of rest) {
      const trial = row.concat(item);
      const trialArea = ((used + item.weight) / total) * area;
      const rowArea = (used / total) * area;
      if (!row.length || worst(trial, side, trialArea) <= worst(row, side, rowArea)) {
        row.push(item);
        used += item.weight;
      } else {
        break;
      }
    }
    const rowArea = (used / total) * area;
    const thickness = rowArea / side;
    if (vertical) {
      place(row, rowX, rowY, thickness, side);
      layout(rest.slice(row.length), rowX + thickness, rowY, rowWidth - thickness, rowHeight);
    } else {
      place(row, rowX, rowY, side, thickness);
      layout(rest.slice(row.length), rowX, rowY + thickness, rowWidth, rowHeight - thickness);
    }
  };
  layout(items, x, y, width, height);
  return rects;
}

/** Watchlist plus open positions. Hidden unless more than four instruments have a daily change. */
export function heatmapCard(tiles) {
  if (!Array.isArray(tiles) || tiles.length <= 4) return '';
  const mapWidth = 1000;
  const mapHeight = 320;
  const placed = squarify(tiles.map((tile) => ({ ...tile, weight: 1 })), 0, 0, mapWidth, mapHeight);
  const numAttr = (value) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : '');
  const cells = placed.map(({ item, x, y, width, height }) => {
    const gap = 4;
    const left = ((x + gap / 2) / mapWidth) * 100;
    const top = ((y + gap / 2) / mapHeight) * 100;
    const boxW = Math.max(((width - gap) / mapWidth) * 100, 0);
    const boxH = Math.max(((height - gap) / mapHeight) * 100, 0);
    const compact = boxW < 8 || boxH < 18 ? ' compact' : '';
    return `<a class="heat-cell${compact}" style="left:${left.toFixed(3)}%;top:${top.toFixed(3)}%;width:${boxW.toFixed(3)}%;height:${boxH.toFixed(3)}%;background:${heatFill(item.changePct)}" href="/connected?m=${item.id}" data-instrument data-id="${item.id}" data-symbol="${escapeHtml(item.symbol)}" data-name="${escapeHtml(item.name)}" data-change="${numAttr(item.changePct)}" data-bid="${numAttr(item.bid)}" data-ask="${numAttr(item.ask)}" data-pnl="${numAttr(item.pnl)}" data-side="${escapeHtml(item.side ?? '')}">
  <span class="heat-symbol">${escapeHtml(item.symbol)}</span>
  <span class="heat-pct">${escapeHtml(formatPct(item.changePct))}</span>
</a>`;
  }).join('');
  return `<section class="card heatmap" data-heatmap>
  <div class="heat-head">
    <div>
      <p class="eyebrow">Daily move</p>
      <h2>Heatmap</h2>
    </div>
    <p class="muted small">Watchlist and open positions.</p>
  </div>
  <div class="heat-map" role="img" aria-label="Heatmap">${cells}</div>
  <div class="heat-scale" aria-hidden="true"></div>
  <div class="heat-legend" aria-hidden="true"><span>-3%</span><span>0</span><span>+3%</span></div>
  <div class="heat-tip" data-heat-tip hidden>
    <p class="heat-tip-symbol" data-tip-symbol></p>
    <p class="heat-tip-name" data-tip-name></p>
    <p class="heat-tip-row"><span>Day</span><strong data-tip-change></strong></p>
    <p class="heat-tip-row" data-tip-price-row hidden><span>Price</span><strong data-tip-price></strong></p>
    <p class="heat-tip-row" data-tip-side-row hidden><span>Position</span><strong data-tip-side></strong></p>
    <p class="heat-tip-row" data-tip-pnl-row hidden><span>Open P/L</span><strong data-tip-pnl></strong></p>
  </div>
</section>`;
}

/**
 * Watchlist, chart, quote, and an order ticket that never sends an order.
 * @param {{ status: string, source?: string, selectedId?: number, items?: object[], candles?: object[], quote?: object }} market
 * @param {{ side: string, leverage: number, amount: number, preview: boolean }} ticket
 */
export function edgeSection(market, ticket = { side: 'buy', leverage: 1, amount: 1000, preview: false }) {
  if (!market || market.status === 'needs-link') {
    return `<section class="card edge-note"><h2>Markets</h2><p class="muted">The watchlist and chart appear after Continue with eToro.</p></section>`;
  }
  if (market.status !== 'ok' || !market.quote) {
    const message = market.status === 'forbidden'
      ? 'Sign in again from Continue with eToro and approve market data. The portfolio above still works.'
      : 'Market data could not be read just now.';
    return `<section class="card edge-note"><h2>Markets</h2><p class="muted">${message}</p></section>`;
  }

  const quote = market.quote;
  const link = (id, extra = {}) => {
    const params = new URLSearchParams();
    params.set('m', String(id));
    params.set('side', extra.side || ticket.side);
    params.set('lev', String(extra.leverage || ticket.leverage));
    params.set('amount', String(ticket.amount));
    return `/connected?${params}`;
  };
  const numAttr = (value) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : '');
  const rows = (market.items ?? []).map((item) => {
    const price = item.bid ?? item.ask;
    return `<a class="watch-row${item.id === market.selectedId ? ' active' : ''}" href="${link(item.id)}" data-instrument data-id="${item.id}" data-symbol="${escapeHtml(item.symbol)}" data-name="${escapeHtml(item.name)}" data-bid="${numAttr(item.bid)}" data-ask="${numAttr(item.ask)}" data-change="${numAttr(item.changePct)}">
  <span class="watch-symbol">${escapeHtml(item.symbol)}</span>
  <span class="watch-price">${formatPrice(price)}</span>
  <span class="watch-change ${pnlClass(item.changePct)}">${formatPct(item.changePct)}</span>
</a>`;
  }).join('');
  const side = ticket.side === 'sell' ? 'sell' : 'buy';
  const action = side === 'sell' ? 'Short' : 'Buy';
  const tradePrice = side === 'sell' ? quote.bid : quote.ask;
  return `<section class="edge" data-board data-id="${quote.id}" data-side="${side}" data-leverage="${ticket.leverage}">
  <section class="card watch">
    <h2>${escapeHtml(market.source || 'Markets')}</h2>
    ${market.throttled ? '<p class="muted small">eToro is limiting requests right now. Wait a minute, then refresh.</p>' : ''}
    <div class="watch-list">${rows}</div>
  </section>
  <div class="chart-stack">
    <section class="card chart-card">
      <div class="chart-head">
        <div>
          <p class="eyebrow" data-quote-symbol>${escapeHtml(quote.symbol)}</p>
          <h2 data-quote-name>${escapeHtml(quote.name)}</h2>
        </div>
        <p class="chart-price ${pnlClass(quote.changePct)}" data-last><span data-last-px>${formatPrice(quote.bid ?? quote.ask)}</span> <span data-last-pct>${formatPct(quote.changePct)}</span></p>
      </div>
      <div data-chart>${candleSvg(market.candles)}</div>
      <p class="muted small">Hourly candles. The percentage is the move since the previous daily close.</p>
    </section>
    <section class="card quote-card">
      <h2>Quote</h2>
      <div class="metrics quote-metrics">
        <div class="metric"><div class="label">Bid</div><p class="value" data-quote-bid>${formatPrice(quote.bid)}</p></div>
        <div class="metric"><div class="label">Ask</div><p class="value" data-quote-ask>${formatPrice(quote.ask)}</p></div>
        <div class="metric"><div class="label">Day</div><p class="value ${pnlClass(quote.changePct)}" data-day>${formatPct(quote.changePct) || '—'}</p></div>
      </div>
    </section>
  </div>
  <section class="card ticket">
    <h2 data-ticket-title>Order ticket · ${escapeHtml(quote.symbol)}</h2>
    <div class="side-toggle">
      <a class="${side === 'sell' ? 'on sell-on' : ''}" data-pick-side="sell" href="${link(quote.id, { side: 'sell' })}">Short</a>
      <a class="${side === 'buy' ? 'on buy-on' : ''}" data-pick-side="buy" href="${link(quote.id, { side: 'buy' })}">Buy</a>
    </div>
    <p class="muted small" data-trade-at>${action} at ${formatPrice(tradePrice)}</p>
    <form method="get" action="/connected">
      <input type="hidden" name="m" value="${quote.id}">
      <input type="hidden" name="side" value="${side}">
      <input type="hidden" name="lev" value="${ticket.leverage}">
      <input type="hidden" name="ticket" value="preview">
      <label class="field">Amount
        <input name="amount" data-amount inputmode="decimal" value="${escapeHtml(ticket.amount)}">
      </label>
      <div class="lev-row">
        ${[1, 2, 5].map((value) => `<a class="${value === ticket.leverage ? 'on' : ''}" data-pick-leverage="${value}" href="${link(quote.id, { leverage: value })}">x${value}</a>`).join('')}
      </div>
      <p class="muted small" data-exposure>Exposure ${escapeHtml(formatUsd(ticket.amount * ticket.leverage))}</p>
      <p class="notice" data-notice ${ticket.preview ? '' : 'hidden'}>Not sent. This demo does not place orders.</p>
      <button class="ticket-go ${side}" type="submit">${action} ${escapeHtml(quote.symbol)}</button>
    </form>
  </section>
</section>`;
}

/** Pending orders and copy relationships, under the portfolio. Empty states stay visible. */
export function extraPanels(portfolio) {
  if (portfolio?.status !== 'ok') return '';
  const orders = portfolio.orders ?? [];
  const copies = portfolio.copies ?? [];
  const orderCards = orders.map((order) => {
    const lines = [order.side];
    if (order.amount != null) lines.push(formatUsd(order.amount));
    if (order.leverage != null) lines.push(`${order.leverage}x`);
    if (order.kind) lines.push(order.kind);
    return miniCard(order.name, lines);
  }).join('');
  const copyCards = copies.map((copy) => {
    const lines = [];
    if (copy.invested != null) lines.push(`Invested ${formatUsd(copy.invested)}`);
    if (copy.closedPnl != null) lines.push(`Closed ${formatUsd(copy.closedPnl, true)}`);
    if (copy.paused) lines.push('Paused');
    return miniCard(copy.name, lines.length ? lines : ['Copying']);
  }).join('');
  return `<div class="below">
  <section class="card side-panel">
    <h2>Pending orders</h2>
    ${orderCards ? `<div class="holdings">${orderCards}</div>` : '<p class="muted">No pending orders.</p>'}
  </section>
  <section class="card side-panel">
    <h2>Copying</h2>
    ${copyCards ? `<div class="holdings">${copyCards}</div>` : '<p class="muted">Not copying anyone.</p>'}
  </section>
</div>`;
}

function spinner() {
  return '<div class="panel-spinner" aria-hidden="true"></div>';
}

// The three panels below take a real call to eToro each, so connectedPage() sends these
// instead of waiting for them. /board.js fetches /api/panel/* and swaps each one in,
// keeping its position in the layout so nothing jumps once the real content lands.
function portfolioLoading() {
  return `<section class="card portfolio-panel panel-loading" data-panel="portfolio">
  <div class="panel-head">
    <p class="eyebrow"><span class="dot" aria-hidden="true"></span>Real account</p>
    <h1>Portfolio</h1>
  </div>
  ${spinner()}
</section>`;
}

function heatmapLoading() {
  return `<section class="card heatmap panel-loading" data-panel="heatmap">
  <div class="heat-head"><h2>Heat map</h2></div>
  ${spinner()}
</section>`;
}

function marketLoading() {
  return `<section class="edge panel-loading" data-panel="market">
  <section class="card watch"><h2>Markets</h2>${spinner()}</section>
  <div class="chart-stack">
    <section class="card chart-card">${spinner()}</section>
  </div>
  <section class="card ticket"><h2>Order ticket</h2>${spinner()}</section>
</section>`;
}

/**
 * Where flows A and B end. Status words, plus the real portfolio when eToro shares it.
 * No tokens.
 * @param {{ hasUserKey: boolean, hasLink: boolean, canSendEvent: boolean, notice?: string,
 *   portfolio?: { status: string },
 *   market?: { status: string },
 *   ticket?: { side: string, leverage: number, amount: number, preview: boolean },
 *   heatmap?: { id: number, symbol: string, name: string, changePct: number }[],
 *   loading?: boolean }} status
 */
export function connectedPage({ hasUserKey, hasLink, canSendEvent, notice, portfolio, market, ticket, heatmap, loading }) {
  const openEtoro = hasLink
    ? `${etoroButton('/api/auth/open-etoro', 'Open eToro')}
    <p class="muted small">Flow C. eToro signs you in on its own page. This site never sees your eToro password.</p>`
    : `<p class="muted">Open eToro needs your sub-account link. Use <a href="/from-etoro">Continue with eToro</a> to create it.</p>`;

  // A form, not a link: sending an event changes state, so it is a POST. The session
  // cookie is SameSite=Lax, so another site cannot submit this form as the customer.
  const partnerEvent = canSendEvent
    ? `<form method="post" action="/api/partner-event"><button type="submit" class="ghost">Send a partner event</button></form>`
    : '';

  // Without JavaScript nothing would ever fetch /api/panel/*, so this sends a no-JS
  // browser straight to the old, fully server-rendered page instead of a permanent
  // spinner. A browser running JavaScript never executes <noscript> content.
  const noscriptFallback = loading
    ? `<noscript><meta http-equiv="refresh" content="0; url=/connected?${new URLSearchParams({
      full: '1',
      m: ticket?.selectedId != null ? String(ticket.selectedId) : '',
      side: ticket?.side ?? 'buy',
      lev: String(ticket?.leverage ?? 1),
      amount: String(ticket?.amount ?? 1000),
    })}"></noscript>`
    : '';

  const boardBody = loading
    ? `${portfolioLoading()}
    ${heatmapLoading()}
    ${marketLoading()}
    <div data-panel="extras" hidden></div>`
    : `${portfolioSection(portfolio)}
    ${heatmapCard(heatmap)}
    ${edgeSection(market, ticket)}
    ${extraPanels(portfolio)}`;

  return htmlDocument(
    'Connected',
    `${noscriptFallback}<header class="topbar">
  ${brand()}
  <a class="ghost" href="/api/auth/logout">Sign out</a>
</header>
<main class="dashboard">
  <div class="board">
    ${boardBody}
  </div>
  <section class="card account-panel">
    <h2>This account</h2>
    <div class="details">
      ${detailRow('Signed in with', 'eToro')}
      ${detailRow('User key', hasUserKey ? 'Saved' : 'Not set up yet')}
      ${detailRow('Sub-account', hasLink ? 'Linked' : 'Not linked yet')}
    </div>
    ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ''}
    <div class="actions">
      ${openEtoro}
      ${partnerEvent}
    </div>
  </section>
</main>
<script src="/board.js" defer></script>`,
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
    <p class="muted">Fill them in <code>src/config.js</code>, then restart with <code>docker compose up --build</code>. The client secret and the application key come from your vault, never from code.</p>
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
