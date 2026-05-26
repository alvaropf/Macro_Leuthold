// /api/yahoo — Vercel serverless proxy for Yahoo Finance historical data
//
// Why this exists:
//   - The dashboard's original "fetchStooq" calls (^spx, ^rut, xauusd, ^spgsci)
//     are equity / commodity index series that aren't on FRED.
//   - Yahoo Finance has a public, key-free historical chart endpoint that
//     returns JSON. CORS is closed in some regions, so we proxy it.
//   - We translate the Stooq-style symbols to Yahoo tickers.
//
// Symbol mapping (Stooq → Yahoo):
//   ^spx     → ^GSPC    (S&P 500)
//   ^rut     → ^RUT     (Russell 2000)
//   xauusd   → GC=F     (Gold futures, continuous)
//   ^spgsci  → ^SPGSCI  (S&P GSCI commodity index)
//
// Usage:
//   GET /api/yahoo?symbol=^spx&start=2000-01-01

const SYMBOL_MAP = {
  '^spx': '^GSPC',
  '^rut': '^RUT',
  'xauusd': 'GC=F',
  '^spgsci': '^SPGSCI',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { symbol, start } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing required query param: symbol' });
  }

  const yahooSymbol = SYMBOL_MAP[symbol.toLowerCase()] || symbol;
  const startDate = start || '2000-01-01';
  const period1 = Math.floor(new Date(startDate).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}` +
              `?period1=${period1}&period2=${period2}&interval=1d&events=history`;

  try {
    const yahooResp = await fetch(url, {
      // Yahoo blocks requests without a realistic User-Agent
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DL-Macro-Dashboard/1.0)',
        'Accept': 'application/json',
      },
    });

    if (!yahooResp.ok) {
      return res.status(yahooResp.status).json({
        error: `Yahoo Finance error ${yahooResp.status} for ${yahooSymbol}`,
      });
    }

    const json = await yahooResp.json();
    const result = json?.chart?.result?.[0];
    if (!result) {
      return res.status(500).json({ error: `No data returned for ${yahooSymbol}` });
    }

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    // Prefer adjusted close when available (handles splits/divs)
    const adjclose = result.indicators?.adjclose?.[0]?.adjclose || closes;

    const out = [];
    for (let i = 0; i < timestamps.length; i++) {
      const v = adjclose[i];
      if (v == null || !Number.isFinite(v)) continue;
      out.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        value: v,
      });
    }

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600'); // 15 min edge cache
    return res.status(200).json({
      series: out,
      count: out.length,
      symbol: yahooSymbol,
      requested: symbol,
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to reach Yahoo', detail: String(err) });
  }
}
