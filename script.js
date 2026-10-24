gsap.registerPlugin(ScrollTrigger);

async function loadSections(mdPath) {
  const res = await fetch(mdPath);
  let raw = (await res.text()).replace(/\r\n/g, "\n");

  const chunks = raw.split(/\n(?=## )/).filter(Boolean);
  const sections = {};

  chunks.forEach((chunk) => {
    const match = chunk.match(/^##\s+(.*)\n/);
    if (!match) return;
    const key = match[1].trim();
    const body = chunk.slice(match[0].length).trim();

    const rawSteps = body.split(/\n(?=<!--\s*svg:)/).filter(Boolean);

    sections[key] = rawSteps.map((stepChunk) => {
      const svgMatch = stepChunk.match(/^<!--\s*svg:\s*(.*?)\s*-->\n/);
      const svgName = svgMatch ? svgMatch[1].trim() : null;
      const text = svgMatch ? stepChunk.slice(svgMatch[0].length) : stepChunk;
      return { svg: svgName, html: marked.parse(text.trim()) };
    });
  });

  return sections;
}

async function renderSteps() {
  const sections = await loadSections("media/text/content.md");

  document.querySelectorAll(".step[data-section]").forEach((el) => {
    const key = el.dataset.section;
    const steps = sections[key];
    if (!steps) {
      console.warn(`No markdown section found for "${key}"`);
      return;
    }

    el.innerHTML = "";
    steps.forEach((step, i) => {
      const line = document.createElement("div");
      line.className = "step-line";
      line.dataset.svg = step.svg || "";
      line.dataset.index = i;
      line.innerHTML = step.html;
      el.appendChild(line);
    });
  });
}

const CURTAIN_FADE_ZONE = 0.25;
const CURTAIN_EXIT_MARGIN = 0.25;
const curtainReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function updateCurtainFades() {
  const vh = window.innerHeight;
  const zone = vh * CURTAIN_FADE_ZONE;
  const exit = vh * CURTAIN_EXIT_MARGIN;
  document.querySelectorAll('.curtain .step-line').forEach(box => {
    if (curtainReduceMotion.matches) { box.style.opacity = 1; return; }
    const b = box.getBoundingClientRect();
    const fadeIn  = Math.max(0, Math.min(1, (vh - b.top) / zone));
    const fadeOut = Math.max(0, Math.min(1, b.bottom / zone));
    box.style.opacity = Math.min(fadeIn, fadeOut).toFixed(3);
  });
}

window.addEventListener('scroll', () => requestAnimationFrame(updateCurtainFades), { passive: true });
window.addEventListener('resize', updateCurtainFades);


function updateGraphic(id) {
  const target = id ? document.getElementById(id) : null;
  const stage = target?.closest(".graphic-stage");
  if (!stage || stage.dataset.current === id) return;   // ignore ids that aren't in a stage
  stage.dataset.current = id;

  gsap.utils.toArray(stage.children).forEach((g) => {
    if (g === target) {
      gsap.fromTo(g, { y: 20 }, { autoAlpha: 1, y: 0, duration: 0.6, overwrite: true });
    } else {
      gsap.to(g, { autoAlpha: 0, y: -20, duration: 0.4, overwrite: true });
    }
  });
}

function initScrollTriggers() {
  // No pin: CSS sticky holds the stage. GSAP only swaps graphics.
  gsap.utils.toArray(".step-line").forEach((line) => {
    ScrollTrigger.create({
      trigger: line,
      start: "top 50%",
      end: "bottom 50%",
      onEnter: () => updateGraphic(line.dataset.svg),
      onEnterBack: () => updateGraphic(line.dataset.svg),
    });
  });
}

renderSteps().then(() => {
  // For each stage, show only its first child to start
  document.querySelectorAll(".graphic-stage").forEach((stage) => {
    const kids = gsap.utils.toArray(stage.children);
    gsap.set(kids, { autoAlpha: 0 });
    gsap.set(kids[0], { autoAlpha: 1 });
    stage.dataset.current = kids[0].id;
  });

  initScrollTriggers();
  ScrollTrigger.refresh();
});

//START HAND DRAWN CHART GENERATOR 

/**
 * Hand-inked D3 line chart — reusable, multi-instance safe.
 *
 * Every DOM id, SVG filter id, and CSS class this creates is namespaced
 * with the chart's own instanceId, so you can call createHandDrawnChart()
 * as many times as you want on one page without any collisions.
 *
 * Usage:
 *   <div id="chart-1"></div>
 *   <script>
 *     createHandDrawnChart({
 *       container: "#chart-1",
 *       categories: [
 *         { key:"restaurants", label:"Restaurants & Bars", color:"#f27966" },
 *         { key:"retail",      label:"Independent Retail", color:"#e0a638" },
 *       ],
 *       data: rawData, // see buildDemoData() below for shape
 *     });
 *   </script>
 */
 
let __handDrawnChartCounter = 0;
 
function seededNoise(i, salt) {
  // deterministic pseudo-random in [-1,1], stable across redraws
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}
 
/**
 * Builds a hand-wavered line generator. Each sample point gets a small
 * per-index offset seeded from (index, salt), so redraws stay stable
 * instead of flickering on every interaction.
 */
function makeHandLine(xScale, yScale, seedSalt) {
  return (values) => {
    const pts = values.map((v, i) => {
      const jitterY = seededNoise(i, seedSalt) * 3.5;
      const jitterX = seededNoise(i, seedSalt + 50) * 1.5;
      return [xScale(v.x) + jitterX, yScale(v.y) + jitterY];
    });
    const gen = d3.line().curve(d3.curveCatmullRom.alpha(0.7));
    return gen(pts);
  };
}


/**
 * Creates one hand-inked, interactive line chart (main view + brushable
 * mini timeline + toggleable legend) inside the given container.
 *
 * @param {Object} opts
 * @param {string|HTMLElement} opts.container   CSS selector or element to render into
 * @param {Array}  opts.categories              [{ key, label, color }]
 * @param {Array}  opts.data                    [{ key, values:[{x,y}, ...] }] — one entry per category
 * @param {string} [opts.title]                 optional heading text
 * @param {string} [opts.subtitle]              optional subheading text
 * @param {number} [opts.width=860]
 * @param {number} [opts.mainHeight=380]
 * @param {number} [opts.brushHeight=70]
 * @param {Function} [opts.xFormat]             d3 format fn for x-axis ticks (default: d3.format("d"))
 * @returns {Object} instance handle with { id, redraw(), destroy() }
 */
function createHandDrawnChart(opts) {
  const {
    container,
    categories,
    data,
    title = "",
    subtitle = "",
    width = 860,
    mainHeight = 380,
    brushHeight = 70,
    xFormat = d3.format("d"),
  } = opts;
 
  // ---------- namespacing ----------
  const instanceId = `hdc-${++__handDrawnChartCounter}`;
  const filterId = `${instanceId}-inkwobble`;
  const filterBoldId = `${instanceId}-inkwobble-bold`;
 
  const root = d3.select(
    typeof container === "string" ? container : container
  );
  root.classed("hand-drawn-chart", true).attr("data-instance", instanceId);
 
  // ---------- markup (scoped to this instance) ----------
  root.html(""); // clear in case of re-render
 
  if (title) {
    root.append("h2").attr("class", "hdc-title").text(title);
  }
  if (subtitle) {
    root.append("p").attr("class", "hdc-subtitle").text(subtitle);
  }
 
  const legend = root.append("div").attr("class", "hdc-legend");
  root
    .append("p")
    .attr("class", "hdc-hint")
    .text(
      "click a legend dot to toggle a category · drag on the timeline below to zoom"
    );
 
  const mainSvg = root
    .append("svg")
    .attr("class", "hdc-main")
    .attr("width", width)
    .attr("height", mainHeight);
 
  const brushSvg = root
    .append("svg")
    .attr("class", "hdc-brush")
    .attr("width", width)
    .attr("height", brushHeight);
 
  // ---------- filters (unique ids per instance) ----------
  const defs = mainSvg.append("defs");
 
  defs
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
 
  defs
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
 
  // ---------- state ----------
  let activeKeys = new Set(categories.map((c) => c.key));
  const allX = data[0].values.map((v) => v.x);
  let currentDomain = [allX[0], allX[allX.length - 1]];
 
  // ---------- legend ----------
  legend
    .selectAll("button")
    .data(categories)
    .join("button")
    .attr("class", "hdc-legend-btn")
    .html(
      (d) => `<span class="hdc-swatch" style="background:${d.color}"></span>${d.label}`
    )
    .on("click", function (event, d) {
      if (activeKeys.has(d.key) && activeKeys.size === 1) return; // keep at least one on
      activeKeys.has(d.key) ? activeKeys.delete(d.key) : activeKeys.add(d.key);
      d3.select(this).classed("off", !activeKeys.has(d.key));
      draw(currentDomain);
    });
 
  // ---------- main chart ----------
  const margin = { top: 20, right: 24, bottom: 30, left: 40 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = mainHeight - margin.top - margin.bottom;
 
  const g = mainSvg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);
 
  const x = d3.scaleLinear().range([0, innerWidth]);
  const y = d3.scaleLinear().range([innerHeight, 0]);
 
  const gx = g
    .append("g")
    .attr("class", "hdc-axis")
    .attr("transform", `translate(0,${innerHeight})`);
  const gy = g.append("g").attr("class", "hdc-axis");
 
  const linesLayer = g.append("g");
 
  function draw(domain) {
    currentDomain = domain;
    const visible = data.filter((d) => activeKeys.has(d.key));
 
    x.domain(domain);
    const maxY =
      d3.max(visible, (d) =>
        d3.max(
          d.values.filter((v) => v.x >= domain[0] && v.x <= domain[1]),
          (v) => v.y
        )
      ) || 1;
    y.domain([0, maxY * 1.15]);
 
    const tickCount = Math.max(
      2,
      allX.filter((v) => v >= domain[0] && v <= domain[1]).length
    );
 
    gx.transition()
      .duration(300)
      .call(d3.axisBottom(x).tickFormat(xFormat).ticks(tickCount));
    gy.transition().duration(300).call(d3.axisLeft(y).ticks(5));
 
    const catByKey = Object.fromEntries(categories.map((c) => [c.key, c]));
    const paths = linesLayer
      .selectAll("path.hdc-series")
      .data(visible, (d) => d.key);
 
    paths.join(
      (enter) =>
        enter
          .append("path")
          .attr("class", "hdc-series")
          .attr("fill", "none")
          .attr("stroke", (d) => catByKey[d.key].color)
          .attr("stroke-width", 3)
          .attr("stroke-linecap", "round")
          .attr("filter", `url(#${filterId})`)
          .attr("d", (d) =>
            makeHandLine(x, y, d.key.length)(
              d.values.filter((v) => v.x >= domain[0] && v.x <= domain[1])
            )
          )
          .style("opacity", 0)
          .transition()
          .duration(300)
          .style("opacity", 0.9),
      (update) =>
        update.transition().duration(300).attr("d", (d) =>
          makeHandLine(x, y, d.key.length)(
            d.values.filter((v) => v.x >= domain[0] && v.x <= domain[1])
          )
        ),
      (exit) => exit.transition().duration(200).style("opacity", 0).remove()
    );
  }
 
  // ---------- brush timeline (mini overview) ----------
  const bMargin = { top: 6, right: 24, bottom: 22, left: 40 };
  const bInnerWidth = width - bMargin.left - bMargin.right;
  const bInnerHeight = brushHeight - bMargin.top - bMargin.bottom;
 
  const bg = brushSvg
    .append("g")
    .attr("transform", `translate(${bMargin.left},${bMargin.top})`);
 
  const bx = d3.scaleLinear().domain(currentDomain).range([0, bInnerWidth]);
  const by = d3.scaleLinear().range([bInnerHeight, 0]);
  by.domain([0, d3.max(data, (d) => d3.max(d.values, (v) => v.y)) * 1.1]);
 
  const catByKey2 = Object.fromEntries(categories.map((c) => [c.key, c]));
  data.forEach((d) => {
    bg.append("path")
      .datum(d.values)
      .attr("fill", "none")
      .attr("stroke", catByKey2[d.key].color)
      .attr("stroke-width", 1.6)
      .attr("stroke-opacity", 0.65)
      .attr("filter", `url(#${filterBoldId})`)
      .attr("d", makeHandLine(bx, by, d.key.length + 20));
  });
 
  bg.append("g")
    .attr("class", "hdc-axis")
    .attr("transform", `translate(0,${bInnerHeight})`)
    .call(d3.axisBottom(bx).tickFormat(xFormat).ticks(8));
 
  // step between x values, used to snap the brush selection
  const step = allX.length > 1 ? Math.abs(allX[1] - allX[0]) : 1;
 
  const brush = d3
    .brushX()
    .extent([
      [0, 0],
      [bInnerWidth, bInnerHeight],
    ])
    .on("brush end", (event) => {
      if (!event.selection) return;
      const [x0, x1] = event.selection.map(bx.invert);
      draw([Math.round(x0 / step) * step, Math.round(x1 / step) * step]);
    });
 
  const brushG = bg.append("g").attr("class", "hdc-brush-g").call(brush);
  brushG.call(brush.move, [bx(currentDomain[0]), bx(currentDomain[1])]);
 
  draw(currentDomain);
 
  // ---------- public handle ----------
  return {
    id: instanceId,
    redraw: () => draw(currentDomain),
    destroy: () => root.html(""),
  };
}
 
/**
 * Helper for demo/testing: builds the same shape of fake data as the
 * original prototype, in the generic {key, values:[{x,y}]} format that
 * createHandDrawnChart expects.
 */
function buildDemoData(categories) {
  const years = d3.range(1950, 2021, 5);
  return categories.map((c, ci) => ({
    key: c.key,
    values: years.map((yr, i) => {
      const base = { restaurants: 8, retail: 22, chains: 2, vacant: 3 }[c.key] ?? 5;
      const trend =
        { restaurants: 0.35, retail: -0.28, chains: 0.45, vacant: 0.12 }[c.key] ?? 0;
      const wobble = Math.sin(i * 0.7 + ci) * 2.2;
      return { x: yr, y: Math.max(0, base + trend * i + wobble) };
    }),
  }));
}
 
// Expose on window for plain <script> usage (no bundler required).
if (typeof window !== "undefined") {
  window.createHandDrawnChart = createHandDrawnChart;
  window.buildDemoData = buildDemoData;
}


//END HAND DRAWN CHART GENERATOR

//CHARTS

//CHART A: MAP SHORT BLOCKS

function createLegend({ container, title, colors, thresholds, unit = "ft" }) {
  const fmt = (v) => Math.round(v);

  const items = colors.map((color, i) => {
    let label;
    if (i === 0) label = `Under ${fmt(thresholds[0])} ${unit}`;
    else if (i === colors.length - 1) label = `${fmt(thresholds[i - 1])} ${unit} +`;
    else label = `${fmt(thresholds[i - 1])}–${fmt(thresholds[i])} ${unit}`;
    return { color, label };
  });

  const legend = d3.select(container)
    .append("div")
    .attr("class", "hdc-legend");

  legend.append("div")
    .attr("class", "hdc-legend-title")
    .text(title);

  const row = legend.selectAll(".hdc-legend-row")
    .data(items)
    .join("div")
    .attr("class", "hdc-legend-row");

  row.append("span")
    .attr("class", "hdc-legend-swatch")
    .style("background", (d) => d.color);

  row.append("span").text((d) => d.label);

  return legend;
}

Promise.all([
  fetch("data/manhattan_ntas.geojson").then((r) => r.json()),
  fetch("data/block_stats.json").then((r) => r.json()),
  fetch("data/manhattan_segments.geojson").then((r) => r.json()),
]).then(([neighborhoods, medianData, segments]) => {

  // legend bins: <250, 250–300, 300–350, 350–400, 400+
  const thresholds = [275, 300, 325, 350, 375, 400];

  const medianLookup = {};
  medianData.forEach((d) => { medianLookup[d.ntaname] = d; });

  neighborhoods.features.forEach((f) => {
    const stats = medianLookup[f.properties.ntaname];
    f.properties.mean_length_ft   = stats ? stats.mean_length_ft : null;
    f.properties.median_length_ft = stats ? stats.median_length_ft : null;
    // use the json flag, but fall back to matching the name directly
    f.properties.is_gv = (stats && stats.is_gv) ||
      /Greenwich Village|West Village/i.test(f.properties.ntaname || "");
  });

  const nGroups = thresholds.length + 1;

  const colorDark  = "#6e2107";
  const colorMid   = "#ca5223";
  const colorLight = "#fe7e4f";

  const ramp = d3.scaleLinear()
    .domain([0, 0.5, 1])
    .range([colorDark, colorMid, colorLight])
    .interpolate(d3.interpolateLab);

  const WHITE_MIX = 0.15;   // 15% white

  const groupColors = d3.range(nGroups).map((i) =>
    d3.interpolateLab(
      ramp(nGroups === 1 ? 0 : i / (nGroups - 1)),
      "#ffffff"
    )(WHITE_MIX)
  );

  const neighborhoodColorScale = d3.scaleThreshold()
    .domain(thresholds)
    .range(groupColors);

  // 1. neighborhoods
  const neighborhoodMap = createHandDrawnMap({
    container: "#map-a",
    geojson: neighborhoods,
    zoomScale: 3,
    zoomCenter: [0.3, 1],
    title: "Greenwich Village and the West Village have among the shortest blocks in Manhattan",
    subtitle: "Average length of blocks in Manhattan, by neighborhood",
    valueByFeature: (d) => d.properties.mean_length_ft,
    colorScale: neighborhoodColorScale,
    strokeOnly: false,
  });

  createLegend({
    container: "#map-a",
    title: "Average block length",
    colors: groupColors,
    thresholds: thresholds,
  });

  // 2. street segments
  neighborhoodMap.g
    .selectAll("path.hdc-street")
    .data(segments.features.filter((f) => f.geometry != null))
    .join("path")
    .attr("class", "hdc-street")
    .attr("d", neighborhoodMap.path)
    .attr("fill", "none")
    .attr("stroke", "#33302a")
    .attr("stroke-opacity", 0.25)
    .attr("stroke-width", 1.5)
    .attr("stroke-linecap", "round")
    .attr("vector-effect", "non-scaling-stroke");

  // 3. GV border + labels
  const labelFeatures = neighborhoods.features.filter((f) => f.properties.is_gv);

  neighborhoodMap.g
    .selectAll("path.hdc-gv-border")
    .data(labelFeatures)
    .join("path")
    .attr("class", "hdc-gv-border")
    .attr("d", neighborhoodMap.path)
    .attr("fill", "none")
    .attr("stroke", "#f27966")
    .attr("stroke-width", 6)
    .attr("stroke-opacity", .7)
    .attr("stroke-linejoin", "round")
    .attr("vector-effect", "non-scaling-stroke")
    .style("pointer-events", "none");

  neighborhoodMap.g
    .selectAll("text.hdc-label")
    .data(labelFeatures)
    .join("text")
    .attr("class", "hdc-label")
    .attr("x", (d) => neighborhoodMap.path.centroid(d)[0] + 4)
    .attr("y", (d) => neighborhoodMap.path.centroid(d)[1] + 6)
    .attr("text-anchor", "middle")
    .attr("font-size", 8)
    .attr("font-family", "'Libre Baskerville', serif")
    .attr("font-style", "italic")
    .attr("font-weight", 600)
    .attr("fill", "#33302a")
    .style("pointer-events", "none")
    .text((d) => d.properties.ntaname);


}).catch((err) => console.error("Chart A failed:", err));

//CHART B: BAR CHART OF MEAN BLOCK LENGTH

Promise.all([
  fetch("data/block_stats.json").then((r) => r.json()),
  fetch("data/manhattan_ntas.geojson").then((r) => r.json()),
]).then(([stats, ntas]) => {

  // only neighborhoods that appear on the map in Chart A
  const onMap = new Set(ntas.features.map((f) => f.properties.ntaname));

  const data = stats
    .filter((d) => onMap.has(d.ntaname) && d.mean_length_ft != null)
    .map((d) => ({
      name: /Greenwich Village/i.test(d.ntaname) ? "Greenwich Village" : d.ntaname,
      value: d.mean_length_ft,
      isGV: !!d.is_gv,
    }))
    .sort((a, b) => a.value - b.value);          // shortest at the top

  const COLOR_GV    = "#f27966";
  const COLOR_OTHER = "#ddb298";

  const margin = { top: 70, right: 50, bottom: 40, left: 210 };
  const barH   = 22;
  const width  = 720;
  const height = margin.top + margin.bottom + data.length * barH;

  const svg = d3.select("#chart-b")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .style("height", "auto");

  svg.append("text")
    .attr("x", 0).attr("y", 22)
    .attr("font-family", "'Libre Baskerville', serif")
    .attr("font-size", 16).attr("font-weight", 700)
    .attr("fill", "#33302a")
    .text("Greenwich Village has among the shortest blocks in Manhattan");

  svg.append("text")
    .attr("x", 0).attr("y", 44)
    .attr("font-family", "'Libre Baskerville', serif")
    .attr("font-size", 12).attr("fill", "#33302a")
    .text("Average block length by neighborhood");

  const x = d3.scaleLinear()
    .domain([0, d3.max(data, (d) => d.value)])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(data.map((d) => d.name))
    .range([margin.top, height - margin.bottom])
    .padding(0.2);

  // light gridlines + x axis
  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickSize(-(height - margin.top - margin.bottom)))
    .call((g) => g.select(".domain").remove())
    .call((g) => g.selectAll(".tick line").attr("stroke", "#33302a").attr("stroke-opacity", 0.1))
    .call((g) => g.selectAll("text").attr("font-size", 10).attr("fill", "#33302a"));

  svg.append("text")
    .attr("x", (margin.left + width - margin.right) / 2)
    .attr("y", height - 6)
    .attr("text-anchor", "middle")
    .attr("font-size", 10).attr("fill", "#33302a")
    .text("Average block length (feet)");

  // bars
  svg.append("g")
    .selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", x(0))
    .attr("y", (d) => y(d.name))
    .attr("width", (d) => x(d.value) - x(0))
    .attr("height", y.bandwidth())
    .attr("fill", (d) => (d.isGV ? COLOR_GV : COLOR_OTHER));

  // neighborhood names
  svg.append("g")
    .selectAll("text")
    .data(data)
    .join("text")
    .attr("x", margin.left - 8)
    .attr("y", (d) => y(d.name) + y.bandwidth() / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .attr("font-size", 11)
    .attr("font-weight", (d) => (d.isGV ? 700 : 400))
    .attr("fill", "#33302a")
    .text((d) => d.name);

  // value labels
  svg.append("g")
    .selectAll("text")
    .data(data)
    .join("text")
    .attr("x", (d) => x(d.value) + 5)
    .attr("y", (d) => y(d.name) + y.bandwidth() / 2)
    .attr("dy", "0.35em")
    .attr("font-size", 10)
    .attr("font-weight", (d) => (d.isGV ? 700 : 400))
    .attr("fill", "#33302a")
    .text((d) => `${Math.round(d.value)} ft`);

}).catch((err) => console.error("Chart B failed:", err));

//END CHART B

//CHART C: MAP OF BUILDING AGE IN GREENWICH VILLAGE

Promise.all([
  fetch("data/gv_buildingsage.geojson").then((r) => r.json()),
  fetch("data/gv_boundary.geojson").then((r) => r.json()),
]).then(([lots, boundary]) => {

  // era bins: edit freely, no need to re-run R
  const thresholds = [1830, 1860, 1900, 1930, 1960, 2000];
  const eras = [
    { label: "Before 1830", color: "#7f3b08" },
    { label: "1830–1859",   color: "#b35806" },
    { label: "1860–1899",   color: "#e08214" },
    { label: "1900–1929",   color: "#fdb863" },
    { label: "1930–1959",   color: "#b2abd2" },
    { label: "1960–1999",   color: "#8073ac" },
    { label: "2000 +",      color: "#2d004b" },
  ];
  const NO_DATA = "#e6e1d8";

  const colorFor = (y) =>
    (y == null || !isFinite(y) || y <= 0) ? NO_DATA : eras[d3.bisect(thresholds, y)].color;

  const width = 700, height = 820;

  const svg = d3.select("#map-c")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .style("height", "auto");

  svg.append("text")
    .attr("x", 0).attr("y", 24)
    .attr("font-family", "'Libre Baskerville', serif")
    .attr("font-size", 16).attr("font-weight", 700)
    .attr("fill", "#33302a")
    .text("Most buildings in Greenwich Village date from the 19th century");   // check against the data

  svg.append("text")
    .attr("x", 0).attr("y", 46)
    .attr("font-family", "'Libre Baskerville', serif")
    .attr("font-size", 12).attr("fill", "#33302a")
    .text("Tax lots by year built");

  const projection = d3.geoMercator()
    .fitExtent([[10, 70], [width - 10, height - 10]], boundary);
  const path = d3.geoPath(projection);

  const g = svg.append("g");

  g.selectAll("path.hdc-lot")
    .data(lots.features.filter((f) => f.geometry != null))
    .join("path")
    .attr("class", "hdc-lot")
    .attr("d", path)
    .attr("fill", (d) => colorFor(d.properties.yearbuilt))
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 0.3)
    .append("title")
    .text((d) => {
      const p = d.properties;
      const yr = p.yearbuilt ? `built ${Math.round(p.yearbuilt)}` : "year built unknown";
      return `${p.address || "Lot"}: ${yr}`;
    });

  // Greenwich Village boundary, same style as Chart A
  g.selectAll("path.hdc-gv-border")
    .data(boundary.type === "FeatureCollection" ? boundary.features : [boundary])
    .join("path")
    .attr("class", "hdc-gv-border")
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "#f27966")
    .attr("stroke-width", 4)
    .attr("stroke-opacity", 0.7)
    .attr("stroke-linejoin", "round")
    .style("pointer-events", "none");

  // legend (reuses the .hdc-legend styles from Chart A)
  const legend = d3.select("#map-c").append("div").attr("class", "hdc-legend");
  legend.append("div").attr("class", "hdc-legend-title").text("Year built");

  const items = [...eras, { label: "No data", color: NO_DATA }];
  const row = legend.selectAll(".hdc-legend-row")
    .data(items)
    .join("div")
    .attr("class", "hdc-legend-row");
  row.append("span").attr("class", "hdc-legend-swatch").style("background", (d) => d.color);
  row.append("span").text((d) => d.label);

}).catch((err) => console.error("Chart C failed:", err));
// END CHART C

//CHART D: BAR CHART OF BUILDING AGE IN GREENWICH VILLAGE

fetch("data/gv_buildingsage.geojson")
  .then((r) => r.json())
  .then((lots) => {

    // same eras and colors as Chart C
    const thresholds = [1830, 1860, 1900, 1930, 1960, 2000];
    const eras = [
      { label: "Before 1830", color: "#7f3b08" },
      { label: "1830–1859",   color: "#b35806" },
      { label: "1860–1899",   color: "#e08214" },
      { label: "1900–1929",   color: "#fdb863" },
      { label: "1930–1959",   color: "#b2abd2" },
      { label: "1960–1999",   color: "#8073ac" },
      { label: "2000 +",      color: "#2d004b" },
    ];

    // count lots per era (lots with no year are left out, as in the R version)
    const counts = new Array(eras.length).fill(0);
    let known = 0, unknown = 0;

    lots.features.forEach((f) => {
      const y = f.properties.yearbuilt;
      if (y == null || !isFinite(y) || y <= 0) { unknown++; return; }
      counts[d3.bisect(thresholds, y)]++;
      known++;
    });

    const data = eras.map((e, i) => ({
      label: e.label,
      color: e.color,
      value: counts[i],
      share: known ? counts[i] / known : 0,
    }));

    const margin = { top: 80, right: 20, bottom: 70, left: 55 };
    const width  = 720;
    const height = 460;

    const svg = d3.select("#chart-d")
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .style("height", "auto");

    svg.append("text")
      .attr("x", 0).attr("y", 24)
      .attr("font-family", "'Libre Baskerville', serif")
      .attr("font-size", 16).attr("font-weight", 700)
      .attr("fill", "#33302a")
      .text("When Greenwich Village's buildings were built");    // check against the data

    svg.append("text")
      .attr("x", 0).attr("y", 46)
      .attr("font-family", "'Libre Baskerville', serif")
      .attr("font-size", 12).attr("fill", "#33302a")
      .text("Number of tax lots by year built");

    const x = d3.scaleBand()
      .domain(data.map((d) => d.label))
      .range([margin.left, width - margin.right])
      .padding(0.2);

    const y = d3.scaleLinear()
      .domain([0, d3.max(data, (d) => d.value)])
      .nice()
      .range([height - margin.bottom, margin.top]);

    // gridlines + y axis
    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-(width - margin.left - margin.right)))
      .call((g) => g.select(".domain").remove())
      .call((g) => g.selectAll(".tick line").attr("stroke", "#33302a").attr("stroke-opacity", 0.1))
      .call((g) => g.selectAll("text").attr("font-size", 10).attr("fill", "#33302a"));

    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -(margin.top + height - margin.bottom) / 2)
      .attr("y", 14)
      .attr("text-anchor", "middle")
      .attr("font-size", 10).attr("fill", "#33302a")
      .text("Tax lots");

    // bars
    svg.append("g")
      .selectAll("rect")
      .data(data)
      .join("rect")
      .attr("x", (d) => x(d.label))
      .attr("y", (d) => y(d.value))
      .attr("width", x.bandwidth())
      .attr("height", (d) => y(0) - y(d.value))
      .attr("fill", (d) => d.color)
      .append("title")
      .text((d) => `${d.label}: ${d.value.toLocaleString()} lots (${Math.round(d.share * 100)}%)`);

    // count + percent labels above the bars
    svg.append("g")
      .selectAll("text")
      .data(data)
      .join("text")
      .attr("x", (d) => x(d.label) + x.bandwidth() / 2)
      .attr("y", (d) => y(d.value) - 6)
      .attr("text-anchor", "middle")
      .attr("font-size", 10)
      .attr("fill", "#33302a")
      .text((d) => `${d.value.toLocaleString()} (${Math.round(d.share * 100)}%)`);

    // era labels
    svg.append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).tickSize(0))
      .call((g) => g.select(".domain").attr("stroke", "#33302a").attr("stroke-opacity", 0.4))
      .call((g) => g.selectAll("text").attr("dy", "1em").attr("font-size", 11).attr("fill", "#33302a"));

    // note on missing data
    svg.append("text")
      .attr("x", 0).attr("y", height - 8)
      .attr("font-size", 10).attr("fill", "#33302a").attr("fill-opacity", 0.7)
      .text(`${unknown.toLocaleString()} lots with no year built are not shown. Source: NYC MapPLUTO`);

  }).catch((err) => console.error("Chart D failed:", err));



  ScrollTrigger.refresh();
//END CHARTS
