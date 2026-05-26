// /api/fred — Vercel serverless proxy for FRED API v2
//
// Why this exists:
//   - FRED API v2 (launched Nov 2025) requires an API key sent as a Bearer token.
//   - The browser cannot call FRED directly because (a) you'd leak your key, and
//     (b) FRED does not send permissive CORS headers.
//   - This function adds the key server-side and re-emits the data as JSON
//     with CORS open, in the shape { series: [{date, value}, ...] } that the
//     dashboard's fetchFRED_live() expects.
//
// Setup:
//   1. Get a free FRED API key at https://fredaccount.stlouisfed.org/apikeys
//   2. In Vercel: Project Settings → Environment Variables → add
//        FRED_API_KEY = <your 32-char key>
//   3. Redeploy.
//
// Usage from frontend:
//   GET /api/fred?series=DGS10&start=2000-01-01

export default async function handler(req, res) {
  // CORS — allow the dashboard (and any other origin) to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { series, start } = req.query;
  if (!series) {
    return res.status(400).json({ error: 'Missing required query param: series' });
  }

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'FRED_API_KEY environment variable is not set on the server. ' +
             'Add it in Vercel → Settings → Environment Variables and redeploy.',
    });
  }

  // FRED v2 series/observations endpoint
  const params = new URLSearchParams({
    series_id: series,
    file_type: 'json',
    observation_start: start || '2000-01-01',
  });
  const url = `https://api.stlouisfed.org/fred/series/observations?${params}`;

  try {
    const fredResp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!fredResp.ok) {
      const text = await fredResp.text();
      return res.status(fredResp.status).json({
        error: `FRED API error ${fredResp.status}`,
        detail: text.slice(0, 500),
      });
    }

    const json = await fredResp.json();
    // FRED returns { observations: [{ date, value, ... }] }.
    // The dashboard's fetchFRED_live reads json.series[seriesId], so we
    // emit { series: { <seriesId>: [{date, value}, ...] } }.
    // "." is FRED's no-data marker; drop those rows.
    const out = (json.observations || [])
      .filter((o) => o.value !== '.' && o.value !== '' && o.value != null)
      .map((o) => ({ date: o.date, value: parseFloat(o.value) }))
      .filter((o) => Number.isFinite(o.value));

    // Cache at the edge for 6 hours — most FRED series update daily or slower
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=43200');
    return res.status(200).json({
      series: { [series]: out },
      count: out.length,
      series_id: series,
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to reach FRED', detail: String(err) });
  }
}
