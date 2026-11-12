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
function inkLinePath(pixelPoints, seedSalt) {
  const pts = pixelPoints.map(([px, py], i) => [
    px + inkSeededNoise(i, seedSalt + 50) * 1.5,
    py + inkSeededNoise(i, seedSalt) * 3.5,
  ]);
  return d3.line().curve(d3.curveCatmullRom.alpha(0.7))(pts);
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
