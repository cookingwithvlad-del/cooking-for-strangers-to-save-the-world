# Stock Playlists

A one-page day-trading scanner with a friendly, playlist-style layout.

## Run it with full data (recommended)

```
node stock-scanner/server.mjs        # Node 18+, no npm install needed
# open http://localhost:8787
```

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

Yahoo's and Google's endpoints are unofficial and can change or rate-limit without notice. The page shows each source's status at the bottom. Any field a source can't supply shows as a dash, and the score uses the remaining signals.

## Without the server

Open `index.html` directly and add a free [Finnhub](https://finnhub.io/register) key under **My watchlist & data**. Without a key or the server it runs on simulated sample prices (clearly labelled).

## What it shows

- **Market mood**: SPY, QQQ, IWM, DIA, TLT, GLD and VIX futures, the 11 sector ETFs as a heatmap, and a Risk-on / Mixed / Risk-off call.
- **Playlists**: top picks, big movers at the open, crowds piling in (unusual volume), new highs, insiders buying, analysts warming up, earnings this week, unusual options activity, short squeeze watch, fresh Wall St upgrades, and Yahoo movers & trending (added to your watchlist automatically).
- **Score**: six 0–100 readings in the direction of each stock's bias: relative strength, relative volume, trend, Wall Street and insiders, options and shorts, and catalysts (weights 20/20/20/15/10/15), with a plain-language "why it's on the list" summary.
- **Stock sheet**: chart, key prices, session (pre/post-market, VWAP, opening range), Wall Street targets and rating changes, ownership, options flow, short interest and crowd sentiment, SEC filings, position sizing with 1R/2R/3R targets, and merged headlines.

Research tool, not investment advice.
