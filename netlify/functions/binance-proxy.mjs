export const config = {
  path: ['/api/binance/*', '/api/market/*'],
}

// In-memory cache to ensure snappy responses and avoid rate limiting
let cachedTickers = null
let lastTickersTime = 0
const TICKERS_TTL_MS = 5000 // 5 seconds cache

async function fetchOkxTickers() {
  const now = Date.now()
  if (cachedTickers && now - lastTickersTime < TICKERS_TTL_MS) {
    return cachedTickers
  }
  const res = await fetch('https://www.okx.com/api/v5/market/tickers?instType=SWAP', {
    headers: { 'user-agent': 'cryptopen-signal-lab/1.0', accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`OKX HTTP ${res.status}`)
  const json = await res.json()
  if (json.code !== '0' || !Array.isArray(json.data)) throw new Error('Invalid OKX response')
  cachedTickers = json.data
  lastTickersTime = now
  return cachedTickers
}

export default async (req) => {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'x-market-provider': 'OKX/Futures',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/api\/(?:binance|market)\/?/, '/')

  try {
    // 1. Ping / health check
    if (path === '/fapi/v1/ping' || path === '/ping') {
      return new Response(JSON.stringify({}), { status: 200, headers: corsHeaders })
    }

    // 2. Server time
    if (path === '/fapi/v1/time' || path === '/time') {
      return new Response(JSON.stringify({ serverTime: Date.now() }), { status: 200, headers: corsHeaders })
    }

    // 3. Exchange Info
    if (path === '/fapi/v1/exchangeInfo' || path === '/exchangeInfo') {
      const tickers = await fetchOkxTickers()
      const usdtSwaps = tickers.filter((t) => t.instId && t.instId.endsWith('-USDT-SWAP'))
      const symbols = usdtSwaps.map((t) => {
        const base = t.instId.replace('-USDT-SWAP', '')
        const sym = `${base}USDT`
        return {
          symbol: sym,
          pair: sym,
          contractType: 'PERPETUAL',
          status: 'TRADING',
          baseAsset: base,
          quoteAsset: 'USDT',
          marginAsset: 'USDT',
          pricePrecision: 4,
          quantityPrecision: 2,
        }
      })

      return new Response(
        JSON.stringify({
          timezone: 'UTC',
          serverTime: Date.now(),
          symbols,
        }),
        { status: 200, headers: corsHeaders }
      )
    }

    // 4. 24hr Ticker
    if (path === '/fapi/v1/ticker/24hr' || path === '/ticker/24hr') {
      const targetSym = url.searchParams.get('symbol')
      const tickers = await fetchOkxTickers()
      const usdtSwaps = tickers.filter((t) => t.instId && t.instId.endsWith('-USDT-SWAP'))

      const mapped = usdtSwaps
        .map((t) => {
          const base = t.instId.replace('-USDT-SWAP', '')
          const sym = `${base}USDT`
          const last = parseFloat(t.last) || 0
          const open = parseFloat(t.open24h) || last
          const pct = open ? ((last - open) / open) * 100 : 0
          const volCcy = parseFloat(t.volCcy24h) || 0
          const quoteVol = volCcy * last

          return {
            symbol: sym,
            lastPrice: t.last,
            priceChange: (last - open).toFixed(4),
            priceChangePercent: pct.toFixed(2),
            weightedAvgPrice: t.last,
            prevClosePrice: t.open24h,
            highPrice: t.high24h,
            lowPrice: t.low24h,
            volume: t.volCcy24h,
            quoteVolume: quoteVol.toFixed(2),
            openPrice: t.open24h,
            openTime: parseInt(t.ts) - 86400000,
            closeTime: parseInt(t.ts),
          }
        })
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))

      if (targetSym) {
        const match = mapped.find((m) => m.symbol.toUpperCase() === targetSym.toUpperCase())
        if (match) {
          return new Response(JSON.stringify(match), { status: 200, headers: corsHeaders })
        }
      }

      return new Response(JSON.stringify(mapped), { status: 200, headers: corsHeaders })
    }

    // 5. Klines / Candlesticks
    if (path === '/fapi/v1/klines' || path === '/klines') {
      const sym = (url.searchParams.get('symbol') || 'BTCUSDT').toUpperCase()
      const interval = (url.searchParams.get('interval') || '5m').toLowerCase()
      const limit = parseInt(url.searchParams.get('limit') || '100', 10)

      const base = sym.replace(/USDT$/, '').replace(/[^A-Z0-9]/g, '')
      const instId = `${base}-USDT-SWAP`

      const barMap = {
        '1m': '1m',
        '3m': '3m',
        '5m': '5m',
        '15m': '15m',
        '30m': '30m',
        '1h': '1H',
        '2h': '2H',
        '4h': '4H',
        '1d': '1D',
        '1w': '1W',
      }
      const bar = barMap[interval] || '5m'
      const intervalMs = ({ '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000, '1d': 86400000, '1w': 604800000 })[interval] || 300000'

      try {
        const okxRes = await fetch(
          `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${limit}`,
          {
            headers: { 'user-agent': 'cryptopen-signal-lab/1.0', accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
          }
        )
        const okxJson = await okxRes.json()
        if (okxJson.code === '0' && Array.isArray(okxJson.data) && okxJson.data.length > 0) {
          // OKX returns newest first. Reverse to chronological order (oldest first).
          const sorted = okxJson.data.slice().reverse()
          const klines = sorted.map((k) => [
            parseInt(k[0]),
            k[1], // open
            k[2], // high
            k[3], // low
            k[4], // close
            k[5], // volume
            parseInt(k[0]) + intervalMs,
            k[7] || '0',
            100,
            k[5],
            k[7] || '0',
            '0',
          ])
          return new Response(JSON.stringify(klines), { status: 200, headers: corsHeaders })
        }
      } catch (err) {
        console.warn('OKX klines failed, trying Gate.io fallback:', err.message)
      }

      // Fallback: Gate.io
      try {
        const gateRes = await fetch(
          `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${base}_USDT&interval=${interval}&limit=${limit}`,
          {
            headers: { 'user-agent': 'cryptopen-signal-lab/1.0', accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
          }
        )
        const gateJson = await gateRes.json()
        if (Array.isArray(gateJson) && gateJson.length > 0) {
          const klines = gateJson.map((k) => [
            k.t * 1000,
            String(k.o),
            String(k.h),
            String(k.l),
            String(k.c),
            String(k.v),
            k.t * 1000 + intervalMs,
            '0',
            100,
            String(k.v),
            '0',
            '0',
          ])
          return new Response(JSON.stringify(klines), { status: 200, headers: corsHeaders })
        }
      } catch (gateErr) {
        console.warn('Gate.io klines fallback failed:', gateErr.message)
      }

      return new Response(JSON.stringify({ error: 'upstream_unavailable', message: 'Candlestick data unavailable from OKX and Gate.io' }), { status: 502, headers: corsHeaders })
    }

    // 6. Premium Index / Funding Rate
    if (path === '/fapi/v1/premiumIndex' || path === '/premiumIndex') {
      const sym = (url.searchParams.get('symbol') || 'BTCUSDT').toUpperCase()
      const base = sym.replace(/USDT$/, '').replace(/[^A-Z0-9]/g, '')
      const instId = `${base}-USDT-SWAP`

      let fundingRate = '0.00010000'
      let nextFundingTime = Date.now() + 28800000

      try {
        const fRes = await fetch(
          `https://www.okx.com/api/v5/public/funding-rate?instId=${encodeURIComponent(instId)}`,
          {
            headers: { 'user-agent': 'cryptopen-signal-lab/1.0', accept: 'application/json' },
            signal: AbortSignal.timeout(6000),
          }
        )
        const fJson = await fRes.json()
        if (fJson.code === '0' && fJson.data?.[0]?.fundingRate) {
          fundingRate = fJson.data[0].fundingRate
          if (fJson.data[0].nextFundingTime) {
            nextFundingTime = parseInt(fJson.data[0].nextFundingTime)
          }
        }
      } catch (err) {
        console.warn('OKX funding rate error, trying Gate.io fallback:', err.message)
        try {
          const gRes = await fetch(
            `https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=${base}_USDT`,
            {
              headers: { 'user-agent': 'cryptopen-signal-lab/1.0', accept: 'application/json' },
              signal: AbortSignal.timeout(5000),
            }
          )
          const gData = await gRes.json()
          if (Array.isArray(gData) && gData[0]?.funding_rate) {
            fundingRate = gData[0].funding_rate
          }
        } catch (_) {}
      }

      return new Response(
        JSON.stringify({
          symbol: sym,
          markPrice: '0',
          indexPrice: '0',
          estimatedSettlePrice: '0',
          lastFundingRate: fundingRate,
          nextFundingTime,
          interestRate: '0.00010000',
          time: Date.now(),
        }),
        { status: 200, headers: corsHeaders }
      )
    }

    // Default fallback: Try Binance directly if available
    const target = `https://fapi.binance.com${path}${url.search}`
    const r = await fetch(target, {
      headers: { accept: 'application/json', 'user-agent': 'cryptopen-signal-lab/1.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    const body = await r.text()
    return new Response(body, {
      status: r.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'upstream_error', message: e.message }),
      { status: 502, headers: corsHeaders }
    )
  }
}
