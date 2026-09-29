const evidence = [
  { id: "e1", source: "Reddit", date: "2026-09-26", quote: "I couldn't name the restaurant or the year. I just remembered we were outside, the tables were blue, and my daughter had that yellow raincoat.", cues: ["visual", "person", "context"], forgotten: ["date", "location"], failure: "Vocabulary gap", intent: "Travel memory", severity: 5, confidence: .94 },
  { id: "e2", source: "Google Photos Community", date: "2026-09-24", quote: "Trying to find a picture of the pills my doctor gave me sometime last winter. Searching medicine gives me hundreds of screenshots and labels.", cues: ["object", "time", "context"], forgotten: ["date", "keywords"], failure: "Results too broad", intent: "Reference photo", severity: 5, confidence: .96 },
  { id: "e3", source: "Play Store", date: "2026-09-18", quote: "I remember my friend was holding a huge fish, but search only finds fish from restaurants. It was years ago and I don't know where.", cues: ["person", "object", "visual"], forgotten: ["date", "location"], failure: "Intent mismatch", intent: "Shared moment", severity: 4, confidence: .91 },
  { id: "e4", source: "Reddit", date: "2026-09-15", quote: "There was a screenshot with the Wi-Fi password from our old Airbnb. I know why I saved it, not what the screenshot actually looked like.", cues: ["context", "object"], forgotten: ["keywords", "date"], failure: "Purpose not searchable", intent: "Saved information", severity: 5, confidence: .93 },
  { id: "e5", source: "App Store", date: "2026-09-11", quote: "Wanted the photo from around when we moved apartments, before the baby was born. Neither is an album and I can't narrow the dates.", cues: ["event", "time", "context"], forgotten: ["date", "album"], failure: "Fuzzy time unsupported", intent: "Life transition", severity: 4, confidence: .89 },
  { id: "e6", source: "YouTube", date: "2026-09-04", quote: "I can picture the photo in my head: warm lights, everyone laughing, maybe Thanksgiving? Search needs me to be much more specific.", cues: ["visual", "emotion", "people"], forgotten: ["date", "event"], failure: "Vocabulary gap", intent: "Social memory", severity: 4, confidence: .86 },
  { id: "e7", source: "Forum", date: "2026-08-29", quote: "Which folder did a WhatsApp image go into three phones ago? I only remember who sent it and what we were discussing.", cues: ["person", "context"], forgotten: ["source", "date"], failure: "Source fragmentation", intent: "Received image", severity: 3, confidence: .88 },
  { id: "e8", source: "Google Photos Community", date: "2026-08-21", quote: "The dog was still a puppy and we were at my parents' old house. Those are the only time clues I have.", cues: ["subject", "place", "life stage"], forgotten: ["date"], failure: "Fuzzy time unsupported", intent: "Pet memory", severity: 3, confidence: .95 },
];

const opportunities = [
  { name: "Search by remembered story", short: "Story cues", description: "Combine loose people, object, visual, and context clues.", prevalence: 86, pain: 91, confidence: 94 },
  { name: "Progressive visual narrowing", short: "Visual narrow", description: "Let recognition refine results when words fail.", prevalence: 78, pain: 84, confidence: 88 },
  { name: "Relative life-event time", short: "Life-event time", description: "Support “before we moved” and other personal anchors.", prevalence: 62, pain: 76, confidence: 83 },
  { name: "Search by saved purpose", short: "Saved purpose", description: "Retrieve screenshots and documents by why they were kept.", prevalence: 54, pain: 88, confidence: 79 },
];

const cueData = [
  ["Life context", 75], ["People", 50], ["Visual details", 38], ["Objects", 38], ["Exact date", 0],
];

let activeSource = "All sources";

function toIsoWeek(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function isoWeekRange(weekString) {
  const [year, week] = weekString.split("-W").map(Number);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - (januaryFourth.getUTCDay() || 7) + 1 + ((week - 1) * 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { startDate: monday.toISOString().slice(0, 10), endDate: sunday.toISOString().slice(0, 10) };
}

function formatDate(dateString) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${dateString}T00:00:00Z`));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function safeSourceUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? escapeHtml(url.href) : "";
  } catch {
    return "";
  }
}

function renderOverview() {
  document.querySelector("#cue-chart").innerHTML = cueData.map(([label, value]) =>
    `<div class="bar-row"><span>${label}</span><div class="track"><div class="fill" style="width:${value}%"></div></div><b>${value}%</b></div>`
  ).join("");
  document.querySelector("#opportunity-cards").innerHTML = opportunities.map((item, index) =>
    `<div class="opp-card"><span class="number">0${index + 1}</span><h4>${item.name}</h4><p>${item.description}</p></div>`
  ).join("");
}

function getFilteredEvidence() {
  const query = document.querySelector("#evidence-search").value.toLowerCase();
  const selectedWeek = document.querySelector("#week-input").value;
  return evidence.filter((item) => {
    const sourceMatch = activeSource === "All sources" || item.source === activeSource;
    const weekMatch = !selectedWeek || toIsoWeek(item.date) === selectedWeek;
    const text = [item.quote, item.source, item.failure, item.intent, ...item.cues, ...item.forgotten].join(" ").toLowerCase();
    return sourceMatch && weekMatch && text.includes(query);
  });
}

function renderEvidence() {
  const sources = ["All sources", ...new Set(evidence.map((item) => item.source))];
  document.querySelector("#filters").innerHTML = sources.map((source) =>
    `<button class="filter ${source === activeSource ? "active" : ""}" data-source="${escapeHtml(source)}">${escapeHtml(source)}</button>`
  ).join("");
  const filtered = getFilteredEvidence();
  document.querySelector("#result-count").textContent = `${filtered.length} signals`;
  document.querySelector("#evidence-list").innerHTML = filtered.length ? filtered.map((item) =>
    `<article class="evidence-card">
      <blockquote>“${escapeHtml(item.quote)}”</blockquote>
      <div class="tags">${item.cues.map((cue) => `<span>${escapeHtml(cue)}</span>`).join("")}<span>${escapeHtml(item.failure)}</span></div>
      <div class="card-meta"><span class="card-source">${safeSourceUrl(item.url) ? `<a href="${safeSourceUrl(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.source)}</a>` : escapeHtml(item.source)} · ${formatDate(item.date)} · ${escapeHtml(item.intent)}</span><span class="confidence">${Math.round(item.confidence * 100)}% confidence</span></div>
    </article>`
  ).join("") : `<article class="evidence-card"><p>No evidence matches these filters.</p></article>`;

  const failures = Object.entries(filtered.reduce((acc, item) => {
    acc[item.failure] = (acc[item.failure] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const max = failures[0]?.[1] || 1;
  document.querySelector("#live-stats").innerHTML = failures.map(([label, count]) =>
    `<div class="stat-block"><label><span>${escapeHtml(label)}</span><b>${count}</b></label><div class="mini-track"><i style="width:${count / max * 100}%"></i></div></div>`
  ).join("");
}

function renderOpportunities() {
  document.querySelector("#matrix-points").innerHTML = opportunities.map((item) =>
    `<div class="opp-point" title="${item.name}" style="left:${item.prevalence}%;bottom:${item.pain}%">${item.short}</div>`
  ).join("");
  document.querySelector("#opportunity-table-body").innerHTML = opportunities
    .map((item) => ({ ...item, score: Math.round((item.prevalence * .4) + (item.pain * .4) + (item.confidence * .2)) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => `<div class="table-row"><strong>${item.name}</strong><span>${item.prevalence}%</span><span>${item.pain}/100</span><span>${item.confidence}%</span><span class="score">${item.score}</span></div>`)
    .join("");
}

function switchView(name) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `${name}-view`));
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  const titles = { overview: "What people remember", evidence: "Evidence explorer", opportunities: "Opportunity map", pipeline: "AI research pipeline" };
  document.querySelector("#page-title").textContent = titles[name];
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2800);
}

async function addEvidence(event) {
  event.preventDefault();
  const quote = document.querySelector("#quote-input").value.trim();
  const source = document.querySelector("#source-input").value;
  const url = document.querySelector("#url-input").value.trim();
  const date = document.querySelector("#date-input").value;
  const status = document.querySelector("#ai-status");
  status.textContent = "Analyzing retrieval signals…";
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: `e${Date.now()}`, text: quote, source, url, date }] }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const result = data.results[0];
    evidence.unshift({
      id: result.id, source, url, date, quote, cues: result.memoryCues, forgotten: result.forgotten,
      failure: result.failureMode, intent: result.intent, severity: result.severity, confidence: result.confidence,
    });
    document.querySelector("#modal").hidden = true;
    event.target.reset();
    renderEvidence();
    switchView("evidence");
    showToast("Evidence analyzed and added");
  } catch (error) {
    status.textContent = error.message;
  }
}

function renderResearchResult(result) {
  const status = document.querySelector("#connector-status");
  status.hidden = false;
  status.innerHTML = result.connectors.map((connector) =>
    `<span class="connector-pill ${connector.status === "connected" ? "" : "unavailable"}" title="${escapeHtml(connector.error || "")}">${escapeHtml(connector.name)} · ${connector.status === "connected" ? `${connector.count} found` : "unavailable"}</span>`
  ).join("");

  const codingById = new Map((result.analysis || []).map((item) => [item.id, item]));
  for (const raw of result.items || []) {
    const coded = codingById.get(raw.id);
    const record = {
      id: raw.id, source: raw.source, date: raw.date, url: raw.url, quote: raw.text,
      cues: coded?.memoryCues || [], forgotten: coded?.forgotten || [],
      failure: coded?.failureMode || "Awaiting AI analysis",
      intent: coded?.intent || "Uncoded feedback",
      severity: coded?.severity || 0, confidence: coded?.confidence || 0,
    };
    const existing = evidence.findIndex((item) => item.id === record.id);
    if (existing >= 0) evidence[existing] = record;
    else evidence.unshift(record);
  }

  const panel = document.querySelector("#ai-summary");
  if (result.summary) {
    panel.hidden = false;
    panel.innerHTML = `
      <p class="eyebrow">AI SYNTHESIS · ${result.items.length} COMMENTS</p>
      <h3>${escapeHtml(result.summary.headline)}</h3>
      <p>${escapeHtml(result.summary.summary)}</p>
      <div class="summary-findings">${(result.summary.findings || []).map((finding) => `
        <div class="summary-finding"><strong>${escapeHtml(finding.title)}</strong><p>${escapeHtml(finding.evidence)}</p><p>${escapeHtml(finding.implication)}</p></div>
      `).join("")}</div>
      <div class="summary-opportunity"><strong>Highest-leverage opportunity:</strong> ${escapeHtml(result.summary.opportunity)}</div>`;
  } else {
    panel.hidden = false;
    panel.innerHTML = `<p class="eyebrow">COLLECTION COMPLETE</p><h3>${result.items.length} comments collected</h3><p>${escapeHtml(result.aiError || "No comments were found for this week. Try a broader research topic or another week.")}</p>`;
  }
  activeSource = "All sources";
  document.querySelector("#week-input").value = document.querySelector("#research-week").value;
  document.querySelector("#clear-week").hidden = false;
  renderEvidence();
}

async function runResearch(event) {
  event.preventDefault();
  const button = document.querySelector("#run-research");
  const query = document.querySelector("#research-query").value.trim();
  const week = document.querySelector("#research-week").value;
  const range = isoWeekRange(week);
  button.disabled = true;
  button.textContent = "Collecting…";
  document.querySelector("#connector-status").hidden = true;
  document.querySelector("#ai-summary").hidden = true;
  try {
    const response = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, ...range }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    renderResearchResult(result);
    showToast(`Research run completed for ${week}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Run AI research";
  }
}

function exportBrief() {
  const lines = [
    "MEMORY LENS — PHOTO RETRIEVAL RESEARCH BRIEF", "",
    "Core insight: People remember the story, not the metadata.", "",
    "Top opportunities:",
    ...opportunities.map((item, index) => `${index + 1}. ${item.name} — ${item.description}`), "",
    "Evidence snapshot:",
    ...evidence.slice(0, 5).map((item) => `- [${item.source}, ${item.date}] “${item.quote}”`),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "memory-lens-research-brief.txt";
  link.click();
  URL.revokeObjectURL(link.href);
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) switchView(nav.dataset.view);
  const target = event.target.closest("[data-target]");
  if (target) switchView(target.dataset.target);
  const filter = event.target.closest("[data-source]");
  if (filter) { activeSource = filter.dataset.source; renderEvidence(); }
});
document.querySelector("#evidence-search").addEventListener("input", renderEvidence);
document.querySelector("#week-input").addEventListener("change", (event) => {
  document.querySelector("#clear-week").hidden = !event.target.value;
  renderEvidence();
});
document.querySelector("#clear-week").addEventListener("click", () => {
  document.querySelector("#week-input").value = "";
  document.querySelector("#clear-week").hidden = true;
  renderEvidence();
});
document.querySelector("#add-button").addEventListener("click", () => {
  document.querySelector("#date-input").value = new Date().toISOString().slice(0, 10);
  document.querySelector("#modal").hidden = false;
});
document.querySelector("#close-modal").addEventListener("click", () => { document.querySelector("#modal").hidden = true; });
document.querySelector("#modal").addEventListener("click", (event) => { if (event.target.id === "modal") event.target.hidden = true; });
document.querySelector("#evidence-form").addEventListener("submit", addEvidence);
document.querySelector("#research-form").addEventListener("submit", runResearch);
document.querySelector("#export-button").addEventListener("click", exportBrief);
document.querySelector("#scoring-info").addEventListener("click", () => showToast("Score = 40% prevalence + 40% pain + 20% confidence"));

renderOverview();
renderEvidence();
renderOpportunities();
document.querySelector("#research-week").value = toIsoWeek(new Date().toISOString().slice(0, 10));
