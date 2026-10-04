/**
 * chart-treemap.js — hand-inked treemap.
 * Depends on: ink.js (load it first).
 *
 * Data shape: standard D3 hierarchy input, e.g.
 *   { name: "root", children: [ { name: "Retail", value: 40 }, ... ] }
 */

function createHandDrawnTreemap(opts) {
  const {
    container,
    data,
    title = "",
    subtitle = "",
    width = 860,
    height = 500,
    colorScale,
  } = opts;

  const instanceId = inkNextId("hdc-treemap");
  const root = d3.select(container);
  root.html("").classed("hand-drawn-chart", true).attr("data-instance", instanceId);

  if (title) root.append("h2").attr("class", "hdc-title").text(title);
  if (subtitle) root.append("p").attr("class", "hdc-subtitle").text(subtitle);

  const svg = root.append("svg").attr("class", "hdc-main").attr("width", width).attr("height", height);
  const defs = svg.append("defs");
  const { filterId } = installInkFilters(defs, instanceId);

  const hierarchyRoot = d3.hierarchy(data).sum((d) => d.value).sort((a, b) => b.value - a.value);
  d3.treemap().size([width, height]).paddingInner(3).paddingOuter(4)(hierarchyRoot);

  const color = colorScale || d3.scaleOrdinal(d3.schemeTableau10);

  const tiles = svg
    .selectAll("g.hdc-tile")
    .data(hierarchyRoot.leaves())
    .join("g")
    .attr("class", "hdc-tile");

  tiles
    .append("path")
    .attr("d", (d, i) => inkRectPath(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0, i + 1))
    .attr("fill", (d) => color(d.data.name))
    .attr("fill-opacity", 0.75)
    .attr("stroke", "#33302a")
    .attr("stroke-width", 1.5)
    .attr("filter", `url(#${filterId})`);

  tiles
    .filter((d) => d.x1 - d.x0 > 55 && d.y1 - d.y0 > 24)
    .append("text")
    .attr("class", "hdc-tile-label")
    .attr("x", (d) => d.x0 + 8)
    .attr("y", (d) => d.y0 + 18)
    .text((d) => d.data.name);

  return { id: instanceId };
}

if (typeof window !== "undefined") {
  window.createHandDrawnTreemap = createHandDrawnTreemap;
}
