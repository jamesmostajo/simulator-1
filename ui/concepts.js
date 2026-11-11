import { LineChart } from "./chart.js";

// ---------- the game (same rules as Main.py) ----------
const TRANSITIONS = [
  [0.6, 0.2, 0.2],   // fair
  [0.15, 0.7, 0.15], // heads-biased
  [0.15, 0.15, 0.7], // tails-biased
];
const P_TAILS = [0.5, 0.25, 0.75];
const COIN_NAMES = ["fair", "heads-biased", "tails-biased"];
const ROUNDS = 200;

const $ = (selector) => document.querySelector(selector);

// small seeded random generator so figures are repeatable
function randomGenerator(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulateGame(rounds, seed) {
  const random = randomGenerator(seed);
  const states = [], flips = [];
  let state = 0; // starts on the fair coin
  for (let t = 0; t < rounds; t++) {
    states.push(state);
    flips.push(random() < P_TAILS[state] ? 1 : 0);
    const r = random();
    state = r < TRANSITIONS[state][0] ? 0 : r < TRANSITIONS[state][0] + TRANSITIONS[state][1] ? 1 : 2;
  }
  return { states, flips, truth: states.map((s) => P_TAILS[s]) };
}

// estimates made before each flip, like the agents
function windowEstimates(flips, size) {
  return flips.map((_, t) => {
    const recent = flips.slice(Math.max(0, t - size), t);
    return recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0.5;
  });
}

function emaEstimates(flips, alpha) {
  const out = [];
  let p = 0.5;
  for (const flip of flips) { out.push(p); p = alpha * flip + (1 - alpha) * p; }
  return out;
}

// ---------- theme helpers ----------
function theme() {
  const style = getComputedStyle(document.documentElement);
  const get = (name) => style.getPropertyValue(name).trim();
  return { fg: get("--fg"), muted: get("--muted"), line: get("--line"), accent: get("--accent"), bg: get("--bg") };
}

const colorProbe = document.createElement("canvas").getContext("2d");
function withAlpha(color, alpha) {
  colorProbe.fillStyle = color;
  const hex = colorProbe.fillStyle;
  const [r, g, b] = hex.startsWith("#") ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : hex.match(/[\d.]+/g).slice(0, 3).map(Number);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function legend(element, items) {
  element.innerHTML = "";
  for (const item of items) {
    const span = document.createElement("span");
    span.textContent = item.label;
    span.style.setProperty("--swatch", item.color);
    if (item.dashed) span.classList.add("dashed");
    element.append(span);
  }
}

const percent = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const range = (start, end, step) => Array.from({ length: Math.round((end - start) / step) + 1 }, (_, i) => +(start + i * step).toFixed(10));

// ---------- 01 Markov diagram ----------
function drawMarkovDiagram() {
  const svg = $("#markov-diagram");
  const nodes = [
    { x: 220, y: 100, name: "fair", sub: "P(T) 0.50" },
    { x: 100, y: 290, name: "heads", sub: "P(T) 0.25" },
    { x: 340, y: 290, name: "tails", sub: "P(T) 0.75" },
  ];
  const r = 38;
  const center = { x: (nodes[0].x + nodes[1].x + nodes[2].x) / 3, y: (nodes[0].y + nodes[1].y + nodes[2].y) / 3 };
  const parts = [`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0,1 L9,5 L0,9" style="fill: none; stroke: var(--muted); stroke-width: 1.3"/></marker></defs>`];
  const edgeStyle = `style="fill: none; stroke: var(--muted); stroke-width: 1" marker-end="url(#arrow)"`;

  // edges between different coins, each direction curved to its own side
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === j) continue;
      const a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      const ux = dx / length, uy = dy / length, nx = -uy, ny = ux;
      const angle = 0.32;
      const start = { x: a.x + r * (ux * Math.cos(angle) + nx * Math.sin(angle)), y: a.y + r * (uy * Math.cos(angle) + ny * Math.sin(angle)) };
      const end = { x: b.x + r * (-ux * Math.cos(angle) + nx * Math.sin(angle)), y: b.y + r * (-uy * Math.cos(angle) + ny * Math.sin(angle)) };
      const control = { x: (a.x + b.x) / 2 + nx * 26, y: (a.y + b.y) / 2 + ny * 26 };
      parts.push(`<path d="M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}" ${edgeStyle}/>`);
      parts.push(`<text class="edge-label" x="${(a.x + b.x) / 2 + nx * 30}" y="${(a.y + b.y) / 2 + ny * 30}" text-anchor="middle" dominant-baseline="middle">${TRANSITIONS[i][j].toFixed(2)}</text>`);
    }
  }
  // self loops, pointing away from the middle of the diagram
  nodes.forEach((node, i) => {
    const vx = node.x - center.x, vy = node.y - center.y, length = Math.hypot(vx, vy);
    const ux = vx / length, uy = vy / length;
    const rotate = (theta, distance) => ({
      x: node.x + distance * (ux * Math.cos(theta) - uy * Math.sin(theta)),
      y: node.y + distance * (ux * Math.sin(theta) + uy * Math.cos(theta)),
    });
    const start = rotate(-0.45, r), end = rotate(0.45, r);
    const c1 = rotate(-0.75, r + 46), c2 = rotate(0.75, r + 46);
    const label = rotate(0, r + 44);
    parts.push(`<path d="M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}" ${edgeStyle}/>`);
    parts.push(`<text class="edge-label" x="${label.x}" y="${label.y}" text-anchor="middle" dominant-baseline="middle">${TRANSITIONS[i][i].toFixed(2)}</text>`);
  });
  for (const node of nodes) {
    parts.push(`<circle cx="${node.x}" cy="${node.y}" r="${r}" style="fill: var(--accent-soft); stroke: var(--accent); stroke-width: 1"/>`);
    parts.push(`<text x="${node.x}" y="${node.y - 6}" text-anchor="middle" style="font-size: 13px">${node.name}</text>`);
    parts.push(`<text x="${node.x}" y="${node.y + 11}" text-anchor="middle" class="edge-label" style="font-size: 11px">${node.sub}</text>`);
  }
  svg.innerHTML = parts.join("");
}

// ---------- 01 simulated strip ----------
function coinColors() {
  const t = theme();
  return [withAlpha(t.muted, 0.18), withAlpha(t.accent, 0.3), withAlpha(t.accent, 0.75)];
}

function drawStrip(game) {
  const canvas = $("#markov-strip");
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  canvas.width = width * dpr; canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const colors = coinColors();
  const t = theme();
  const cell = width / game.states.length;
  const middle = height / 2;
  game.states.forEach((state, i) => {
    ctx.fillStyle = colors[state];
    ctx.fillRect(i * cell, middle - 10, Math.ceil(cell), 20);
  });
  ctx.strokeStyle = t.fg;
  ctx.lineWidth = Math.max(1, Math.min(1.5, cell * 0.5));
  game.flips.forEach((flip, i) => {
    const x = i * cell + cell / 2;
    ctx.beginPath();
    if (flip) { ctx.moveTo(x, middle - 12); ctx.lineTo(x, middle - 24); }
    else { ctx.moveTo(x, middle + 12); ctx.lineTo(x, middle + 24); }
    ctx.stroke();
  });

  legend($("#markov-legend"), COIN_NAMES.map((name, i) => ({ label: name, color: colors[i] })));
  let switches = 0, longest = 1, current = 1;
  for (let i = 1; i < game.states.length; i++) {
    if (game.states[i] !== game.states[i - 1]) { switches++; current = 1; } else { current++; longest = Math.max(longest, current); }
  }
  const tailsShare = game.flips.reduce((a, b) => a + b, 0) / game.flips.length;
  $("#markov-readout").textContent =
    `${game.states.length} flips · ${switches} coin switches · longest stay ${longest} flips · ${percent(tailsShare, 0)} tails overall`;
}

// ---------- 03 / 04 estimators ----------
const estimatorsChart = new LineChart($("#estimators-chart"));
function drawEstimators(game) {
  const size = Number($("#window-size").value);
  const alpha = Number($("#ema-alpha").value);
  $("#window-size-value").textContent = size;
  $("#ema-alpha-value").textContent = alpha.toFixed(2);
  const t = theme();
  const windowValues = windowEstimates(game.flips, size);
  const emaValues = emaEstimates(game.flips, alpha);
  const x = game.flips.map((_, i) => i);

  estimatorsChart.setData({
    x,
    yLabel: "P(tails)",
    series: [
      { name: "true P(tails)", values: game.truth, color: t.fg, width: 1, dash: [4, 3] },
      { name: `EMA alpha ${alpha.toFixed(2)}`, values: emaValues, color: withAlpha(t.accent, 0.5), width: 1.5 },
      { name: `window ${size}`, values: windowValues, color: t.accent, width: 1.5 },
    ],
    refLines: [{ y: 0.5, label: "50%" }],
  });
  legend($("#estimators-legend"), [
    { label: "true P(tails) (hidden from agents)", color: t.fg, dashed: true },
    { label: `window ${size}`, color: t.accent },
    { label: `EMA alpha ${alpha.toFixed(2)}`, color: withAlpha(t.accent, 0.5) },
  ]);

  const error = (values) => values.reduce((s, v, i) => s + Math.abs(v - game.truth[i]), 0) / values.length;
  const accuracy = (values) => {
    let right = 0, made = 0;
    values.forEach((v, i) => { if (v !== 0.5) { made++; if ((v > 0.5 ? 1 : 0) === game.flips[i]) right++; } });
    return made ? right / made : 0;
  };
  $("#estimators-readout").textContent =
    `average distance from the true probability: window ${error(windowValues).toFixed(3)}, EMA ${error(emaValues).toFixed(3)} · ` +
    `side picked correctly: window ${percent(accuracy(windowValues))}, EMA ${percent(accuracy(emaValues))}`;
  drawTolerance(game);
}

// ---------- 05 tolerance ----------
const toleranceChart = new LineChart($("#tolerance-chart"));
function drawTolerance(game) {
  const tolerance = Number($("#tolerance-slider").value);
  const alpha = Number($("#ema-alpha").value);
  $("#tolerance-value").textContent = tolerance.toFixed(2);
  const t = theme();
  const signal = emaEstimates(game.flips, alpha).map((p) => 2 * p - 1);
  const x = game.flips.map((_, i) => i);
  toleranceChart.setData({
    x,
    yLabel: "signal",
    series: [{ name: "EMA signal", values: signal, color: t.accent, width: 1.5 }],
    bands: [{ lo: x.map(() => -tolerance), hi: x.map(() => tolerance), color: withAlpha(t.muted, 0.15) }],
    refLines: [{ y: 0, label: "" }],
  });

  const stats = (minimum) => {
    let bets = 0, right = 0;
    signal.forEach((s, i) => { if (Math.abs(s) > minimum) { bets++; if ((s >= 0 ? 1 : 0) === game.flips[i]) right++; } });
    return { bets, accuracy: bets ? right / bets : 0 };
  };
  const now = stats(tolerance), all = stats(0);
  $("#tolerance-readout").textContent =
    `bets on ${now.bets} of ${signal.length} rounds, right on ${percent(now.accuracy)} of them · ` +
    `with tolerance 0: ${all.bets} bets, right on ${percent(all.accuracy)}`;
}

// ---------- 06 fractional break-even table ----------
function drawBreakEvenTable() {
  const fractions = [0.01, 0.02, 0.05, 0.1, 0.2];
  const growth = (accuracy, f) => accuracy * Math.log1p(f) + (1 - accuracy) * Math.log1p(-f);
  const rows = fractions.map((f) => {
    const breakEven = -Math.log1p(-f) / (Math.log1p(f) - Math.log1p(-f));
    return `<tr><td>${percent(f, 0)} of stack</td><td>${percent(breakEven, 2)}</td><td>${growth(0.55, f) >= 0 ? "+" : "−"}${Math.abs(growth(0.55, f) * 100).toFixed(2)}</td></tr>`;
  });
  $("#breakeven-table").innerHTML =
    `<thead><tr><th>bet size</th><th>win rate to break even</th><th>log growth per 100 bets at 55% wins</th></tr></thead><tbody>${rows.join("")}</tbody>`;
}

// ---------- 07 Kelly growth curve ----------
const kellyChart = new LineChart($("#kelly-chart"));
function drawKelly() {
  const p = Number($("#kelly-p").value);
  $("#kelly-p-value").textContent = p.toFixed(2);
  const t = theme();
  const growth = (f) => p * Math.log1p(f) + (1 - p) * Math.log1p(-f);
  const x = range(0, 0.99, 0.005);
  const floor = -0.15;
  const values = x.map((f) => { const g = growth(f); return g < floor ? null : g; });
  const kelly = 2 * p - 1;

  kellyChart.setData({
    x,
    xLabel: "share of stack bet",
    yLabel: "expected log growth per round",
    series: [{ name: `p = ${p.toFixed(2)}`, values, color: t.accent, width: 1.5 }],
    refLines: [{ y: 0, label: "" }],
    vLines: kelly > 0 ? [
      { x: kelly / 2, label: "half kelly" },
      { x: kelly, label: "kelly", color: t.accent },
      { x: Math.min(2 * kelly, 0.99), label: "2× kelly" },
    ] : [],
  });
  legend($("#kelly-legend"), [{ label: `expected log growth when the true win chance is ${p.toFixed(2)}`, color: t.accent }]);

  const best = growth(kelly);
  $("#kelly-readout").textContent = kelly <= 0
    ? "with no edge (p = 0.50) the best bet is nothing: any bet loses growth on average"
    : `kelly share ${percent(kelly, 0)} · growth at kelly ${best.toFixed(4)} per round · ` +
      `half kelly keeps ${percent(growth(kelly / 2) / best, 0)} of that · ` +
      `2× kelly ${2 * kelly >= 1 ? "risks the whole stack" : `gives ${growth(2 * kelly).toFixed(4)}`}`;
}

// ---------- 08 linear vs log ----------
const linearChart = new LineChart($("#linear-chart"));
const logChart = new LineChart($("#log-chart"));
function drawLogs() {
  const t = theme();
  const p = 0.6, rounds = 400, start = 200;
  const strategies = [
    { name: "kelly (20%)", f: 0.2, color: t.accent },
    { name: "half kelly (10%)", f: 0.1, color: withAlpha(t.accent, 0.5) },
    { name: "2× kelly (40%)", f: 0.4, color: t.fg },
  ];
  // exactly 60% wins in a shuffled order, so the figure shows the typical outcome rather than a lucky one
  const random = randomGenerator(11);
  const wins = Array.from({ length: rounds }, (_, i) => i < Math.round(p * rounds));
  for (let i = wins.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [wins[i], wins[j]] = [wins[j], wins[i]]; }
  const x = range(0, rounds, 1);
  const paths = strategies.map((s) => {
    const logGrowth = [0];
    for (const win of wins) logGrowth.push(logGrowth[logGrowth.length - 1] + Math.log1p(win ? s.f : -s.f));
    return { ...s, logGrowth };
  });
  linearChart.setData({
    x,
    yLabel: "chips",
    series: paths.map((s) => ({ name: s.name, values: s.logGrowth.map((g) => start * Math.exp(g)), color: s.color, width: 1.5, endLabel: true })),
  });
  logChart.setData({
    x,
    yLabel: "log growth",
    series: paths.map((s) => ({ name: s.name, values: s.logGrowth, color: s.color, width: 1.5, endLabel: true })),
    refLines: [{ y: 0, label: "start" }],
  });
  const describe = (s) => `${s.name}: ${Math.round(start * Math.exp(s.logGrowth[rounds])).toLocaleString("en-US")} chips (log growth ${s.logGrowth[rounds] >= 0 ? "+" : ""}${s.logGrowth[rounds].toFixed(2)})`;
  $("#logs-readout").textContent = `${rounds} bets with exactly 60% wins, starting with ${start} chips · ${paths.map(describe).join(" · ")}`;
}

// ---------- wiring ----------
let game = simulateGame(ROUNDS, 2026);
let gameSeed = 2026;

function drawAll() {
  drawMarkovDiagram();
  drawStrip(game);
  drawEstimators(game);
  drawBreakEvenTable();
  drawKelly();
  drawLogs();
}

$("#markov-reroll").addEventListener("click", () => {
  gameSeed += 1;
  game = simulateGame(ROUNDS, gameSeed);
  drawStrip(game);
  drawEstimators(game);
});
$("#window-size").addEventListener("input", () => drawEstimators(game));
$("#ema-alpha").addEventListener("input", () => drawEstimators(game));
$("#tolerance-slider").addEventListener("input", () => drawTolerance(game));
$("#kelly-p").addEventListener("input", drawKelly);
new ResizeObserver(() => drawStrip(game)).observe($("#markov-strip"));
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawAll);

drawAll();
