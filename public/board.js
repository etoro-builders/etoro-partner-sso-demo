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
// Updates the market board in place. Side and leverage need no request. A symbol
// loads only its chart. The links still work when this file does not run.
//
// /connected sends instantly with a loading placeholder in each slow panel (portfolio,
// heat map, market board). This file also fetches /api/panel/* to fill those in, then
// wires up the same in-place interactivity as before. A browser without JavaScript never
// runs this file; the page's own <noscript> tag sends it to the old, fully rendered
// ?full=1 version instead, so nothing here is required for the page to work.
let board = null;
let state = null;
let request = 0;

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  signDisplay: 'exceptZero',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Idempotent: safe to call again after the market panel loads, even if it was already
// wired (for example when the page was rendered by ?full=1, with no loading placeholder).
function wireBoard() {
  const el = document.querySelector('[data-board]');
  if (!el || el.dataset.wired) return;
  el.dataset.wired = '1';
  board = el;
  state = {
    id: Number(board.dataset.id),
    side: board.dataset.side === 'sell' ? 'sell' : 'buy',
    leverage: Number(board.dataset.leverage) || 1,
    symbol: textOf('[data-quote-symbol]'),
    name: textOf('[data-quote-name]'),
    bid: num(board.querySelector('[data-instrument].active')?.dataset.bid),
    ask: num(board.querySelector('[data-instrument].active')?.dataset.ask),
    change: num(board.querySelector('[data-instrument].active')?.dataset.change),
  };

  board.addEventListener('click', (event) => {
    const row = event.target.closest('[data-instrument]');
    if (row && board.contains(row)) {
      event.preventDefault();
      select(row);
      return;
    }
    const side = event.target.closest('[data-pick-side]');
    if (side && board.contains(side)) {
      event.preventDefault();
      state.side = side.dataset.pickSide === 'sell' ? 'sell' : 'buy';
      paint();
      writeUrl();
      return;
    }
    const leverage = event.target.closest('[data-pick-leverage]');
    if (leverage && board.contains(leverage)) {
      event.preventDefault();
      const value = Number(leverage.dataset.pickLeverage);
      if (value === 1 || value === 2 || value === 5) state.leverage = value;
      paint();
      writeUrl();
    }
  });

  board.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const notice = board.querySelector('[data-notice]');
    if (notice) notice.hidden = false;
  });
  board.querySelector('[data-amount]')?.addEventListener('input', () => {
    paint();
    writeUrl();
  });
}

// Idempotent for the same reason as wireBoard(), and safe to call before the market
// panel exists: clicking a tile then just falls through to its plain <a href>.
function wireHeatmap() {
  const heatmap = document.querySelector('[data-heatmap]');
  if (!heatmap || heatmap.dataset.wired) return;
  heatmap.dataset.wired = '1';
  const tip = heatmap.querySelector('[data-heat-tip]');

  heatmap.addEventListener('click', (event) => {
    const row = event.target.closest('[data-instrument]');
    if (!row || !board) return;
    event.preventDefault();
    select(row);
  });
  heatmap.addEventListener('pointerover', (event) => {
    const cell = event.target.closest('.heat-cell');
    if (!cell || !tip) return;
    showTip(cell, tip);
    placeTip(event, tip);
  });
  heatmap.addEventListener('pointermove', (event) => {
    if (!tip || tip.hidden) return;
    placeTip(event, tip);
  });
  heatmap.addEventListener('pointerout', (event) => {
    if (!event.target.closest('.heat-cell') || !tip) return;
    const next = event.relatedTarget?.closest?.('.heat-cell');
    if (next) {
      showTip(next, tip);
      return;
    }
    tip.hidden = true;
  });
}

function showTip(cell, tip) {
  const symbol = cell.dataset.symbol || '';
  const name = cell.dataset.name || '';
  const change = num(cell.dataset.change);
  const price = num(cell.dataset.bid) ?? num(cell.dataset.ask);
  const pnl = num(cell.dataset.pnl);
  const side = cell.dataset.side || '';
  tip.querySelector('[data-tip-symbol]').textContent = symbol;
  const nameNode = tip.querySelector('[data-tip-name]');
  nameNode.textContent = name && name !== symbol ? name : '';
  nameNode.hidden = !nameNode.textContent;
  const changeNode = tip.querySelector('[data-tip-change]');
  changeNode.textContent = formatPct(change) || '—';
  changeNode.className = pnlClass(change);
  setTipRow(tip, '[data-tip-price-row]', '[data-tip-price]', price == null ? '' : formatPrice(price), '');
  setTipRow(tip, '[data-tip-side-row]', '[data-tip-side]', side, '');
  setTipRow(tip, '[data-tip-pnl-row]', '[data-tip-pnl]', pnl == null ? '' : signed.format(pnl), pnlClass(pnl));
  tip.hidden = false;
}

function setTipRow(tip, rowSelector, valueSelector, value, valueClass) {
  const row = tip.querySelector(rowSelector);
  const node = tip.querySelector(valueSelector);
  if (!row || !node) return;
  row.hidden = value === '';
  node.textContent = value;
  node.className = valueClass;
}

function placeTip(event, tip) {
  const pad = 16;
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + width > window.innerWidth - 8) x = event.clientX - width - pad;
  if (y + height > window.innerHeight - 8) y = event.clientY - height - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

async function select(row) {
  const id = Number(row.dataset.id);
  if (!Number.isInteger(id) || id <= 0) {
    window.location.href = row.href;
    return;
  }
  state.id = id;
  state.symbol = row.dataset.symbol || state.symbol;
  state.name = row.dataset.name || state.name;
  state.bid = num(row.dataset.bid);
  state.ask = num(row.dataset.ask);
  state.change = num(row.dataset.change);
  board.querySelectorAll('[data-instrument]').forEach((item) => item.classList.toggle('active', item === row));
  document.querySelectorAll('[data-heatmap] [data-instrument]').forEach((item) => item.classList.toggle('active', item === row));
  paint();
  writeUrl();

  const token = ++request;
  const chart = board.querySelector('[data-chart]');
  chart?.classList.add('is-busy');
  try {
    const response = await fetch(`/api/market/instrument?m=${id}`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(String(response.status));
    const body = await response.json();
    if (token !== request) return;
    if (typeof body.symbol === 'string' && body.symbol !== '') state.symbol = body.symbol;
    if (typeof body.name === 'string' && body.name !== '') state.name = body.name;
    state.bid = num(body.bid);
    state.ask = num(body.ask);
    state.change = num(body.changePct);
    paint();
    if (chart) chart.innerHTML = candleSvg(body.candles);
  } catch {
    if (token === request) window.location.href = row.href;
  } finally {
    if (token === request) chart?.classList.remove('is-busy');
  }
}

function paint() {
  setText('[data-quote-symbol]', state.symbol);
  setText('[data-quote-name]', state.name);
  setText('[data-last-px]', formatPrice(state.bid ?? state.ask));
  setText('[data-last-pct]', formatPct(state.change));
  const last = board.querySelector('[data-last]');
  if (last) last.className = `chart-price ${pnlClass(state.change)}`.trim();
  setText('[data-quote-bid]', formatPrice(state.bid));
  setText('[data-quote-ask]', formatPrice(state.ask));
  setText('[data-day]', formatPct(state.change) || '—');
  const day = board.querySelector('[data-day]');
  if (day) day.className = `value ${pnlClass(state.change)}`.trim();

  const action = state.side === 'sell' ? 'Short' : 'Buy';
  const trade = state.side === 'sell' ? state.bid : state.ask;
  setText('[data-trade-at]', `${action} at ${formatPrice(trade)}`);
  setText('[data-ticket-title]', `Order ticket · ${state.symbol}`);
  const button = board.querySelector('button[type="submit"]');
  if (button) {
    button.textContent = `${action} ${state.symbol}`;
    button.className = `ticket-go ${state.side}`;
  }
  board.querySelectorAll('[data-pick-side]').forEach((link) => {
    const on = link.dataset.pickSide === state.side;
    link.className = on ? (state.side === 'sell' ? 'on sell-on' : 'on buy-on') : '';
  });
  board.querySelectorAll('[data-pick-leverage]').forEach((link) => {
    link.className = Number(link.dataset.pickLeverage) === state.leverage ? 'on' : '';
  });
  const sized = amount();
  setText('[data-exposure]', sized == null ? 'Exposure —' : `Exposure ${usd.format(sized * state.leverage)}`);
  const form = board.querySelector('form');
  if (form) {
    form.elements.m.value = String(state.id);
    form.elements.side.value = state.side;
    form.elements.lev.value = String(state.leverage);
  }
}

function writeUrl() {
  const params = new URLSearchParams(window.location.search);
  params.set('m', String(state.id));
  params.set('side', state.side);
  params.set('lev', String(state.leverage));
  const sized = amount();
  if (sized == null) params.delete('amount');
  else params.set('amount', String(sized));
  params.delete('ticket');
  params.delete('full');
  window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
}

function amount() {
  const raw = Number(board.querySelector('[data-amount]')?.value);
  return Number.isFinite(raw) && raw >= 10 && raw <= 1_000_000 ? raw : null;
}

function setText(selector, value) {
  const node = board.querySelector(selector);
  if (node) node.textContent = value;
}

function textOf(selector) {
  return board.querySelector(selector)?.textContent ?? '';
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function pnlClass(value) {
  if (typeof value !== 'number' || value === 0) return '';
  return value > 0 ? 'up' : 'down';
}

function candleSvg(candles) {
  const points = Array.isArray(candles)
    ? candles.filter((candle) => ['open', 'high', 'low', 'close'].every((key) => typeof candle?.[key] === 'number' && Number.isFinite(candle[key])))
    : [];
  if (!points.length) return '<p class="muted">No chart for this market.</p>';
  const width = 640;
  const height = 260;
  const pad = 10;
  const max = Math.max(...points.map((candle) => candle.high));
  const min = Math.min(...points.map((candle) => candle.low));
  const span = max - min || 1;
  const slot = width / points.length;
  const body = Math.max(slot * 0.55, 1.2);
  const y = (price) => pad + ((max - price) / span) * (height - pad * 2);
  const bars = points.map((candle, index) => {
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

// Progressive loading: each slow panel starts as a <section data-panel="..."> skeleton
// (see pages.js). Fetch its real content and swap it into the same spot, so page order
// never changes. Query params (m, side, lev, amount) carry over so the market and heat
// map panels build the same ticket the shell was requested with.
async function loadHtmlPanel(placeholder, url, { quietFail = false } = {}) {
  try {
    const response = await fetch(url, { headers: { accept: 'text/html' } });
    if (!response.ok) throw new Error(String(response.status));
    const html = (await response.text()).trim();
    if (!html) {
      placeholder.remove();
      return;
    }
    placeholder.outerHTML = html;
  } catch {
    if (quietFail) {
      placeholder.remove();
      return;
    }
    placeholder.classList.remove('panel-loading');
    placeholder.innerHTML = '<p class="muted small">Could not load this panel. <a href="?full=1">Reload</a></p>';
  }
}

async function loadPortfolioPanel(placeholder) {
  const extras = document.querySelector('[data-panel="extras"]');
  try {
    const response = await fetch('/api/panel/portfolio', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(String(response.status));
    const body = await response.json();
    if (typeof body.portfolio === 'string' && body.portfolio) placeholder.outerHTML = body.portfolio;
    if (extras) {
      if (typeof body.extras === 'string' && body.extras) {
        extras.outerHTML = body.extras;
      } else {
        extras.remove();
      }
    }
  } catch {
    placeholder.classList.remove('panel-loading');
    placeholder.innerHTML = '<div class="panel-head"><p class="eyebrow"><span class="dot" aria-hidden="true"></span>Real account</p><h1>Portfolio</h1></div><p class="muted small">Could not load the portfolio. <a href="?full=1">Reload</a></p>';
    extras?.remove();
  }
}

async function loadPanels() {
  const jobs = [];
  const portfolioPanel = document.querySelector('[data-panel="portfolio"]');
  if (portfolioPanel) jobs.push(loadPortfolioPanel(portfolioPanel));

  const marketPanel = document.querySelector('[data-panel="market"]');
  if (marketPanel) {
    jobs.push(
      loadHtmlPanel(marketPanel, `/api/panel/market${window.location.search}`).then(() => {
        wireBoard();
        wireHeatmap();
      }),
    );
  }

  const heatmapPanel = document.querySelector('[data-panel="heatmap"]');
  if (heatmapPanel) {
    jobs.push(
      loadHtmlPanel(heatmapPanel, `/api/panel/heatmap${window.location.search}`, { quietFail: true }).then(() => wireHeatmap()),
    );
  }

  await Promise.allSettled(jobs);
}

// Runs immediately for the ?full=1 / no-JS-fallback page, where every panel is already
// in the DOM. On the normal (fast) page these find nothing yet and simply do nothing.
wireBoard();
wireHeatmap();
loadPanels();
