# DL Macro Dashboard — Live (Vercel + FRED + Yahoo)

A self-contained macro markets dashboard. The HTML was originally written to fall back to mock data when no `/api/fred` and `/api/yahoo` proxies are present. This repo wires up those two proxies as Vercel serverless functions so the dashboard runs on **real live data** the moment it's deployed.

## What the dashboard pulls

**FRED series** (St. Louis Fed):
`DGS10`, `DTWEXBGS`, `T10YIE`, `WALCL`, `M2SL`, `GDPDEF`, `GDP`, `UNRATE`, `CPIAUCSL`, `NEWORDER`, `PPIACO`, `CES0500000003`, `M318501Q027NBEA`, `IRLTLT01CAM156N`, `IRLTLT01DEM156N`, `IRLTLT01GBM156N`, `IRLTLT01JPM156N`.

**Yahoo Finance** (proxied for CORS, no key needed):
`^GSPC` (S&P 500), `^RUT` (Russell 2000), `GC=F` (gold), `^SPGSCI` (commodities).

## Architecture

```
Browser  ──fetch──►  /api/fred?series=DGS10   ──►  api.stlouisfed.org   (key added server-side)
                  ►  /api/yahoo?symbol=^spx   ──►  query1.finance.yahoo.com
```

The dashboard probes `/api/fred` on load. If the proxy responds with valid JSON, it goes live. If not, it silently falls back to the built-in mock data generators (handy for local development).

## Deployment — three steps

### 1. Get a free FRED API key
- Visit https://fredaccount.stlouisfed.org/apikeys
- Create an account, click **Request API Key**, copy the 32-character string
- It's free; rate limit is 120 requests/minute (plenty)

### 2. Push this folder to GitHub
```bash
cd dl-macro-dashboard
git init
git add .
git commit -m "Initial commit: live macro dashboard"
git branch -M main
git remote add origin https://github.com/<your-username>/dl-macro-dashboard.git
git push -u origin main
```

### 3. Deploy on Vercel
- Go to https://vercel.com/new
- **Import Git Repository** → pick the repo you just pushed
- Framework Preset: **Other** (Vercel will auto-detect the `api/` folder)
- Before clicking Deploy, expand **Environment Variables** and add:

  | Name            | Value                              |
  |-----------------|------------------------------------|
  | `FRED_API_KEY`  | (paste your 32-char key from step 1) |

- Click **Deploy**. You'll get a URL like `dl-macro-dashboard.vercel.app`.

That's it. Open the URL — the header should say **"Live · FRED"** and each chart will fetch real data on load.

## Sanity checks after deploy

Visit these URLs directly in your browser; both should return JSON:

```
https://<your-app>.vercel.app/api/fred?series=DGS10&start=2024-01-01
https://<your-app>.vercel.app/api/yahoo?symbol=^spx&start=2024-01-01
```

If `/api/fred` returns `{"error":"FRED_API_KEY environment variable is not set..."}`, you skipped step 3's env var — add it in **Project Settings → Environment Variables**, then **Deployments → ... → Redeploy**.

## Local development

```bash
npm i -g vercel
vercel dev
# Open http://localhost:3000
```

`vercel dev` runs the static site plus the serverless functions locally. You'll need a `.env.local` with `FRED_API_KEY=…` for the FRED proxy to work locally (Yahoo needs no key).

## Files

```
dl-macro-dashboard/
├── api/
│   ├── fred.js         FRED API v2 proxy (adds Bearer auth, normalizes response)
│   └── yahoo.js        Yahoo Finance chart-API proxy (maps Stooq-style symbols)
├── public/
│   └── index.html      The dashboard (self-contained: Chart.js + date-fns inlined)
├── package.json
├── vercel.json
└── README.md
```

## Notes & caveats

- **Caching.** The FRED proxy caches responses at Vercel's edge for 6 hours (FRED data updates daily at most). Yahoo is cached 15 minutes. Adjust the `Cache-Control` headers in `api/fred.js` and `api/yahoo.js` if you want fresher or staler data.
- **Rate limits.** FRED allows 120 req/min. With 18 series fetched on each page load and edge caching, you'll never hit it.
- **Yahoo TOS.** Yahoo's chart endpoint is unofficial. It's been stable for many years but Yahoo could change it without notice. If `/api/yahoo` ever 404s, swap to Stooq's CSV endpoint or pay for a data provider.
- **Why not call FRED directly from the browser?** Two reasons: (a) you'd leak your API key to anyone who views source, and (b) FRED doesn't set CORS headers that allow browser-origin calls.
