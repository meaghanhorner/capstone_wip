/**
 * chart-bar.js — hand-inked, multi-series bar chart (grouped or stacked).
 * Depends on: ink.js (load it first) for inkNextId() and installInkFilters().
 *
 * Data shape (same as chart-line.js): [{ key, values: [{x, y}, ...] }, ...]
 * Here x is a category (string or number) and every series should share the
 * same x values, taken from the first series. Missing y values are skipped.
 *
 * Options beyond chart-line.js:
 *   stacked      false -> bars side by side (default), true -> stacked
 *   horizontal   false -> vertical bars (default), true -> horizontal bars
 *   yFormat      tick/tooltip number format
 *   xLabelAngle  rotate x labels (degrees) when categories are long
 *   showLegend   false hides the legend + hint (e.g. when colour is just a highlight)
 *   valueLabels  true, or a function(v) -> string, prints the value at the end of each bar
 *   valueAxisLabel  text label under (horizontal) / beside (vertical) the value axis
 *   gridlines    light gridlines running from the value axis
 *   boldKeys     array of series keys whose bars get bold category + value labels
 *   barPadding   gap between bars as a fraction of each row (default 0.2; bigger = further apart)
 *   strokeDarken how much darker each bar's outline is than its fill (default 0.4, 0 = same colour)
 *   categoryAxisLine  false removes the axis line and tick marks beside the category labels
 *   responsive   scale the svg to its container width (keeps the viewBox)
 */

// seeded random so the wobble is stable between redraws
function barRng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a slightly wobbly, slightly overshooting rectangle outline
function inkBarPath(x, y, w, h, seed, wobble = 1.6) {
  const r = barRng(seed);
  const j = () => (r() - 0.5) * 2 * wobble;
  const pts = [
    [x + j(), y + j()],
    [x + w + j(), y + j()],
    [x + w + j(), y + h + j()],
    [x + j(), y + h + j()],
  ];
  const mid = (a, b) => [(a[0] + b[0]) / 2 + j(), (a[1] + b[1]) / 2 + j()];
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const m = mid(a, b);
    d += ` Q${m[0]},${m[1]} ${b[0]},${b[1]}`;
  }
  return d + "Z";
}

function isMissingBar(v) {
  return v.y === null || v.y === undefined || Number.isNaN(v.y);
}

function createHandDrawnBarChart(opts) {
  const {
    container,
    categories,
    data,
    title = "",
    subtitle = "",
    width = 860,
    mainHeight = 380,
    xFormat = (d) => d,
    yFormat = d3.format(","),
    stacked = false,
    horizontal = false,
    xLabelAngle = 0,
    margin: marginOverride = {},
    showLegend = true,
    valueLabels = false,
    valueAxisLabel = "",
    gridlines = false,
    boldKeys: boldKeysOpt = [],
    responsive = false,
    barPadding = 0.2,
    strokeDarken = 0.4,
    categoryAxisLine = true,
  } = opts;
  const boldKeys = new Set(boldKeysOpt);

  const instanceId = inkNextId("hdc-bar");
  const root = d3.select(typeof container === "string" ? container : container);
  root.html("").classed("hand-drawn-chart", true).attr("data-instance", instanceId);

  if (title) root.append("h3").attr("class", "hdc-title").text(title);
  if (subtitle) root.append("h5").attr("class", "hdc-subtitle").text(subtitle);

  const legend = root.append("div").attr("class", "hdc-legend").style("display", showLegend ? null : "none");
  if (showLegend && categories.length > 1) {
    root.append("p").attr("class", "hdc-hint").text("click a legend dot to toggle a category");
  }

  const mainSvg = root.append("svg").attr("class", "hdc-main").attr("viewBox", `0 0 ${width} ${mainHeight}`);
  if (responsive) mainSvg.attr("width", "100%").style("height", "auto");
  else mainSvg.attr("width", width).attr("height", mainHeight);
  const defs = mainSvg.append("defs");
  const { filterId } = installInkFilters(defs, instanceId);

  const activeKeys = new Set(categories.map((c) => c.key));
  const catByKey = Object.fromEntries(categories.map((c) => [c.key, c]));
  const xValues = data[0].values.map((v) => v.x);

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
      draw();
    });

  const margin = Object.assign(
    { top: 20, right: 24, bottom: xLabelAngle ? 70 : 30, left: horizontal ? 110 : 40 },
    marginOverride
  );
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = mainHeight - margin.top - margin.bottom;

  const g = mainSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // category axis (band) and value axis (linear); swap orientation if horizontal
  const band = d3
    .scaleBand()
    .domain(xValues)
    .range(horizontal ? [0, innerHeight] : [0, innerWidth])
    .paddingInner(barPadding)
    .paddingOuter(0.1);
  const val = d3.scaleLinear().range(horizontal ? [0, innerWidth] : [innerHeight, 0]);

  const gCat = g.append("g").attr("class", "hdc-axis");
  const gVal = g.append("g").attr("class", "hdc-axis");
  if (horizontal) {
    // category axis on the left, value axis on the bottom
    gVal.attr("transform", `translate(0,${innerHeight})`);
  } else {
    gCat.attr("transform", `translate(0,${innerHeight})`);
  }
  const barsLayer = g.append("g");
  const labelsLayer = g.append("g");

  if (valueAxisLabel) {
    const lbl = mainSvg.append("text").attr("class", "hdc-axis-title").attr("font-size", 10).attr("fill", "#33302a");
    if (horizontal) {
      lbl.attr("x", margin.left + innerWidth / 2).attr("y", mainHeight - 6).attr("text-anchor", "middle");
    } else {
      lbl
        .attr("transform", `translate(12,${margin.top + innerHeight / 2}) rotate(-90)`)
        .attr("text-anchor", "middle");
    }
    lbl.text(valueAxisLabel);
  }

  // tooltip, reusing the .hdc-tooltip class from the map code
  const tooltip = d3.select("body").append("div").attr("class", "hdc-tooltip").style("opacity", 0);
  function moveTooltip(event) {
    const pad = 14;
    const node = tooltip.node();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    let left = event.clientX + pad;
    let top = event.clientY + pad;
    if (left + w > window.innerWidth - 8) left = event.clientX - w - pad;
    if (top + h > window.innerHeight - 8) top = event.clientY - h - pad;
    tooltip.style("left", `${left}px`).style("top", `${top}px`);
  }

  function draw() {
    const visible = data.filter((d) => activeKeys.has(d.key));

    // ---- build one row per bar with its value-axis start/end
    const rows = [];
    if (stacked) {
      xValues.forEach((xv) => {
        let running = 0;
        visible.forEach((s) => {
          const pt = s.values.find((v) => v.x === xv);
          if (!pt || isMissingBar(pt)) return;
          rows.push({ id: `${s.key}-${xv}`, key: s.key, x: xv, y: pt.y, v0: running, v1: running + pt.y });
          running += pt.y;
        });
      });
    } else {
      visible.forEach((s) => {
        s.values.forEach((pt) => {
          if (isMissingBar(pt)) return;
          rows.push({ id: `${s.key}-${pt.x}`, key: s.key, x: pt.x, y: pt.y, v0: 0, v1: pt.y });
        });
      });
    }

    const maxV = d3.max(rows, (r) => r.v1) || 1;
    val.domain([0, maxV * 1.1]);

    // ---- axes
    const catAxis = horizontal ? d3.axisLeft(band) : d3.axisBottom(band);
    catAxis.tickFormat(xFormat).tickSizeOuter(0);
    const valAxis = (horizontal ? d3.axisBottom(val) : d3.axisLeft(val)).ticks(5).tickFormat(yFormat);
    if (gridlines) valAxis.tickSize(-(horizontal ? innerHeight : innerWidth));

    gCat.transition().duration(300).call(catAxis);
    gVal.transition().duration(300).call(valAxis);

    if (!categoryAxisLine) {
      gCat.select(".domain").remove();
      gCat.selectAll(".tick line").remove();
    }
    if (gridlines) {
      gVal.select(".domain").remove();
      gVal.selectAll(".tick line").attr("stroke", "#33302a").attr("stroke-opacity", 0.1);
      // no gridline at zero, so nothing looks like a "start line" behind the bars
      gVal.selectAll(".tick").filter((t) => t === 0).select("line").attr("stroke-opacity", 0);
    }
    if (boldKeys.size) {
      const boldX = new Set(rows.filter((r) => boldKeys.has(r.key)).map((r) => r.x));
      gCat.selectAll("text").attr("font-weight", (t) => (boldX.has(t) ? 700 : 400));
    }

    if (xLabelAngle && !horizontal) {
      gCat
        .selectAll("text")
        .attr("transform", `rotate(${-xLabelAngle})`)
        .style("text-anchor", "end")
        .attr("dx", "-0.6em")
        .attr("dy", "0.2em");
    }

    // ---- bar geometry
    const sub = d3
      .scaleBand()
      .domain(visible.map((s) => s.key))
      .range([0, band.bandwidth()])
      .padding(stacked ? 0 : 0.08);

    function geom(r) {
      const bandStart = band(r.x);
      const thick = stacked ? band.bandwidth() : sub.bandwidth();
      const offset = stacked ? 0 : sub(r.key);
      if (horizontal) {
        const x0 = val(r.v0);
        return { x: x0, y: bandStart + offset, w: Math.max(0, val(r.v1) - x0), h: thick };
      }
      const yTop = val(r.v1);
      return { x: bandStart + offset, y: yTop, w: thick, h: Math.max(0, val(r.v0) - yTop) };
    }

    const seedFor = (r) => r.key.length * 31 + String(r.x).length * 7 + (typeof r.x === "number" ? r.x : 0);
    const pathFor = (r) => {
      const b = geom(r);
      return inkBarPath(b.x, b.y, b.w, b.h, seedFor(r));
    };

    const bars = barsLayer.selectAll("path.hdc-bar").data(rows, (d) => d.id);

    bars.join(
      (enter) =>
        enter
          .append("path")
          .attr("class", "hdc-bar")
          .attr("fill", (d) => catByKey[d.key].color)
          .attr("fill-opacity", 0.85)
          .attr("stroke", (d) => d3.color(catByKey[d.key].color).darker(strokeDarken).formatHex())
          .attr("stroke-width", 2)
          .attr("stroke-linejoin", "round")
          .attr("filter", `url(#${filterId})`)
          .attr("d", pathFor)
          .style("opacity", 0)
          .call((s) => s.transition().duration(300).style("opacity", 1)),
      (update) => update.call((s) => s.transition().duration(300).attr("d", pathFor)),
      (exit) => exit.transition().duration(200).style("opacity", 0).remove()
    );

    if (valueLabels) {
      const fmt = typeof valueLabels === "function" ? valueLabels : yFormat;
      const lx = (d) => { const b = geom(d); return horizontal ? b.x + b.w + 5 : b.x + b.w / 2; };
      const ly = (d) => { const b = geom(d); return horizontal ? b.y + b.h / 2 : b.y - 5; };
      labelsLayer
        .selectAll("text.hdc-bar-label")
        .data(rows, (d) => d.id)
        .join(
          (enter) =>
            enter
              .append("text")
              .attr("class", "hdc-bar-label")
              .attr("font-size", 10)
              .attr("fill", "#33302a")
              .attr("text-anchor", horizontal ? "start" : "middle")
              .attr("dy", horizontal ? "0.35em" : null)
              .attr("x", lx)
              .attr("y", ly)
              .style("opacity", 0)
              .text((d) => fmt(d.y))
              .call((s) => s.transition().duration(300).style("opacity", 1)),
          (update) =>
            update
              .text((d) => fmt(d.y))
              .call((s) => s.transition().duration(300).attr("x", lx).attr("y", ly)),
          (exit) => exit.transition().duration(200).style("opacity", 0).remove()
        )
        .attr("font-weight", (d) => (boldKeys.has(d.key) ? 700 : 400));
    }

    barsLayer
      .selectAll("path.hdc-bar")
      .style("cursor", "pointer")
      .on("mouseenter", (event, d) => {
        tooltip
          .html(`<strong>${catByKey[d.key].label}</strong><br>${xFormat(d.x)}: ${yFormat(d.y)}`)
          .style("opacity", 1);
        moveTooltip(event);
      })
      .on("mousemove", moveTooltip)
      .on("mouseleave", () => tooltip.style("opacity", 0));
  }

  draw();

  return {
    id: instanceId,
    redraw: draw,
    destroy: () => {
      tooltip.remove();
      root.html("");
    },
  };
}

if (typeof window !== "undefined") {
  window.createHandDrawnBarChart = createHandDrawnBarChart;
}