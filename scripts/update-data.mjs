import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public", "data", "live.json");
const headers = { "User-Agent": "taiwan-tilapia-dashboard/2.0 (public information dashboard)" };

const officialFallback = [
  { title: "升級產業韌性！漁業署續推臺灣鯛加工獎勵", url: "https://www.fa.gov.tw/view.php?id=2214&subtheme=&theme=Press_release", source: "農業部漁業署", publishedAt: "2026-06-01T00:00:00+08:00", category: "政策產銷", isOfficial: true },
  { title: "台灣鯛外銷下滑　漁業署：最大市場美國庫存充足", url: "https://www.cna.com.tw/news/ahel/202605270193.aspx", source: "中央社", publishedAt: "2026-05-27T14:41:00+08:00", category: "市場外銷", isOfficial: false },
  { title: "漁業署攜手全聯力推台灣鯛大賞　實踐友善地球願景", url: "https://www.fa.gov.tw/view.php?id=2198&subtheme=&theme=Press_release", source: "農業部漁業署", publishedAt: "2026-04-10T00:00:00+08:00", category: "品牌通路", isOfficial: true },
  { title: "因應美國關稅養殖吳郭魚凍儲獎勵作業原則", url: "https://www.fa.gov.tw/view.php?id=702&print=Y&subtheme=&theme=FisheriesAct_RULE", source: "農業部漁業署", publishedAt: "2026-02-03T00:00:00+08:00", category: "政策產銷", isOfficial: true },
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

async function loadNews({ international = false, terms } = {}) {
  const query = terms || (international ? "tilapia aquaculture OR Oreochromis" : "吳郭魚 OR 台灣鯛 OR 臺灣鯛");
  const locale = international ? "hl=en-US&gl=US&ceid=US:en" : "hl=zh-TW&gl=TW&ceid=TW:zh-Hant";
  const xml = await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${locale}`);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).map(([, block]) => ({
    title: xmlTag(block, "title").replace(/\s+-\s+[^-]+$/, ""),
    url: xmlTag(block, "link"),
    source: xmlTag(block, "source") || "Google News",
    publishedAt: new Date(xmlTag(block, "pubDate")).toISOString(),
  })).filter((item) => item.title && item.url);
}

function normalizeNewsTitle(title = "") {
  return title.toLowerCase().replace(/[｜|]\s*(生活|產經|政治|地方|即時|新聞).*$/i, "").replace(/[\s｜|－—–：:「」『』【】（）()、，,。！？!?]/g, "").replace(/台灣/g, "臺灣");
}

function classifyDomesticArticle(article) {
  const text = article.title;
  const source = article.source || "";
  const official = article.isOfficial ?? /農業部漁業署|農業部水產試驗所|fa\.gov\.tw|tfrin\.gov\.tw/.test(source);
  let category = "產業消息";
  if (/獎勵|補助|凍儲|作業原則|支持方案/.test(text)) category = "政策產銷";
  else if (/外銷|出口|價格|市場|庫存|美國|訂單|銷美|供需|關稅/.test(text)) category = "市場外銷";
  else if (/養殖|育種|疾病|魚苗|種苗|水質|研究|技術/.test(text)) category = "養殖技術";
  else if (/通路|全聯|餐桌|料理|品牌|推廣|大賞/.test(text)) category = "品牌通路";
  else if (/政策|獎勵|補助|凍儲|關稅|作業原則|漁業署|農業部/.test(text)) category = "政策產銷";
  return { ...article, category: article.category || category, isOfficial: official };
}

function newsScore(article) {
  const source = article.source || "";
  const authority = article.isOfficial ? 100 : /中央社/.test(source) ? 60 : /公視|聯合|自由時報|農傳媒|海洋大學/.test(source) ? 35 : 10;
  const ageDays = Math.max(0, (Date.now() - new Date(article.publishedAt || 0).getTime()) / 86400000);
  return authority + Math.max(0, 45 - ageDays / 14);
}

async function loadTfrinNews() {
  const feeds = [
    "https://www.tfrin.gov.tw/wm_DATA.php?data=news_news",
    "https://www.tfrin.gov.tw/wm_DATA.php?data=news_feed",
  ];
  const settled = await Promise.allSettled(feeds.map(fetchText));
  return settled.flatMap((result) => result.status === "fulfilled" ? [...result.value.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, block]) => ({
    title: xmlTag(block, "title"),
    url: xmlTag(block, "link"),
    source: "水試所水產新聞提要",
    publishedAt: new Date(xmlTag(block, "pubDate") || 0).toISOString(),
    isOfficial: false,
  })) : []).filter((item) => /吳郭魚|臺灣鯛|台灣鯛|福壽魚/.test(item.title));
}

async function loadDomesticNews() {
  const queries = [
    '(吳郭魚 OR 台灣鯛 OR 臺灣鯛 OR 福壽魚) when:365d',
    '(台灣鯛 OR 臺灣鯛) (外銷 OR 出口 OR 價格 OR 關稅 OR 產銷 OR 凍儲) when:365d',
    '(吳郭魚 OR 台灣鯛 OR 臺灣鯛) (養殖 OR 育種 OR 疾病 OR 水質 OR 種苗) when:365d',
    'site:fa.gov.tw (吳郭魚 OR 台灣鯛 OR 臺灣鯛) when:730d',
  ];
  const [googleResults, tfrinResults] = await Promise.all([
    Promise.allSettled(queries.map((terms) => loadNews({ terms }))),
    loadTfrinNews(),
  ]);
  const collected = [
    ...officialFallback,
    ...googleResults.flatMap((result) => result.status === "fulfilled" ? result.value : []),
    ...tfrinResults,
  ].map(classifyDomesticArticle).filter((article) => /吳郭魚|臺灣鯛|台灣鯛|福壽魚/.test(article.title));
  const seen = new Set();
  return collected
    .filter((article) => {
      const rocDate = article.title.match(/[（(](\d{2,3})[./-]\d{1,2}[./-]\d{1,2}[）)]/);
      if (rocDate && Number(rocDate[1]) < 114) return false;
      if (/愛料理|Cookpad/i.test(article.source) || /\bby\s+\d/i.test(article.title)) return false;
      const published = new Date(article.publishedAt).getTime();
      if (!Number.isFinite(published) || published < Date.now() - 550 * 86400000) return false;
      const key = normalizeNewsTitle(article.title);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime() || newsScore(b) - newsScore(a))
    .slice(0, 16);
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
    news: "農業部漁業署 + 農業部水產試驗所 RSS + Google News RSS 多主題檢索",
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
