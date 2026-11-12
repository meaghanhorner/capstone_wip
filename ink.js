/**
 * ink.js — the shared "what makes it look hand-drawn" toolkit.
 *
 * This file knows nothing about charts, axes, or data shapes. It only
 * knows how to (a) generate stable, deterministic jitter, and (b) turn
 * that jitter into SVG filters, wobbly line paths, and wobbly rect paths.
 * Every chart-type file (chart-line.js, chart-treemap.js, chart-map.js...)
 * imports from here, so the aesthetic stays identical across all of them.
 */

let __inkInstanceCounter = 0;

/** Unique, human-readable instance id, e.g. inkNextId("hdc") -> "hdc-3" */
function inkNextId(prefix) {
  return `${prefix}-${++__inkInstanceCounter}`;
}

/** Deterministic pseudo-random in [-1, 1]. Same (i, salt) always gives
 * the same result, so redraws/interactions never cause flicker. */
function inkSeededNoise(i, salt) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Installs the two standard ink-wobble SVG filters into a <defs>
 * selection, namespaced to instanceId so multiple charts on one page
 * never collide over a filter id.
 *
 * @returns {{filterId: string, filterBoldId: string}}
 */
function installInkFilters(defsSelection, instanceId) {
  const filterId = `${instanceId}-inkwobble`;
  const filterBoldId = `${instanceId}-inkwobble-bold`;

  defsSelection
    .append("filter")
    .attr("id", filterId)
    .attr("x", "-20%")
    .attr("y", "-20%")
    .attr("width", "140%")
    .attr("height", "140%")
    .html(`
      <feTurbulence type="fractalNoise" baseFrequency="0.012 0.06" numOctaves="2" seed="7" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.2" xChannelSelector="R" yChannelSelector="G"/>
    `);

  defsSelection
    .append("filter")
    .attr("id", filterBoldId)
    .attr("x", "-20%")
    .attr("y", "-20%")
    .attr("width", "140%")
    .attr("height", "140%")
    .html(`
      <feTurbulence type="fractalNoise" baseFrequency="0.02 0.09" numOctaves="2" seed="3" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="4.5" xChannelSelector="R" yChannelSelector="G"/>
    `);

  return { filterId, filterBoldId };
}

/**
 * Jittered, hand-wavered line path through already-projected pixel
 * points. Used for line charts, but also for any freeform outline
 * (a coastline, a hand-ruled connector, etc).
 *
 * @param {Array<[number,number]>} pixelPoints
 * @param {number} seedSalt  vary this per series so parallel lines don't wobble in lockstep
 */
function inkLinePath(points, seed = 0, opts = {}) {
  const { vertexJitter = 1.2, bow = 0.02, maxBow = 4, corner = 18 } = opts;
  if (!points || points.length < 2) return "";

  let s = ((seed + 1) * 2654435761) >>> 0;
  const rand = () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = () => rand() * 2 - 1;
  const f = (v) => v.toFixed(2);

  const pts = points.map(([x, y]) => [x + r() * vertexJitter, y + r() * vertexJitter]);

  // gently bowed segment from a to b
  const seg = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const off = r() * Math.min(maxBow, len * bow);
    return ` C${f(a[0] + dx / 3 + nx * off)},${f(a[1] + dy / 3 + ny * off)}` +
           ` ${f(a[0] + (2 * dx) / 3 + nx * off)},${f(a[1] + (2 * dy) / 3 + ny * off)}` +
           ` ${f(b[0])},${f(b[1])}`;
  };

  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  let cur = pts[0];

  for (let i = 1; i < pts.length; i++) {
    if (i < pts.length - 1) {
      const prev = pts[i - 1], v = pts[i], next = pts[i + 1];
      const l1 = Math.hypot(v[0] - prev[0], v[1] - prev[1]) || 1;
      const l2 = Math.hypot(next[0] - v[0], next[1] - v[1]) || 1;
      const rad = Math.min(corner, l1 / 2, l2 / 2); // never eat more than half a segment

      const entry = [v[0] - ((v[0] - prev[0]) / l1) * rad, v[1] - ((v[1] - prev[1]) / l1) * rad];
      const exit  = [v[0] + ((next[0] - v[0]) / l2) * rad, v[1] + ((next[1] - v[1]) / l2) * rad];

      d += seg(cur, entry);                                   // run up to the corner
      d += ` Q${f(v[0])},${f(v[1])} ${f(exit[0])},${f(exit[1])}`; // round it, using the data point as the control
      cur = exit;
    } else {
      d += seg(cur, pts[i]);
    }
  }
  return d;
}

/**
 * Jittered rectangle path — for bars, treemap tiles, or anything with
 * straight edges that should still read as hand-ruled rather than
 * CAD-drawn. Each corner gets its own small, stable offset.
 */
function inkRectPath(x, y, w, h, seedSalt) {
  const j = (i) => inkSeededNoise(i, seedSalt) * 1.6;
  const corners = [
    [x + j(0), y + j(1)],
    [x + w + j(2), y + j(3)],
    [x + w + j(4), y + h + j(5)],
    [x + j(6), y + h + j(7)],
  ];
  return d3.line().curve(d3.curveCatmullRomClosed.alpha(0.6))(corners);
}

// Expose as plain globals for no-bundler, multi-file <script> usage.
if (typeof window !== "undefined") {
  window.inkNextId = inkNextId;
  window.inkSeededNoise = inkSeededNoise;
  window.installInkFilters = installInkFilters;
  window.inkLinePath = inkLinePath;
  window.inkRectPath = inkRectPath;
}
