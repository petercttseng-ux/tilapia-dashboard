import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public", "data", "live.json");
const headers = { "User-Agent": "taiwan-tilapia-dashboard/1.0" };

const officialFallback = [
  { title: "縣市別吳郭魚養殖放養量彙整表", url: "https://www.fa.gov.tw/view.php?id=178&subtheme=&theme=GIO_others", source: "農業部漁業署", publishedAt: "2026-02-26T00:00:00+08:00" },
  { title: "因應美國關稅養殖吳郭魚凍儲獎勵作業原則", url: "https://www.fa.gov.tw/view.php?id=702&print=Y&subtheme=&theme=FisheriesAct_RULE", source: "農業部漁業署", publishedAt: "2026-02-03T00:00:00+08:00" },
];

async function fetchText(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(18000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(18000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

function decodeXml(value = "") {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function xmlTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(match?.[1]?.trim() || "");
}

async function loadNews() {
  const query = encodeURIComponent("吳郭魚 OR 台灣鯛 OR tilapia aquaculture");
  const xml = await fetchText(`https://news.google.com/rss/search?q=${query}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`);
  const parsed = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).map(([, block]) => ({
    title: xmlTag(block, "title").replace(/\s+-\s+[^-]+$/, ""),
    url: xmlTag(block, "link"),
    source: xmlTag(block, "source") || "Google News",
    publishedAt: new Date(xmlTag(block, "pubDate")).toISOString(),
  })).filter((item) => item.title && item.url);
  return [...officialFallback, ...parsed].slice(0, 8);
}

async function loadRepositories() {
  const queries = ["tilapia aquaculture in:name,description,readme", '"Oreochromis niloticus" in:name,description,readme'];
  const results = await Promise.all(queries.map((query) => fetchJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=8`)));
  const seen = new Set();
  return results.flatMap((result) => result.items || [])
    .filter((repo) => !repo.fork && !repo.archived && !seen.has(repo.html_url) && seen.add(repo.html_url))
    .map((repo) => ({ name: repo.full_name, url: repo.html_url, description: repo.description || "", stars: repo.stargazers_count || 0, language: repo.language || "", updatedAt: repo.updated_at || "" }))
    .slice(0, 8);
}

function numeric(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

async function loadIndustry() {
  const url = "https://data.moa.gov.tw/Service/OpenData/DataFileService.aspx?IsTransData=1&UnitId=B32";
  const body = await fetchJson(url);
  const rows = Array.isArray(body) ? body : body.Data || body.data || [];
  return rows.filter((row) => row["所屬縣市"] && row["所屬縣市"] !== "總計")
    .map((row) => ({
      year: String(row["所屬縣市"]),
      value: numeric(row["放養量-在池(尾、粒、隻)"]),
      unit: "尾",
    }))
    .filter((row) => row.year && row.value != null)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
}

let previous = { news: officialFallback, repositories: [], industry: [] };
try { previous = JSON.parse(await readFile(output, "utf8")); } catch {}

const jobs = await Promise.allSettled([loadNews(), loadRepositories(), loadIndustry()]);
const successful = jobs.filter((job) => job.status === "fulfilled").length;
const next = {
  updatedAt: new Date().toISOString(),
  status: successful === jobs.length ? "live" : successful > 0 ? "partial" : "fallback",
  news: jobs[0].status === "fulfilled" && jobs[0].value.length ? jobs[0].value : previous.news,
  repositories: jobs[1].status === "fulfilled" && jobs[1].value.length ? jobs[1].value : previous.repositories,
  industry: jobs[2].status === "fulfilled" && jobs[2].value.length ? jobs[2].value : previous.industry,
  sources: { news: "Google News RSS + 農業部漁業署", repositories: "GitHub Search API", industry: "農業部縣市別吳郭魚放養量 UnitId B32" },
  errors: jobs.map((job, index) => job.status === "rejected" ? ({ source: ["news", "repositories", "industry"][index], message: String(job.reason) }) : null).filter(Boolean),
};

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, status: next.status, counts: { news: next.news.length, repositories: next.repositories.length, industry: next.industry.length } }));
