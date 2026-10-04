/**
 * chart-line.js — hand-inked, multi-series, brushable line chart.
 * Depends on: ink.js (load it first).
 *
 * Data shape: [{ key, values: [{x, y}, ...] }, ...]
 * Each chart call builds its own x/y domain from its OWN data — nothing
 * here assumes a shared year range, shared x type, or shared anything
 * with other charts on the page.
 */

// first deal with splits caused by nulls

function splitDefinedSegments(values) {
  const segments = [];
  let current = [];
  values.forEach((v) => {
    const missing = v.y === null || v.y === undefined || Number.isNaN(v.y);
    if (missing) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(v);
    }
  });
  if (current.length) segments.push(current);
  return segments;
}

//end deal with splits caused by nulls


function computeYearTicks(allXValues, domain, interval) {
  if (!interval) return null;
  const wholeYears = Array.from(new Set(allXValues.map((v) => Math.floor(v)))).sort((a, b) => a - b);
  if (!wholeYears.length) return null;
  const base = wholeYears[0];
  return wholeYears.filter((yr) => (yr - base) % interval === 0 && yr >= domain[0] && yr <= domain[1]);
}


function createHandDrawnLineChart(opts) {
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
    xAxisTickYears = null, // e.g. 2 -> label only every 2nd year on the x-axis
    brush = true, // set false for compact use inside small multiples
  } = opts;
 
  const instanceId = inkNextId("hdc-line");
  const root = d3.select(typeof container === "string" ? container : container);
  root.html("").classed("hand-drawn-chart", true).attr("data-instance", instanceId);
 
  if (title) root.append("h2").attr("class", "hdc-title").text(title);
  if (subtitle) root.append("p").attr("class", "hdc-subtitle").text(subtitle);
 
  const legend = root.append("div").attr("class", "hdc-legend");
  if (categories.length > 1) {
    root
      .append("p")
      .attr("class", "hdc-hint")
      .text(
        brush
          ? "click a legend dot to toggle a category · drag the timeline below to zoom"
          : "click a legend dot to toggle a category"
      );
  }
 
  const mainSvg = root.append("svg").attr("class", "hdc-main").attr("width", width).attr("height", mainHeight);
  const defs = mainSvg.append("defs");
  const { filterId, filterBoldId } = installInkFilters(defs, instanceId);
 
  let brushSvg = null;
  if (brush) {
    brushSvg = root.append("svg").attr("class", "hdc-brush").attr("width", width).attr("height", brushHeight);
  }
 
  let activeKeys = new Set(categories.map((c) => c.key));
  const allX = data[0].values.map((v) => v.x);
  let currentDomain = [allX[0], allX[allX.length - 1]];
  const catByKey = Object.fromEntries(categories.map((c) => [c.key, c]));
 
  legend
    .selectAll("button")
    .data(categories)
    .join("button")
    .attr("class", "hdc-legend-btn")
    .html((d) => `<span class="hdc-swatch" style="background:${d.color}"></span>${d.label}`)
    .on("click", function (event, d) {
      if (activeKeys.has(d.key) && activeKeys.size === 1) return;
      activeKeys.has(d.key) ? activeKeys.delete(d.key) : activeKeys.add(d.key);
      d3.select(this).classed("off", !activeKeys.has(d.key));
      draw(currentDomain);
    });
 
  const margin = { top: 20, right: 24, bottom: 30, left: 40 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = mainHeight - margin.top - margin.bottom;
 
  const g = mainSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const x = d3.scaleLinear().range([0, innerWidth]);
  const y = d3.scaleLinear().range([innerHeight, 0]);
  const gx = g.append("g").attr("class", "hdc-axis").attr("transform", `translate(0,${innerHeight})`);
  const gy = g.append("g").attr("class", "hdc-axis");
  const linesLayer = g.append("g");
 
  function draw(domain) {
    currentDomain = domain;
    const visible = data.filter((d) => activeKeys.has(d.key));
 
    x.domain(domain);
    const maxY =
      d3.max(visible, (d) => d3.max(d.values.filter((v) => v.x >= domain[0] && v.x <= domain[1]), (v) => v.y)) || 1;
    y.domain([0, maxY * 1.15]);
 
    const tickCount = Math.max(2, allX.filter((v) => v >= domain[0] && v <= domain[1]).length);
    const tickValues = computeYearTicks(allX, domain, xAxisTickYears);
    const xAxisGen = d3.axisBottom(x).tickFormat(xFormat);
    tickValues ? xAxisGen.tickValues(tickValues) : xAxisGen.ticks(tickCount);
    gx.transition().duration(300).call(xAxisGen);
    gy.transition().duration(300).call(d3.axisLeft(y).ticks(5));
 
    // Flatten each visible series into its defined-value segments, so
    // "na" gaps become real breaks rather than lines drawn straight
    // through missing data. Each segment gets a stable composite key
    // (seriesKey + segment index) for the data join below.
    const segmentRows = [];
    const dotRows = [];
    visible.forEach((d) => {
      const inRange = d.values.filter((v) => v.x >= domain[0] && v.x <= domain[1]);
      splitDefinedSegments(inRange).forEach((segment, segIndex) => {
        if (segment.length >= 2) {
          segmentRows.push({
            id: `${d.key}-${segIndex}`,
            key: d.key,
            points: segment.map((v) => [x(v.x), y(v.y)]),
          });
        } else if (segment.length === 1) {
          // an isolated single reading can't form a line — show it as a dot
          // rather than silently disappearing.
          dotRows.push({
            id: `${d.key}-${segIndex}-dot`,
            key: d.key,
            cx: x(segment[0].x),
            cy: y(segment[0].y),
          });
        }
      });
    });
 
    const paths = linesLayer.selectAll("path.hdc-series").data(segmentRows, (d) => d.id);
 
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
          .attr("d", (d) => inkLinePath(d.points, d.key.length))
          .style("opacity", 0)
          .transition()
          .duration(300)
          .style("opacity", 0.9),
      (update) =>
        update.transition().duration(300).attr("d", (d) => inkLinePath(d.points, d.key.length)),
      (exit) => exit.transition().duration(200).style("opacity", 0).remove()
    );
 
    const dots = linesLayer.selectAll("circle.hdc-series-dot").data(dotRows, (d) => d.id);
 
    dots.join(
      (enter) =>
        enter
          .append("circle")
          .attr("class", "hdc-series-dot")
          .attr("r", 4)
          .attr("fill", (d) => catByKey[d.key].color)
          .attr("cx", (d) => d.cx)
          .attr("cy", (d) => d.cy)
          .style("opacity", 0)
          .transition()
          .duration(300)
          .style("opacity", 0.9),
      (update) => update.transition().duration(300).attr("cx", (d) => d.cx).attr("cy", (d) => d.cy),
      (exit) => exit.transition().duration(200).style("opacity", 0).remove()
    );
  }
 
  if (brush) {
    const bMargin = { top: 6, right: 24, bottom: 22, left: 40 };
    const bInnerWidth = width - bMargin.left - bMargin.right;
    const bInnerHeight = brushHeight - bMargin.top - bMargin.bottom;
 
    const bg = brushSvg.append("g").attr("transform", `translate(${bMargin.left},${bMargin.top})`);
    const bx = d3.scaleLinear().domain(currentDomain).range([0, bInnerWidth]);
    const by = d3.scaleLinear().range([bInnerHeight, 0]);
    by.domain([0, d3.max(data, (d) => d3.max(d.values, (v) => v.y)) * 1.1]);
 
    data.forEach((d) => {
      splitDefinedSegments(d.values).forEach((segment, segIndex) => {
        if (segment.length < 2) return; // skip isolated points in the compact overview
        bg.append("path")
          .attr("fill", "none")
          .attr("stroke", catByKey[d.key].color)
          .attr("stroke-width", 1.6)
          .attr("stroke-opacity", 0.65)
          .attr("filter", `url(#${filterBoldId})`)
          .attr("d", inkLinePath(segment.map((v) => [bx(v.x), by(v.y)]), d.key.length + 20 + segIndex));
      });
    });
 
    const bTickValues = computeYearTicks(allX, currentDomain, xAxisTickYears);
    const bAxisGen = d3.axisBottom(bx).tickFormat(xFormat);
    bTickValues ? bAxisGen.tickValues(bTickValues) : bAxisGen.ticks(8);

    bg.append("g")
      .attr("class", "hdc-axis")
      .attr("transform", `translate(0,${bInnerHeight})`)
      .call(bAxisGen);
 
    const step = allX.length > 1 ? Math.abs(allX[1] - allX[0]) : 1;
    const brushBehavior = d3
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
 
    bg.append("g").attr("class", "hdc-brush-g").call(brushBehavior).call(brushBehavior.move, [bx(currentDomain[0]), bx(currentDomain[1])]);
  }
 
  draw(currentDomain);
 
  return { id: instanceId, redraw: () => draw(currentDomain), destroy: () => root.html("") };
}
 
if (typeof window !== "undefined") {
  window.createHandDrawnLineChart = createHandDrawnLineChart;
}
