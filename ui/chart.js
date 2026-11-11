// Minimal canvas line chart: lines with gaps (null), shaded bands, reference lines,
// labels at the end of lines, and hover that highlights the nearest line.
//
// data = {
//   x: number[],
//   series: [{ name, values: (number|null)[], color, width?, dash?, endLabel? }],
//   bands:  [{ lo: number[], hi: number[], color }],
//   refLines: [{ y, label }],
//   yLabel: string,
// }

const PAD = { top: 12, bottom: 34, left: 58 };
const HOVER_DISTANCE = 18; // px from a line to count as hovering it

export class LineChart {
  constructor(canvas, { onHover } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.base = document.createElement("canvas"); // cached drawing without hover effects
    this.onHover = onHover;
    this.data = null;

    canvas.addEventListener("mousemove", (event) => this.handleHover(event));
    canvas.addEventListener("mouseleave", () => this.clearHover());
    new ResizeObserver(() => this.render()).observe(canvas);
  }

  setData(data) {
    this.data = data;
    this.render();
  }

  render() {
    const dpr = window.devicePixelRatio || 1;
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    if (!this.width || !this.height) return;
    for (const c of [this.canvas, this.base]) {
      c.width = Math.round(this.width * dpr);
      c.height = Math.round(this.height * dpr);
    }
    this.dpr = dpr;
    this.theme = readTheme();
    if (!this.data || this.data.x.length === 0) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    this.layout();
    this.drawBase();
    this.present(null, null);
  }

  // ---------- geometry ----------
  layout() {
    const { x, series, bands, refLines } = this.data;
    // leave room on the right for the longest end label (at most 35% of the width)
    const measure = this.base.getContext("2d");
    measure.font = `11px ${this.theme.font}`;
    const labelWidth = Math.max(0, ...series.filter((s) => s.endLabel).map((s) => measure.measureText(s.name).width));
    const right = labelWidth ? Math.min(labelWidth + 20, this.width * 0.35) : 16;
    this.maxLabelWidth = right - 12;
    this.plot = {
      left: PAD.left,
      top: PAD.top,
      right: this.width - right,
      bottom: this.height - PAD.bottom,
    };

    let lo = Infinity, hi = -Infinity;
    const scan = (values) => {
      for (const v of values) if (v != null && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    };
    series.forEach((s) => scan(s.values));
    (bands || []).forEach((b) => { scan(b.lo); scan(b.hi); });
    if (lo === Infinity) { lo = -1; hi = 1; }
    lo = Math.min(lo, 0); hi = Math.max(hi, 0); // always show the break-even line
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.04;
    this.yTicks = niceTicks(lo - pad, hi + pad, Math.max(3, Math.floor((this.plot.bottom - this.plot.top) / 60)));
    this.yMin = Math.min(lo - pad, this.yTicks[0]);
    this.yMax = Math.max(hi + pad, this.yTicks[this.yTicks.length - 1]);
    this.xMin = x[0];
    this.xMax = x[x.length - 1] === x[0] ? x[0] + 1 : x[x.length - 1];
    this.xTicks = niceTicks(this.xMin, this.xMax, Math.max(3, Math.floor((this.plot.right - this.plot.left) / 110)))
      .filter((t) => t >= this.xMin && t <= this.xMax);
    this.refLines = (refLines || []).filter((r) => r.y >= this.yMin && r.y <= this.yMax);
  }

  px(xv) { return this.plot.left + ((xv - this.xMin) / (this.xMax - this.xMin)) * (this.plot.right - this.plot.left); }
  py(yv) { return this.plot.bottom - ((yv - this.yMin) / (this.yMax - this.yMin)) * (this.plot.bottom - this.plot.top); }

  // ---------- drawing ----------
  drawBase() {
    const ctx = this.base.getContext("2d");
    const { plot, theme } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.font = `11px ${theme.font}`;
    ctx.lineJoin = "round";

    // grid and axis labels
    ctx.strokeStyle = theme.line;
    ctx.fillStyle = theme.muted;
    ctx.lineWidth = 1;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const t of this.yTicks) {
      const y = Math.round(this.py(t)) + 0.5;
      if (y < plot.top - 1 || y > plot.bottom + 1) continue;
      ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.right, y); ctx.stroke();
      ctx.fillText(formatTick(t), plot.left - 8, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of this.xTicks) {
      ctx.fillText(formatTick(t), this.px(t), plot.bottom + 8);
    }
    ctx.beginPath(); ctx.moveTo(plot.left, plot.bottom + 0.5); ctx.lineTo(plot.right, plot.bottom + 0.5); ctx.stroke();

    // axis titles
    ctx.textAlign = "right";
    ctx.fillText("round", plot.right, plot.bottom + 20);
    ctx.save();
    ctx.translate(12, plot.top);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "right";
    ctx.fillText(this.data.yLabel || "", 0, 0);
    ctx.restore();

    // reference lines
    ctx.setLineDash([3, 4]);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    for (const r of this.refLines) {
      const y = Math.round(this.py(r.y)) + 0.5;
      ctx.strokeStyle = theme.muted;
      ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.right, y); ctx.stroke();
      if (r.label) ctx.fillText(r.label, plot.left + 6, y - 3);
    }
    ctx.setLineDash([]);

    // clip lines and bands to the plot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.left, plot.top - 2, plot.right - plot.left, plot.bottom - plot.top + 4);
    ctx.clip();
    for (const band of this.data.bands || []) this.drawBand(ctx, band);
    for (const s of this.data.series) this.drawLine(ctx, s);
    ctx.restore();

    this.drawEndLabels(ctx);
  }

  drawBand(ctx, band) {
    const { x } = this.data;
    ctx.fillStyle = band.color;
    let open = false;
    let segment = [];
    const flush = () => {
      if (segment.length > 1) {
        ctx.beginPath();
        segment.forEach((i, k) => (k ? ctx.lineTo(this.px(x[i]), this.py(band.hi[i])) : ctx.moveTo(this.px(x[i]), this.py(band.hi[i]))));
        for (let k = segment.length - 1; k >= 0; k--) ctx.lineTo(this.px(x[segment[k]]), this.py(band.lo[segment[k]]));
        ctx.closePath();
        ctx.fill();
      }
      segment = [];
    };
    for (let i = 0; i < x.length; i++) {
      if (band.lo[i] == null || band.hi[i] == null) { if (open) flush(); open = false; continue; }
      open = true;
      segment.push(i);
    }
    flush();
  }

  drawLine(ctx, s, overrides = {}) {
    const { x } = this.data;
    ctx.strokeStyle = overrides.color || s.color;
    ctx.lineWidth = overrides.width || s.width || 1;
    ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    let drawing = false;
    for (let i = 0; i < x.length; i++) {
      const v = s.values[i];
      if (v == null || !Number.isFinite(v)) { drawing = false; continue; }
      const X = this.px(x[i]), Y = this.py(v);
      if (drawing) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); drawing = true; }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawEndLabels(ctx) {
    const labels = [];
    for (const s of this.data.series) {
      if (!s.endLabel) continue;
      const i = lastIndex(s.values);
      if (i < 0) continue;
      labels.push({ text: s.name, color: s.labelColor || s.color, y: this.py(s.values[i]), x: this.px(this.data.x[i]) });
    }
    // spread labels apart so they don't overlap
    labels.sort((a, b) => a.y - b.y);
    const gap = 13;
    for (let k = 1; k < labels.length; k++) labels[k].y = Math.max(labels[k].y, labels[k - 1].y + gap);
    const overflow = labels.length ? labels[labels.length - 1].y - this.plot.bottom : 0;
    if (overflow > 0) labels.forEach((l) => (l.y -= overflow));
    for (let k = labels.length - 2; k >= 0; k--) labels[k].y = Math.min(labels[k].y, labels[k + 1].y - gap);

    ctx.font = `11px ${this.theme.font}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const l of labels) {
      ctx.fillStyle = l.color;
      ctx.fillText(fitText(ctx, l.text, this.maxLabelWidth), this.plot.right + 8, l.y);
    }
  }

  // draws the cached base, dimmed when a line is highlighted, plus the cursor
  present(highlight, index) {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.globalAlpha = highlight ? 0.3 : 1;
    ctx.drawImage(this.base, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (index != null) {
      const X = Math.round(this.px(this.data.x[index])) + 0.5;
      ctx.strokeStyle = this.theme.line;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X, this.plot.top); ctx.lineTo(X, this.plot.bottom); ctx.stroke();
    }
    if (highlight) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.plot.left, this.plot.top - 2, this.plot.right - this.plot.left, this.plot.bottom - this.plot.top + 4);
      ctx.clip();
      this.drawLine(ctx, highlight, { color: this.theme.fg, width: Math.max(1.5, (highlight.width || 1) + 0.5) });
      ctx.restore();
      const v = highlight.values[index];
      if (v != null && Number.isFinite(v)) {
        ctx.fillStyle = this.theme.fg;
        ctx.beginPath(); ctx.arc(this.px(this.data.x[index]), this.py(v), 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // ---------- hover ----------
  handleHover(event) {
    if (!this.data || !this.plot) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left, my = event.clientY - rect.top;
    const { plot } = this;
    if (mx < plot.left || mx > plot.right || my < plot.top || my > plot.bottom) return this.clearHover();

    const xv = this.xMin + ((mx - plot.left) / (plot.right - plot.left)) * (this.xMax - this.xMin);
    const index = nearestIndex(this.data.x, xv);
    let best = null, bestDistance = HOVER_DISTANCE;
    for (const s of this.data.series) {
      const v = s.values[index];
      if (v == null || !Number.isFinite(v)) continue;
      const d = Math.abs(this.py(v) - my);
      if (d < bestDistance) { bestDistance = d; best = s; }
    }
    this.present(best, index);
    if (this.onHover) this.onHover({ x: this.data.x[index], series: best, value: best ? best.values[index] : null });
  }

  clearHover() {
    if (this.data && this.plot) this.present(null, null);
    if (this.onHover) this.onHover(null);
  }
}

// ---------- helpers ----------
function readTheme() {
  const style = getComputedStyle(document.documentElement);
  const get = (name) => style.getPropertyValue(name).trim();
  return { fg: get("--fg"), muted: get("--muted"), line: get("--line"), accent: get("--accent"), font: get("--font") };
}

function niceTicks(lo, hi, count) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => span / s <= count) || 10 * power;
  const ticks = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  return ticks;
}

function formatTick(v) {
  if (Math.abs(v) >= 1e5) return v.toExponential(0);
  return Number.isInteger(v) ? String(v) : String(+v.toFixed(2));
}

function nearestIndex(xs, v) {
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] < v) lo = mid; else hi = mid; }
  return Math.abs(xs[lo] - v) <= Math.abs(xs[hi] - v) ? lo : hi;
}

// shortens text with "…" so it fits in the given width
function fitText(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(text.slice(0, end) + "…").width > width) end--;
  return text.slice(0, end) + "…";
}

function lastIndex(values) {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null && Number.isFinite(values[i])) return i;
  return -1;
}
