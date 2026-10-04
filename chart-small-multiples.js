/**
 * chart-small-multiples.js — grid layout wrapper around any other
 * chart factory. Not a chart type itself: it takes a factory function
 * (createHandDrawnLineChart, createHandDrawnTreemap, etc.) and repeats
 * it once per panel, each with its own data/options.
 * Depends on: ink.js (load it first, for the instance-id counter).
 *
 * opts.panels: [{ factory: createHandDrawnLineChart, opts: {...} }, ...]
 * Each panel's `opts` is exactly what that factory normally expects
 * (minus `container`, which this wrapper assigns automatically).
 */

function createSmallMultiples(opts) {
  const { container, panels, cols = 3, panelWidth = 260, panelHeight = 180 } = opts;

  const instanceId = inkNextId("hdc-grid");
  const root = d3.select(container);
  root.html("").classed("hdc-grid", true).attr("data-instance", instanceId);
  root
    .style("display", "grid")
    .style("grid-template-columns", `repeat(${cols}, minmax(0, 1fr))`)
    .style("gap", "24px");

  const handles = panels.map((panel, i) => {
    const panelId = `${instanceId}-panel-${i}`;
    root.append("div").attr("id", panelId).attr("class", "hdc-grid-panel");

    return panel.factory({
      // sane compact defaults for a grid cell — override per-panel via panel.opts
      width: panelWidth,
      mainHeight: panelHeight,
      height: panelHeight,
      brush: false,
      ...panel.opts,
      container: `#${panelId}`, // always wins — panels can't collide on ids
    });
  });

  return { id: instanceId, panels: handles };
}

if (typeof window !== "undefined") {
  window.createSmallMultiples = createSmallMultiples;
}
