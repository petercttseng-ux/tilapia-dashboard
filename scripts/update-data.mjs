import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public", "data", "live.json");
const headers = { "User-Agent": "taiwan-tilapia-dashboard/2.0 (public information dashboard)" };

const officialFallback = [
  { title: "縣市別吳郭魚養殖放養量彙整表", url: "https://www.fa.gov.tw/view.php?id=178&subtheme=&theme=GIO_others", source: "農業部漁業署", publishedAt: "2026-02-26T00:00:00+08:00" },
  { title: "因應美國關稅養殖吳郭魚凍儲獎勵作業原則", url: "https://www.fa.gov.tw/view.php?id=702&print=Y&subtheme=&theme=FisheriesAct_RULE", source: "農業部漁業署", publishedAt: "2026-02-03T00:00:00+08:00" },
];

const faoFallback = {
  globalProduction: { version: "2026.1.0", releaseDate: "2026-03-31", referenceThrough: "2024", url: "https://www.fao.org/fishery/static/FishStatJ/" },
  checkedAt: "",
};

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

async function loadNews({ international = false } = {}) {
  const terms = international
    ? "tilapia aquaculture OR Oreochromis"
    : "吳郭魚 OR 台灣鯛 OR tilapia aquaculture Taiwan";
  const locale = international ? "hl=en-US&gl=US&ceid=US:en" : "hl=zh-TW&gl=TW&ceid=TW:zh-Hant";
  const xml = await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(terms)}&${locale}`);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).map(([, block]) => ({
    title: xmlTag(block, "title").replace(/\s+-\s+[^-]+$/, ""),
    url: xmlTag(block, "link"),
    source: xmlTag(block, "source") || "Google News",
    publishedAt: new Date(xmlTag(block, "pubDate")).toISOString(),
  })).filter((item) => item.title && item.url);
}

async function loadDomesticNews() {
  return [...officialFallback, ...(await loadNews())].slice(0, 8);
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

async function loadResearch() {
  const term = encodeURIComponent("tilapia[Title/Abstract] OR Oreochromis[Title/Abstract]");
  const search = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=6&sort=pub+date&term=${term}&tool=taiwan_tilapia_dashboard`);
  const ids = search?.esearchresult?.idlist || [];
  if (!ids.length) return [];
  const summary = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&version=2.0&id=${ids.join(",")}&tool=taiwan_tilapia_dashboard`);
  return ids.map((id) => summary?.result?.[id]).filter(Boolean).map((paper) => ({
    id: String(paper.uid),
    title: paper.title || "Untitled",
    journal: paper.fulljournalname || paper.source || "PubMed",
    publishedAt: paper.pubdate || "",
    authors: (paper.authors || []).slice(0, 3).map((author) => author.name).filter(Boolean),
    url: `https://pubmed.ncbi.nlm.nih.gov/${paper.uid}/`,
  }));
}

async function loadFaoRelease() {
  const xml = await fetchText("https://www.fao.org/fishery/static/FishStatJ/current_versionFAO.xml");
  const fileMatch = /FAO_FI_Global_Production_([0-9.]+)\.fws/i.exec(xml);
  const version = fileMatch?.[1] || "—";
  const fileIndex = fileMatch?.index ?? xml.search(/FAO_FI_GLOBAL_PROD/i);
  const nearbyStart = Math.max(0, fileIndex - 1600);
  const nearby = xml.slice(nearbyStart, fileIndex + 1600);
  const dates = [...nearby.matchAll(/20\d{2}-\d{2}-\d{2}/g)];
  const releaseDate = dates.sort((a, b) => Math.abs((a.index || 0) + nearbyStart - fileIndex) - Math.abs((b.index || 0) + nearbyStart - fileIndex))[0]?.[0] || "—";
  return {
    globalProduction: { version, releaseDate, referenceThrough: "2024", url: "https://www.fao.org/fishery/static/FishStatJ/" },
    checkedAt: new Date().toISOString(),
  };
}

function numeric(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

async function loadIndustry() {
  const url = "https://data.moa.gov.tw/Service/OpenData/DataFileService.aspx?IsTransData=1&UnitId=B32";
  const body = await fetchJson(url);
  const rows = Array.isArray(body) ? body : body.Data || body.data || [];
  return rows.filter((row) => row["縣市名稱"] && row["縣市名稱"] !== "總計")
    .map((row) => ({
      year: String(row["縣市名稱"]),
      value: numeric(row["放養量(尾數或粒數)"]),
      unit: "尾",
    }))
    .filter((row) => row.year && row.value != null)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
}

let previous = { news: officialFallback, internationalNews: [], repositories: [], research: [], industry: [], fao: faoFallback };
try { previous = { ...previous, ...JSON.parse(await readFile(output, "utf8")) }; } catch {}

const names = ["news", "internationalNews", "repositories", "research", "industry", "fao"];
const jobs = await Promise.allSettled([
  loadDomesticNews(),
  loadNews({ international: true }),
  loadRepositories(),
  loadResearch(),
  loadIndustry(),
  loadFaoRelease(),
]);
const successful = jobs.filter((job) => job.status === "fulfilled").length;
const valueOrPrevious = (index, key) => jobs[index].status === "fulfilled" && (Array.isArray(jobs[index].value) ? jobs[index].value.length : jobs[index].value) ? jobs[index].value : previous[key];

const next = {
  updatedAt: new Date().toISOString(),
  status: successful === jobs.length ? "live" : successful > 0 ? "partial" : "fallback",
  news: valueOrPrevious(0, "news"),
  internationalNews: valueOrPrevious(1, "internationalNews"),
  repositories: valueOrPrevious(2, "repositories"),
  research: valueOrPrevious(3, "research"),
  industry: valueOrPrevious(4, "industry"),
  fao: valueOrPrevious(5, "fao"),
  sources: {
    news: "Google News RSS + 農業部漁業署",
    internationalNews: "Google News RSS",
    repositories: "GitHub Search API",
    research: "NCBI PubMed E-utilities",
    industry: "農業部縣市別吳郭魚放養量 UnitId B32",
    fao: "FAO FishStatJ current_versionFAO.xml",
  },
  errors: jobs.map((job, index) => job.status === "rejected" ? ({ source: names[index], message: String(job.reason) }) : null).filter(Boolean),
};

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output,
  status: next.status,
  counts: { news: next.news.length, internationalNews: next.internationalNews.length, repositories: next.repositories.length, research: next.research.length, industry: next.industry.length },
  errors: next.errors,
}));
