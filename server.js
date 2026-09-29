const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT || 4173);
const publicDir = path.join(__dirname, "public");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, body) {
  setSecurityHeaders(response);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function setSecurityHeaders(response) {
  response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function serveStatic(request, response) {
  const urlPath = new URL(request.url, "http://localhost").pathname;
  const relativePath = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const filePath = path.resolve(publicDir, relativePath);

  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  setSecurityHeaders(response);
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(response);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

async function analyzeWithOpenAI(items) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `You are a product research analyst. Analyze each user quote about finding old photos.
Return JSON: {"items":[{"id":"input id","memoryCues":["people|place|event|time|object|visual|emotion|context"],"forgotten":["date|location|album|keywords|person|source"],"failureMode":"one concise label","intent":"photo type or goal","queryPattern":"how the user tries to search","severity":1-5,"confidence":0-1,"rationale":"one sentence"}]}.
Use only evidence in the quote. Do not invent demographics or facts.`,
        },
        { role: "user", content: JSON.stringify(items) },
      ],
    }),
  });

  if (!response.ok) throw new Error(`AI request failed (${response.status})`);
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content).items;
}

function inDateRange(value, startDate, endDate) {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date >= new Date(`${startDate}T00:00:00Z`) && date <= new Date(`${endDate}T23:59:59Z`);
}

async function fetchReddit(query, startDate, endDate) {
  const url = `https://www.reddit.com/r/googlephotos/search.json?q=${encodeURIComponent(query)}&restrict_sr=on&sort=new&t=all&limit=100`;
  const response = await fetch(url, { headers: { "User-Agent": "MemoryLensResearch/1.0" } });
  if (!response.ok) throw new Error(`Reddit returned ${response.status}`);
  const data = await response.json();
  return data.data.children
    .map(({ data: post }) => ({
      id: `reddit-${post.id}`,
      source: "Reddit",
      date: new Date(post.created_utc * 1000).toISOString().slice(0, 10),
      text: [post.title, post.selftext].filter(Boolean).join(" — ").slice(0, 3000),
      url: `https://www.reddit.com${post.permalink}`,
    }))
    .filter((item) => item.text && inDateRange(item.date, startDate, endDate));
}

async function fetchAppStore(startDate, endDate) {
  const response = await fetch("https://itunes.apple.com/rss/customerreviews/page=1/id=962194608/sortby=mostrecent/json");
  if (!response.ok) throw new Error(`App Store returned ${response.status}`);
  const data = await response.json();
  return (data.feed.entry || [])
    .filter((entry) => entry["im:rating"])
    .map((entry) => ({
      id: `appstore-${entry.id.label.split("/").pop()}`,
      source: "App Store",
      date: entry.updated.label.slice(0, 10),
      text: `${entry.title.label} — ${entry.content.label}`.slice(0, 3000),
      url: entry.link?.attributes?.href || "https://apps.apple.com/app/google-photos/id962194608",
    }))
    .filter((item) => inDateRange(item.date, startDate, endDate));
}

async function fetchYouTube(query, startDate, endDate) {
  if (!process.env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY not configured");
  const key = process.env.YOUTUBE_API_KEY;
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.search = new URLSearchParams({
    key, part: "snippet", type: "video", maxResults: "5", order: "date",
    q: `Google Photos ${query}`, publishedAfter: `${startDate}T00:00:00Z`, publishedBefore: `${endDate}T23:59:59Z`,
  });
  const searchResponse = await fetch(searchUrl);
  if (!searchResponse.ok) throw new Error(`YouTube search returned ${searchResponse.status}`);
  const videos = await searchResponse.json();
  const results = [];
  for (const video of videos.items || []) {
    const commentsUrl = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
    commentsUrl.search = new URLSearchParams({ key, part: "snippet", videoId: video.id.videoId, maxResults: "20", order: "time", textFormat: "plainText" });
    const commentsResponse = await fetch(commentsUrl);
    if (!commentsResponse.ok) continue;
    const comments = await commentsResponse.json();
    for (const item of comments.items || []) {
      const comment = item.snippet.topLevelComment.snippet;
      const date = comment.publishedAt.slice(0, 10);
      if (inDateRange(date, startDate, endDate)) {
        results.push({
          id: `youtube-${item.id}`, source: "YouTube", date,
          text: comment.textDisplay.slice(0, 3000),
          url: `https://www.youtube.com/watch?v=${video.id.videoId}&lc=${item.id}`,
        });
      }
    }
  }
  return results;
}

async function fetchWebSources(query, startDate, endDate) {
  if (!process.env.SERPER_API_KEY) throw new Error("SERPER_API_KEY not configured");
  const sites = "(site:support.google.com/photos OR site:play.google.com OR site:x.com OR site:facebook.com OR site:quora.com)";
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      q: `${query} Google Photos ${sites}`,
      num: 30,
      tbs: `cdr:1,cd_min:${startDate.slice(5).replace("-", "/")}/${startDate.slice(0, 4)},cd_max:${endDate.slice(5).replace("-", "/")}/${endDate.slice(0, 4)}`,
    }),
  });
  if (!response.ok) throw new Error(`Web search returned ${response.status}`);
  const data = await response.json();
  return (data.organic || []).map((result, index) => {
    const parsedDate = result.date ? new Date(result.date) : new Date("invalid");
    if (Number.isNaN(parsedDate.valueOf())) return null;
    const hostname = new URL(result.link).hostname;
    const source = hostname.includes("support.google.com") ? "Google Photos Community"
      : hostname.includes("play.google.com") ? "Play Store"
      : hostname.includes("x.com") ? "Social media" : "Forum";
    return {
      id: `web-${index}-${Date.now()}`, source,
      date: parsedDate.toISOString().slice(0, 10),
      text: `${result.title} — ${result.snippet || ""}`.slice(0, 3000),
      url: result.link,
    };
  }).filter((item) => item?.text && inDateRange(item.date, startDate, endDate));
}

async function summarizeWithOpenAI(items, analysis, period) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: `Synthesize photo-retrieval research without inventing evidence. Return JSON: {"headline":"concise insight","summary":"2-3 sentence executive summary","findings":[{"title":"finding","evidence":"specific pattern with count","implication":"product implication"}],"opportunity":"highest-leverage opportunity","limitations":["coverage caveat"]}. Distinguish prevalence in this sample from population prevalence.` },
        { role: "user", content: JSON.stringify({ period, feedback: items, coding: analysis }) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`AI summary failed (${response.status})`);
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

async function collectFromPlatforms(query, startDate, endDate) {
  const connectors = [
    ["Reddit", () => fetchReddit(query, startDate, endDate)],
    ["App Store", () => fetchAppStore(startDate, endDate)],
    ["YouTube", () => fetchYouTube(query, startDate, endDate)],
    ["Web sources", () => fetchWebSources(query, startDate, endDate)],
  ];
  const settled = await Promise.all(connectors.map(async ([name, run]) => {
    try {
      const items = await run();
      return { name, status: "connected", count: items.length, items };
    } catch (error) {
      return { name, status: "unavailable", count: 0, error: error.message, items: [] };
    }
  }));
  return {
    items: settled.flatMap((connector) => connector.items).slice(0, 50),
    connectors: settled.map(({ items, ...status }) => status),
  };
}

async function handleAnalyze(request, response) {
  try {
    const { items } = await readBody(request);
    if (!Array.isArray(items) || items.length === 0) {
      sendJson(response, 400, { error: "Provide at least one feedback item." });
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      sendJson(response, 503, {
        error: "AI analysis is not configured. Set OPENAI_API_KEY or use the included demo analysis.",
      });
      return;
    }
    const results = await analyzeWithOpenAI(items.slice(0, 50));
    sendJson(response, 200, { results });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

async function handleResearch(request, response) {
  try {
    const { query = "find old photo", startDate, endDate } = await readBody(request);
    if (!startDate || !endDate || startDate > endDate) {
      sendJson(response, 400, { error: "Provide a valid start and end date." });
      return;
    }
    const collection = await collectFromPlatforms(query, startDate, endDate);
    if (!collection.items.length) {
      sendJson(response, 200, { ...collection, analysis: [], summary: null });
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      sendJson(response, 200, {
        ...collection, analysis: [], summary: null,
        aiError: "OPENAI_API_KEY is not configured; collection completed without AI synthesis.",
      });
      return;
    }
    const analysis = await analyzeWithOpenAI(collection.items);
    const summary = await summarizeWithOpenAI(collection.items, analysis, { startDate, endDate });
    sendJson(response, 200, { ...collection, analysis, summary });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (request.method === "POST" && request.url === "/api/research") {
    handleResearch(request, response);
    return;
  }
  if (request.method === "POST" && request.url === "/api/analyze") {
    handleAnalyze(request, response);
    return;
  }
  if (request.method === "GET") {
    serveStatic(request, response);
    return;
  }
  sendJson(response, 405, { error: "Method not allowed" });
});

if (require.main === module) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Memory Lens is running at http://127.0.0.1:${port}`);
  });
}

module.exports = {
  server,
  analyzeWithOpenAI,
  collectFromPlatforms,
  summarizeWithOpenAI,
};
