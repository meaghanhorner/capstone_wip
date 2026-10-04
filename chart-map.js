/**
 * chart-map.js — hand-inked geographic map.
 * Depends on: ink.js (load it first).
 *
 * Data shape: a standard GeoJSON FeatureCollection. Geo paths are curved
 * arcs already, so instead of manually jittering points (which would
 * fight the projection math), the ink filter is applied directly to the
 * rendered path — same feTurbulence/feDisplacementMap approach, just
 * skipping the per-point jitter step that lines/rects use.
 */

function createHandDrawnMap(opts) {
  const {
    container,
    geojson,
    valueByFeature = () => null,
    colorScale,
    title = "",
    subtitle = "",
    width = 860,
    height = 1100,
    projection,
    strokeOnly = false,
    zoomScale = 1,
    zoomCenter = [0.5,0.5],
  } = opts;

  const instanceId = inkNextId("hdc-map");
  const root = d3.select(container);
  root.html("").classed("hand-drawn-chart", true).attr("data-instance", instanceId);

  if (title) root.append("h2").attr("class", "hdc-title").text(title);
  if (subtitle) root.append("p").attr("class", "hdc-subtitle").text(subtitle);

  const svg = root
  .append("svg")
  .attr("class", "hdc-main")
  .attr("viewBox", `0 0 ${width} ${height}`)
  .attr("preserveAspectRatio", "xMidYMid meet");
  const clipId = `${instanceId}-clip`;

  svg.append("clipPath").attr("id", clipId)
    .append("rect")
    .attr("width", width)
    .attr("height", height);

  const defs = svg.append("defs");
  const { filterId } = installInkFilters(defs, instanceId);

  const g = svg.append("g")
    .attr("class", "hdc-zoom-group")
    .attr("clip-path", `url(#${clipId})`);

  const cleanFeatures = geojson.features.filter((f) => f.geometry != null);

  if (cleanFeatures.length < geojson.features.length) {
    console.warn(
      `createHandDrawnMap: dropped ${geojson.features.length - cleanFeatures.length} feature(s) with null/missing geometry`,
      geojson.features.filter((f) => f.geometry == null).map((f) => f.properties)
    );
  }

  // build a cleaned FeatureCollection so fitSize sees the same set as the paths
  const cleanGeojson = { ...geojson, features: cleanFeatures };

  
  const proj = (projection || d3.geoMercator()).fitSize([width, height], geojson);
  const path = d3.geoPath(proj);

  const color = colorScale || (() => "#d4dfa8");

  const inner = g.append("g").attr("class", "hdc-inner");

  inner.selectAll("path.hdc-feature")
    .data(cleanFeatures)
    .join("path")
    .attr("class", "hdc-feature")
    .attr("d", path)
    .attr("fill", strokeOnly ? "none" : (d) => color(valueByFeature(d)))
    .attr("fill-opacity", strokeOnly ? null : 0.8)
    .attr("stroke", strokeOnly ? (d) => color(valueByFeature(d)) : "#33302a")
    .attr("stroke-width", strokeOnly ? 3 : 1.2)
    .attr("stroke-linecap", strokeOnly ? "round" : null)
    .attr("vector-effect", "non-scaling-stroke")
    .attr("filter", `url(#${filterId})`)
    .append("title")
    .text((d) => (d.properties && d.properties.name) || "");

  // --- NEW: apply a fixed (non-interactive) zoom transform, centered on zoomCenter ---
  if (zoomScale !== 1) {
    const cx = width * zoomCenter[0];
    const cy = height * zoomCenter[1];
    // scale around the chosen center point: translate to origin, scale, translate back
    const tx = cx - cx * zoomScale;
    const ty = cy - cy * zoomScale;
    inner.attr("transform", `translate(${tx}, ${ty}) scale(${zoomScale})`);
  }

  return { id: instanceId, projection: proj, path, svg, g: inner };
}

if (typeof window !== "undefined") {
  window.createHandDrawnMap = createHandDrawnMap;
}
