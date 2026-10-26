Crypto Futures Signal Lab — Netlify deploy

Status: Terhubung ke Live Market Data (Perpetual Futures)

Fitur:
- Mengambil daftar kontrak USDT perpetual aktif secara real-time.
- Memindai 30 kontrak USDT paling likuid berdasarkan volume 24 jam.
- Menghitung candlestick real-time, EMA 9/21, RSI 14, ATR 14, dan volume relatif.
- Scanner tabel kini dilengkapi kolom "Area Open Posisi", "Target Harga (TP)", dan "Stop Loss (SL)":
  * Area Open Posisi: Zona harga optimal untuk masuk/open posisi berbasis volatilitas ATR dan momentum.
  * Target Harga (TP): Target take profit berbasis Risk-to-Reward 1:1,5 (+1,5× ATR) serta estimasi persentase profit.
  * Stop Loss (SL): Pengaman batas risiko pada 1× ATR.
- Filter cepat scanner: pilihan untuk menampilkan "Semua Pair" atau "Hanya Sinyal Aktif (LONG / SHORT)".
- Feed sinyal otomatis mencatat seluruh pair yang memiliki sinyal aktif beserta area open posisi dan target harga.
- Pembaruan otomatis setiap 30 detik atau manual via tombol Refresh.
- Semua data market publik di-relay melalui Netlify Function proxy (/api/binance & /api/market) dengan multi-source bridge (OKX Perpetual Futures & Gate.io dengan fallback Binance), sehingga kebal dari pembatasan wilayah (HTTP 451) maupun blokir ISP browser.
- Read-only data market publik: tanpa API key, tanpa akun login, tanpa eksekusi order.

Penting:
- Dashboard ini ditujukan untuk analisis dan simulasi (paper trading), bukan saran finansial/investasi. Sinyal belum divalidasi dengan backtest historis.
- Proxy hanya membuka endpoint publik data pasar dan tidak pernah meneruskan kredensial pribadi.
