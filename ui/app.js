import { LineChart } from "./chart.js";

const RESULTS_ROOT = "../results";
const MAX_CHART_POINTS = 1200; // long runs are thinned out evenly for drawing
const LN10 = Math.log(10);

// settings that can be filtered, in display order (only the ones present in a run are shown)
const FILTER_DIMENSIONS = [
  { key: "predictor", label: "predictor" },
  { key: "window", label: "window" },
  { key: "alpha", label: "alpha" },
  { key: "betting", label: "betting" },
  { key: "size_scale", label: "size scale" },
  { key: "tolerance", label: "tolerance" },
];

const GROUPINGS = {
  predictor: { label: "predictor", key: (a) => a.predictor },
  predictorSetting: { label: "predictor setting", key: (a) => a.predictorName },
  betting: { label: "betting", key: (a) => a.betting },
  bettingSize: { label: "betting size", key: (a) => a.bettingName },
  tolerance: { label: "tolerance", key: (a) => `tol ${a.tolerance}` },
};

const COLUMNS = [
  { key: "rank", label: "#", num: true, sortable: false },
  { key: "predictorName", label: "predictor" },
  { key: "bettingName", label: "betting" },
  { key: "tolerance", label: "tolerance", num: true },
  { key: "final_log_growth", label: "log growth", num: true, format: (a) => formatGrowth(a.final_log_growth) },
  { key: "multiple", label: "multiple", num: true, sortKey: "final_log_growth", format: (a) => formatMultiple(a.final_log_growth) },
  { key: "win_rate", label: "win rate", num: true, format: (a) => (a.win_rate == null ? "–" : `${(a.win_rate * 100).toFixed(1)}%`) },
  { key: "bets", label: "bets", num: true },
  { key: "skips", label: "skips", num: true },
  { key: "rounds_played", label: "status", format: (a) => (a.bankrupt ? `bankrupt, round ${a.bankrupt_round}` : "active") },
];

const state = {
  runs: [],
  runName: null,
  meta: null,
  agents: [],
  logStack: null,
  columns: 0,
  filters: {},         // dimension -> Set of selected values (as strings); empty = everything
  status: "all",       // all | active | bankrupt
  sort: { key: "final_log_growth", dir: -1 },
  pinned: new Set(),
  chart: { view: "top", topN: 20, groupBy: "predictorSetting", stat: "mean", band: "none", scale: "ln", oracle: false },
};

const $ = (selector) => document.querySelector(selector);
const chart = new LineChart($("#chart"), { onHover: showReadout });

// ---------- loading ----------
async function start() {
  try {
    const response = await fetch(`${RESULTS_ROOT}/index.json`, { cache: "no-store" });
    if (!response.ok) throw new Error();
    state.runs = await response.json();
  } catch {
    return showMessage("No results found. Run python3 Main.py from the project folder, then reload this page.");
  }
  if (!state.runs.length) return showMessage("No runs in results/ yet. Run python3 Main.py, then reload.");

  const select = $("#run-select");
  select.innerHTML = "";
  for (const run of state.runs) {
    const option = document.createElement("option");
    option.value = run.run;
    option.textContent = `${run.created_at?.replace("T", " ") ?? run.run} · seed ${run.master_seed} · ${run.number_rounds} rounds`;
    select.append(option);
  }
  select.addEventListener("change", () => loadRun(select.value));
  await loadRun(state.runs[0].run);
}

async function loadRun(runName) {
  const base = `${RESULTS_ROOT}/${runName}`;
  try {
    const [meta, csvText, npyBuffer] = await Promise.all([
      fetch(`${base}/run.json`, { cache: "no-store" }).then(okJson),
      fetch(`${base}/agents.csv`, { cache: "no-store" }).then(okText),
      fetch(`${base}/log_stack.npy`, { cache: "no-store" }).then(okBuffer),
    ]);
    const npy = parseNpy(npyBuffer);
    state.runName = runName;
    state.meta = meta;
    state.agents = parseCsv(csvText).map(prepareAgent);
    state.logStack = npy.data;
    state.columns = npy.shape[1];
    state.logMinimumBet = meta.log_minimum_bet ?? 0;
    state.filters = {};
    state.pinned = new Set();
    hideMessage();
    renderRunMeta();
    buildFilters();
    buildChartControls();
    render();
  } catch (error) {
    const oldFormat = error.message.includes("log_stack.npy") && error.message.includes("404");
    showMessage(oldFormat
      ? `Run ${runName} was saved in the older format (trajectories.npz), which this page can't read. Pick another run, or re-run Main.py.`
      : `Could not load run ${runName}: ${error.message}`);
  }
}

function okJson(r) { if (!r.ok) throw new Error(`${r.url} (${r.status})`); return r.json(); }
function okText(r) { if (!r.ok) throw new Error(`${r.url} (${r.status})`); return r.text(); }
function okBuffer(r) { if (!r.ok) throw new Error(`${r.url} (${r.status})`); return r.arrayBuffer(); }

// reads a numpy .npy file (little-endian, C order)
function parseNpy(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const major = bytes[6];
  const headerLength = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const headerStart = major === 1 ? 10 : 12;
  const header = new TextDecoder("latin1").decode(bytes.subarray(headerStart, headerStart + headerLength));
  const descr = header.match(/'descr':\s*'([^']+)'/)[1];
  const shape = header.match(/'shape':\s*\(([^)]*)\)/)[1].split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  if (/'fortran_order':\s*True/.test(header)) throw new Error("fortran-ordered arrays are not supported");
  const types = { "<f8": Float64Array, "<f4": Float32Array, "|i1": Int8Array, "<i4": Int32Array };
  const Type = types[descr];
  if (!Type) throw new Error(`unsupported dtype ${descr}`);
  const count = shape.reduce((a, b) => a * b, 1);
  const offset = headerStart + headerLength;
  return { data: new Type(buffer.slice(offset, offset + count * Type.BYTES_PER_ELEMENT)), shape };
}

// agents.csv has no quoted fields, so a plain split is enough
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    header.forEach((name, i) => (row[name] = parseCell(cells[i] ?? "")));
    return row;
  });
}

function parseCell(value) {
  if (value === "") return null;
  if (value === "True") return true;
  if (value === "False") return false;
  if (value === "inf") return Infinity;
  if (value === "-inf") return -Infinity;
  const number = Number(value);
  return Number.isNaN(number) ? value : number;
}

function prepareAgent(row) {
  const predictorName =
    row.predictor === "window" ? `window ${row.window}` :
    row.predictor === "ema" ? `ema ${row.alpha}` :
    row.predictor;
  const bettingName = `${row.betting} ${row.size_scale}`;
  return {
    ...row,
    id: row.agent_id,
    predictorName,
    bettingName,
    name: `${predictorName} · ${bettingName} · tol ${row.tolerance}`,
  };
}

// ---------- filtering and sorting ----------
function isVisible(agent) {
  for (const [key, selected] of Object.entries(state.filters)) {
    if (selected.size && !selected.has(String(agent[key]))) return false;
  }
  if (state.status === "active" && agent.bankrupt) return false;
  if (state.status === "bankrupt" && !agent.bankrupt) return false;
  return true;
}

function sortedVisibleAgents() {
  const column = COLUMNS.find((c) => c.key === state.sort.key);
  const key = column?.sortKey || state.sort.key;
  const dir = state.sort.dir;
  return state.agents.filter(isVisible).sort((a, b) => {
    const x = a[key], y = b[key];
    if (x === y) return a.id - b.id;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === "string" || typeof y === "string") {
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
    }
    return (x < y ? -1 : 1) * dir;
  });
}

// ---------- rendering ----------
function render() {
  const visible = sortedVisibleAgents();
  renderSummary(visible);
  renderFilterState();
  renderTable(visible);
  renderChart(visible);
}

function renderRunMeta() {
  const m = state.meta;
  $("#run-meta").textContent =
    `seed ${m.master_seed} · ${m.number_rounds} rounds · ${m.number_agents} agents · starting stack ${m.initial_stack} · ${m.created_at?.replace("T", " ") ?? ""}`;
  $("#run-select").value = state.runName;
}

function renderSummary(visible) {
  const bankrupt = visible.filter((a) => a.bankrupt).length;
  const growths = visible.map((a) => a.final_log_growth).filter((g) => g != null);
  const best = visible.reduce((top, a) => (top == null || a.final_log_growth > top.final_log_growth ? a : top), null);
  const stats = [
    ["agents shown", `${visible.length} of ${state.agents.length}`],
    ["active", visible.length - bankrupt],
    ["bankrupt", bankrupt],
    ["median log growth", growths.length ? formatGrowth(quantile(growths.slice().sort((a, b) => a - b), 0.5)) : "–"],
    ["in profit", visible.length ? `${Math.round((visible.filter((a) => a.final_log_growth > 0).length / visible.length) * 100)}%` : "–"],
    ["best", best ? `${formatGrowth(best.final_log_growth)} · ${best.predictorName}` : "–"],
  ];
  const summary = $("#summary");
  summary.innerHTML = "";
  for (const [label, value] of stats) {
    const cell = document.createElement("div");
    cell.innerHTML = `<div class="stat-label"></div><div class="stat-value"></div>`;
    cell.children[0].textContent = label;
    cell.children[1].textContent = value;
    summary.append(cell);
  }
}

function buildFilters() {
  const container = $("#filters");
  container.innerHTML = "";
  for (const dimension of FILTER_DIMENSIONS) {
    const values = [...new Set(state.agents.map((a) => a[dimension.key]).filter((v) => v != null))];
    if (values.length < 2) continue;
    values.sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))));
    state.filters[dimension.key] = new Set();
    container.append(chipRow(dimension.label, values.map(String), (value) => {
      const selected = state.filters[dimension.key];
      selected.has(value) ? selected.delete(value) : selected.add(value);
      render();
    }, `filter-${dimension.key}`));
  }
  container.append(chipRow("status", ["all", "active", "bankrupt"], (value) => {
    state.status = value;
    render();
  }, "filter-status"));
  $("#clear-filters").onclick = () => {
    Object.values(state.filters).forEach((set) => set.clear());
    state.status = "all";
    render();
  };
}

function renderFilterState() {
  for (const [key, selected] of Object.entries(state.filters)) {
    document.querySelectorAll(`#filter-${key} .chip`).forEach((chip) => chip.classList.toggle("active", selected.has(chip.dataset.value)));
  }
  document.querySelectorAll("#filter-status .chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.value === state.status));
}

function chipRow(label, values, onClick, id, labels = values) {
  const row = document.createElement("div");
  row.className = "filter-row";
  row.innerHTML = `<span class="row-label"></span><div class="chips"></div>`;
  row.firstChild.textContent = label;
  if (id) row.id = id;
  values.forEach((value, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.value = value;
    chip.textContent = labels[i];
    chip.addEventListener("click", () => onClick(value));
    row.lastChild.append(chip);
  });
  return row;
}

function renderTable(visible) {
  const thead = $("#agents-table thead");
  const tbody = $("#agents-table tbody");
  thead.innerHTML = "";
  const headRow = document.createElement("tr");
  for (const column of COLUMNS) {
    const th = document.createElement("th");
    const sortKey = column.key;
    const active = state.sort.key === sortKey;
    th.textContent = column.label + (active ? (state.sort.dir < 0 ? " ↓" : " ↑") : "");
    if (column.num) th.classList.add("num");
    if (active) th.classList.add("sorted");
    if (column.sortable !== false) {
      th.addEventListener("click", () => {
        if (state.sort.key === sortKey) state.sort.dir *= -1;
        else state.sort = { key: sortKey, dir: column.num ? -1 : 1 };
        render();
      });
    } else {
      th.style.cursor = "default";
    }
    headRow.append(th);
  }
  thead.append(headRow);

  const fragment = document.createDocumentFragment();
  visible.forEach((agent, i) => {
    const tr = document.createElement("tr");
    if (state.pinned.has(agent.id)) tr.classList.add("pinned");
    for (const column of COLUMNS) {
      const td = document.createElement("td");
      if (column.num) td.classList.add("num");
      const value = column.key === "rank" ? i + 1 : column.format ? column.format(agent) : agent[column.key];
      td.textContent = value ?? "–";
      if (column.key === "rounds_played" && !agent.bankrupt) td.classList.add("dim");
      tr.append(td);
    }
    tr.title = agent.label;
    tr.addEventListener("click", () => {
      state.pinned.has(agent.id) ? state.pinned.delete(agent.id) : state.pinned.add(agent.id);
      render();
    });
    fragment.append(tr);
  });
  tbody.innerHTML = "";
  tbody.append(fragment);
  $("#table-count").textContent = `${visible.length} agents · sorted by ${COLUMNS.find((c) => c.key === state.sort.key)?.label}`;
}

// ---------- chart ----------
function buildChartControls() {
  const container = $("#chart-controls");
  container.innerHTML = "";
  const rows = [
    { id: "view", label: "show", values: ["top", "groups"], labels: ["first rows of the table", "groups"] },
    { id: "topN", label: "rows", values: ["10", "20", "50", "all"], only: "top" },
    { id: "groupBy", label: "group by", values: Object.keys(GROUPINGS), labels: Object.values(GROUPINGS).map((g) => g.label), only: "groups" },
    { id: "stat", label: "line", values: ["mean", "median"], only: "groups" },
    { id: "band", label: "spread", values: ["none", "quartiles", "range"], labels: ["none", "middle 50%", "min to max"], only: "groups" },
    { id: "scale", label: "units", values: ["ln", "log10"], labels: ["natural log", "powers of 10"] },
    { id: "oracle", label: "oracle", values: ["off", "on"], labels: ["hidden", "shown"] },
  ];
  for (const row of rows) {
    const element = chipRow(row.label, row.values, (value) => {
      const setting = row.id === "topN" ? (value === "all" ? Infinity : Number(value)) : row.id === "oracle" ? value === "on" : value;
      state.chart[row.id] = setting;
      renderChartControls();
      renderChart(sortedVisibleAgents());
    }, `control-${row.id}`, row.labels || row.values);
    element.className = "control-row";
    element.dataset.only = row.only || "";
    container.append(element);
  }
  renderChartControls();
}

function renderChartControls() {
  const c = state.chart;
  const current = {
    view: c.view,
    topN: c.topN === Infinity ? "all" : String(c.topN),
    groupBy: c.groupBy,
    stat: c.stat,
    band: c.band,
    scale: c.scale,
    oracle: c.oracle ? "on" : "off",
  };
  document.querySelectorAll("#chart-controls .control-row").forEach((row) => {
    const id = row.id.replace("control-", "");
    row.hidden = row.dataset.only && row.dataset.only !== c.view;
    row.querySelectorAll(".chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.value === current[id]));
  });
}

function sampledColumns() {
  const n = state.columns;
  const stride = Math.max(1, Math.ceil(n / MAX_CHART_POINTS));
  const columns = [];
  for (let c = 0; c < n; c += stride) columns.push(c);
  if (columns[columns.length - 1] !== n - 1) columns.push(n - 1);
  return columns;
}

// log growth of one agent at the sampled columns; null after bankruptcy unless carryBankrupt
function agentGrowth(agent, columns, unit, carryBankrupt) {
  const row = agent.id * state.columns;
  const floor = state.logMinimumBet;
  return columns.map((c) => {
    const v = state.logStack[row + c];
    if (Number.isNaN(v)) return carryBankrupt ? (floor - agent.initial_log_stack) / unit : null;
    return (Math.max(v, floor) - agent.initial_log_stack) / unit; // bankrupt values below 1 chip are shown at 1 chip
  });
}

function renderChart(visible) {
  const c = state.chart;
  const unit = c.scale === "log10" ? LN10 : 1;
  const columns = sampledColumns();
  const theme = getComputedStyle(document.documentElement);
  const accent = theme.getPropertyValue("--accent").trim();
  const fg = theme.getPropertyValue("--fg").trim();
  const muted = theme.getPropertyValue("--muted").trim();
  const inChart = visible.filter((a) => c.oracle || a.predictor !== "oracle");
  const pinned = state.agents.filter((a) => state.pinned.has(a.id) && (c.oracle || a.predictor !== "oracle"));

  const series = [];
  const bands = [];

  if (c.view === "top") {
    const shown = inChart.slice(0, c.topN);
    const shownIds = new Set(shown.map((a) => a.id));
    for (const agent of shown) {
      if (state.pinned.has(agent.id)) continue;
      series.push({ name: agent.name, values: agentGrowth(agent, columns, unit, false), color: withAlpha(accent, 0.45), width: 1 });
    }
    for (const agent of pinned) {
      series.push({ name: agent.name, values: agentGrowth(agent, columns, unit, false), color: fg, width: 1.5, endLabel: true, labelColor: fg, pinned: !shownIds.has(agent.id) });
    }
  } else {
    const grouping = GROUPINGS[c.groupBy];
    const groups = new Map();
    for (const agent of inChart) {
      const key = String(grouping.key(agent));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(agent);
    }
    const aggregated = [...groups.entries()].map(([key, members]) => aggregate(key, members, columns, unit));
    aggregated.sort((a, b) => lastValue(b.line) - lastValue(a.line));
    aggregated.forEach((g, i) => {
      const shade = shadeOf(accent, i, aggregated.length);
      if (c.band !== "none") bands.push({ lo: c.band === "quartiles" ? g.q1 : g.min, hi: c.band === "quartiles" ? g.q3 : g.max, color: withAlpha(shade, 0.07) });
      series.push({ name: `${g.key} (${g.count})`, values: g.line, color: shade, width: 1.5, endLabel: true });
    });
    for (const agent of pinned) {
      series.push({ name: agent.name, values: agentGrowth(agent, columns, unit, false), color: fg, width: 1, dash: [4, 3], endLabel: true, labelColor: fg });
    }
  }

  const unitName = c.scale === "log10" ? "log growth (powers of 10)" : "log growth (natural log)";
  const refLines = [{ y: 0, label: "start" }];
  const startLog = state.agents[0]?.initial_log_stack;
  if (startLog != null) refLines.push({ y: (state.logMinimumBet - startLog) / unit, label: "bankrupt" });

  chart.setData({ x: columns, series, bands, refLines, yLabel: unitName });
  showReadout(null);
}

function aggregate(key, members, columns, unit) {
  const values = members.map((a) => agentGrowth(a, columns, unit, true));
  const line = [], q1 = [], q3 = [], min = [], max = [];
  const column = new Array(members.length);
  for (let i = 0; i < columns.length; i++) {
    for (let k = 0; k < members.length; k++) column[k] = values[k][i];
    const sorted = column.slice().sort((a, b) => a - b);
    line.push(state.chart.stat === "mean" ? sorted.reduce((s, v) => s + v, 0) / sorted.length : quantile(sorted, 0.5));
    q1.push(quantile(sorted, 0.25));
    q3.push(quantile(sorted, 0.75));
    min.push(sorted[0]);
    max.push(sorted[sorted.length - 1]);
  }
  return { key, count: members.length, line, q1, q3, min, max };
}

function showReadout(hover) {
  const readout = $("#readout");
  if (!hover) {
    const c = state.chart;
    readout.textContent = c.view === "top"
      ? "hover a line to see which agent it is"
      : `${c.stat} per ${GROUPINGS[c.groupBy].label}, hover a line for its value`;
    return;
  }
  if (!hover.series) {
    readout.textContent = `round ${hover.x}`;
    return;
  }
  const unit = state.chart.scale === "log10" ? "powers of 10" : "ln";
  readout.textContent = `${hover.series.name} · round ${hover.x} · ${formatGrowth(hover.value)} ${unit}`;
}

// ---------- formatting and helpers ----------
function formatGrowth(value) {
  if (value == null) return "–";
  if (value === -Infinity) return "−∞";
  const text = Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(3);
  return value > 0 ? `+${text}` : text.replace("-", "−");
}

// growth as a multiple of the starting stack
function formatMultiple(logGrowth) {
  if (logGrowth == null) return "–";
  if (logGrowth === -Infinity) return "0×";
  const power = logGrowth / LN10;
  if (Math.abs(power) < 4) {
    const multiple = Math.exp(logGrowth);
    if (multiple >= 100) return `${Math.round(multiple).toLocaleString("en-US")}×`;
    return `${multiple < 0.01 ? multiple.toExponential(1) : multiple.toPrecision(3)}×`;
  }
  return `10^${power.toFixed(1)}×`;
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function lastValue(values) {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return values[i];
  return -Infinity;
}

const colorProbe = document.createElement("canvas").getContext("2d");
function parseColor(color) {
  colorProbe.fillStyle = color;
  const normalised = colorProbe.fillStyle; // "#rrggbb", or "rgba(r, g, b, a)" for translucent colours
  if (normalised.startsWith("#")) return [1, 3, 5].map((i) => parseInt(normalised.slice(i, i + 2), 16));
  return normalised.match(/[\d.]+/g).slice(0, 3).map(Number);
}

function withAlpha(color, alpha) {
  const [r, g, b] = parseColor(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// shades of one colour, from strong to light, so groups stay distinguishable with a single hue
function shadeOf(color, index, total) {
  const [r, g, b] = parseColor(color);
  const t = total <= 1 ? 0 : index / (total - 1);
  const alpha = 1 - t * 0.6;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

function showMessage(text) {
  const message = $("#message");
  message.textContent = text;
  message.hidden = false;
}

function hideMessage() {
  $("#message").hidden = true;
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderChart(sortedVisibleAgents()));

start();
