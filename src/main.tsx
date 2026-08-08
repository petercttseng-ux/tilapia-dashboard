import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Article = { title: string; url: string; source: string; publishedAt: string };
type Repo = { name: string; url: string; description: string; stars: number; language: string; updatedAt: string };
type IndustryPoint = { year: string; value: number; unit: string };
type LiveData = {
  updatedAt: string;
  status: "live" | "partial" | "fallback";
  news: Article[];
  repositories: Repo[];
  industry: IndustryPoint[];
};
type Weather = {
  temperature_2m: number;
  apparent_temperature: number;
  precipitation: number;
  wind_speed_10m: number;
  weather_code: number;
  time: string;
};

const regions = {
  嘉義: { lat: 23.46, lon: 120.33 },
  臺南: { lat: 23.0, lon: 120.2 },
  高雄: { lat: 22.71, lon: 120.36 },
  雲林: { lat: 23.71, lon: 120.43 },
  屏東: { lat: 22.55, lon: 120.55 },
} as const;

const species = [
  ["莫三比克吳郭魚", "O. mossambicus", "1946", "新加坡"],
  ["吉利吳郭魚", "Tilapia zillii", "1963", "南非"],
  ["尼羅吳郭魚", "O. niloticus", "1966 / 2002", "日本 / 泰國"],
  ["歐利亞吳郭魚", "O. aureus", "1974", "以色列"],
  ["賀諾奴吳郭魚", "O. hornorum", "1981", "哥斯大黎加"],
  ["黑邊吳郭魚", "T. rendalli", "1981", "南非"],
  ["斯皮路勒吳郭魚", "O. spilurus", "1981", "沙烏地阿拉伯"],
];

const productionHistory = [
  { year: "2003", output: 20090, value: 68.8, cost: 57.8, profit: 9.4 },
  { year: "2004", output: 23070, value: 63.8, cost: 62.3, profit: -0.2 },
  { year: "2005", output: 30490, value: 82.7, cost: 66.8, profit: 14.0 },
  { year: "2006", output: 28060, value: 40.8, cost: 73.2, profit: 15.1 },
  { year: "2007", output: 25310, value: 86.7, cost: 80.6, profit: 13.6 },
];

const breedingSteps = [
  ["原種鑑定", "外型、計數形質、DNA 標誌交叉確認"],
  ["親本選拔", "健康、性成熟、體型與目標性狀"],
  ["配對與繁殖", "避免近親，保留配對與批次紀錄"],
  ["家系評估", "成長、體色、耐鹽與存活率比較"],
  ["保種與回饋", "活體保種＋遺傳物質保存，定期更新"],
];

const fallback: LiveData = {
  updatedAt: "2026-08-08T14:00:00.000Z",
  status: "fallback",
  news: [
    {
      title: "縣市別吳郭魚養殖放養量彙整表",
      url: "https://www.fa.gov.tw/view.php?id=178&subtheme=&theme=GIO_others",
      source: "農業部漁業署",
      publishedAt: "2026-02-26T00:00:00+08:00",
    },
    {
      title: "因應美國關稅養殖吳郭魚凍儲獎勵作業原則",
      url: "https://www.fa.gov.tw/view.php?id=702&print=Y&subtheme=&theme=FisheriesAct_RULE",
      source: "農業部漁業署",
      publishedAt: "2026-02-03T00:00:00+08:00",
    },
  ],
  repositories: [
    {
      name: "ropensci/rfishbase",
      url: "https://github.com/ropensci/rfishbase",
      description: "透過 FishBase 取得物種分類、生態與漁業資料的 R 介面。",
      stars: 0,
      language: "R",
      updatedAt: "",
    },
    {
      name: "Imageomics/Fish-Vista",
      url: "https://github.com/Imageomics/Fish-Vista",
      description: "魚類影像與性狀辨識資料集及基準程式。",
      stars: 0,
      language: "Python",
      updatedAt: "",
    },
  ],
  industry: [],
};

const fmt = new Intl.NumberFormat("zh-TW");
const shortDate = new Intl.DateTimeFormat("zh-TW", { month: "short", day: "numeric" });
const fullTime = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function weatherLabel(code?: number) {
  if (code == null) return "讀取中";
  if (code === 0) return "晴朗";
  if (code <= 3) return "多雲";
  if (code <= 67) return "有雨";
  if (code <= 77) return "降雪";
  return "雷雨";
}

function App() {
  const [region, setRegion] = useState<keyof typeof regions>("臺南");
  const [live, setLive] = useState<LiveData>(fallback);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [lastChecked, setLastChecked] = useState<Date>(new Date());
  const [isRefreshing, setRefreshing] = useState(false);
  const [pondArea, setPondArea] = useState(1);
  const [mode, setMode] = useState<"semi" | "breeder">("semi");

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    const coords = regions[region];
    const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
    weatherUrl.searchParams.set("latitude", String(coords.lat));
    weatherUrl.searchParams.set("longitude", String(coords.lon));
    weatherUrl.searchParams.set(
      "current",
      "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    );
    weatherUrl.searchParams.set("timezone", "Asia/Taipei");

    const [liveResult, weatherResult] = await Promise.allSettled([
      fetch(`${import.meta.env.BASE_URL}data/live.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("live data unavailable");
        return r.json() as Promise<LiveData>;
      }),
      fetch(weatherUrl, { cache: "no-store" }).then(async (r) => {
        if (!r.ok) throw new Error("weather unavailable");
        const body = await r.json();
        return body.current as Weather;
      }),
    ]);
    if (liveResult.status === "fulfilled") setLive(liveResult.value);
    if (weatherResult.status === "fulfilled") setWeather(weatherResult.value);
    setLastChecked(new Date());
    setRefreshing(false);
  }, [region]);

  useEffect(() => {
    refresh(true);
    const timer = window.setInterval(() => refresh(true), 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const airRisk = useMemo(() => {
    const temperature = weather?.temperature_2m;
    if (temperature == null) return { label: "待連線", tone: "neutral", detail: "尚未取得環境資料" };
    if (temperature < 15) return { label: "低溫注意", tone: "danger", detail: "加強巡池與溶氧觀察" };
    if (temperature > 34) return { label: "高溫注意", tone: "danger", detail: "留意清晨溶氧與午後熱壓力" };
    if (temperature < 20 || temperature > 30)
      return { label: "偏離適溫", tone: "warning", detail: "氣溫為代理值，請實測池水" };
    return { label: "氣溫平穩", tone: "good", detail: "仍應以池內感測值判斷" };
  }, [weather]);

  const stocking = mode === "semi" ? pondArea * 15000 : pondArea * 16000;
  const femaleBreeders = mode === "breeder" ? Math.round((stocking * 3) / 4) : 0;
  const maleBreeders = mode === "breeder" ? Math.round(stocking / 4) : 0;
  const maxOutput = Math.max(...productionHistory.map((d) => d.output));

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主要導覽">
        <a className="brand" href="#top" aria-label="返回頁首">
          <span className="brand-mark">T</span>
          <span><small>農業部水產試驗所</small><br />台灣吳郭魚情報站</span>
        </a>
        <nav>
          <a className="active" href="#overview"><span>01</span>即時總覽</a>
          <a href="#standards"><span>02</span>養殖基準</a>
          <a href="#breeding"><span>03</span>育種保種</a>
          <a href="#industry"><span>04</span>產業脈動</a>
          <a href="#resources"><span>05</span>開源資源</a>
        </nav>
        <div className="side-note">
          <span className="pulse" /> 每 10 分鐘重讀
          <small>資料排程可能因 GitHub Actions 延遲</small>
        </div>
      </aside>

      <main id="top">
        <header className="topbar">
          <div>
            <p className="eyebrow">農業部水產試驗所 · TILAPIA INTELLIGENCE / TAIWAN</p>
            <h1>把魚塭的訊號，<br /><em>整理成下一步。</em></h1>
          </div>
          <div className="toolbar">
            <label>
              產區
              <select value={region} onChange={(event) => setRegion(event.target.value as keyof typeof regions)}>
                {Object.keys(regions).map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            <button onClick={() => refresh(false)} disabled={isRefreshing}>
              {isRefreshing ? "更新中…" : "立即更新"}
            </button>
          </div>
        </header>

        <section id="overview" className="hero-grid">
          <article className="weather-card dark-card">
            <div className="card-heading">
              <span>產區環境代理</span>
              <span className={`status ${airRisk.tone}`}>{airRisk.label}</span>
            </div>
            <div className="temperature">
              {weather ? Math.round(weather.temperature_2m) : "—"}<sup>°C</sup>
            </div>
            <p>{region} · {weatherLabel(weather?.weather_code)} · {airRisk.detail}</p>
            <div className="weather-details">
              <span><b>{weather?.apparent_temperature ?? "—"}°</b>體感</span>
              <span><b>{weather?.precipitation ?? "—"} mm</b>降雨</span>
              <span><b>{weather?.wind_speed_10m ?? "—"} km/h</b>風速</span>
            </div>
            <small>Open-Meteo 氣象資料，不等同魚塭水溫或溶氧感測。</small>
          </article>

          <article className="signal-card">
            <div className="card-heading"><span>核心操作窗</span><span className="source-chip">教材基準</span></div>
            <div className="signal-row">
              <div><strong>20–30</strong><span>°C 適溫</span></div>
              <div><strong>5–6</strong><span>ppm 溶氧</span></div>
              <div><strong>7–8.5</strong><span>pH</span></div>
            </div>
            <div className="risk-band" aria-label="溶氧風險帶">
              <span className="danger-zone">&lt;3 危險</span>
              <span className="watch-zone">3–5 觀察</span>
              <span className="safe-zone">5–6 建議</span>
            </div>
            <p className="source-line">來源：《台灣淡水魚類養殖（上）》吳郭魚章，頁 32–35。</p>
          </article>

          <article className="update-card">
            <div className="card-heading"><span>資料鮮度</span><span className="live-dot">LIVE</span></div>
            <strong>{fullTime.format(lastChecked)}</strong>
            <p>頁面檢查時間</p>
            <dl>
              <div><dt>快取快照</dt><dd>{fullTime.format(new Date(live.updatedAt))}</dd></div>
              <div><dt>資料狀態</dt><dd>{live.status === "live" ? "正常" : live.status === "partial" ? "部分來源" : "備援資料"}</dd></div>
              <div><dt>下次重讀</dt><dd>10 分鐘內</dd></div>
            </dl>
          </article>
        </section>

        <section id="standards" className="section-block">
          <div className="section-title">
            <div><span>02 / FARM OPERATIONS</span><h2>養殖基準與放養試算</h2></div>
            <p>教材數字是管理起點；實際決策仍須依池況、魚體、季節與法規調整。</p>
          </div>
          <div className="operations-grid">
            <article className="calculator panel">
              <div className="panel-title"><h3>放養量試算</h3><span>公頃制</span></div>
              <label>魚塭面積 <b>{pondArea.toFixed(1)} 公頃</b>
                <input type="range" min="0.1" max="10" step="0.1" value={pondArea} onChange={(e) => setPondArea(Number(e.target.value))} />
              </label>
              <div className="segmented" role="group" aria-label="放養模式">
                <button className={mode === "semi" ? "selected" : ""} onClick={() => setMode("semi")}>半集約成魚</button>
                <button className={mode === "breeder" ? "selected" : ""} onClick={() => setMode("breeder")}>種魚 3:1</button>
              </div>
              <div className="result-number">{fmt.format(Math.round(stocking))}<small>尾 / 建議起始量</small></div>
              {mode === "breeder" && <p className="ratio-note">雌魚約 {fmt.format(femaleBreeders)} 尾 · 雄魚約 {fmt.format(maleBreeders)} 尾</p>}
              <p className="source-line">半集約養殖以 15,000 尾/公頃；種魚以每公頃 12,000–20,000 尾中位數估算。來源同上，頁 33、35。</p>
            </article>

            <article className="cycle panel">
              <div className="panel-title"><h3>育成節奏</h3><span>典型範圍</span></div>
              <div className="cycle-track">
                <div><span>0–1 月</span><b>仔魚培育</b><small>0.1 g → 1 g</small></div>
                <div><span>1–2 月</span><b>魚苗培養</b><small>1 g → 20 g</small></div>
                <div><span>2–6 月</span><b>成魚育成</b><small>20 g → 600 g+</small></div>
              </div>
              <div className="fact-grid">
                <div><strong>6–10 月</strong><span>一般養殖期</span></div>
                <div><strong>800–1,500 g</strong><span>間捕體型</span></div>
                <div><strong>500–600 g+</strong><span>國內上市體型</span></div>
                <div><strong>1,000 g+</strong><span>外銷偏好體型</span></div>
              </div>
            </article>

            <article className="cost panel">
              <div className="panel-title"><h3>成本結構</h3><span>2007 教材案例</span></div>
              <div className="donut-wrap">
                <div className="donut" aria-label="飼料與肥料 53%、人事 13%、魚苗 9%、水電油料 5%、其他 20%"><span><b>53%</b>飼料與肥料</span></div>
                <ul>
                  <li><i className="feed" />飼料與肥料 <b>53%</b></li>
                  <li><i className="labor" />人事 <b>13%</b></li>
                  <li><i className="seed" />魚苗 <b>9%</b></li>
                  <li><i className="energy" />水電油料 <b>5%</b></li>
                  <li><i className="other" />其他 <b>20%</b></li>
                </ul>
              </div>
              <p className="source-line">來源：《台灣淡水魚類養殖（上）》頁 38。歷史案例，非現行市場價格。</p>
            </article>
          </div>
        </section>

        <section id="breeding" className="section-block breeding-section">
          <div className="section-title light-title">
            <div><span>03 / BREEDING & CONSERVATION</span><h2>從原種到家系：留下可追溯的改良路徑</h2></div>
            <p>重點不是只挑最大尾，而是保住族群多樣性、性狀紀錄與可重複的選拔依據。</p>
          </div>
          <div className="breeding-layout">
            <ol className="timeline">
              {breedingSteps.map(([title, detail], index) => (
                <li key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{title}</b><p>{detail}</p></div></li>
              ))}
            </ol>
            <article className="genetics-card">
              <p className="eyebrow">保種警戒線</p>
              <h3>每池 25–50 對</h3>
              <p>教材建議保種個體數量維持於此區間，盡量避免或降低近親交配；每代可先選性狀理想的 5–10% 作為保存對象。</p>
              <div className="breeding-tags"><span>表型</span><span>家系</span><span>DNA 標誌</span><span>配對紀錄</span></div>
              <p className="source-line">來源：《台灣淡水魚類養殖（上）》頁 43；《吳郭魚之育種管理》頁 22–25、50–54。</p>
            </article>
          </div>
          <div className="species-table-wrap">
            <div className="panel-title"><h3>台灣引進種源圖譜</h3><span>教材歷史紀錄</span></div>
            <table>
              <thead><tr><th>魚種</th><th>學名</th><th>引進年代</th><th>來源</th></tr></thead>
              <tbody>{species.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>

        <section id="industry" className="section-block">
          <div className="section-title">
            <div><span>04 / INDUSTRY PULSE</span><h2>歷史基準 × 最新產業消息</h2></div>
            <p>不同年代與單位不直接相加；圖表用於理解結構，最新資料以原始來源為準。</p>
          </div>
          <div className="industry-grid">
            <article className="history-chart panel">
              <div className="panel-title"><h3>單位面積產量</h3><span>kg / 公頃 · 2003–2007</span></div>
              <div className="bars">
                {productionHistory.map((d) => (
                  <div className="bar-group" key={d.year}>
                    <div className="bar" style={{ height: `${(d.output / maxOutput) * 100}%` }}><span>{fmt.format(d.output)}</span></div>
                    <b>{d.year}</b><small>淨損益 {d.profit}</small>
                  </div>
                ))}
              </div>
              <p className="source-line">來源：《台灣淡水魚類養殖（上）》頁 38，朱等（2009）。淨損益單位：萬元/公頃。</p>
            </article>
            <article className="news panel">
              <div className="panel-title"><h3>最新消息</h3><span>{live.news.length} 則</span></div>
              <div className="news-list">
                {live.news.slice(0, 5).map((article) => (
                  <a href={article.url} target="_blank" rel="noreferrer" key={`${article.url}-${article.title}`}>
                    <span>{article.source}</span>
                    <b>{article.title}</b>
                    <time>{article.publishedAt ? shortDate.format(new Date(article.publishedAt)) : "—"} ↗</time>
                  </a>
                ))}
              </div>
            </article>
          </div>
          {live.industry.length > 0 && (
            <div className="latest-stat panel">
              <div><span>農業部開放資料</span><h3>縣市別吳郭魚在池放養量</h3></div>
              <div className="stat-row">{live.industry.slice(0, 5).map((point) => <div key={point.year}><small>{point.year}</small><b>{fmt.format(point.value)}</b><span>{point.unit}</span></div>)}</div>
            </div>
          )}
        </section>

        <section id="resources" className="section-block resources-section">
          <div className="section-title">
            <div><span>05 / OPEN SOURCE</span><h2>GitHub 吳郭魚與水產資料工具</h2></div>
            <p>每次部署以 GitHub 公開搜尋重新整理；收錄代表資料與工具，不代表品質背書。</p>
          </div>
          <div className="repo-grid">
            {live.repositories.slice(0, 6).map((repo) => (
              <a className="repo-card" href={repo.url} target="_blank" rel="noreferrer" key={repo.url}>
                <div><span className="repo-icon">⌘</span><span>{repo.language || "Repository"}</span></div>
                <h3>{repo.name}</h3>
                <p>{repo.description || "公開的吳郭魚／水產相關程式或資料資源。"}</p>
                <footer><span>★ {fmt.format(repo.stars)}</span><span>查看專案 ↗</span></footer>
              </a>
            ))}
          </div>
        </section>

        <section className="sources-section">
          <div>
            <p className="eyebrow">SOURCES & METHODS</p>
            <h2>來源分層，避免把教材、統計與即時代理混在一起。</h2>
          </div>
          <div className="source-columns">
            <div><b>教材層</b><p>五份使用者提供 PDF；核心引用集中在《台灣淡水魚類養殖（上）》吳郭魚章與《吳郭魚之育種管理》。</p></div>
            <div><b>官方統計層</b><p><a href="https://data.gov.tw/en/datasets/44084" target="_blank" rel="noreferrer">政府資料開放平臺</a>、<a href="https://fadopen.fa.gov.tw/fadopen/service/qryBreedPredictReport.htmx" target="_blank" rel="noreferrer">漁業署放養量平臺</a>。</p></div>
            <div><b>即時與開源層</b><p>Open-Meteo、Google News RSS 與 GitHub 公開 API；更新失敗時保留最後一次成功快照並顯示狀態。</p></div>
          </div>
        </section>

        <footer className="site-footer">
          <div><b>農業部水產試驗所｜台灣吳郭魚情報站</b><p>研究與管理輔助資訊，不替代現場量測、獸醫診斷或主管機關規範。</p></div>
          <span>Built from reviewed sources · {new Date().getFullYear()}</span>
        </footer>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
