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

    // split into line-groups on the svg directive
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

    // clear placeholder, build one .step-line per line-group
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

  // initScrollTriggers(); // set up GSAP once DOM is populated
}

renderSteps();


gsap.registerPlugin(ScrollTrigger);

ScrollTrigger.config({
  autoRefreshEvents: "visibilitychange,DOMContentLoaded,resize",
});

let mm = gsap.matchMedia();

// Desktop / tablet: pinned graphic, scrubbed steps
mm.add(
  {
    isDesktop: "(min-width: 768px) and (prefers-reduced-motion: no-preference)",
    isMobile: "(max-width: 767px) and (prefers-reduced-motion: no-preference)",
    reduced: "(prefers-reduced-motion: reduce)",
  },
  (context) => {
    const { isDesktop, isMobile, reduced } = context.conditions;
    const steps = gsap.utils.toArray(".step");
    const triggers = [];

    if (isDesktop) {
      const stage = document.querySelector(".graphic-stage");

      const pinTrigger = ScrollTrigger.create({
        trigger: ".narrative-steps",
        start: "top top",
        end: "bottom bottom",
        pin: stage,
        pinSpacing: false, // narrative column already provides scroll length
      });
      triggers.push(pinTrigger);

      steps.forEach((step, index) => {
        triggers.push(
          ScrollTrigger.create({
            trigger: step,
            start: "top 60%",
            end: "bottom 40%",
            onEnter: () => updateGraphic(index, "forward"),
            onEnterBack: () => updateGraphic(index, "backward"),
          })
        );
      });
    }

    if (isMobile) {
      // no pinning on mobile — avoid dynamic-toolbar jump/flicker
      steps.forEach((step, index) => {
        triggers.push(
          ScrollTrigger.create({
            trigger: step,
            start: "top 70%",
            onEnter: () => updateGraphic(index, "forward"),
            onEnterBack: () => updateGraphic(index, "backward"),
          })
        );
      });
    }

    if (reduced) {
      // static reveal only, no scroll-linked motion
      steps.forEach((step, index) => updateGraphic(index, "forward"));
    }

    // cleanup on breakpoint change
    return () => {
      triggers.forEach((t) => t.kill());
    };
  }
);

// Refresh once fonts/images settle, so trigger math uses final layout
document.fonts.ready.then(() => ScrollTrigger.refresh());

window.addEventListener("load", () => {
  const images = document.querySelectorAll(".graphic-stage img");
  Promise.all(
    Array.from(images).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((res) => img.addEventListener("load", res, { once: true }))
    )
  ).then(() => ScrollTrigger.refresh());
});

function updateGraphic(stepIndex, direction) {
  // your existing graphic-update logic
}

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
  fetch("/data/manhattan_ntas.geojson").then((r) => r.json()), // shapes — swap in your real filename
  fetch("/data/block_stats.json").then((r) => r.json()),             // the array you just showed — swap in your real filename
  fetch("/data/manhattan_segments.geojson").then((r) => r.json()),      // streets
]).then(([neighborhoods, medianData, segments]) => {

  // build a lookup: neighborhood name -> stats object
  const medianLookup = {};
  medianData.forEach((d) => {
    medianLookup[d.ntaname] = d;
  });

   neighborhoods.features = neighborhoods.features.filter(
    (f) => f.properties.boroname === "Manhattan"
  );

   neighborhoods.features.forEach((f) => {
    const stats = medianLookup[f.properties.ntaname];
    f.properties.mean_length_ft = stats ? stats.mean_length_ft : null; 
    f.properties.is_gv = stats ? stats.is_gv : false;
  });

  const GROUP_SIZE = 5;

  const sortedMeans = neighborhoods.features
    .map((f) => f.properties.mean_length_ft)
    .filter((v) => v != null)
    .sort(d3.ascending);

  const thresholds = d3.range(GROUP_SIZE, sortedMeans.length, GROUP_SIZE)
    .map((i) => sortedMeans[i]);

  const nGroups = thresholds.length + 1;

  const colorDark  = "#7c2c13";  
  const colorLight = "#e0a638";
  const groupColors = d3.range(nGroups).map((i) =>
    d3.interpolateLab(colorDark, colorLight)(nGroups === 1 ? 0 : i / (nGroups - 1))
  );

  

  // attach median (and other stats) onto each neighborhood polygon's properties
  neighborhoods.features.forEach((f) => {
    const stats = medianLookup[f.properties.ntaname]; // <-- confirm boundary geojson also uses "ntaname"
    f.properties.median_length_ft = stats ? stats.median_length_ft : null;
    f.properties.is_gv = stats ? stats.is_gv : false;
  });

  // color scale for neighborhoods, based on median_length_ft
  const medianValues = neighborhoods.features
    .map((f) => f.properties.median_length_ft)
    .filter((v) => v != null);

  const neighborhoodColorScale = d3.scaleThreshold()
    .domain(thresholds)
    .range(groupColors);

  // 1. draw neighborhoods first (underlying polygon layer)
  const neighborhoodMap = createHandDrawnMap({
    container: "#map-a",
    geojson: neighborhoods,
    zoomScale: 3,
    zoomCenter: [0.3,1],
    title: "Greenwich Village and the West Village have among the shortest blocks in Manhattan",
    subtitle: "Average length of blocks in Manhattan, by neighborhood",
    valueByFeature: (d) => d.properties.mean_length_ft,
    colorScale: neighborhoodColorScale,
    strokeOnly: false,
  });

  // 2. draw street segments on top, same svg/g, same projection
  const streetColorScale = d3.scaleSequential()
    .domain([200, 600])
    .clamp(true)
    .interpolator((t) => d3.interpolateGreys(1 - t));

  neighborhoodMap.g
    .selectAll("path.hdc-street")
    .data(segments.features.filter((f) => f.geometry != null))
    .join("path")
    .attr("class", "hdc-street")
    .attr("d", neighborhoodMap.path)
    .attr("fill", "none")
    .attr("stroke", "#33302a")
    .attr("stroke-opacity", 0.35)
    .attr("stroke-width", 1.5)
    .attr("stroke-linecap", "round")
    .attr("vector-effect", "non-scaling-stroke");

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
    .attr("stroke-opacity", .5)
    .attr("stroke-linejoin", "round")
    .attr("vector-effect", "non-scaling-stroke")
    .style("pointer-events", "none");

  neighborhoodMap.g
    .selectAll("text.hdc-label")
    .data(labelFeatures)
    .join("text")
    .attr("class", "hdc-label")
    .attr("x", (d) => neighborhoodMap.path.centroid(d)[0])
    .attr("y", (d) => neighborhoodMap.path.centroid(d)[1])
    .attr("text-anchor", "middle")
    .attr("font-size", 5)
    .attr("font-family", "'Libre Franklin', sans-serif")
    .attr("font-weight", 600)
    .attr("fill", "#f3f3e7")
    .text((d) => d.properties.ntaname);

    createLegend({
    container: "#map-a",
    title: "Average block length",
    colors: groupColors,
    thresholds: thresholds,
  });
});

// CHART A NEEDS A LEGEND



  // END CHART A

//END CHARTS
