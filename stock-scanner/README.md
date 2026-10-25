# Stock Playlists

A one-page day-trading scanner with a friendly, playlist-style layout.

## Run it with full data (recommended)

```
node stock-scanner/server.mjs        # Node 18+, no npm install needed
# open http://localhost:8787
```

Check that every data source answers from your machine before you open the page:

```
node stock-scanner/server.mjs --check        # or --check TSLA
```

It prints one OK / FAIL line per source with the reason for any failure, and exits non-zero if a required source failed.

Optional environment variables:

- `SEC_USER_AGENT="Your Name you@example.com"`: SEC EDGAR asks every client to identify itself and may block anonymous requests.
- `FINNHUB_KEY=...`: adds Finnhub insider sentiment and Finnhub news.
- `PORT=8787`

The server fetches and merges these sources, with in-memory caching and per-host rate limits:

| Source | What it adds |
| --- | --- |
| Yahoo Finance | Quotes incl. pre-market and after-hours, 6-month daily bars (RVOL, ATR, 20/50-day averages), 5-minute bars (VWAP, pre-market high/low, 15-minute opening range), options chain (put/call ratio, ATM IV, implied move, unusual options activity), short interest and float, institutional and insider ownership, top holders, insider transactions, analyst recommendation trend, price targets, upgrades and downgrades, earnings date, day gainers/losers/most active and trending tickers |
| Google | Google News headlines (RSS) and a Google Finance price cross-check |
| SEC EDGAR | Form 4 count (30 days), 13D/13G filings (90 days), latest 8-K with link |
| FINRA | Daily short-sale volume ratio (Reg SHO files) |
| StockTwits | Bullish/bearish share of tagged posts, watcher count |
| Finnhub (optional) | Insider sentiment (MSPR), company news |

### Source status (checked 2026-10-25)

| Source | Endpoint | Status |
| --- | --- | --- |
| SEC EDGAR | `www.sec.gov/files/company_tickers.json`, `data.sec.gov/submissions/CIK##########.json` | Verified live: `cik_str`/`ticker` and the `filings.recent` arrays (`filingDate`, `accessionNumber`) match the parser. `form` and `primaryDocument` are documented fields in the same arrays. |
| FINRA | `cdn.finra.org/equity/regsho/daily/CNMSshvolYYYYMMDD.txt` | Verified live. Volumes now have decimals and the parser handles that, Windows line endings and the trailer line. Files appear after the close, so the server walks back up to a week. |
| StockTwits | `api.stocktwits.com/api/2/streams/symbol/SYM.json` | Verified live: `symbol.watchlist_count` and `messages[].entities.sentiment.basic` match the parser. |
| Yahoo Finance | `query1/query2.finance.yahoo.com` chart v8, quote v7, quoteSummary v10, options v7, screener, trending, search | **Not live-tested**: Yahoo blocks automated checks from cloud servers. Code follows what current open-source clients (yahoo-finance2 v4, yfinance 1.x) use. Run `--check` to confirm on your machine. |
| Google News | `news.google.com/rss/search` | **Not live-tested** (blocked to automated checks). The RSS format has been stable for years. |
| Google Finance | `www.google.com/finance/quote/SYM:EXCH` | Page reachable and showing prices, but the HTML attribute couldn't be inspected. The parser now tries three patterns (`data-last-price`, the price div, embedded data). It's only a cross-check, so nothing breaks if it fails. |
| Finnhub (optional) | `finnhub.io/api/v1/...` | Official documented API, needs your key, not tested here. |

### When a source fails

- **Yahoo quote API refuses the session** (no cookie, consent page in the EU, crumb refused, or 429 rate limit): quotes fall back to Yahoo's chart endpoint, which needs no session. Prices, change and day range still work; pre/after-hours, P/E and analyst rating show a dash until the session works again. The server waits five minutes before retrying the handshake.
- **Yahoo answers 429 or 5xx on one host**: the request is retried once on the other host (query1 ↔ query2).
- **Any other source fails**: its fields show a dash, the score uses the remaining signals, and the failure isn't cached, so the next scan tries again. The page lists each source as OK or failing at the bottom (hover for the reason).
- **SEC answers 403**: set `SEC_USER_AGENT` with a real name and email.
- **Nothing answers at all**: the page says so and shows clearly labelled sample data.

Yahoo's and Google's endpoints are unofficial and can change or rate-limit without notice.

## Without the server

Open `index.html` directly and add a free [Finnhub](https://finnhub.io/register) key under **My watchlist & data**. Without a key or the server it runs on simulated sample prices (clearly labelled).

## What it shows

- **Buy / sell signal**: each stock gets Strong buy, Buy, Hold, Sell or Strong sell, scored −100 to +100, with the reasons for and against and a confidence level. It blends analyst consensus (Yahoo Finance, plus Finnhub when `FINNHUB_KEY` is set) 25%, upgrades/downgrades and the change in buy ratings over 30 days 15%, upside to the average price target 20% (about +8% counts as neutral), the chart (20/50-day averages, 3-month return, RSI) 20%, revenue and earnings growth and margin 10%, insiders 5%, and options put/call plus StockTwits 5%. A buy call in a clear downtrend, or a sell call on a rising stock analysts like, is held to Hold. Playlists: Strong buy signals, All buy signals, Sell signals. In server mode the scan also pulls in a few names from Yahoo's undervalued large caps and growth tech screeners.
- **Market mood**: SPY, QQQ, IWM, DIA, TLT, GLD and VIX futures, the 11 sector ETFs as a heatmap, and a Risk-on / Mixed / Risk-off call.
- **Playlists**: top picks, big movers at the open, crowds piling in (unusual volume), new highs, insiders buying, analysts warming up, earnings this week, unusual options activity, short squeeze watch, fresh Wall St upgrades, and Yahoo movers & trending (added to your watchlist automatically).
- **Score**: six 0–100 readings in the direction of each stock's bias: relative strength, relative volume, trend, Wall Street and insiders, options and shorts, and catalysts (weights 20/20/20/15/10/15), with a plain-language "why it's on the list" summary.
- **Stock sheet**: chart, key prices, session (pre/post-market, VWAP, opening range), Wall Street targets and rating changes, ownership, options flow, short interest and crowd sentiment, SEC filings, position sizing with 1R/2R/3R targets, and merged headlines.

Research tool, not investment advice.
