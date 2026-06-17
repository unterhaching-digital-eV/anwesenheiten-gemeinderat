/* Anwesenheitsstatistik Gemeinderat – dependency-freies Frontend.
   Liest die Daten ausschließlich aus sitzungen.json (schreibgeschützt, kein Upload). */

"use strict";

/* Standard-Statusarten, falls die Daten keine mitliefern. */
const DEFAULT_STATUS = [
  { id: "anwesend", label: "Anwesend", farbe: "#2e9e5b" },
  { id: "entschuldigt", label: "Entschuldigt", farbe: "#e6a700" },
  { id: "unentschuldigt", label: "Unentschuldigt", farbe: "#d64545" }
];

/* ----------------------------------------------------------------------------
 * Anwendungszustand
 * -------------------------------------------------------------------------- */
const state = {
  statusarten: [],
  parteien: [],
  parteiMap: new Map(),
  mitglieder: [],
  sitzungen: [],
  sel: { sitzungen: new Set(), parteien: new Set(), mitglieder: new Set() },
  sort: "quote-asc",
  onlyAbsent: false,
  search: "",
  tableSort: { key: "name", asc: true }
};

/* ----------------------------------------------------------------------------
 * Hilfsfunktionen
 * -------------------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
const fmtPct = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 1 });
const fmtNum = new Intl.NumberFormat("de-DE");

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function tip(text) { return `data-tip="${esc(text)}"`; }
function pct(x) { return x == null ? "–" : fmtPct.format(x); }

function fmtDatum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso || "");
}
function statusColor(id) {
  const s = state.statusarten.find((x) => x.id === id);
  return s ? s.farbe : "#999";
}
function statusLabel(id) {
  const s = state.statusarten.find((x) => x.id === id);
  return s ? s.label : id;
}
function parteiColor(id) {
  const f = state.parteiMap.get(id);
  return f ? f.farbe : "#999";
}
function parteiName(id) {
  const f = state.parteiMap.get(id);
  return f ? f.name : id;
}
// Lesbare Textfarbe (schwarz/weiß) abhängig von der Helligkeit der Hintergrundfarbe.
function textOn(hex) {
  const c = String(hex).replace("#", "");
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(c)) return "#ffffff";
  const f = c.length === 3 ? c.split("").map((ch) => ch + ch).join("") : c;
  const r = parseInt(f.slice(0, 2), 16), g = parseInt(f.slice(2, 4), 16), b = parseInt(f.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.62 ? "#1f2733" : "#ffffff";
}

/* ----------------------------------------------------------------------------
 * Daten laden / validieren
 * -------------------------------------------------------------------------- */
function applyData(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Die Datei enthält kein gültiges JSON-Objekt.");
  if (!Array.isArray(raw.mitglieder) || raw.mitglieder.length === 0) throw new Error("Feld \"mitglieder\" fehlt oder ist leer.");
  if (!Array.isArray(raw.sitzungen)) throw new Error("Feld \"sitzungen\" fehlt.");

  state.statusarten = Array.isArray(raw.statusarten) && raw.statusarten.length ? raw.statusarten : DEFAULT_STATUS;

  // Parteien: aus Daten übernehmen, fehlende (in Mitgliedern referenzierte) ergänzen.
  const parteien = Array.isArray(raw.parteien) ? raw.parteien.slice() : [];
  const known = new Set(parteien.map((f) => f.id));
  const palette = ["#5b8def", "#e0698a", "#43b5a0", "#b48ce0", "#d99a3f", "#7f8a99"];
  let pi = 0;
  for (const m of raw.mitglieder) {
    const fid = m.partei || "OHNE";
    if (!known.has(fid)) { parteien.push({ id: fid, name: fid, farbe: palette[pi++ % palette.length] }); known.add(fid); }
  }
  state.parteien = parteien;
  state.parteiMap = new Map(parteien.map((f) => [f.id, f]));

  state.mitglieder = raw.mitglieder.map((m) => ({
    id: m.id, name: m.name || m.id, partei: m.partei || "OHNE", rolle: m.rolle || ""
  }));

  state.sitzungen = raw.sitzungen
    .map((s) => ({
      id: s.id || s.datum || String(s.nummer),
      nummer: s.nummer ?? null,
      datum: s.datum || "",
      titel: s.titel || (s.nummer ? `Sitzung ${s.nummer}` : "Sitzung"),
      anwesenheit: s.anwesenheit || {}
    }))
    .sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : (a.nummer ?? 0) - (b.nummer ?? 0)));

  // Auswahl initialisieren: alles aktiv.
  state.sel.sitzungen = new Set(state.sitzungen.map((s) => s.id));
  state.sel.parteien = new Set(state.parteien.filter((f) => state.mitglieder.some((m) => m.partei === f.id)).map((f) => f.id));
  state.sel.mitglieder = new Set(state.mitglieder.map((m) => m.id));

  if (raw.gemeinde) $("#hdr-gremium").textContent = `${raw.gremium || "Gemeinderat"} ${raw.gemeinde}`;
  const frCount = state.parteien.filter((f) => state.mitglieder.some((m) => m.partei === f.id)).length;
  const sC = state.sitzungen.length;
  // Zweite Titelzeile: "Zuletzt aktualisiert" (Feld aus den Daten, sonst Datum der
  // jüngsten Sitzung), gefolgt von den Kennzahlen.
  const stand = raw.aktualisiert || (sC ? state.sitzungen[sC - 1].datum : "");
  const counts = `${state.mitglieder.length} Mitglieder · ${frCount} Parteien · ${sC} ${sC === 1 ? "Sitzung" : "Sitzungen"}`;
  $("#hdr-meta").innerHTML =
    (stand ? `<span class="hdr-stand">Zuletzt aktualisiert: ${esc(fmtDatum(stand))}</span> · ` : "") + esc(counts);

  renderFilters();
  renderAll();

  if (raw.hinweis) showInfo(raw.hinweis);
  else hideError();
}

function showError(msg) {
  const e = $("#data-error");
  e.textContent = msg; e.hidden = false; e.classList.remove("is-info");
}
function showInfo(msg) {
  const e = $("#data-error");
  e.textContent = msg; e.hidden = false; e.classList.add("is-info");
}
function hideError() { $("#data-error").hidden = true; }

async function ladeDaten(url) {
  let raw;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    raw = await res.json();
  } catch (err) {
    showError("Die Daten konnten nicht geladen werden (" + url + "): " + err.message +
      ". Bitte sicherstellen, dass die Datei neben index.html liegt und über den Webserver erreichbar ist.");
    return;
  }
  try { applyData(raw); }
  catch (err) { showError("Daten ungültig (" + url + "): " + err.message); }
}

/* ----------------------------------------------------------------------------
 * Auswahl / Berechnungen
 * -------------------------------------------------------------------------- */
function activeSitzungen() {
  return state.sitzungen.filter((s) => state.sel.sitzungen.has(s.id));
}
function activeMembers() {
  return state.mitglieder.filter((m) => state.sel.parteien.has(m.partei) && state.sel.mitglieder.has(m.id));
}

function emptyCounts() {
  const c = { erfasst: 0, quote: null };
  for (const s of state.statusarten) c[s.id] = 0;
  return c;
}

function memberStats(member, sitzungen) {
  const c = emptyCounts();
  for (const s of sitzungen) {
    const st = s.anwesenheit[member.id];
    if (st == null) continue;
    if (c[st] === undefined) c[st] = 0;
    c[st]++; c.erfasst++;
  }
  c.quote = c.erfasst ? (c.anwesend || 0) / c.erfasst : null;
  return c;
}

function sumCounts(list) {
  const c = emptyCounts();
  for (const x of list) {
    for (const s of state.statusarten) c[s.id] += x[s.id] || 0;
    c.erfasst += x.erfasst;
  }
  c.quote = c.erfasst ? (c.anwesend || 0) / c.erfasst : null;
  return c;
}

/* ----------------------------------------------------------------------------
 * SVG-Bausteine
 * -------------------------------------------------------------------------- */
function donutSVG(segments) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const size = 188, r = 68, cx = size / 2, cy = size / 2, sw = 26, C = 2 * Math.PI * r;
  let rings = "", off = 0;
  if (total === 0) {
    rings = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${sw}"/>`;
  } else {
    for (const s of segments) {
      if (s.value <= 0) continue;
      const len = C * (s.value / total);
      rings += `<circle class="seg" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}"
        stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})" ${tip(`${s.label}: ${fmtNum.format(s.value)} (${pct(s.value / total)})`)} />`;
      off += len;
    }
  }
  const anw = segments.find((s) => s.id === "anwesend");
  const quote = total ? (anw ? anw.value / total : 0) : null;
  const center = `
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" style="font-size:26px;font-weight:700;fill:var(--text)">${quote == null ? "–" : pct(quote)}</text>
    <text x="${cx}" y="${cy + 15}" text-anchor="middle" class="axis-label">Anwesenheit</text>`;
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Gesamtverteilung">${rings}${center}</svg>`;
}

/* Horizontale 100%-Balken als HTML – damit die Textgrößen exakt der Detailtabelle
   entsprechen (13 px) und nicht von der Bildschirmbreite abhängen. Das Umbrechen
   auf Mobil (Name/Quote oben, Balken darunter) übernimmt CSS. */
function stackedRowsHTML(rows) {
  if (!rows.length) return `<p class="chart-note">Keine Daten für die aktuelle Auswahl.</p>`;
  const body = rows.map((row) => {
    const total = row.counts.erfasst;
    let segs = "";
    if (total) {
      for (const st of state.statusarten) {
        const v = row.counts[st.id] || 0;
        if (!v) continue;
        const w = (v / total) * 100;
        segs += `<span class="brow__seg" style="width:${w.toFixed(2)}%;background:${st.farbe}" ${tip(`${row.label} · ${st.label}: ${v} von ${total} (${pct(v / total)})`)}></span>`;
      }
    }
    const dot = row.color ? `<span class="dot" style="background:${row.color}"></span>` : "";
    const quote = row.counts.quote == null ? "–" : pct(row.counts.quote);
    return `<div class="brow">
      <div class="brow__head" ${tip(row.tipName || row.label)}>${dot}<span class="brow__name">${esc(row.label)}</span></div>
      <div class="brow__track">${segs}</div>
      <span class="brow__quote">${esc(quote)}</span>
    </div>`;
  }).join("");
  return `<div class="brows">${body}</div>`;
}

/* Vertikale gestapelte Balken je Sitzung (absolute Anzahl). */
function verlaufSVG(sitzungen, members) {
  if (!sitzungen.length || !members.length) return `<p class="chart-note">Keine Daten für die aktuelle Auswahl.</p>`;
  const W = 720, H = 240, padL = 34, padR = 12, padT = 24, padB = 52;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const cols = sitzungen.map((s) => {
    const c = sumCounts(members.map((m) => memberStats(m, [s])));
    return { s, c };
  });
  const maxTotal = Math.max(1, ...cols.map((x) => x.c.erfasst));
  const n = cols.length;
  const slot = plotW / n;
  const bw = Math.min(54, slot * 0.6);

  // y-Gitter
  let grid = "";
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const val = Math.round((maxTotal / ticks) * t);
    const y = padT + plotH - (plotH * (val / maxTotal));
    grid += `<line class="grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"/>
             <text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="axis-label">${val}</text>`;
  }

  let bars = "";
  cols.forEach((col, i) => {
    const cx = padL + slot * i + slot / 2;
    let yTop = padT + plotH;
    let stack = "";
    for (const st of state.statusarten) {
      const v = col.c[st.id] || 0;
      if (!v) continue;
      const h = plotH * (v / maxTotal);
      yTop -= h;
      stack += `<rect class="seg" x="${(cx - bw / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${st.farbe}"
        ${tip(`${col.s.titel} · ${st.label}: ${v}`)} />`;
    }
    const quote = col.c.quote == null ? "" : pct(col.c.quote);
    const label = col.s.nummer != null ? "Nr. " + col.s.nummer : fmtDatum(col.s.datum);
    bars += `${stack}
      <text x="${cx.toFixed(1)}" y="${(yTop - 6).toFixed(1)}" text-anchor="middle" class="bar-row__meta">${quote}</text>
      <text x="${cx.toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" class="axis-label">${esc(label)}</text>
      <text x="${cx.toFixed(1)}" y="${H - padB + 30}" text-anchor="middle" class="axis-label">${esc(fmtDatum(col.s.datum))}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${grid}${bars}</svg>`;
}

/* ----------------------------------------------------------------------------
 * Rendering
 * -------------------------------------------------------------------------- */
function renderAll() {
  const sitz = activeSitzungen();
  const members = activeMembers();
  const memberStatsList = members.map((m) => ({ m, c: memberStats(m, sitz) }));
  const totals = sumCounts(memberStatsList.map((x) => x.c));

  renderEmpty(sitz, members);
  renderKPIs(sitz, members, totals);
  renderLegend();
  renderDonut(totals);
  renderVerlauf(sitz, members);
  renderPartei(sitz, members);
  renderPerson(memberStatsList);
  renderTable(memberStatsList);
}

function renderEmpty(sitz, members) {
  const empty = $("#empty-state");
  const dash = $("#dashboard");
  if (!sitz.length || !members.length) {
    empty.hidden = false;
    empty.textContent = !sitz.length
      ? "Keine Sitzung ausgewählt. Bitte links mindestens eine Sitzung aktivieren."
      : "Keine Mitglieder ausgewählt. Bitte links Parteien oder Mitglieder aktivieren.";
    dash.style.display = "none";
  } else {
    empty.hidden = true;
    dash.style.display = "";
  }
}

function renderKPIs(sitz, members, totals) {
  const anw = totals.anwesend || 0, ent = totals.entschuldigt || 0, unent = totals.unentschuldigt || 0;
  const kpis = [
    { value: fmtNum.format(sitz.length), label: "Sitzungen", sub: sitz.length ? `${fmtDatum(sitz[0].datum)} – ${fmtDatum(sitz[sitz.length - 1].datum)}` : "" },
    { value: fmtNum.format(members.length), label: "Mitglieder (gefiltert)", sub: `von ${state.mitglieder.length} gesamt` },
    { value: pct(totals.quote), label: "Ø Anwesenheitsquote", sub: `${fmtNum.format(anw)} von ${fmtNum.format(totals.erfasst)} Einträgen`, cls: "kpi--good" },
    { value: fmtNum.format(ent), label: "Entschuldigt gesamt", sub: totals.erfasst ? pct(ent / totals.erfasst) + " der Einträge" : "", cls: "kpi--warn" },
    { value: fmtNum.format(unent), label: "Unentschuldigt gesamt", sub: totals.erfasst ? pct(unent / totals.erfasst) + " der Einträge" : "", cls: "kpi--bad" }
  ];
  $("#kpis").innerHTML = kpis.map((k) => `
    <div class="kpi ${k.cls || ""}">
      <div class="kpi__value">${k.value}</div>
      <div class="kpi__label">${esc(k.label)}</div>
      ${k.sub ? `<div class="kpi__sub">${esc(k.sub)}</div>` : ""}
    </div>`).join("");
}

function renderLegend() {
  $("#legend-status").innerHTML = state.statusarten.map((s) =>
    `<span class="legend__item"><span class="legend__swatch" style="background:${s.farbe}"></span>${esc(s.label)}</span>`
  ).join("");
}

function renderDonut(totals) {
  const segments = state.statusarten.map((s) => ({ id: s.id, label: s.label, color: s.farbe, value: totals[s.id] || 0 }));
  $("#chart-donut").innerHTML = donutSVG(segments);
}

function renderVerlauf(sitz, members) {
  $("#chart-verlauf").innerHTML = verlaufSVG(sitz, members);
}

function renderPartei(sitz, members) {
  const byFr = new Map();
  for (const m of members) {
    if (!byFr.has(m.partei)) byFr.set(m.partei, []);
    byFr.get(m.partei).push(memberStats(m, sitz));
  }
  const rows = [...byFr.entries()].map(([fid, list]) => {
    const c = sumCounts(list);
    return { label: parteiName(fid), color: parteiColor(fid), counts: c, n: list.length };
  }).sort((a, b) => (a.counts.quote ?? 2) - (b.counts.quote ?? 2));
  rows.forEach((r) => { r.label = `${r.label} (${r.n})`; });
  $("#chart-partei").innerHTML = stackedRowsHTML(rows);
}

function renderPerson(memberStatsList) {
  let list = memberStatsList.slice();
  if (state.onlyAbsent) list = list.filter((x) => (x.c.erfasst - (x.c.anwesend || 0)) > 0);

  const cmp = {
    "quote-asc": (a, b) => (a.c.quote ?? 2) - (b.c.quote ?? 2) || a.m.name.localeCompare(b.m.name, "de"),
    "quote-desc": (a, b) => (b.c.quote ?? -1) - (a.c.quote ?? -1) || a.m.name.localeCompare(b.m.name, "de"),
    "fehl-desc": (a, b) => (b.c.erfasst - (b.c.anwesend || 0)) - (a.c.erfasst - (a.c.anwesend || 0)) || a.m.name.localeCompare(b.m.name, "de"),
    "name": (a, b) => a.m.name.localeCompare(b.m.name, "de"),
    "partei": (a, b) => parteiName(a.m.partei).localeCompare(parteiName(b.m.partei), "de") || a.m.name.localeCompare(b.m.name, "de")
  }[state.sort];
  list.sort(cmp);

  const rows = list.map((x) => ({
    label: x.m.name,
    tipName: `${x.m.name} · ${parteiName(x.m.partei)}`,
    color: parteiColor(x.m.partei),
    counts: x.c
  }));
  $("#chart-person").innerHTML = stackedRowsHTML(rows);
}

function renderTable(memberStatsList) {
  const cols = [
    { key: "name", label: "Name", l: true },
    { key: "partei", label: "Partei", l: true },
    { key: "anwesend", label: "Anw." },
    { key: "entschuldigt", label: "Entsch." },
    { key: "unentschuldigt", label: "Unentsch." },
    { key: "erfasst", label: "Sitzungen" },
    { key: "quote", label: "Quote" }
  ];
  const sortKey = state.tableSort.key, asc = state.tableSort.asc;
  const val = (x, k) => {
    if (k === "name") return x.m.name;
    if (k === "partei") return parteiName(x.m.partei);
    if (k === "quote") return x.c.quote ?? -1;
    return x.c[k] ?? 0;
  };
  const sorted = memberStatsList.slice().sort((a, b) => {
    const va = val(a, sortKey), vb = val(b, sortKey);
    let r = typeof va === "string" ? va.localeCompare(vb, "de") : va - vb;
    if (r === 0) r = a.m.name.localeCompare(b.m.name, "de");
    return asc ? r : -r;
  });

  const head = cols.map((c) =>
    `<th class="${c.l ? "l" : ""} ${sortKey === c.key ? "is-sorted " + (asc ? "asc" : "") : ""}" data-sortkey="${c.key}">${esc(c.label)}</th>`
  ).join("");

  const body = sorted.map((x) => {
    const c = x.c;
    return `<tr>
      <td class="l name">${esc(x.m.name)}</td>
      <td class="l"><span class="pill" style="background:${parteiColor(x.m.partei)};color:${textOn(parteiColor(x.m.partei))}">${esc(parteiName(x.m.partei))}</span></td>
      <td>${c.anwesend || 0}</td>
      <td>${c.entschuldigt || 0}</td>
      <td>${c.unentschuldigt || 0}</td>
      <td>${c.erfasst}</td>
      <td class="quote-cell" style="color:${quoteColor(c.quote)}">${c.quote == null ? "–" : pct(c.quote)}</td>
    </tr>`;
  }).join("");

  $("#table-detail").innerHTML = `<table class="detail"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function quoteColor(q) {
  if (q == null) return "var(--muted)";
  if (q >= 0.9) return "var(--c-anwesend)";
  if (q >= 0.75) return "var(--c-entschuldigt)";
  return "var(--c-unentschuldigt)";
}

/* ----------------------------------------------------------------------------
 * Filter-UI
 * -------------------------------------------------------------------------- */
function renderFilters() {
  // Sitzungen
  $("#filter-sitzungen").innerHTML = state.sitzungen.map((s) => {
    const lbl = `${s.nummer != null ? "Nr. " + s.nummer + " · " : ""}${fmtDatum(s.datum)}`;
    return checkRow("s", s.id, lbl, state.sel.sitzungen.has(s.id), s.titel);
  }).join("");

  // Parteien (nur solche mit Mitgliedern)
  const usedFr = state.parteien.filter((f) => state.mitglieder.some((m) => m.partei === f.id));
  $("#filter-parteien").innerHTML = usedFr.map((f) => {
    const n = state.mitglieder.filter((m) => m.partei === f.id).length;
    return checkRow("f", f.id, f.name, state.sel.parteien.has(f.id), null, f.farbe, n);
  }).join("");

  renderMemberFilter();
}

function renderMemberFilter() {
  const term = state.search.trim().toLowerCase();
  const usedFr = state.parteien.filter((f) => state.mitglieder.some((m) => m.partei === f.id));
  let html = "";
  for (const f of usedFr) {
    const members = state.mitglieder.filter((m) => m.partei === f.id && (!term || m.name.toLowerCase().includes(term)));
    if (!members.length) continue;
    const frOff = !state.sel.parteien.has(f.id);
    html += `<div class="group-head"><span class="dot" style="background:${f.farbe}"></span>${esc(f.name)}</div>`;
    html += members.map((m) =>
      checkRow("m", m.id, m.name, state.sel.mitglieder.has(m.id), m.rolle || null, null, null, frOff)
    ).join("");
  }
  $("#filter-mitglieder").innerHTML = html || `<p class="chart-note">Keine Treffer.</p>`;
}

function checkRow(type, id, label, checked, sub, color, count, disabled) {
  const dot = color ? `<span class="dot" style="background:${color}"></span>` : "";
  const cnt = count != null ? `<span class="check__count">${count}</span>` : "";
  return `<label class="check ${disabled ? "is-disabled" : ""}" ${sub ? tip(sub) : ""}>
    <input type="checkbox" data-type="${type}" value="${esc(id)}" ${checked ? "checked" : ""}>
    ${dot}<span class="check__label">${esc(label)}</span>${cnt}
  </label>`;
}

/* ----------------------------------------------------------------------------
 * CSV-Export
 * -------------------------------------------------------------------------- */
function exportCSV() {
  const sitz = activeSitzungen();
  const members = activeMembers();
  const head = ["Name", "Partei", "Rolle", "Anwesend", "Entschuldigt", "Unentschuldigt", "Sitzungen", "Anwesenheitsquote"];
  const lines = [head.join(";")];
  for (const m of members) {
    const c = memberStats(m, sitz);
    lines.push([
      m.name, parteiName(m.partei), m.rolle,
      c.anwesend || 0, c.entschuldigt || 0, c.unentschuldigt || 0, c.erfasst,
      c.quote == null ? "" : (c.quote * 100).toFixed(1).replace(".", ",") + "%"
    ].map(csvCell).join(";"));
  }
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "anwesenheit-export.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
function csvCell(v) {
  const s = String(v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ----------------------------------------------------------------------------
 * Events
 * -------------------------------------------------------------------------- */
function bindEvents() {
  // Checkbox-Filter (Delegation)
  document.querySelector(".sidebar").addEventListener("change", (e) => {
    const cb = e.target;
    if (cb.matches('input[type="checkbox"][data-type]')) {
      const set = { s: state.sel.sitzungen, f: state.sel.parteien, m: state.sel.mitglieder }[cb.dataset.type];
      if (cb.checked) set.add(cb.value); else set.delete(cb.value);
      if (cb.dataset.type === "f") renderMemberFilter(); // disabled-Zustand der Mitglieder aktualisieren
      renderAll();
    }
  });

  // Alle / Keine
  document.querySelector(".sidebar").addEventListener("click", (e) => {
    const all = e.target.dataset.all, none = e.target.dataset.none;
    const which = all || none;
    if (!which) return;
    const map = {
      sitzungen: state.sitzungen.map((s) => s.id),
      parteien: state.parteien.filter((f) => state.mitglieder.some((m) => m.partei === f.id)).map((f) => f.id),
      mitglieder: state.mitglieder.map((m) => m.id)
    };
    state.sel[which] = all ? new Set(map[which]) : new Set();
    renderFilters();
    renderAll();
  });

  $("#member-search").addEventListener("input", (e) => { state.search = e.target.value; renderMemberFilter(); });
  $("#opt-sort").addEventListener("change", (e) => { state.sort = e.target.value; renderAll(); });
  $("#opt-only-absent").addEventListener("change", (e) => { state.onlyAbsent = e.target.checked; renderAll(); });

  // Tabellen-Sortierung
  $("#table-detail").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sortkey]");
    if (!th) return;
    const key = th.dataset.sortkey;
    if (state.tableSort.key === key) state.tableSort.asc = !state.tableSort.asc;
    else state.tableSort = { key, asc: key === "name" || key === "partei" };
    renderAll();
  });

  // CSV-Export
  $("#btn-csv").addEventListener("click", exportCSV);

  // Mobiler Filter-Drawer
  const sidebar = $("#sidebar"), overlay = $("#sidebar-overlay"), menuBtn = $("#menu-toggle");
  const openDrawer = () => { sidebar.classList.add("is-open"); overlay.hidden = false; menuBtn.setAttribute("aria-expanded", "true"); document.body.classList.add("drawer-open"); };
  const closeDrawer = () => { sidebar.classList.remove("is-open"); overlay.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); document.body.classList.remove("drawer-open"); };
  menuBtn.addEventListener("click", () => sidebar.classList.contains("is-open") ? closeDrawer() : openDrawer());
  overlay.addEventListener("click", closeDrawer);
  $("#sidebar-close").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  // Tooltip
  const tt = $("#tooltip");
  document.addEventListener("mousemove", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) { tt.hidden = true; return; }
    tt.textContent = t.getAttribute("data-tip");
    tt.hidden = false;
    const pad = 14, r = tt.getBoundingClientRect();
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + r.width > innerWidth) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight) y = e.clientY - r.height - pad;
    tt.style.left = x + "px"; tt.style.top = y + "px";
  }, true);
}

/* ----------------------------------------------------------------------------
 * Start
 * -------------------------------------------------------------------------- */
async function init() {
  bindEvents();
  await ladeDaten("sitzungen.json");
}

document.addEventListener("DOMContentLoaded", init);
