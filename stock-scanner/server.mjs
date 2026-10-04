#!/usr/bin/env node
// Stock Playlists data server.
// Serves index.html and merges Yahoo Finance, Google News, Google Finance, SEC EDGAR, FINRA short volume,
// StockTwits and (optionally) Finnhub into one JSON feed. Browsers can't call most of these directly, so
// the page talks to this server instead.
//
//   node stock-scanner/server.mjs            then open http://localhost:8787
//
// Optional environment:
//   PORT=8787
//   SEC_USER_AGENT="Your Name you@example.com"   SEC asks every client to identify itself
//   FINNHUB_KEY=...                              adds Finnhub insider sentiment (MSPR)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const SEC_UA = process.env.SEC_USER_AGENT || 'StockPlaylists/1.0 research-tool (set SEC_USER_AGENT)';
const FINNHUB_KEY = process.env.FINNHUB_KEY || '';
const MIN = 60e3, HOUR = 60 * MIN;

/* ---------- plumbing ---------- */
export const health = {};
function mark(src, ok, err) {
  const h = health[src] ||= { ok: 0, fail: 0, lastError: null, lastOk: null };
  if (ok) { h.ok++; h.lastOk = new Date().toISOString(); } else { h.fail++; h.lastError = String(err).slice(0, 200); }
}
const cache = new Map();
function memo(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.p;
  const p = fn();
  cache.set(key, { p, exp: Date.now() + ttl });
  p.catch(() => cache.delete(key));
  return p;
}
function limiter(n) {
  let active = 0; const q = [];
  const next = () => {
    if (active >= n || !q.length) return;
    active++;
    const { fn, res, rej } = q.shift();
    fn().then(res, rej).finally(() => { active--; next(); });
  };
  return fn => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
}
const lim = { yahoo: limiter(4), google: limiter(2), sec: limiter(4), other: limiter(3) };

async function get(url, { src, headers = {}, type = 'json', timeout = 12000 } = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: type === 'json' ? 'application/json' : '*/*', ...headers }, signal: ctl.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
    const out = type === 'json' ? await res.json() : await res.text();
    mark(src, true);
    return out;
  } catch (e) {
    mark(src, false, e.name === 'AbortError' ? `timeout from ${new URL(url).host}` : e.message);
    throw e;
  } finally { clearTimeout(t); }
}
const raw = v => v && typeof v === 'object' && 'raw' in v ? v.raw : v;
const num = v => { const x = raw(v); return typeof x === 'number' && isFinite(x) ? x : null; };
const settle = async p => { try { return await p; } catch { return null; } };
const ymd = d => d.toISOString().slice(0, 10);
const sma = (a, n) => a.length >= n ? a.slice(-n).reduce((x, y) => x + y, 0) / n : null;
function atr(h, l, c, n = 14) {
  if (c.length < n + 1) return null;
  const tr = [];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  return tr.slice(-n).reduce((x, y) => x + y, 0) / n;
}

/* ---------- Yahoo Finance ---------- */
let yAuth = null;
async function yahooAuth(force) {
  if (yAuth && !force && yAuth.exp > Date.now()) return yAuth;
  const r = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const cookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  const cookie = cookies.map(c => c.split(';')[0]).join('; ');
  const res = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie } });
  const crumb = (await res.text()).trim();
  if (!res.ok || !crumb || crumb.length > 64 || crumb.includes('<')) { mark('yahoo', false, 'Yahoo did not issue a session crumb'); throw new Error('no crumb'); }
  yAuth = { cookie, crumb, exp: Date.now() + 6 * HOUR };
  return yAuth;
}
function yget(url, crumb = false) {
  return lim.yahoo(async () => {
    for (let attempt = 0; ; attempt++) {
      let u = url; const headers = {};
      if (crumb) { const a = await yahooAuth(attempt > 0); u += (u.includes('?') ? '&' : '?') + 'crumb=' + encodeURIComponent(a.crumb); headers.Cookie = a.cookie; }
      try { return await get(u, { src: 'yahoo', headers }); } catch (e) {
        if (!crumb || attempt > 0 || !/^(401|403)/.test(e.message)) throw e;
      }
    }
  });
}

export async function yQuotes(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 40) {
    const chunk = symbols.slice(i, i + 40);
    const j = await memo('yq:' + chunk.join(','), 15e3, () => yget(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}`, true));
    for (const q of j?.quoteResponse?.result || []) out[q.symbol] = q;
  }
  return out;
}
function bars(res) {
  const q = res?.indicators?.quote?.[0] || {}, t = res?.timestamp || [];
  const rows = [];
  for (let i = 0; i < t.length; i++) if (q.close?.[i] != null) rows.push({ t: t[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume?.[i] || 0 });
  return rows;
}
const yDaily = sym => memo('yd:' + sym, 10 * MIN, async () =>
  bars((await yget(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=6mo&interval=1d`))?.chart?.result?.[0]));
const yIntraday = sym => memo('yi:' + sym, MIN, async () => {
  const r = (await yget(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=5m&includePrePost=true`))?.chart?.result?.[0];
  const b = bars(r), reg = r?.meta?.currentTradingPeriod?.regular;
  if (!b.length || !reg) return null;
  const pre = b.filter(x => x.t < reg.start), day = b.filter(x => x.t >= reg.start && x.t < reg.end);
  let pv = 0, vv = 0; for (const x of day) { pv += (x.h + x.l + x.c) / 3 * x.v; vv += x.v; }
  const or = day.slice(0, 3);
  return {
    vwap: vv ? pv / vv : null,
    preHigh: pre.length ? Math.max(...pre.map(x => x.h)) : null, preLow: pre.length ? Math.min(...pre.map(x => x.l)) : null,
    preVol: pre.reduce((a, x) => a + x.v, 0) || null,
    orHigh: or.length === 3 ? Math.max(...or.map(x => x.h)) : null, orLow: or.length === 3 ? Math.min(...or.map(x => x.l)) : null,
    path: b.map(x => x.c)
  };
});
const MODULES = 'assetProfile,defaultKeyStatistics,financialData,recommendationTrend,upgradeDowngradeHistory,majorHoldersBreakdown,institutionOwnership,insiderTransactions,calendarEvents';
const ySummary = sym => memo('ys:' + sym, HOUR, async () =>
  (await yget(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${MODULES}`, true))?.quoteSummary?.result?.[0] || null);
const yOptions = sym => memo('yo:' + sym, 5 * MIN, async () =>
  (await yget(`https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(sym)}`, true))?.optionChain?.result?.[0] || null);
const yNews = sym => memo('yn:' + sym, 10 * MIN, async () =>
  ((await yget(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(sym)}&quotesCount=0&newsCount=8`))?.news || [])
    .map(n => ({ title: n.title, url: n.link, source: n.publisher, time: (n.providerPublishTime || 0) * 1000, via: 'Yahoo Finance' })));

export const yMovers = () => memo('ymov', 2 * MIN, async () => {
  const screen = async id => ((await settle(yget(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${id}&count=15`)))
    ?.finance?.result?.[0]?.quotes || []).map(q => q.symbol);
  const [gainers, losers, actives, trend] = await Promise.all([
    screen('day_gainers'), screen('day_losers'), screen('most_actives'),
    settle(yget('https://query1.finance.yahoo.com/v1/finance/trending/US?count=15'))
  ]);
  const trending = (trend?.finance?.result?.[0]?.quotes || []).map(q => q.symbol).filter(s => /^[A-Z.\-]{1,6}$/.test(s));
  return { gainers, losers, actives, trending };
});

export function parseOptions(chain, price) {
  const o = chain?.options?.[0]; if (!o) return null;
  const calls = o.calls || [], puts = o.puts || [];
  const sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0);
  const callVol = sum(calls, 'volume'), putVol = sum(puts, 'volume');
  const px = price ?? chain?.quote?.regularMarketPrice;
  const near = a => a.reduce((b, x) => !b || Math.abs(x.strike - px) < Math.abs(b.strike - px) ? x : b, null);
  const c = near(calls), p = near(puts);
  const mid = x => x && x.bid > 0 && x.ask > 0 ? (x.bid + x.ask) / 2 : x?.lastPrice;
  const straddle = c && p ? mid(c) + mid(p) : null;
  const unusual = [...calls.map(x => ({ ...x, type: 'Call' })), ...puts.map(x => ({ ...x, type: 'Put' }))]
    .filter(x => (x.volume || 0) >= 500 && x.volume > 2 * (x.openInterest || 0))
    .sort((a, b) => b.volume - a.volume).slice(0, 6)
    .map(x => ({ type: x.type, strike: x.strike, volume: x.volume, oi: x.openInterest || 0, iv: x.impliedVolatility }));
  return {
    exp: o.expirationDate ? ymd(new Date(o.expirationDate * 1000)) : null,
    callVol, putVol, pc: callVol ? putVol / callVol : null,
    atmIV: c && p ? ((c.impliedVolatility || 0) + (p.impliedVolatility || 0)) / 2 : null,
    movePct: straddle && px ? straddle / px * 100 : null,
    unusual, unusualCalls: unusual.filter(x => x.type === 'Call').length, unusualPuts: unusual.filter(x => x.type === 'Put').length
  };
}

export function parseSummary(s) {
  if (!s) return {};
  const ks = s.defaultKeyStatistics || {}, fd = s.financialData || {}, mh = s.majorHoldersBreakdown || {}, ap = s.assetProfile || {};
  const out = {
    sector: ap.sector || null, industry: ap.industry || null,
    float: num(ks.floatShares), shortPctFloat: num(ks.shortPercentOfFloat) != null ? num(ks.shortPercentOfFloat) * 100 : null,
    shortRatio: num(ks.shortRatio),
    shortChg: num(ks.sharesShort) && num(ks.sharesShortPriorMonth) ? (num(ks.sharesShort) / num(ks.sharesShortPriorMonth) - 1) * 100 : null,
    instPct: num(mh.institutionsPercentHeld) != null ? num(mh.institutionsPercentHeld) * 100 : num(ks.heldPercentInstitutions) != null ? num(ks.heldPercentInstitutions) * 100 : null,
    insiderPct: num(mh.insidersPercentHeld) != null ? num(mh.insidersPercentHeld) * 100 : null,
    instCount: num(mh.institutionsCount),
    target: num(fd.targetMeanPrice) ? { mean: num(fd.targetMeanPrice), high: num(fd.targetHighPrice), low: num(fd.targetLowPrice), n: num(fd.numberOfAnalystOpinions), key: fd.recommendationKey || null } : null
  };
  const tr = s.recommendationTrend?.trend || [];
  const t0 = tr.find(x => x.period === '0m'), t1 = tr.find(x => x.period === '-1m');
  const tot = x => x.strongBuy + x.buy + x.hold + x.sell + x.strongSell, b = x => x.strongBuy + x.buy;
  if (t0 && tot(t0)) { out.buyPct = b(t0) / tot(t0) * 100; out.analysts = tot(t0); out.anaDelta = t1 ? b(t0) - b(t1) : 0; }
  const since = Date.now() / 1000 - 30 * 86400;
  out.upgrades = (s.upgradeDowngradeHistory?.history || []).filter(h => h.epochGradeDate >= since).slice(0, 8)
    .map(h => ({ date: ymd(new Date(h.epochGradeDate * 1000)), firm: h.firm, from: h.fromGrade || '', to: h.toGrade || '', action: h.action }));
  out.holders = (s.institutionOwnership?.ownershipList || []).slice(0, 5)
    .map(h => ({ org: h.organization, pct: num(h.pctHeld) != null ? num(h.pctHeld) * 100 : null, chg: num(h.pctChange) != null ? num(h.pctChange) * 100 : null, date: h.reportDate?.fmt || null }));
  const cutoff = Date.now() / 1000 - 90 * 86400;
  const tx = (s.insiderTransactions?.transactions || []).filter(x => (num(x.startDate) ?? 0) >= cutoff);
  let buys = 0, sells = 0;
  for (const x of tx) { const v = num(x.value) || 0, t = (x.transactionText || '').toLowerCase(); if (t.includes('purchase')) buys += v; else if (t.includes('sale')) sells += v; }
  out.insiderNet = buys - sells;
  out.mspr = buys + sells > 0 ? (buys - sells) / (buys + sells) * 100 : null;
  out.insiderTx = tx.filter(x => num(x.value)).slice(0, 5).map(x => ({ who: x.filerName, rel: x.filerRelation, text: x.transactionText, value: num(x.value), date: ymd(new Date(num(x.startDate) * 1000)) }));
  const ed = s.calendarEvents?.earnings?.earningsDate?.[0];
  out.earnDate = num(ed) ? ymd(new Date(num(ed) * 1000)) : null;
  return out;
}

/* ---------- Google ---------- */
const decode = s => s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
export function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const tag = n => decode((it.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)) || [])[1] || '').trim();
    const source = tag('source');
    let title = tag('title'); if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    return { title, url: tag('link'), source, time: Date.parse(tag('pubDate')) || 0, via: 'Google News' };
  }).filter(x => x.title);
}
const gNews = (sym, name) => memo('gn:' + sym, 10 * MIN, async () => {
  const q = name ? `"${sym}" OR "${name.replace(/,? (Inc|Corp|Corporation|Ltd|plc|Holdings|Co)\.?$/i, '')}" stock when:3d` : `"${sym}" stock when:3d`;
  const xml = await lim.google(() => get(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, { src: 'google', type: 'text' }));
  return parseRss(xml).slice(0, 12);
});
const GX = { NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ', NAS: 'NASDAQ', NYQ: 'NYSE', NYS: 'NYSE', ASE: 'NYSEAMERICAN', PCX: 'NYSEARCA', BTS: 'BATS' };
const gFinance = (sym, exch) => memo('gf:' + sym, MIN, async () => {
  const gx = GX[exch]; if (!gx) return null;
  const html = await lim.google(() => get(`https://www.google.com/finance/quote/${encodeURIComponent(sym.replace('-', '.'))}:${gx}?hl=en`, { src: 'google', type: 'text' }));
  const m = html.match(/data-last-price="([\d.]+)"/);
  return m ? { price: +m[1] } : null;
});

/* ---------- SEC EDGAR ---------- */
const secTickers = () => memo('sec:tickers', 24 * HOUR, async () => {
  const j = await lim.sec(() => get('https://www.sec.gov/files/company_tickers.json', { src: 'sec', headers: { 'User-Agent': SEC_UA } }));
  const map = {}; for (const k in j) map[j[k].ticker] = j[k].cik_str; return map;
});
const secFilings = sym => memo('sec:' + sym, HOUR, async () => {
  const cik = (await secTickers())[sym.replace('.', '-')]; if (!cik) return null;
  const j = await lim.sec(() => get(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, { src: 'sec', headers: { 'User-Agent': SEC_UA } }));
  const r = j?.filings?.recent || {}, now = Date.now();
  const age = d => (now - Date.parse(d)) / 864e5;
  let form4 = 0, own = 0, last8k = null;
  (r.form || []).forEach((f, i) => {
    const d = r.filingDate[i];
    if (f === '4' && age(d) <= 30) form4++;
    if (/13D|13G/.test(f) && age(d) <= 90) own++;
    if (f === '8-K' && !last8k) last8k = { date: d, url: `https://www.sec.gov/Archives/edgar/data/${cik}/${r.accessionNumber[i].replace(/-/g, '')}/${r.primaryDocument[i]}` };
  });
  return { form4_30d: form4, own13_90d: own, last8k };
});

/* ---------- FINRA daily short-sale volume ---------- */
export function parseFinra(txt) {
  const map = {};
  for (const line of txt.split('\n').slice(1)) {
    const [date, sym, short, , total] = line.split('|');
    if (sym && +total > 0) map[sym] = { ratio: +short / +total, date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` };
  }
  return map;
}
const finra = () => memo('finra', 3 * HOUR, async () => {
  for (let back = 0; back < 7; back++) {
    const d = new Date(Date.now() - back * 864e5); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const txt = await settle(lim.other(() => get(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${ymd(d).replace(/-/g, '')}.txt`, { src: 'finra', type: 'text' })));
    if (txt && txt.includes('|')) return parseFinra(txt);
  }
  return {};
});

/* ---------- StockTwits ---------- */
const social = sym => memo('st:' + sym, 5 * MIN, async () => {
  const j = await lim.other(() => get(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(sym)}.json`, { src: 'stocktwits' }));
  const msgs = j?.messages || [];
  let bull = 0, bear = 0; for (const m of msgs) { const s = m.entities?.sentiment?.basic; if (s === 'Bullish') bull++; else if (s === 'Bearish') bear++; }
  const ts = msgs.map(m => Date.parse(m.created_at)).filter(Boolean), span = ts.length > 1 ? (Math.max(...ts) - Math.min(...ts)) / HOUR : null;
  return { bull, bear, n: msgs.length, bullPct: bull + bear >= 5 ? bull / (bull + bear) * 100 : null, watchers: j?.symbol?.watchlist_count ?? null, perHour: span ? msgs.length / Math.max(span, .1) : null };
});

/* ---------- Finnhub (optional) ---------- */
const fhMspr = sym => !FINNHUB_KEY ? Promise.resolve(null) : memo('fh:' + sym, 12 * HOUR, async () => {
  const now = new Date(), from = new Date(now - 120 * 864e5);
  const j = await lim.other(() => get(`https://finnhub.io/api/v1/stock/insider-sentiment?symbol=${sym}&from=${ymd(from)}&to=${ymd(now)}&token=${FINNHUB_KEY}`, { src: 'finnhub' }));
  const d = (j?.data || []).slice(-3); return d.length ? d.reduce((a, x) => a + (x.mspr || 0), 0) / d.length : null;
});
const fhNews = sym => !FINNHUB_KEY ? Promise.resolve([]) : memo('fhn:' + sym, 10 * MIN, async () => {
  const now = new Date();
  const j = await lim.other(() => get(`https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${ymd(new Date(now - 4 * 864e5))}&to=${ymd(now)}&token=${FINNHUB_KEY}`, { src: 'finnhub' }));
  return (j || []).slice(0, 8).map(n => ({ title: n.headline, url: n.url, source: n.source, time: n.datetime * 1000, via: 'Finnhub' }));
});

/* ---------- assemble ---------- */
export async function buildRow(sym, q, shortMap) {
  if (!q || q.regularMarketPrice == null) return null;
  const [daily, intra, summary, chain, filings, st, fhm, gf, gn] = await Promise.all([
    settle(yDaily(sym)), settle(yIntraday(sym)), settle(ySummary(sym)), settle(yOptions(sym)),
    settle(secFilings(sym)), settle(social(sym)), settle(fhMspr(sym)), settle(gFinance(sym, q.exchange)), settle(gNews(sym, q.longName || q.shortName))
  ]);
  const pre = ['PRE', 'PREPRE'].includes(q.marketState) && q.preMarketPrice;
  const r = {
    sym, name: q.longName || q.shortName || sym, exchange: q.fullExchangeName || q.exchange, marketState: q.marketState,
    price: pre ? q.preMarketPrice : q.regularMarketPrice,
    prevClose: pre ? q.regularMarketPrice : q.regularMarketPreviousClose,
    chgPct: pre ? q.preMarketChangePercent : q.regularMarketChangePercent,
    open: pre ? null : q.regularMarketOpen, high: q.regularMarketDayHigh, low: q.regularMarketDayLow,
    volume: q.regularMarketVolume, marketCap: q.marketCap ?? null,
    hi52: q.fiftyTwoWeekHigh, lo52: q.fiftyTwoWeekLow,
    pre: q.preMarketPrice ? { price: q.preMarketPrice, chgPct: q.preMarketChangePercent } : null,
    post: q.postMarketPrice ? { price: q.postMarketPrice, chgPct: q.postMarketChangePercent } : null,
    pe: q.trailingPE ?? null, fwdPe: q.forwardPE ?? null
  };
  r.gapPct = pre ? r.chgPct : q.regularMarketOpen && q.regularMarketPreviousClose ? (q.regularMarketOpen / q.regularMarketPreviousClose - 1) * 100 : null;
  if (daily?.length) {
    const today = ymd(new Date()), last = daily.at(-1), hasToday = ymd(new Date(last.t * 1000)) === today && !pre;
    const hist = hasToday ? daily.slice(0, -1) : daily;
    const c = [...hist.map(x => x.c), r.price], h = [...hist.map(x => x.h), Math.max(r.high ?? r.price, r.price)], l = [...hist.map(x => x.l), Math.min(r.low ?? r.price, r.price)];
    r.closes = c; r.highs = h; r.lows = l; r.sma20 = sma(c, 20); r.sma50 = sma(c, 50); r.atr = atr(h, l, c);
    r.avgVol = sma(hist.map(x => x.v), 20);
  }
  r.avgVol ??= q.averageDailyVolume10Day ?? null;
  if (pre && intra?.preVol) r.volume = intra.preVol;
  Object.assign(r, intra ? { vwap: intra.vwap, preHigh: intra.preHigh, preLow: intra.preLow, orHigh: intra.orHigh, orLow: intra.orLow, intraday: intra.path } : {});
  const s = parseSummary(summary);
  Object.assign(r, s, { industry: s.industry || s.sector || q.quoteType || '—' });
  if (fhm != null) r.mspr = fhm;
  r.options = parseOptions(chain, r.price);
  r.finraShort = shortMap?.[sym] || null;
  r.social = st; r.sec = filings; r.google = gf;
  r.newsCount = (gn || []).filter(n => Date.now() - n.time < 2 * 864e5).length;
  r.sources = { yahoo: true, yahooSummary: !!summary, options: !!r.options, google: !!(gf || gn), sec: !!filings, finra: !!r.finraShort, stocktwits: !!st, finnhub: fhm != null };
  return r;
}

export async function scan(symbols) {
  const [quotes, shortMap] = await Promise.all([yQuotes(symbols), settle(finra())]);
  const rows = await Promise.all(symbols.map(s => settle(buildRow(s, quotes[s], shortMap))));
  return rows.filter(Boolean);
}
async function news(sym, name) {
  const lists = await Promise.all([settle(gNews(sym, name)), settle(yNews(sym)), settle(fhNews(sym))]);
  const seen = new Set(), out = [];
  for (const n of lists.flat().filter(Boolean).sort((a, b) => b.time - a.time)) {
    const k = n.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (!seen.has(k)) { seen.add(k); out.push(n); }
  }
  return out.slice(0, 14);
}

/* ---------- http ---------- */
const symList = s => [...new Set(String(s || '').toUpperCase().split(/[\s,]+/).filter(t => /^[A-Z.\-^]{1,10}$/.test(t)))].slice(0, 60);
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
export const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname === '/' || u.pathname === '/index.html') return send(res, 200, await fs.readFile(path.join(DIR, 'index.html'), 'utf8'), 'text/html');
    if (u.pathname === '/api/health') return send(res, 200, { ok: true, sources: health, finnhub: !!FINNHUB_KEY, secUserAgent: !!process.env.SEC_USER_AGENT });
    if (u.pathname === '/api/market') {
      const q = await yQuotes(symList(u.searchParams.get('symbols')));
      return send(res, 200, Object.values(q).map(x => ({ sym: x.symbol, price: x.regularMarketPrice, chgPct: ['PRE', 'PREPRE'].includes(x.marketState) && x.preMarketChangePercent != null ? x.preMarketChangePercent : x.regularMarketChangePercent })));
    }
    if (u.pathname === '/api/movers') return send(res, 200, await yMovers());
    if (u.pathname === '/api/scan') return send(res, 200, await scan(symList(u.searchParams.get('symbols'))));
    if (u.pathname === '/api/news') return send(res, 200, await news(symList(u.searchParams.get('symbol'))[0] || '', u.searchParams.get('name') || ''));
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 502, { error: e.message || String(e), sources: health });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`Stock Playlists running at http://localhost:${PORT}`);
    if (!process.env.SEC_USER_AGENT) console.log('Tip: set SEC_USER_AGENT="Your Name you@example.com" so SEC EDGAR accepts requests.');
    if (!FINNHUB_KEY) console.log('Optional: set FINNHUB_KEY to add Finnhub insider sentiment and news.');
  });
}
