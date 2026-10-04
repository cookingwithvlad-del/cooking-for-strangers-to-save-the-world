# Stock Playlists

A one-page day-trading scanner. Open `index.html` in a browser, click **My watchlist & data**, paste a free [Finnhub](https://finnhub.io/register) API key and load live data. Without a key it runs on simulated sample prices (clearly labelled).

What it shows:

- **Market regime**: SPY, QQQ, IWM, DIA, TLT, GLD and VIX futures (VIXY), the 11 SPDR sector ETFs as a heatmap, and a Risk-on / Mixed / Risk-off call from breadth, cyclical-vs-defensive spread, index trend and volatility.
- **Scanner**: every watchlist ticker scored 0–100 in the direction of its bias (long/short) from relative strength vs SPY, time-adjusted relative volume, trend (20/50-day averages, 52-week position), institutional sentiment (analyst consensus and its one-month change, insider buying from SEC Form 4 via Finnhub's MSPR) and catalysts (earnings proximity, news, gap size). Scans are grouped as playlists: top picks (A/B), big movers at the open, crowds piling in (unusual volume), new highs, insiders buying, analysts warming up, earnings this week. Each stock gets a plain-language "why it's on the list" summary.
- **Ticket**: 60-session chart with the 20-day average and 52-week high, key levels, score breakdown, risk-based position sizing with 1R/2R/3R targets, and recent headlines.

Free Finnhub keys allow 60 calls a minute; the page throttles itself and caches fundamentals for the day, so the first load of 20 tickers takes about two minutes and refreshes only pull quotes. If the key's plan doesn't include daily bars, RVOL, ATR and moving averages stay blank and the score uses the remaining signals.

The key, watchlist and account settings are saved in the browser's localStorage only. Research tool, not investment advice.
