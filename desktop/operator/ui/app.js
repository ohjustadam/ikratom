// iKratom Operator — frontend. Vanilla JS, no build step (works offline).
const TOKEN = new URLSearchParams(location.search).get("t") || "";
const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    ...opts,
    headers: { "x-operator-token": TOKEN, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
};
const el = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// ── Tabs ─────────────────────────────────────────────────────────────────────
let lastDiagnosis = null;
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    el("#" + t.dataset.panel).classList.add("active");
    if (t.dataset.panel === "database") loadTables();
    if (t.dataset.panel === "ops") loadOps();
    if (t.dataset.panel === "config") loadConfig();
    if (t.dataset.panel === "assistant") loadProviders();
  })
);

// ── Status ───────────────────────────────────────────────────────────────────
const dotFor = (ok) => (ok === true ? "ok" : ok === false ? "bad" : "na");
async function diagnose() {
  el("#verdict").textContent = "Running diagnosis…";
  el("#probes").innerHTML = "";
  try {
    const d = await api("/api/diagnose");
    lastDiagnosis = d;
    const down = d.verdict.headline.startsWith("SITE DOWN");
    const stPill = el("#siteState");
    stPill.textContent = d.probes.site.ok ? "site up" : "site down";
    stPill.className = "pill " + (d.probes.site.ok ? "pill-ok" : "pill-bad");
    const v = el("#verdict");
    v.className = "verdict " + (down ? "bad" : d.verdict.actions.length ? "warn" : "ok");
    v.innerHTML = `${esc(d.verdict.headline)}` +
      (d.verdict.actions.length ? `<ul>${d.verdict.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : "");
    const order = ["site", "vercel", "database", "crons", "github", "deployments"];
    el("#probes").innerHTML = order.map((k) => {
      const p = d.probes[k]; if (!p) return "";
      return `<div class="probe"><div class="n"><span class="dot ${dotFor(p.ok)}"></span>${esc(p.name || k)}</div><div class="d">${esc(p.detail || "")}</div></div>`;
    }).join("");
  } catch (e) {
    el("#verdict").textContent = "Diagnosis failed: " + e.message;
    el("#verdict").className = "verdict bad";
  }
}
el("#rediagnose").addEventListener("click", diagnose);

// ── Database ─────────────────────────────────────────────────────────────────
let tablesLoaded = false;
async function loadTables() {
  if (tablesLoaded) return;
  try {
    const { tables } = await api("/api/tables");
    tablesLoaded = true;
    el("#tableList").innerHTML = (tables || []).map((t) =>
      `<div class="t" data-t="${esc(t.table_name)}"><span>${esc(t.table_name)}</span><span class="c">${esc(t.columns)}</span></div>`
    ).join("") || '<div class="muted">no tables</div>';
    document.querySelectorAll(".tables .t").forEach((row) =>
      row.addEventListener("click", () => {
        el("#sql").value = `select * from ${row.dataset.t} limit 50`;
        runSql();
      })
    );
  } catch (e) { el("#tableList").innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
}
async function runSql() {
  const query = el("#sql").value.trim();
  const allowWrite = el("#allowWrite").checked;
  if (!query) return;
  el("#sqlMeta").textContent = "running…";
  el("#sqlOut").innerHTML = "";
  try {
    const r = await api("/api/sql", { method: "POST", body: JSON.stringify({ query, allowWrite }) });
    el("#sqlMeta").textContent = `${r.rowCount} row(s)`;
    el("#sqlOut").innerHTML = renderRows(r.rows);
  } catch (e) {
    el("#sqlMeta").textContent = "";
    el("#sqlOut").innerHTML = `<div class="verdict bad" style="margin:0">${esc(e.message)}</div>`;
  }
}
function renderRows(rows) {
  if (!rows || !rows.length) return '<div class="muted" style="padding:12px">no rows</div>';
  const cols = Object.keys(rows[0]);
  const cell = (v) => (v === null ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return `<table class="grid"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(cell(r[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
el("#runSql").addEventListener("click", runSql);
el("#sql").addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") runSql(); });

// ── Ops ──────────────────────────────────────────────────────────────────────
async function loadOps() {
  try {
    const { runs, dispatchable } = await api("/api/ops/runs");
    el("#dispatchList").innerHTML = (dispatchable || []).map((f) =>
      `<div class="d-item"><span>${esc(f)}</span><button class="btn" data-f="${esc(f)}">Run</button></div>`
    ).join("");
    document.querySelectorAll("#dispatchList button").forEach((b) =>
      b.addEventListener("click", () => dispatch(b.dataset.f))
    );
    el("#runList").innerHTML = (runs || []).map((r) =>
      `<div class="r-item"><span class="dot ${r.status === "success" ? "ok" : r.status === "failure" ? "bad" : "warn"}"></span><span class="rn">${esc(r.name)}</span><span class="rt">${esc(r.at)}</span></div>`
    ).join("") || '<div class="muted">no runs</div>';
  } catch (e) { el("#runList").innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
}
async function dispatch(file) {
  if (!confirm(`Dispatch ${file} on main?`)) return;
  try {
    await api("/api/ops/dispatch", { method: "POST", body: JSON.stringify({ file, confirm: true }) });
    alert(`Dispatched ${file}. Refresh in ~10s to see the run.`);
  } catch (e) { alert("Dispatch failed: " + e.message); }
}
el("#refreshOps").addEventListener("click", loadOps);

// ── Assistant ────────────────────────────────────────────────────────────────
async function loadProviders() {
  try {
    const { providers } = await api("/api/ai/providers");
    el("#aiProviders").textContent = providers.length ? `providers: ${providers.join(", ")}` : "no AI providers configured";
  } catch { el("#aiProviders").textContent = ""; }
}
function addMsg(who, text) {
  const d = document.createElement("div");
  d.className = "msg " + who;
  d.innerHTML = `<div class="who">${who === "user" ? "you" : "assistant"}</div>${esc(text)}`;
  el("#chat").appendChild(d);
  el("#chat").scrollTop = el("#chat").scrollHeight;
  return d;
}
async function sendChat() {
  const msg = el("#chatMsg").value.trim();
  if (!msg) return;
  el("#chatMsg").value = "";
  addMsg("user", msg);
  const thinking = addMsg("ai", "thinking…");
  const context = el("#withContext").checked && lastDiagnosis
    ? JSON.stringify(lastDiagnosis.verdict) + " | probes: " + Object.values(lastDiagnosis.probes).map((p) => `${p.name}:${p.detail}`).join("; ")
    : null;
  try {
    const r = await api("/api/ai/chat", { method: "POST", body: JSON.stringify({ message: msg, context }) });
    thinking.innerHTML = `<div class="who">assistant · ${esc(r.provider)}</div>${esc(r.reply)}`;
  } catch (e) { thinking.innerHTML = `<div class="who">assistant</div>⚠ ${esc(e.message)}`; }
}
el("#chatSend").addEventListener("click", sendChat);
el("#chatMsg").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

// ── Config ───────────────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const { groups } = await api("/api/config");
    el("#configGrid").innerHTML = Object.entries(groups).map(([g, items]) =>
      `<div class="cfg-group"><h4>${esc(g)}</h4>${items.map((i) =>
        `<div class="cfg-item"><span>${esc(i.key)}</span><span class="${i.set ? "yes" : "no"}">${i.set ? "✓ set" : "—"}</span></div>`
      ).join("")}</div>`
    ).join("");
  } catch (e) { el("#configGrid").innerHTML = esc(e.message); }
}

// First load
diagnose();
