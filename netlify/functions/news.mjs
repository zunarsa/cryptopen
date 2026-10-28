export const config = { path: ["/api/news"] };

const SOURCES = [
  { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml" },
  { name: "The Block", url: "https://www.theblock.co/rss.xml" },
];
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=60, s-maxage=120",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};
function decodeXml(s = "") {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function tag(xml, name) {
  const re = new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + name + ">", "i");
  return decodeXml(xml.match(re)?.[1] || "");
}
function classify(title, summary) {
  const text = (title + " " + summary).toLowerCase();
  const riskRules = [
    ["CRITICAL", /\b(hack(?:ed|ing)?|exploit|stolen funds|drained|security breach|private keys leaked|bridge attack|rug pull)\b/],
    ["HIGH", /\b(delist(?:ed|ing)?|insolvency|bankruptcy|withdrawals suspended|exchange halt|liquidation cascade|lawsuit|charged by|ban(?:ned)?|default)\b/],
    ["ELEVATED", /\b(sec |cftc|fed |federal reserve|interest rate|inflation|etf decision|regulation|investigation|outage|depeg|stablecoin)\b/],
  ];
  let risk = "NORMAL";
  for (const [level, re] of riskRules) if (re.test(text)) { risk = level; break; }
  const positive = (text.match(/\b(surge|rally|approval|approved|adoption|inflow|record high|breakout|bullish|partnership|launch|gains)\b/g) || []).length;
  const negative = (text.match(/\b(crash|plunge|falls|drop|hack|exploit|lawsuit|ban|outflow|bearish|losses|liquidation|delist|depeg|fraud)\b/g) || []).length;
  const score = Math.max(-100, Math.min(100, Math.round((positive - negative) * 22)));
  const sentiment = score >= 20 ? "POSITIF" : score <= -20 ? "NEGATIF" : "NETRAL";
  return { risk, sentiment, score };
}
function extractItems(xml, source) {
  const blocks = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(m => m[1]);
  const rss = blocks.length ? blocks : [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map(m => m[1]);
  return rss.map(item => {
    const title = tag(item, "title");
    const link = tag(item, "link") || item.match(/<link[^>]+href=["']([^"']+)/i)?.[1] || "";
    const summary = tag(item, "description") || tag(item, "summary") || tag(item, "content");
    const date = tag(item, "pubDate") || tag(item, "published") || tag(item, "updated");
    if (!title || !/^https?:\/\//i.test(link)) return null;
    return { title: title.slice(0, 240), summary: summary.slice(0, 420), url: link, source, publishedAt: date, ...classify(title, summary) };
  }).filter(Boolean);
}
export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: HEADERS });
  const results = await Promise.allSettled(SOURCES.map(async source => {
    const response = await fetch(source.url, {
      headers: { "user-agent": "CryptoOpen-SignalLab/1.0 (RSS reader)", accept: "application/rss+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(source.name + " HTTP " + response.status);
    return extractItems(await response.text(), source.name);
  }));
  const articles = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
  const sourceStatus = results.map((result, i) => ({
    source: SOURCES[i].name, ok: result.status === "fulfilled",
    count: result.status === "fulfilled" ? result.value.length : 0,
  }));
  const unique = [...new Map(articles.map(a => [a.url, a])).values()]
    .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0))
    .slice(0, 35);
  return new Response(JSON.stringify({ updatedAt: new Date().toISOString(), articles: unique, sources: sourceStatus }), { status: 200, headers: HEADERS });
};
