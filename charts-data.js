/**
 * charts-data.js — every chart's data AND which factory draws it, in
 * one place. index.html just loops over CHART_CONFIGS and calls
 * config.factory(config) — it never needs to know how many chart
 * *types* exist or what their option shapes look like.
 *
 * Each chart owns its own x-range, its own data shape, its own
 * everything. Nothing here is shared between charts unless you
 * deliberately choose to share it (e.g. reusing `storefrontCategories`
 * for both the line chart and the treemap below).
 */

// ---------- Chart 1: rents over time, 2008-2026 from REBNY ----------
const storefrontCategories = [
  { key: "restaurants", label: "Restaurants & Bars", color: "#f27966" },
  { key: "retail", label: "Independent Retail", color: "#e0a638" },
  { key: "chains", label: "Chain Storefronts", color: "#33302a" },
  { key: "vacant", label: "Vacant", color: "#a8c169" },
];

const storefrontYears = d3.range(1950, 2021, 5);
const storefrontData = storefrontCategories.map((c, ci) => ({
  key: c.key,
  values: storefrontYears.map((yr, i) => {
    const base = { restaurants: 8, retail: 22, chains: 2, vacant: 3 }[c.key];
    const trend = { restaurants: 0.35, retail: -0.28, chains: 0.45, vacant: 0.12 }[c.key];
    return { x: yr, y: Math.max(0, base + trend * i + Math.sin(i * 0.7 + ci) * 2.2) };
  }),
}));

// ---------- Chart 2: treemap, a totally different data shape & no x-axis at all ----------
const businessMixTreemapData = {
  name: "root",
  children: [
    { name: "Independent Retail", value: 38 },
    { name: "Restaurants & Bars", value: 27 },
    { name: "Chain Storefronts", value: 14 },
    { name: "Services", value: 12 },
    { name: "Vacant", value: 9 },
  ],
};

// ---------- Chart 3: map — irregular years/points don't apply here at all ----------
// Placeholder polygons standing in for actual Village block geometry —
// swap `geojson` for your real block/lot shapefile→GeoJSON export.
const villageBlocksGeoJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Block A", turnoverRate: 0.8 },
      geometry: { type: "Polygon", coordinates: [[[-74.002, 40.732], [-74.0, 40.732], [-74.0, 40.734], [-74.002, 40.734], [-74.002, 40.732]]] },
    },
    {
      type: "Feature",
      properties: { name: "Block B", turnoverRate: 0.3 },
      geometry: { type: "Polygon", coordinates: [[[-74.0, 40.732], [-73.998, 40.732], [-73.998, 40.734], [-74.0, 40.734], [-74.0, 40.732]]] },
    },
    {
      type: "Feature",
      properties: { name: "Block C", turnoverRate: 0.55 },
      geometry: { type: "Polygon", coordinates: [[[-74.002, 40.734], [-74.0, 40.734], [-74.0, 40.736], [-74.002, 40.736], [-74.002, 40.734]]] },
    },
  ],
};
const turnoverColor = d3.scaleSequential(d3.interpolateOranges).domain([0, 1]);

// ---------- Chart 4: small multiples — one line-chart panel per category ----------
// Each panel reuses createHandDrawnLineChart, but gets ITS OWN category
// list, own data, own line count — the wrapper doesn't care that these
// happen to come from the same source dataset.
const smallMultiplesPanels = storefrontCategories.map((c) => ({
  factory: createHandDrawnLineChart,
  opts: {
    title: c.label,
    categories: [c],
    data: [storefrontData.find((d) => d.key === c.key)],
  },
}));

// Chart RENTS OVER TIME // 

const rentOverTimeCategories = [
  { key: "bleecker-average", label: "Bleecker Street Average Commercial Rent", color: "#f27966" },
  { key: "bleecker-median", label: "Bleecker Street Median Commercial Rent", color: "#e0a638" },
  { key: "bleecker-lowest", label: "Bleecker Street Lowest Commercial Rent", color: "#b25a3f" },
  { key: "bleecker-highest", label: "Bleecker Street Highest Commercial Rent", color: "#8a9a4f" },
];

d3.json("/data/rents_over_time.json").then((rentOverTimeData) => {

  const filteredRentData = rentOverTimeData.map((series) => ({
    ...series,
    values: series.values.filter((v) => v.x < 2025),
  }));
  
/**
 * The single list index.html loops over. Every entry says:
 *  - which div to render into (`container`)
 *  - which factory function draws it
 *  - everything that factory needs, inline
 */
const CHART_CONFIGS = [
  {
    container: "#chart-storefronts",
    factory: createHandDrawnLineChart,
    title: "Storefront Category Counts, 1950–2020",
    subtitle: "// line chart · 5-year steps · brushable",
    categories: storefrontCategories,
    data: storefrontData,
  },
  {
    container: "#chart-business-mix",
    factory: createHandDrawnTreemap,
    title: "Current Business Mix",
    subtitle: "// treemap · no time axis, no shared x-range with the chart above",
    data: businessMixTreemapData,
  },
  {
    container: "#chart-blocks-map",
    factory: createHandDrawnMap,
    title: "Storefront Turnover Rate by Block",
    subtitle: "// map · GeoJSON, not x/y at all — placeholder geometry shown here",
    geojson: villageBlocksGeoJSON,
    valueByFeature: (f) => f.properties.turnoverRate,
    colorScale: turnoverColor,
    height: 420,
  },
  {
    container: "#chart-small-multiples",
    factory: createSmallMultiples,
    cols: 2,
    panels: smallMultiplesPanels,
  },
   {
      container: "#chart-rents-over-time",
      factory: createHandDrawnLineChart,
      title: "Rents Over Time",
      categories: rentOverTimeCategories,
      data: rentOverTimeData,   
      xAxisTickYears: 2,
    },
  ];
 const root = d3.select("#charts-container");
  CHART_CONFIGS.forEach((config, i) => {
    const containerId = config.container.replace("#", "");
    root.append("div").attr("id", containerId).attr("class", "wrap");
    config.factory(config);
    if (i < CHART_CONFIGS.length - 1) root.append("hr");
  });

}).catch((err) => console.error("Couldn't load rents_over_time.json:", err));
