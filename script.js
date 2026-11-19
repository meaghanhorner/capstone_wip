gsap.registerPlugin(ScrollTrigger, Observer, ScrollToPlugin);


//conditions bar

const MARKS = {
  yes: { color: '#509464', width: 2.6, paths: [{ d: 'M9.5 9.5 L13 15 L22.5 3.5', len: 24, delay: 0 }] },
  no:      { color: '#c8372d', width: 2.6, paths: [{ d: 'M7.5 7.5 L16.5 16.5', len: 13, delay: 0 },
                                                   { d: 'M16.5 7.5 L7.5 16.5', len: 13, delay: 0.25 }] },
  partial: { color: '#d5861e', width: 2.6, paths: [{ d: 'M8.5 13.5 L22.5 8.5', len: 12, delay: 0 }] }
};

function buildMarks(box) {
  box.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"
      stroke-linecap="round" stroke-linejoin="round">` +
    Object.entries(MARKS).map(([k, m]) =>
      m.paths.map(p => `<path class="m-${k}" d="${p.d}" style="opacity:0"/>`).join('')
    ).join('') + `</svg>`;
}

function drawMark(box, v) {
  console.log('drawMark', v);   // proves this version of the script is the one running
  Object.entries(MARKS).forEach(([k, m]) => {
    box.querySelectorAll('.m-' + k).forEach((p, i) => {
      gsap.killTweensOf(p);
      if (k === v) {
        const len = m.paths[i].len;
        gsap.set(p, { stroke: m.color, strokeWidth: m.width, strokeDasharray: len, strokeDashoffset: len, opacity: 1 });
        gsap.to(p, { strokeDashoffset: 0, duration: 0.35, delay: m.paths[i].delay, ease: 'power2.out' });
      } else {
        gsap.to(p, { opacity: 0, duration: 0.15 });
      }
    });
  });
}

function initConditionsBar() {
  const bar = document.getElementById('conditions-bar');
  const labels = {
    yes: 'meets the condition',
    no: 'does not meet the condition',
    partial: 'partly meets the condition',
    pending: 'not yet assessed'
  };
  const toEnd = () => ScrollTrigger.maxScroll(window);
  

  // 1. build the SVG marks inside each box
  bar.querySelectorAll('.box').forEach(buildMarks);

  // 2. swap marker paragraphs for invisible anchors
  const anchors = [];
  const re = /^@(bar|condition|verdict)(?:\s+([\w-]+))?(?:\s+(yes|no|partial))?$/i;

  document.querySelectorAll('.step-line p').forEach(p => {
    const lines = p.innerHTML
      .split(/<br\s*\/?>|\n/i)
      .map(s => s.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);
    if (!lines.length || !lines.every(l => re.test(l))) return;

    const frag = document.createDocumentFragment();
    lines.forEach(l => {
      const m = l.match(re);
      const a = document.createElement('div');
      a.className = 'cond-anchor';
      a.dataset.type = m[1].toLowerCase();
      if (m[2]) a.dataset.condition = m[2].toLowerCase();
      if (m[3]) a.dataset.verdict = m[3].toLowerCase();
      frag.appendChild(a);
      anchors.push(a);
    });
    p.replaceWith(frag);
  });

  console.log('conditions-bar anchors found:', anchors.length);

  // 3. bar slides in at @bar
  gsap.set(bar, { yPercent: -100 });
  const barAnchor = anchors.find(a => a.dataset.type === 'bar');
  if (barAnchor) {
    ScrollTrigger.create({
      trigger: barAnchor,
      start: 'top 40%',
      end: toEnd,
      onToggle: self => gsap.to(bar, {
        yPercent: self.isActive ? 0 : -100,
        duration: 0.35, ease: 'power2.out', overwrite: true
      })
    });
  }

  // 4. one trigger per condition/verdict anchor
  const reached = new Set();
  anchors.filter(a => a.dataset.type !== 'bar').forEach(a => {
    ScrollTrigger.create({
      trigger: a,
      start: 'top 40%',
      end: toEnd,
      onToggle: self => {
        self.isActive ? reached.add(a) : reached.delete(a);
        update();
      }
    });
  });

  // 5. derive the bar's state from the reached anchors
  function update() {
    const state = {};
    let current = null;
    anchors.forEach(a => {
      if (!reached.has(a)) return;
      if (a.dataset.type === 'condition') current = a.dataset.condition;
      if (a.dataset.type === 'verdict') state[a.dataset.condition] = a.dataset.verdict;
    });

    bar.querySelectorAll('li').forEach(li => {
      const c = li.dataset.condition;
      const box = li.querySelector('.box');
      const v = state[c] || 'pending';

      if (box.dataset.state !== v) {
        box.dataset.state = v;
        box.setAttribute('role', 'img');
        box.setAttribute('aria-label', labels[v]);
        drawMark(box, v);
      }

      li.classList.toggle('is-active', c === current);
    });
  }

  // 6. recalc trigger positions after layout settles
  ScrollTrigger.refresh();
  window.addEventListener('load', () => ScrollTrigger.refresh());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
}



async function loadSections(mdPath) {
  const res = await fetch(mdPath);
  let raw = (await res.text()).replace(/\r\n/g, "\n");

  const chunks = raw.split(/\n(?=##### )/).filter(Boolean);
  const sections = {};

  chunks.forEach((chunk) => {
    const match = chunk.match(/^#####\s+(.*)\n/);
    if (!match) return;
    const key = match[1].trim();
    const body = chunk.slice(match[0].length).trim();

    const rawSteps = body.split(/\n(?=<!--\s*svg:)/).filter(Boolean);

    sections[key] = rawSteps.map((stepChunk) => {
      const svgMatch = stepChunk.match(/^<!--\s*svg:\s*(.*?)\s*-->(?:\n|$)/);
      const parts = svgMatch ? svgMatch[1].trim().split(/\s+/) : [];
      const svgName = parts[0] || null;
      const svgState = parts[1] || null;          // optional, e.g. "e2"
      const text = svgMatch ? stepChunk.slice(svgMatch[0].length) : stepChunk;
      return { svg: svgName, state: svgState, html: marked.parse(text.trim()) };
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
      line.dataset.state = step.state || "";
      line.dataset.index = i;
      line.innerHTML = step.html;
      el.appendChild(line);
    });
  });
  initConditionsBar();
}



//


/* =========================================================
   CONFIG
   ========================================================= */
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// text fades
const CURTAIN_FADE_ZONE = 0.25;

// graphic crossfades
const FADE_OUT  = 0.9;
const FADE_IN   = 1.4;
const FADE_EASE = "power1.inOut";

// photo fade (time-based)
const PHOTO_FADE_DURATION = 1.6;

// scroll stops
const DEBUG_STOPS   = false;  // true: logs + trigger markers
const CARD_HOLD_MS  = 1000;   // brief hold on each curtain / photo_fade card
const GATE_MOVE_S   = 0.9;    // image section: travel time between images (= min time each image shows)
const GATE_COOLDOWN = 150;    // ms of ignored input after each move, soaks up trackpad inertia

// register plugins (skips any whose script tag is missing, and says so)
const plugins = [window.ScrollTrigger, window.Observer, window.ScrollToPlugin];
if (plugins.some((p) => !p)) {
  console.warn("[gsap] a plugin script is missing (ScrollTrigger / Observer / ScrollToPlugin)");
}
gsap.registerPlugin(...plugins.filter(Boolean));

const log = (...a) => DEBUG_STOPS && console.log("[stops]", ...a);


/* =========================================================
   CURTAIN TEXT FADES
   ========================================================= */
function updateCurtainFades() {
  const vh = window.innerHeight;
  const zone = vh * CURTAIN_FADE_ZONE;

  document.querySelectorAll(".curtain .step-line").forEach((box) => {
    if (reduceMotion.matches) { box.style.opacity = 1; return; }
    const b = box.getBoundingClientRect();
    const fadeIn  = Math.max(0, Math.min(1, (vh - b.top) / zone));
    const fadeOut = Math.max(0, Math.min(1, b.bottom / zone));
    box.style.opacity = Math.min(fadeIn, fadeOut).toFixed(3);
  });
}

window.addEventListener("scroll", () => requestAnimationFrame(updateCurtainFades), { passive: true });
window.addEventListener("resize", updateCurtainFades);


/* =========================================================
   GRAPHICS (swap / crossfade)
   ========================================================= */
const zoomHandlers = {};

// children of a stage that are graphics (not the scroll cue)
const graphicKids = (stage) =>
  gsap.utils.toArray(stage.children).filter((c) => !c.classList.contains("scroll-cue"));

function updateGraphic(id) {
  let zoomIn = null;
  const m = id && id.match(/^(.*)-zoom-(in|out)$/);
  if (m) { zoomIn = m[2] === "in"; id = m[1]; }

  const target = id ? document.getElementById(id) : null;
  const stage = target?.closest(".graphic-stage");
  if (!stage) return;

  const panel = graphicKids(stage).find((c) => c === target || c.contains(target));
  if (!panel) return;

  if (zoomIn !== null && zoomHandlers[id]) zoomHandlers[id](zoomIn);

  if (stage.dataset.current === id) return;
  stage.dataset.current = id;

  graphicKids(stage).forEach((g) => {
    if (g === panel) {
      gsap.fromTo(g, { y: 20 }, { autoAlpha: 1, y: 0, duration: 1.2, ease: FADE_EASE, overwrite: true });
    } else {
      gsap.to(g, { autoAlpha: 0, y: -20, duration: 0.8, ease: FADE_EASE, overwrite: true });
    }
  });
}

function crossfadeOnly(stage, id) {
  if (!id || stage.dataset.current === id) return;
  const next = stage.querySelector("#" + CSS.escape(id));
  const prev = stage.querySelector("#" + CSS.escape(stage.dataset.current));
  if (!next) return;

  if (prev) {
    gsap.to(prev, { autoAlpha: 0, duration: FADE_OUT, ease: FADE_EASE, overwrite: true, y: 0 });
  }
  gsap.fromTo(
    next,
    { y: 0 },
    { autoAlpha: 1, y: 0, duration: FADE_IN, ease: FADE_EASE, delay: 0.15, overwrite: true }
  );

  stage.dataset.current = id;
}

// each step-line swaps its graphic as it crosses mid-screen (CSS sticky holds the stage; no pin)
function initGraphicTriggers() {
  gsap.utils.toArray(".step-line").forEach((line) => {
    const go = () => {
      const stage = line
        .closest(".centered-on-white, .narration-no-image")
        ?.querySelector(".graphic-stage");

      if (stage) return crossfadeOnly(stage, line.dataset.svg);
      updateGraphic(line.dataset.svg);
    };

    ScrollTrigger.create({
      trigger: line,
      start: "top 50%",
      end: "bottom 50%",
      onEnter: go,
      onEnterBack: go,
    });
  });
}


/* =========================================================
   PHOTO FADE
   ========================================================= */
function initPhotoFade() {
  const section = document.querySelector(".photo_fade");
  const bg = section?.querySelector(".photo_fade_bg");
  if (!bg) return;

  gsap.set(bg, { autoAlpha: 0 });

  gsap.to(bg, {
    autoAlpha: 1,
    duration: PHOTO_FADE_DURATION,
    ease: "power1.inOut",
    paused: true,
    scrollTrigger: {
      trigger: section,
      start: "top 60%",
      toggleActions: "play none none reverse",
    },
  });
}

// photo_fade intro steps: fade/slide in as they enter (scrubbed)
function initPhotoFadeSteps() {
  gsap.utils.toArray(".photo_fade_bg_steps .step-line").forEach((step) => {
    gsap.set(step, { autoAlpha: 0, y: 30 });
    gsap.to(step, {
      autoAlpha: 1,
      y: 0,
      ease: "power2.out",
      scrollTrigger: {
        trigger: step,
        start: "top 75%",
        end: "top 45%",
        scrub: true,
      },
    });
  });
}


/* =========================================================
   SCROLL STOPS
   1) initCardPauses: curtain / photo_fade cards hold scrolling briefly
   2) initImageGate:  image section moves exactly one image per gesture
   Neither one moves the page except the gate's own scrollTo.
   ========================================================= */

// y that puts an element's center at the viewport center
const centerY = (el) => {
  const r = el.getBoundingClientRect();
  return window.scrollY + r.top + r.height / 2 - window.innerHeight / 2;
};

/* ---- 1) brief hold on each card ---- */
function initCardPauses() {
  if (reduceMotion.matches) return;

  // skip the sticky ones: the last photo_fade card and the alt curtain pin themselves
  const cards = gsap.utils.toArray(
    ".photo_fade_bg_steps .step-line:not(:last-of-type), .curtain:not(.curtain--alt) .step-line"
  );
  log("card pauses:", cards.length, "cards");
  if (!cards.length) return;

  let holding = null;

  function hold() {
    if (holding) return;
    log("hold");
    // swallows wheel/touch input without moving the page
    holding = Observer.create({
      target: window,
      type: "wheel,touch",
      preventDefault: true,
      allowClicks: true,
      onChange: () => {},          // a handler must exist for preventDefault to apply
    });
    gsap.delayedCall(CARD_HOLD_MS / 1000, () => {
      holding.kill();
      holding = null;
    });
  }

  cards.forEach((el) =>
    ScrollTrigger.create({
      trigger: el,
      start: "center center",
      end: "center center",
      markers: DEBUG_STOPS,
      onEnter: hold,
      onEnterBack: hold,
    })
  );
}

/* ---- 2) one image per gesture ---- */
function initGraphicGates() {
  if (reduceMotion.matches) return;
  if (!window.ScrollToPlugin) { console.warn("[stops] ScrollToPlugin missing; gates disabled"); return; }

  gsap.utils.toArray(".centered-on-white, .narration-no-image").forEach((section) => {
    const steps = gsap.utils.toArray(".step-line", section);   // this section only
    if (!steps.length || !section.querySelector(".graphic-stage")) return;
    buildGate(section, steps);
  });
}

function buildGate(section, steps) {
  const last = steps.length - 1;
  const holdEl = section.querySelector(".logo-hold");   // optional
  let idx = 0;
  let busy = false;
  let readyAt = 0;   // ignore input until this timestamp (soaks up trackpad inertia)

  const zoneStart = () => centerY(steps[0]) - window.innerHeight * 0.5;
  const zoneEnd   = () => centerY(steps[last]) + window.innerHeight * 0.5;

  log("gate built:", section.className, steps.length, "steps");

  function scrollToY(y) {
    busy = true;
    gsap.to(window, {
      scrollTo: { y, autoKill: false },
      duration: GATE_MOVE_S,
      ease: "power2.inOut",
      onComplete: () => { busy = false; readyAt = Date.now() + GATE_COOLDOWN; },
    });
  }

  function goTo(i) {
    idx = i;
    log("gate ->", section.className, i);
    scrollToY(centerY(steps[i]));
  }

  function step(dir) {            // +1 down the page, -1 up
    if (busy || Date.now() < readyAt) return;
    const next = idx + dir;
    if (next < 0)    return release("up");
    if (next > last) return release("down");
    goTo(next);
  }

  function release(dir) {
    log("gate release", section.className, dir);
    gate.disable();
    // land just outside the zone so scrolling back re-engages
    const y = dir === "down"
      ? Math.max(holdEl ? centerY(holdEl) : 0, zoneEnd() + 2)
      : Math.max(0, zoneStart() - 2);
    scrollToY(y);
  }

  // wheelSpeed -1: onUp = scrolling down the page (swap if yours feels reversed)
  const gate = Observer.create({
    target: window,
    type: "wheel,touch",
    wheelSpeed: -1,
    tolerance: 10,
    preventDefault: true,
    allowClicks: true,
    onUp:   () => step(+1),
    onDown: () => step(-1),
  });
  gate.disable();

  const engage = (i) => { if (!gate.isEnabled) { gate.enable(); goTo(i); } };

  ScrollTrigger.create({
    start: zoneStart,
    end: zoneEnd,
    markers: DEBUG_STOPS,
    onEnter:     () => engage(0),
    onEnterBack: () => engage(last),
    onLeave:     () => gate.disable(),
    onLeaveBack: () => gate.disable(),
  });

  window.addEventListener("keydown", (e) => {
    if (!gate.isEnabled) return;
    const down = [" ", "PageDown", "ArrowDown"].includes(e.key);
    const up   = ["PageUp", "ArrowUp"].includes(e.key);
    if (!down && !up) return;
    e.preventDefault();
    step(down ? +1 : -1);
  });
}


/* =========================================================
   CHART STATE SWITCHES
   ========================================================= */

// chart-e: each step that names a state switches the plot (e1 / e2 / e3)
function initChartE() {
  document.querySelectorAll('.step-line[data-svg="chart-e"]').forEach((el) => {
    if (!el.dataset.state) return;
    ScrollTrigger.create({
      trigger: el,
      start: "top 60%",
      onEnter:     () => window.chartE?.show(el.dataset.state),
      onEnterBack: () => window.chartE?.show(el.dataset.state),
    });
  });
}

// chart-h: steps switch the plot AND its title/subtitle/source (population / density / household)
function initChartH() {
  const hStates = ["population", "density", "household"]; // step 1, 2, 3

  const hText = {
    population: {
      title: "Greenwich Village's population shrank, while Manhattan's grew",
      subtitle: "Residents counted in decennial census, 1970-2020",
      source: "Source: U.S. Census Bureau via NHGIS",
    },
    density: {
      title: "Manhattan became more dense; Greenwich Village less",
      subtitle: "Residents per acre of land, 1970-2020",
      source: "Source: U.S. Census Bureau via NHGIS;",
    },
    household: {
      title: "Household size shrank in Greenwich Village and Manhattan",
      subtitle: "Average Household Size, 1970-2020",
      source: "Source: U.S. Census Bureau via NHGIS",
    },
  };

  const block = document.querySelector("#block-chart-h");
  if (!block) return;

  const els = {
    title:    block.querySelector(".hdc-title"),
    subtitle: block.querySelector(".hdc-subtitle"),
    source:   block.querySelector(".hdc-source"),
  };
  let current = "population";   // matches the text already in the HTML

  function showH(state) {
    window.chartH1?.show(state);
    if (state === current || !hText[state]) return;
    current = state;

    const all = Object.values(els);
    gsap.killTweensOf(all);
    gsap.timeline()
      .to(all, { opacity: 0, duration: 0.2, ease: "power1.out" })
      .add(() => {
        els.title.textContent    = hText[state].title;
        els.subtitle.textContent = hText[state].subtitle;
        els.source.textContent   = hText[state].source;
      })
      .to(all, { opacity: 1, duration: 0.3, ease: "power1.in" });
  }

  document.querySelectorAll('.step-line[data-svg="chart-h1"]').forEach((el, i) => {
    const state = el.dataset.state || hStates[i];
    if (!state) return;
    ScrollTrigger.create({
      trigger: el,
      start: "top 60%",
      onEnter:     () => showH(state),
      onEnterBack: () => showH(state),
    });
  });
}


/* =========================================================
   INIT
   ========================================================= */
renderSteps().then(() => {
  // each stage starts showing only its first graphic (cue stays visible)
  document.querySelectorAll(".graphic-stage").forEach((stage) => {
    const kids = graphicKids(stage);
    if (!kids.length) return;
    gsap.set(kids, { autoAlpha: 0 });
    gsap.set(kids[0], { autoAlpha: 1 });

    const cue = stage.querySelector(".scroll-cue");
    if (cue) gsap.set(cue, { autoAlpha: 1 });

    stage.dataset.current = kids[0].querySelector("[id]:not([id^='block-'])")?.id ?? kids[0].id;
  });

  initGraphicTriggers();
  initPhotoFade();
  initPhotoFadeSteps();
  initChartE();
  initChartH();

  initCardPauses();
  initGraphicGates();

  updateCurtainFades();
  ScrollTrigger.refresh();
});

window.addEventListener("load", () => ScrollTrigger.refresh());
document.fonts?.ready.then(() => ScrollTrigger.refresh());

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

//HELPER FOR CHART TITLES

function addChartHeader(selector, title, subtitle) {
  const root = d3.select(selector);
  root.selectAll(".hdc-head-auto").remove();
  const head = root.insert("div", ":first-child")
    .attr("class", "hdc-head hdc-head-auto");
  head.append("h2").attr("class", "hdc-title").text(title);
  if (subtitle) head.append("p").attr("class", "hdc-subtitle").text(subtitle);
  return head;
}

function addChartSource(selector, text) {
  return d3.select(selector).append("p").attr("class", "hdc-source").text(text);
}

//END HELPER FOR CHART TITLES



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

  const colorDark  = "#6a2238";
  const colorMid   = "#e08558";
  const colorLight = "#f9eac0";

  const ramp = d3.scaleLinear()
    .domain([0, 0.5, 1])
    .range([colorDark, colorMid, colorLight])
    .interpolate(d3.interpolateLab);

  const groupColors = d3.range(nGroups).map((i) =>
    ramp(nGroups === 1 ? 0 : i / (nGroups - 1))
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

  const inkFilter = `url(#${neighborhoodMap.filterId})`;

   // 2. street segments
  neighborhoodMap.g
    .append("g")
    .attr("class", "hdc-streets")
    .attr("filter", inkFilter)
    .style("pointer-events", "none")
    .selectAll("path.hdc-street")
    .data(segments.features.filter((f) => f.geometry != null))
    .join("path")
    .attr("class", "hdc-street")
    .attr("d", neighborhoodMap.path)
    .attr("fill", "none")
    .attr("stroke", "#33302a")
    .attr("stroke-opacity", 0.1)
    .attr("stroke-width", 1.5)
    .attr("stroke-linecap", "round")
    .attr("vector-effect", "non-scaling-stroke");

  // 3. GV border + labels
  const labelFeatures = neighborhoods.features.filter((f) => f.properties.is_gv);

  neighborhoodMap.g
    .append("g")
    .attr("class", "hdc-gv-borders")
    .attr("filter", inkFilter)
    .style("pointer-events", "none")
    .selectAll("path.hdc-gv-border")
    .data(labelFeatures)
    .join("path")
    .attr("class", "hdc-gv-border")
    .attr("d", neighborhoodMap.path)
    .attr("fill", "none")
    .attr("stroke", "#b25a3f")
    .attr("stroke-width", 6)
    .attr("stroke-opacity", 0.7)
    .attr("stroke-linejoin", "round")
    .attr("vector-effect", "non-scaling-stroke");

  neighborhoodMap.g
    .selectAll("text.hdc-label")
    .data(labelFeatures)
    .join("text")
    .attr("class", "hdc-label")
    .style("opacity", 0)
    .attr("x", (d) => neighborhoodMap.path.centroid(d)[0] + 3)
    .attr("y", (d) => neighborhoodMap.path.centroid(d)[1] + 0)
    .attr("text-anchor", "middle")
    .attr("font-size", 10)
    .attr("font-family", "'Jost', sans-serif")
    .attr("font-style", "italic")
    .attr("font-weight", 500)
    .attr("fill", "#ffffff")
    .style("pointer-events", "none")
    .text((d) => d.properties.ntaname);

    //tooltips

      const tooltip = d3.select("body")
    .append("div")
    .attr("class", "hdc-tooltip")
    .style("opacity", 0);

  function moveTooltip(event) {
    const pad = 14;
    const node = tooltip.node();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    let left = event.clientX + pad;
    let top = event.clientY + pad;
    // keep it on screen
    if (left + w > window.innerWidth - 8) left = event.clientX - w - pad;
    if (top + h > window.innerHeight - 8) top = event.clientY - h - pad;
    tooltip.style("left", `${left}px`).style("top", `${top}px`);
  }

  neighborhoodMap.g
    .selectAll("path.hdc-feature")
    .style("cursor", "pointer")
    .on("mouseenter", function (event, d) {
      const len = d.properties.mean_length_ft;
      tooltip
        .html(
          `<strong>${d.properties.ntaname}</strong><br>` +
          (len != null ? `Average block length: ${Math.round(len)} ft` : "No data")
        )
        .style("opacity", 1);
      moveTooltip(event);
      d3.select(this).attr("stroke-width", 2.4);   // thicker outline on hover
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", function () {
      tooltip.style("opacity", 0);
      d3.select(this).attr("stroke-width", 1.2);
    });



    // zoom (triggered by updateGraphic when a map-a-zoom-in / map-a-zoom-out step is reached)
  let zoomed = false;

  zoomHandlers["map-a"] = function (next) {
    if (next === zoomed) return;
    zoomed = next;

    neighborhoodMap.zoomTo(zoomed);

    neighborhoodMap.g.selectAll("text.hdc-label")
      .interrupt()
      .transition()
      .delay(zoomed ? 900 : 0)
      .duration(600)
      .style("opacity", zoomed ? 1 : 0);
  };

}).catch((err) => console.error("Chart A failed:", err));

//CHART B: BAR CHART OF AVERAGE BLOCK LENGTH

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

  const COLOR_GV    = "#b25a3f";
  const COLOR_OTHER = "#d89064";

  // the bar chart colours by series, so Greenwich Village and everything else
  // are two series; each neighborhood has a value in exactly one of them
  const seriesFor = (isGV) => ({
    key: isGV ? "gv" : "other",
    values: data.map((d) => ({ x: d.name, y: d.isGV === isGV ? d.value : null })),
  });

   const barH = 30;   // was 22; more room per row now that bars are spaced further apart
  const margin = { top: 15, right: 50, bottom: 60, left: 350 };

  createHandDrawnBarChart({
    container: "#chart-b",
    categories: [
      { key: "other", label: "Other neighborhoods", color: COLOR_OTHER },
      { key: "gv",    label: "Greenwich Village",   color: COLOR_GV },
    ],
    data: [seriesFor(false), seriesFor(true)],
    width: 1100,
    mainHeight: margin.top + margin.bottom + data.length * barH,
    margin,
    horizontal: true,
    stacked: true,
    responsive: true,
    showLegend: false,
    gridlines: false,
    categoryAxisLine: false,   
    barPadding: 0.4,          
    strokeDarken: 0.4,         
    valueAxisLabel: "Average block length (feet)",
    valueAxisLabelOffset:8,
    valueLabels: (v) => `${Math.round(v)} ft`,
    yFormat: d3.format(",.0f"),
    boldKeys: ["gv"],
  });

}).catch((err) => console.error("Chart B failed:", err));
//END CHART B

//CHART C: MAP OF BUILDING AGE IN GREENWICH VILLAGE

Promise.all([
  fetch("data/gv_buildingsage.geojson").then((r) => r.json()),
  fetch("data/gv_boundary.geojson").then((r) => r.json()),
]).then(([lots, boundary]) => {

  const isOdd14th = (f) => {
    const a = String(f.properties?.address ?? "").trim();
    const m = a.match(/^(\d+)/);
    return !!m && /\b14(th)?\s+(st|street)/i.test(a) && Number(m[1]) % 2 === 1;
  };

  const cut = (f) =>
  EXCLUDE.has(f.properties._idx) ||
  /pier[\s_-]*50/i.test(JSON.stringify(f.properties ?? {})) ||
  isOdd14th(f);

  // --- clip to boundary (winding-proof, planar) ---
  const polys = [];
  (boundary.type === "FeatureCollection" ? boundary.features : [boundary]).forEach((b) => {
    const g = b.geometry || b;
    if (g.type === "Polygon") polys.push(g.coordinates);
    if (g.type === "MultiPolygon") g.coordinates.forEach((p) => polys.push(p));
  });

lots.features.forEach((f, i) => {
  f.properties = f.properties || {};
  f.properties._idx = i;
});



const EXCLUDE = new Set([2954,861,884,883,859,878,879,2963,2962,887,2964,886,2961,2960,940,2957]);

  const inBoundary = (f) => {
    if (!f.geometry) return false;
    const pt = d3.geoCentroid(f);
    return polys.some(
      (rings) => rings.filter((r) => d3.polygonContains(r, pt)).length % 2 === 1
    );
  };

  console.log("lots before:", lots.features.length);
  lots.features = lots.features.filter((f) => inBoundary(f) && !cut(f));
  console.log("lots after:", lots.features.length);
  // --- end clip ---

  const thresholds = [1830, 1860, 1900, 1930, 1960, 2000];
  const eras = [
{ label: "Before 1830", color: "#6a2238" },
{ label: "1830–1859",   color: "#a03640" },
{ label: "1860–1899",   color: "#d05c4a" },
{ label: "1900–1929",   color: "#e08558" },
{ label: "1930–1959",   color: "#eba762" },
{ label: "1960–1999",   color: "#f6d995" },
{ label: "2000 +",      color: "#f9eac0" },
];
  const NO_DATA = "#666666";

  const colorFor = (y) =>
    (y == null || !isFinite(y) || y <= 0) ? NO_DATA : eras[d3.bisect(thresholds, y)].color;

  const width = 700, height = 820;

  const svg = d3.select("#map-c")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .style("height", "auto");

  const projection = d3.geoMercator()
    .fitExtent([[10, 10], [width - 10, height - 10]], boundary);
  const path = d3.geoPath(projection);
  const [[bx0, by0], [bx1, by1]] = path.bounds(boundary);
svg.attr("viewBox", `${bx0 - 10} ${by0 - 10} ${bx1 - bx0 + 20} ${by1 - by0 + 20}`);

   console.log("chart C v3 loaded");

  const tip = d3.select("body").append("div")
    .style("position", "fixed")
    .style("pointer-events", "none")
    .style("display", "none")
    .style("z-index", 9999)
    .style("background", "#fff")
    .style("border", "1px solid #333")
    .style("padding", "6px 8px")
    .style("font", "11px/1.35 'Jost', sans-serif")
    .style("max-width", "280px");

  const g = svg.append("g");


  g.selectAll("path.hdc-lot")
    .data(lots.features.filter((f) => f.geometry != null))
    .join("path")
    .attr("class", "hdc-lot")
    .attr("d", path)
    .attr("fill", (d) => colorFor(d.properties.yearbuilt))
    .attr("stroke", "#333333")
    .attr("stroke-width", 0.3)
    .style("pointer-events", "all")
    .on("mousemove", (event, d) => {
      tip.style("display", "block")
        .style("left", event.clientX + 12 + "px")
        .style("top", event.clientY + 12 + "px")
        .html(Object.entries(d.properties)
          .map(([k, v]) => `<b>${k}</b>: ${v}`)
          .join("<br>"));
    })
    .on("mouseleave", () => tip.style("display", "none"))
    
    .on("click", (event, d) => {
})

  // Greenwich Village boundary, same style as Chart A
  // g.selectAll("path.hdc-gv-border")
  //   .data(boundary.type === "FeatureCollection" ? boundary.features : [boundary])
  //   .join("path")
  //   .attr("class", "hdc-gv-border")
  //   .attr("d", path)
  //   .attr("fill", "none")
  //   .attr("stroke", "#4e976e")
  //   .attr("stroke-width", 4)
  //   .attr("stroke-opacity", 0.7)
  //   .attr("stroke-linejoin", "round")
  //   .style("pointer-events", "none");

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

//CHART D: BAR CHART OF BUILDING AGE IN GREENWICH VILLAGE

fetch("data/gv_buildingsage.geojson")
  .then((r) => r.json())
  .then((lots) => {

    // same eras and colors as Chart C
    const thresholds = [1830, 1860, 1900, 1930, 1960, 2000];
    const eras = [
      { key: "e0", label: "Before 1830", color: "#6a2238" },
      { key: "e1", label: "1830–1859",   color: "#a03640" },
      { key: "e2", label: "1860–1899",   color: "#d05c4a" },
      { key: "e3", label: "1900–1929",   color: "#e08558" },
      { key: "e4", label: "1930–1959",   color: "#eba762" },
      { key: "e5", label: "1960–1999",   color: "#f6d995" },
      { key: "e6", label: "2000 +",      color: "#f9eac0" },
    ];

    // count lots per era (lots with no year are left out)
    const counts = new Array(eras.length).fill(0);
    let known = 0;

    lots.features.forEach((f) => {
      const y = f.properties.yearbuilt;
      if (y == null || !isFinite(y) || y <= 0) return;
      counts[d3.bisect(thresholds, y)]++;
      known++;
    });

    // one series per era; each has a value only at its own label
    const series = eras.map((e, i) => ({
      key: e.key,
      values: eras.map((e2, j) => ({ x: e2.label, y: i === j ? counts[i] : null })),
    }));

    // label above each bar: "count (percent%)"
    // looked up by count, which is safe because equal counts have equal shares
    const labelByCount = new Map(
      counts.map((c) => [c, `${c.toLocaleString()} (${Math.round((known ? c / known : 0) * 100)}%)`])
    );

    const margin = { top: 80, right: 20, bottom: 70, left: 55 };

    createHandDrawnBarChart({
      container: "#chart-d",
      categories: eras.map((e) => ({ key: e.key, label: e.label, color: e.color })),
      data: series,
      width: 720,
      mainHeight: 460,
      margin,
      horizontal: false,
      stacked: true,
      responsive: true,
      showLegend: false,
      gridlines: false,
      barPadding: 0.2,
      strokeDarken: 0.4,
      handScale: .5,
      denseWobble: true,
      valueAxisLabel: "Number of buildings",
      valueLabels: (v) => labelByCount.get(v) ?? `${v.toLocaleString()}`,
      yFormat: d3.format(",.0f"),
    });

    ScrollTrigger.refresh();   // moved inside, so it runs after the chart exists

  }).catch((err) => console.error("Chart D failed:", err));


//CHART E
//CHART E (E1 -> E2 crossfade)

// public handle for the scroll code; calls made before the data loads are remembered
window.chartE = window.chartE || {
  requested: "e1",
  show(name) { this.requested = name; },
};

Promise.all([
  fetch("data/chart-e-1.json").then((r) => r.json()),
  fetch("data/chart-e-2.json").then((r) => r.json()),
]).then(([raw1, raw2]) => {

  const clean = (arr) => arr
    .map((d) => ({
      year: +(d.year ?? d.Year),
      series: d.series,
      value: +d.value,
      source: d.source,
    }))
    .filter((d) => isFinite(d.year) && isFinite(d.value) && d.series != null);

  const rows1 = clean(raw1);
  const rows2 = clean(raw2);
  const nytRows2 = rows2.filter((d) => d.source === "nyt");
  const rebnyRows2 = rows2.filter((d) => d.source === "rebny");

  // ---------- colors (edit keys to match your series names) ----------
    const colorByName = {
    "Manhattan (NYT)":          "#4f8363",
    "Manhattan":                "#4f8363",
    "Greenwich Village":        "#b25a3f",
    "Bleecker Street":          "#b8801a",
    "Bleecker":                 "#b8801a",
    "Manhattan (REBNY)":        "#4f8363",
    "Bleecker Street (REBNY)":  "#b8801a",
  };
  const fallback = d3.scaleOrdinal(d3.schemeTableau10);
  const colorOf = (name) => colorByName[name] || fallback(name);

  

  // rows -> [{key, color, values}] sorted by year
  const toSeries = (rows) =>
    Array.from(d3.group(rows, (d) => d.series), ([name, v]) => ({
      key: name,
      color: colorOf(name),
      values: v.slice().sort((a, b) => a.year - b.year),
    }));

  const s1 = toSeries(rows1);
  const sNyt = toSeries(nytRows2);
  const sRebny = toSeries(rebnyRows2);
  const sRebnyMan = sRebny.filter((s) => /manhattan/i.test(s.key));
  const sRebnyBlk = sRebny.filter((s) => !/manhattan/i.test(s.key));

  // ---------- fixed scales shared by both states ----------
  const allRows = [...rows1, ...rows2];
  const [minYear, maxYear] = d3.extent(allRows, (d) => d.year);
  const yMax = d3.max(allRows, (d) => d.value) || 1;

  const width = 860;
  const height = 760;
  const margin = { top: 34, right: 24, bottom: 30, left: 48 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const x = d3.scaleLinear().domain([d3.min(rows1, (d) => d.year), 2001]).range([0, innerWidth]);
  const y = d3.scaleLinear().domain([0, yMax * 1.15]).nice().range([innerHeight, 0]);
  const fullDomain = [minYear, maxYear];
  const e1Domain = [d3.min(rows1, (d) => d.year), 2001];
  const view = { d0: e1Domain[0], d1: e1Domain[1] };   // what's currently on screen

  
 
  

  // ---------- DOM ----------
  const instanceId = typeof inkNextId === "function" ? inkNextId("hdc-chart-e") : "hdc-chart-e";
  const root = d3.select("#chart-e");
  root.html("").classed("hand-drawn-chart", true).attr("data-instance", instanceId);


  // legend: union of series; entries not in the current state are dimmed
  const legendNames = Array.from(new Set([...s1, ...sNyt, ...sRebny].map((s) => s.key)));
  const legendSpans = root.append("div").attr("class", "hdc-legend")
    .selectAll("span")
    .data(legendNames)
    .join("span")
    .attr("class", "hdc-legend-btn")
    .style("cursor", "default")
    .style("pointer-events", "none")
    .html((n) => {
      const c = colorOf(n);
      const bg = /rebny/i.test(n)
        ? c
        : `repeating-linear-gradient(90deg, ${c} 0 7px, transparent 7px 11px)`;
      return `<span class="hdc-swatch" style="display:inline-block;width:34px;height:3px;margin-right:0.4rem;vertical-align:middle;background:${bg}"></span>${n}`;
    });

  const svg = root.append("svg")
    .attr("class", "hdc-main")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .style("height", "auto");

  const captionEl = root.append("p").attr("class", "hdc-caption")
    .style("white-space", "pre-line");

  const defs = svg.append("defs");
  const ink = typeof installInkFilters === "function" ? installInkFilters(defs, instanceId) : null;
  const inkFilter = ink ? `url(#${ink.filterId})` : null;
  const inkPath = (pts, seed) => (typeof inkLinePath === "function" ? inkLinePath(pts, seed) : d3.line()(pts));

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

     const clipId = instanceId + "-plotclip";
  defs.append("clipPath").attr("id", clipId)
    .append("rect")
    .attr("x", -6).attr("y", -6)
    .attr("width", innerWidth + 12).attr("height", innerHeight + 12);

  const xAxisG = g.append("g").attr("class", "hdc-axis")
    .attr("transform", `translate(0,${innerHeight})`);

  function drawAxis() {
    const start = Math.ceil(view.d0 / 5) * 5;
    xAxisG.call(d3.axisBottom(x)
      .tickValues(d3.range(start, view.d1 + 0.01, 5))
      .tickFormat(d3.format("d")));
  }

  g.append("g").attr("class", "hdc-axis")
    .call(d3.axisLeft(y).ticks(5).tickFormat((d) => "$" + d3.format(",.0f")(d)));

  g.append("text")
    .attr("x", 0).attr("y", -14)
    .attr("font-size", 11).attr("fill", "#33302a").attr("fill-opacity", 0.8)
    .text("Annual rent per sq ft");

  // ---------- layers: one lines group + one points group per dataset ----------
    function makeLayer(seriesList, cls, dashed = false) {
    const lines = g.append("g").attr("class", `${cls}-lines`)
      .attr("clip-path", `url(#${clipId})`).style("opacity", 0);
    const pts = g.append("g").attr("class", `${cls}-pts`)
      .attr("clip-path", `url(#${clipId})`).style("opacity", 0);

    const paths = lines.selectAll("path")
      .data(seriesList, (d) => d.key)
      .join("path")
      .attr("fill", "none")
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", 3)
      .attr("stroke-linecap", dashed ? "butt" : "round")
      .attr("stroke-dasharray", dashed ? "10 8" : null)
      .attr("filter", dashed ? null : inkFilter);

    const groups = pts.selectAll("g")
      .data(seriesList, (d) => d.key)
      .join("g")
      .style("fill", (d) => d.color);

    groups.each(function (s) {
      d3.select(this).selectAll("circle")
        .data(s.values)
        .join("circle")
        .attr("r", 4)
        .attr("filter", inkFilter);
    });

    function update() {
      paths.attr("d", (d) => inkPath(d.values.map((v) => [x(v.year), y(v.value)]), d.key.length));
      groups.each(function () {
        d3.select(this).selectAll("circle")
          .attr("cx", (v) => x(v.year))
          .attr("cy", (v) => y(v.value));
      });
    }

    return { lines: lines.node(), pts: pts.node(), update };
  }

 


  // draw order: faded NYT underneath, REBNY on top, e1 version separate
    const L = {
    nyt:      makeLayer(sNyt, "chart-e-nyt", true),
    rebnyMan: makeLayer(sRebnyMan, "chart-e-rebny-man"),
    rebnyBlk: makeLayer(sRebnyBlk, "chart-e-rebny-blk"),
    e1:       makeLayer(s1, "chart-e-e1", true),
  };

 // ---------- 2001 line + annotations (hidden until their state) ----------
  const refLine = g.append("line")
    .attr("x1", x(2001)).attr("x2", x(2001))
    .attr("y1", 0).attr("y2", innerHeight)
    .attr("stroke", "#000").attr("stroke-width", 1)
    .style("opacity", 0);

  function makeNote(lines, px, py, anchor) {
    const t = g.append("text")
      .attr("x", px).attr("y", py)
      .attr("text-anchor", anchor)
      .attr("font-family", "'Jost', sans-serif")
      .attr("font-size", 14).attr("fill", "#33302a")
      .style("opacity", 0);
    lines.forEach((ln, i) => {
      t.append("tspan").attr("x", px).attr("dy", i ? "1.25em" : 0).text(ln);
    });
    return t.node();
  }

  // left of the 2001 line, near the top where the chart is empty
  const note2001 = makeNote(
    ["Manhattan rents as a whole kept climbing",
     "after 2001 at about the same pace",
     "as in the decades before."],
    x(2001) - 10, 14, "end");

  // beside the end of the REBNY Bleecker line
  let noteBleecker = null;
  if (sRebnyBlk.length) {
    const last = sRebnyBlk[0].values[sRebnyBlk[0].values.length - 1];
    noteBleecker = makeNote(
      ["Meanwhile, rents on", "Bleecker Street surged."],
      x(last.year) - 12, y(last.value) - 8, "end");
  }


  // opacities taken from v01 / v02 (lines, points)
    const noteTargets = (a, b, c) => [
    [refLine, a], [note2001, a], ...(noteBleecker ? [[noteBleecker, c]] : []),
  ];

  const states = {
    e1: {
      targets: [
        [L.e1.lines, 0.5], [L.e1.pts, 0.8],
        [L.nyt.lines, 0], [L.nyt.pts, 0],
        [L.rebnyMan.lines, 0], [L.rebnyMan.pts, 0],
        [L.rebnyBlk.lines, 0], [L.rebnyBlk.pts, 0],
        ...noteTargets(0, 0, 0),
      ],
      legend: new Set(s1.map((s) => s.key)),
    },
    e1a: {
      targets: [
        [L.e1.lines, 0.15], [L.e1.pts, 0.25],
        [L.nyt.lines, 0], [L.nyt.pts, 0],
        [L.rebnyMan.lines, 0.5], [L.rebnyMan.pts, 0.8],
        [L.rebnyBlk.lines, 0], [L.rebnyBlk.pts, 0],
        ...noteTargets(1, 1, 0),
      ],
      legend: new Set(sRebnyMan.map((s) => s.key)),
    },
    e2: {
      targets: [
        [L.e1.lines, 0], [L.e1.pts, 0],
        [L.nyt.lines, 0.15], [L.nyt.pts, 0.25],
        [L.rebnyMan.lines, 0.5], [L.rebnyMan.pts, 0.8],
        [L.rebnyBlk.lines, 0.5], [L.rebnyBlk.pts, 0.8],
        ...noteTargets(1, 1, 1),
      ],
      legend: new Set([...sNyt, ...sRebny].map((s) => s.key)),
    },
  };

  // fade a text element out, swap its text, fade back in
  const subtitleEl = root.insert("p", "svg").attr("class", "hdc-subtitle");
  const texts = {
    e1:  { subtitle: "", caption: "" },
    e1a: { subtitle: "", caption: "" },
    e2:  { subtitle: "", caption: "" },
  };

  function swapText(el, text, dur, instant) {
    const node = el.node();
    gsap.killTweensOf(node);
    if (instant) { el.text(text); gsap.set(node, { opacity: 1 }); return; }
    gsap.timeline()
      .to(node, { opacity: 0, duration: dur * 0.3, ease: "power1.out" })
      .add(() => el.text(text))
      .to(node, { opacity: 1, duration: dur * 0.5, ease: "power1.in" });
  }

  let current = null;

  function show(name, instant) {
    const st = states[name];
    if (!st) { console.warn(`Chart E: unknown state "${name}"`); return; }
    if (name === current && !instant) return;
    current = name;

    const dur = instant ? 0 : 0.9;
    const target = name === "e1" ? e1Domain : fullDomain;
    if (instant) {
      view.d0 = target[0]; view.d1 = target[1];
      render();
    } else {
      gsap.to(view, {
        d0: target[0], d1: target[1],
        duration: dur, ease: "power1.inOut",
        overwrite: true, onUpdate: render,
      });
    }

    st.targets.forEach(([el, op]) => {
      gsap.to(el, { opacity: op, duration: dur, ease: "power1.inOut", overwrite: true });
    });

    legendSpans.each(function (n) {
      gsap.to(this, { opacity: st.legend.has(n) ? 1 : 0.3, duration: dur, overwrite: true });
    });

    swapText(subtitleEl, texts[name].subtitle, dur, instant);
    swapText(captionEl, texts[name].caption, dur, instant);
  }

  function moveNote(node, px, py) {
    const t = d3.select(node).attr("x", px);
    if (py != null) t.attr("y", py);
    t.selectAll("tspan").attr("x", px);
  }

  function render() {
    x.domain([view.d0, view.d1]);
    drawAxis();
    Object.values(L).forEach((l) => l.update());
    refLine.attr("x1", x(2001)).attr("x2", x(2001));
    moveNote(note2001, x(2001) - 10);
    if (noteBleecker) {
      const last = sRebnyBlk[0].values[sRebnyBlk[0].values.length - 1];
      moveNote(noteBleecker, x(last.year) - 12, y(last.value) - 8);
    }
  }
  render();   // draws the initial e1 view


  // hand the real function to the public handle and draw whatever was requested
  window.chartE.show = show;
  show("e1", true);

}).catch((err) => console.error("Chart E failed:", err));

//END CHART E


//START CHART G VACANCIES 2026

Promise.all([
  fetch("data/vacancy_lots_2026.geojson").then((r) => r.json()),
  fetch("data/vacancy_outlines_2026.geojson").then((r) => r.json()),
  fetch("data/street_labels.geojson").then((r) => r.json()),
]).then(([lots, outlines, labels]) => {

  const TAN   = "#dbc398";
  const OTHER = "residential, open space, or other";

  const statuses = [
    { key: "vacant",     label: "Has a vacant storefront",           color: "#8e361b" },
    { key: "occupied",   label: "Occupied",                          color: "#4e9a82" },
    { key: "demolished", label: "Demolished",                        color: "#636363" },
    { key: OTHER,        label: "Residential, open space, or other", color: TAN },
  ];

  const colorScale = d3.scaleOrdinal()
    .domain(statuses.map((s) => s.key))
    .range(statuses.map((s) => s.color))
    .unknown(TAN);

  // one layer: every lot in the area, so the map draws and fits them together.
  // surveyed lots go last so they sit on top
  const surveyed = new Set(lots.features.map((f) => f.properties.bbl));
  const rest = outlines.features
    .filter((f) => !surveyed.has(f.properties.bbl))
    .map((f) => ({ ...f, properties: { ...f.properties, category: OTHER } }));
  const allLots = { type: "FeatureCollection", features: [...rest, ...lots.features] };

  d3.select("#map-g").style("background", TAN);

  const vacancyMap = createHandDrawnMap({
    container: "#map-g",
    geojson: allLots,
    valueByFeature: (d) => d.properties.category,
    colorScale: colorScale,
    strokeOnly: false,
  });

// zoom in: crop the viewBox to the surveyed lots
const [[x0, y0], [x1, y1]] = vacancyMap.path.bounds(lots);   // bounds in the svg's own coordinates
const pad = 12;                                              // smaller = tighter
d3.select("#map-g svg").attr(
  "viewBox",
  `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`
);


  // thinner lot outlines than the neighborhood map
  vacancyMap.g.selectAll("path.hdc-feature").attr("stroke-width", 0.5);

  // street names: same italic serif as the Chart A labels
   const LABEL_DROP = 0.01;                        // fraction of the map's height; raise for more
  const [[bx0, by0], [bx1, by1]] = vacancyMap.path.bounds(lots);
  const dy = (by1 - by0) * LABEL_DROP;

 const BASE_SIZE = 13;

  // hand overrides by label text; check real names with
  // console.log(labels.features.map((d) => d.properties.label))
  const nudge = {
    "7th Ave South": [-20,60],
    "Ave of the Americas":[60,-125],
    "Christopher St":[20,-8],
    "Grove St":[120,-55],
    "Barrow St": [0,-4],
    "Commerce St": [0,-4],
    "Morton St": [0,-4],
    "Leroy St": [0,-4],
    "Carmine St": [0,-4],
    "Downing St": [0, -4],
    "Bedford St": [-83, -180],
    "Jones St": [0,-4],
    "Cornelia St": [0,-2],
    "Minetta Lane": [20,10],
    "Bleecker St": [40,23],
    "Mac Dougal St": [103,-160],
    "Bleecker St 2": [-115,-200]
  };

  const tilt = {
    "Ave of the Americas":4,
    "Bleecker St 2": 33.5,
  };

  const nudgeFor = (d) => nudge[d.properties.key] ?? [0, 0];




  const sizeOverride = {
    "Ave of the Americas": 24,
    "7th Ave South": 24,
  };
 const fontSize = (d) => sizeOverride[d.properties.label] ?? BASE_SIZE;




const displayName = {
  "Ave of the Americas" : "Avenue of the Americas",
  "7th Ave South" : "7th Avenue South",
  "Mac Dougal St" : "MacDougal St",
};

// give each label a key; Bleecker gets two copies
const labelData = labels.features.flatMap((f) => {
  const label = f.properties.label;
  const make = (key) => ({ ...f, properties: { ...f.properties, key } });
  return label === "Bleecker St"
    ? [make("Bleecker St"), make("Bleecker St 2")]
    : [make(label)];
});

  vacancyMap.g
    .append("g")
    .attr("class", "hdc-street-labels")
    .style("pointer-events", "none")
    .selectAll("text")
    .data(labelData)
    .join("text")
    .attr("transform", (d) => {
    const [x, y] = vacancyMap.path.centroid(d);
    const [nx, ny] = nudgeFor(d);
    return `translate(${x + nx},${y + dy + ny}) rotate(${-d.properties.angle + (tilt[d.properties.key] ?? 0)})`;
  })
    .attr("text-anchor", "middle")
    .attr("font-size", fontSize)
    .attr("font-family", "'Jost', sans-serif")
    .attr("font-weight", 500)
    .attr("fill", "#000000")
    .attr("fill-opacity", 1)
    .attr("stroke", TAN)
    .attr("stroke-width", 4)
    .style("paint-order", "stroke")
    .text((d) => displayName[d.properties.label] ?? d.properties.label);

  const tooltip = d3.select("body")
    .append("div")
    .attr("class", "hdc-tooltip")
    .style("opacity", 0);

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

  const isSurveyed = (d) => d.properties.category !== OTHER;

  vacancyMap.g
    .selectAll("path.hdc-feature")
    .filter(isSurveyed)
    .style("cursor", "pointer")
    .on("mouseenter", function (event, d) {
      const p = d.properties;
      const counts = [];
      if (p.n_vacant)   counts.push(`${p.n_vacant} vacant`);
      if (p.n_occupied) counts.push(`${p.n_occupied} occupied`);
      const biz = p.businesses ? `<br>${String(p.businesses).slice(0, 140)}` : "";
      tooltip
        .html(`<strong>${p.address ?? "Lot"}</strong><br>${counts.join(", ") || "Demolished"}${biz}`)
        .style("opacity", 1);
      moveTooltip(event);
      d3.select(this).attr("stroke-width", 1.6);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", function () {
      tooltip.style("opacity", 0);
      d3.select(this).attr("stroke-width", 0.4);
    });

  const legend = d3.select("#map-g").append("div").attr("class", "hdc-legend");
  legend.append("div").attr("class", "hdc-legend-title").text("Storefront status");

  const row = legend.selectAll(".hdc-legend-row")
    .data(statuses)
    .join("div")
    .attr("class", "hdc-legend-row");
  row.append("span")
    .attr("class", "hdc-legend-swatch")
    .style("background", (d) => d.color)
    .style("border", (d) => (d.key === OTHER ? "1px solid rgba(51,48,42,0.4)" : null));
  row.append("span").text((d) => d.label);

  if (window.ScrollTrigger) ScrollTrigger.refresh();    
}).catch((err) => console.error("Chart G failed:", err));
//END CHART G


//END CHART G

//START CHART H1: SLOPE CHARTS (population / density / household size)

window.chartH1 = window.chartH1 || {
  requested: "population",
  show(name) { this.requested = name; },
};

fetch("data/metrics_comparison.json")
  .then((r) => r.json())
  .then((allRows) => {

    const rows = allRows.filter((d) => d.year != null && isFinite(+d.year));
    const Y0 = 1970, Y1 = 2020;
    const ACRES_PER_KM2 = 247.105;

    // EDIT TEXT HERE
    const states = {
      population: {
        value: (d) => +d.population,
        yLabel: "Residents",
        fmt: d3.format(",.0f"),
        title: "Total Population, 1970 and 2020",
        subtitle: "Residents counted in the decennial census",
        source: "Source: U.S. Census Bureau via NHGIS. 1970 interpolated to 2010 tract boundaries."
      },
      density: {
        value: (d) => +d.density_km2 / ACRES_PER_KM2,
        yLabel: "People per acre",
        fmt: d3.format(",.0f"),
        title: "Population Density, 1970 and 2020",
        subtitle: "Residents per acre of land",
        source: "Source: U.S. Census Bureau via NHGIS; area from 2010 tract boundaries."
      },
      household: {
        value: (d) => +d.avg_household_size,
        yLabel: "Average people per household",
        fmt: d3.format(".2f"),
        yMax: (hi) => Math.max(2, Math.ceil(hi * 2) / 2),
        title: "Average Household Size, 1970 and 2020",
        subtitle: "People per household",
        source: "Source: U.S. Census Bureau via NHGIS. 1970 interpolated to 2010 tract boundaries."
      }
    };

    const areas = ["Manhattan", "Greenwich Village"];
    const colors = { "Manhattan": "#2c3e50", "Greenwich Village": "#c0392b" };
    const keys = { "Manhattan": "manhattan", "Greenwich Village": "gv" };
    const names = { manhattan: "Manhattan", gv: "Greenwich Village" };

    // two values per series per state: 1970 and 2020
    const seriesDefs = areas.map((areaName) => {
      const areaRows = rows.filter((d) => d.area === areaName);
      const at = (yr) => areaRows.find((d) => +d.year === yr);
      const vals = {};
      Object.entries(states).forEach(([k, st]) => {
        const a = at(Y0), b = at(Y1);
        vals[k] = [a ? st.value(a) : null, b ? st.value(b) : null];
      });
      return { key: keys[areaName], color: colors[areaName], vals };
    });

    const width = 860, height = 860;
    const margin = { top: 44, right: 190, bottom: 56, left: 120 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const instanceId = typeof inkNextId === "function" ? inkNextId("hdc-chart-h1") : "hdc-chart-h1";
    const root = d3.select("#chart-h1");
    root.html("").classed("hand-drawn-chart", true).attr("data-instance", instanceId);

    root.append("div").attr("class", "hdc-legend")
      .selectAll("span")
      .data(seriesDefs)
      .join("span")
      .attr("class", "hdc-legend-btn")
      .style("cursor", "default")
      .style("pointer-events", "none")
      .html((d) => `<span class="hdc-swatch" style="background:${d.color}"></span>${names[d.key]}`);

    const svg = root.append("svg")
      .attr("class", "hdc-main")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .style("height", "auto");

    const defs = svg.append("defs");
    const ink = typeof installInkFilters === "function" ? installInkFilters(defs, instanceId) : null;
    const inkFilter = ink ? `url(#${ink.filterId})` : null;
    const inkPath = (pts, seed) => (typeof inkLinePath === "function" ? inkLinePath(pts, seed) : d3.line()(pts));

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const xL = 0;              // x of the 1970 side, inside g
    const xR = innerWidth;     // x of the 2020 side
    const GAP = 16;            // minimum vertical gap between direct labels

    // keep labels from overlapping
    const spread = (items) => {
      const s = items.slice().sort((a, b) => a.y - b.y);
      for (let i = 1; i < s.length; i++) if (s[i].y - s[i - 1].y < GAP) s[i].y = s[i - 1].y + GAP;
      return s;
    };

    const OFFSET = 14;
    const layers = {};

    Object.entries(states).forEach(([name, st]) => {
      const all = seriesDefs.flatMap((s) => s.vals[name]).filter((v) => v != null);
      const hi = d3.max(all);
      const y = d3.scaleLinear()
        .domain([0, st.yMax ? st.yMax(hi) : hi * 1.15])
        .range([innerHeight, 0]);
      if (!st.yMax) y.nice();

      const layer = g.append("g")
        .attr("class", `hdc-layer hdc-layer-${name}`)
        .style("opacity", 0)
        .style("pointer-events", "none")
        .attr("transform", `translate(0,${OFFSET})`);

      // y axis title (what is being measured)
      layer.append("text")
        .attr("x", xL - margin.left + 6).attr("y", -22)
        .attr("font-size", 12).attr("fill", "#33302a").attr("fill-opacity", 0.85)
        .text(st.yLabel);

      // vertical guides + year labels (x axis)
      [[xL, Y0], [xR, Y1]].forEach(([px, yr]) => {
        layer.append("line")
          .attr("x1", px).attr("x2", px).attr("y1", 0).attr("y2", innerHeight)
          .attr("stroke", "#33302a").attr("stroke-opacity", 0.25);
        layer.append("text")
          .attr("x", px).attr("y", innerHeight + 24)
          .attr("text-anchor", "middle").attr("font-size", 13).attr("fill", "#33302a")
          .text(yr);
      });
      layer.append("text")
        .attr("x", innerWidth / 2).attr("y", innerHeight + 46)
        .attr("text-anchor", "middle")
        .attr("font-size", 12).attr("fill", "#33302a").attr("fill-opacity", 0.85)
        .text("Census year");

      // baseline at zero
      layer.append("line")
        .attr("x1", xL).attr("x2", xR).attr("y1", y(0)).attr("y2", y(0))
        .attr("stroke", "#33302a").attr("stroke-opacity", 0.2).attr("stroke-dasharray", "3 4");
      layer.append("text")
        .attr("x", xL - 10).attr("y", y(0) + 4).attr("text-anchor", "end")
        .attr("font-size", 11).attr("fill", "#33302a").attr("fill-opacity", 0.6).text("0");

      const usable = seriesDefs.filter((s) => s.vals[name][0] != null && s.vals[name][1] != null);

      // slopes + end dots
      usable.forEach((s, i) => {
        const [a, b] = s.vals[name];
        layer.append("path")
          .attr("fill", "none").attr("stroke", s.color)
          .attr("stroke-width", 3).attr("stroke-linecap", "round")
          .attr("filter", inkFilter).style("opacity", 0.9)
          .attr("d", inkPath([[xL, y(a)], [xR, y(b)]], s.key.length + i));
        [[xL, a], [xR, b]].forEach(([px, v]) =>
          layer.append("circle").attr("cx", px).attr("cy", y(v)).attr("r", 5).attr("fill", s.color));
      });

      // direct labels
      const left = spread(usable.map((s) => ({ color: s.color, y: y(s.vals[name][0]), v: s.vals[name][0] })));
      const right = spread(usable.map((s) => ({ color: s.color, y: y(s.vals[name][1]), v: s.vals[name][1], key: s.key })));

      left.forEach((d) => layer.append("text")
        .attr("x", xL - 12).attr("y", d.y + 4).attr("text-anchor", "end")
        .attr("font-size", 13).attr("font-weight", 600).attr("fill", d.color)
        .text(st.fmt(d.v)));
      right.forEach((d) => layer.append("text")
        .attr("x", xR + 12).attr("y", d.y + 4).attr("text-anchor", "start")
        .attr("font-size", 13).attr("font-weight", 600).attr("fill", d.color)
        .text(`${st.fmt(d.v)}  ${names[d.key]}`));

      layers[name] = layer;
    });

    let current = null;

    function show(name, instant) {
      if (!states[name]) { console.warn(`Chart H1: unknown state "${name}"`); return; }
      if (name === current && !instant) return;

      const dur = instant ? 0 : 600;
      const prev = current;
      current = name;

      if (prev && layers[prev]) {
        layers[prev]
          .style("pointer-events", "none")
          .transition("layer").duration(dur).ease(d3.easeCubicInOut)
          .style("opacity", 0)
          .attr("transform", `translate(0,${-OFFSET})`);
      }

      layers[name]
        .interrupt("layer")
        .attr("transform", `translate(0,${OFFSET})`)
        .style("pointer-events", "all")
        .transition("layer").duration(dur).ease(d3.easeCubicInOut)
        .style("opacity", 1)
        .attr("transform", "translate(0,0)");
    }




    window.chartH1.show = show;
    show(window.chartH1.requested, true);

  }).catch((err) => console.error("Chart H1 failed:", err));

//END CHART H1 POPULATION


/* //START CHART H2 DENSITY

function chartH(selector, dataURL) {
  const root = d3.select(selector).classed("chart-h", true).html("");

  const SIZES = ["1","2","3","4","5","6+"];
  const NUM = {"1":1,"2":2,"3":3,"4":4,"5":5,"6+":6};
  const color = s => s==="1" ? "var(--c1)" : s==="2" ? "var(--c2)" : "var(--c3)";

  // dot positions inside a 40x52 window
  const POS = {
    1:[[20,26]],
    2:[[12,26],[28,26]],
    3:[[20,17],[11,34],[29,34]],
    4:[[12,18],[28,18],[12,34],[28,34]],
    5:[[12,14],[28,14],[20,27],[12,40],[28,40]],
    6:[[12,14],[28,14],[12,27],[28,27],[12,40],[28,40]]
  };

  // largest-remainder rounding so each building has exactly 100 windows
  function toWindows(rows) {
    const total = d3.sum(rows, r => r.pct);
    const items = SIZES.map(s => {
      const p = (rows.find(r => r.size === s)?.pct || 0) / total * 100;
      return {size: s, pct: p, n: Math.floor(p), rem: p - Math.floor(p)};
    });
    const left = 100 - d3.sum(items, d => d.n);
    items.slice().sort((a, b) => b.rem - a.rem).slice(0, left).forEach(d => d.n++);
    return items;
  }

  const W = 40, H = 52, SX = 50, SY = 62, PADX = 18, TOP = 46, COLS = 10, ROWS = 10;
  const width  = PADX * 2 + SX * (COLS - 1) + W;
  const height = TOP + SY * (ROWS - 1) + H + 28;

  // legend (attached to root, not "#legend")
  const leg = root.append("div").attr("class", "chart-h-legend");
  [["1", "1 person", 1], ["2", "2 people", 2], ["3", "3+ people", 3]].forEach(([s, t, n]) => {
    const sp = leg.append("span");
    const svg = sp.append("svg").attr("width", 26).attr("height", 32).attr("viewBox", "0 0 40 52");
    svg.append("rect").attr("width", 40).attr("height", 52).attr("rx", 3).attr("fill", "var(--win)");
    POS[n].forEach(([x, y]) => svg.append("circle").attr("cx", x).attr("cy", y).attr("r", 5.5).attr("fill", color(s)));
    sp.append("span").text(t);
  });

  const grid = root.append("div").attr("class", "chart-h-grid");

  d3.json(dataURL).then(DATA => {
    DATA.forEach(d => { d.year = +d.year; d.size = String(d.size); d.pct = +d.pct; });

    [1970, 2020].forEach(year => {
      const items = toWindows(DATA.filter(d => d.year === year));

      // one entry per window, 1-person first, filled from the bottom row up
      const windows = [];
      items.forEach(it => { for (let k = 0; k < it.n; k++) windows.push(it.size); });
      const cells = windows.map((s, i) => ({s, row: ROWS - 1 - Math.floor(i / COLS), col: i % COLS}));

      const box = grid.append("div").attr("class", "chart-h-bld");
      box.append("h2").text(year);

      const svg = box.append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label", `Building of 100 windows showing household sizes in ${year}`);

      // facade, cornice, base
      svg.append("rect").attr("x", 0).attr("y", TOP - 20).attr("width", width).attr("height", height - TOP + 12).attr("fill", "var(--wall)");
      svg.append("rect").attr("x", -4).attr("y", TOP - 30).attr("width", width + 8).attr("height", 12).attr("fill", "var(--wall2)");
      svg.append("rect").attr("x", 0).attr("y", height - 8).attr("width", width).attr("height", 8).attr("fill", "var(--wall2)");

      // windows + dots
      const g = svg.selectAll("g.win").data(cells).join("g").attr("class", "win")
        .attr("transform", d => `translate(${PADX + d.col * SX},${TOP + d.row * SY})`);
      g.append("rect").attr("width", W).attr("height", H).attr("rx", 3).attr("fill", "var(--win)");
      g.each(function (d) {
        d3.select(this).selectAll("circle").data(POS[NUM[d.s]]).join("circle")
          .attr("cx", p => p[0]).attr("cy", p => p[1]).attr("r", 5.5).attr("fill", color(d.s));
      });

      // summary stats: 1 / 2 / 3+
      const pct = sizes => items.filter(i => sizes.includes(i.size)).reduce((a, i) => a + i.pct, 0);
      const st = box.append("div").attr("class", "chart-h-stats");
      [["1 person", ["1"], "--c1"], ["2 people", ["2"], "--c2"], ["3+ people", ["3", "4", "5", "6+"], "--c3"]].forEach(([t, s, c]) => {
        const d = st.append("div");
        d.append("b").style("color", `var(${c})`).text(Math.round(pct(s)) + "%");
        d.append("span").text(t);
      });
    });
  }).catch(err => {
    console.error(err);
    root.append("p").text("Could not load " + dataURL);
  });
}

chartH("#chart-h", "data/hh_size.json"); */

//END CHART H


//CHART I: STRETCHY BUILDINGS BY YEAR (share of businesses by category)

(async function () {
  try {
    const data = await fetch("data/strips_by_year.json").then((r) => r.json());
    const byYear = new Map(data.map((d) => [d.year, d.segments]));
    const years = data.map((d) => d.year).sort((a, b) => a - b);

    // ---------- groups ----------
    const DRAWN = [];     // empty = show everything

    // every category that appears in any year, ordered by the exported `order`
    const orderOf = new Map();
    data.forEach((y) => y.segments.forEach((s) => {
      if (!orderOf.has(s.group)) orderOf.set(s.group, s.order ?? 999);
    }));
    const allGroups = [...orderOf.keys()].sort((a, b) => orderOf.get(a) - orderOf.get(b));
    const groups = DRAWN.length ? allGroups.filter((g) => DRAWN.includes(g)) : allGroups;

    console.log("chart-i groups:", groups);

    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    // ---------- load building pieces ----------
    const parse = (txt) =>
      new DOMParser().parseFromString(txt, "image/svg+xml").documentElement;

    const loadPiece = async (file) => {
      try {
        const r = await fetch(file);
        if (!r.ok) throw new Error(r.status);
        const node = parse(await r.text());
        let [x, y, w, h] = (node.getAttribute("viewBox") || "")
          .trim().split(/[\s,]+/).map(Number);
        if (![x, y, w, h].every(Number.isFinite)) {
          x = 0; y = 0;
          w = parseFloat(node.getAttribute("width")) || 0;
          h = parseFloat(node.getAttribute("height")) || 0;
        }
        return { html: node.innerHTML, x, y, w, h };
      } catch (e) {
        return {
          html: `<rect width="40" height="100" fill="#ccc" stroke="#888"/>`,
          x: 0, y: 0, w: 40, h: 100,
        };
      }
    };

    const pieces = {};
    await Promise.all(groups.map(async (g) => {
      const s = slug(g);
      const [L, M, R] = await Promise.all(
        ["left", "mid", "right"].map((p) => loadPiece(`data/buildings/${s}-${p}.svg`))
      );
      pieces[g] = { L, M, R };
    }));

    // ---------- settings ----------
    const COLORS = d3.scaleOrdinal().domain(groups).range(d3.schemeTableau10);
    const TINT    = null;                    // one color for all, or null = per-group COLORS
    const tintFor = (g) => TINT ?? COLORS(g);

    const LINE_PX = 0.8;                     // min on-screen thickness for black linework; 0 = off

    const SIGN_FONT  = "'newshound', sans-serif";
    const SIGN_DY    = 40;                   // px down from the top of the artwork (on the building)
    const SIGN_SIZE  = 12;
    const SIGN_COLOR = "#000";
    const SIGN_PAD   = 6;                   // px of breathing room each side before text counts as "too wide"
    const UNDER_DY   = 18;                   // px below the ground line when the name goes underneath

    // short names shown on the buildings (anything not listed shows its full name)
    const signNames = {
      "Restaurants, cafes & bars": "Restaurants",
      "Personal services": "Services",
      "Finance & professional": "Finance",
      "Health, education & religion": "Social",
      "Arts & entertainment": "Arts",
      "Grocery, food & liquor": "Grocery",
    };

    // what each short name stands for (shown in the legend; edit freely)
    const legendText = {
      "Grocery, food & liquor": "grocery, specialty food, liquor",
      "Restaurants, cafes & bars": "restaurants, bars, cafes and nightclubs",
      "Personal services": "personal services",
      "Finance & professional": "finance & professional",
      "Health, education & religion": "health, education & religion",
      "Arts & entertainment": "arts & entertainment",
    };

    const OVERLAP = .5;                       // 0 = no overlap between pieces
    const EPS     = 0.0005;                  // below this share, treat as 0%

    // ---------- layout (order matters: each line uses the ones above it) ----------
    const margin = { top: 40, right: 30, bottom: 40, left: 30 };
    const width  = 1440;
    const avail  = width - margin.left - margin.right;

    const maxSum = d3.max(data, (y) => d3.sum(y.segments, (s) => s.pct));
    const K      = avail / maxSum;           // px per 100% share

    // widest cap in the artwork's own units, measured from the files
    const CAP_NATIVE = d3.max(groups, (g) => Math.max(pieces[g].L.w, pieces[g].R.w));
    const CAP_PCT    = 0.01;                 // each end = 1% of the line
    const BUILD_S    = CAP_PCT * K / CAP_NATIVE;
    const V_STRETCH = 1.5;   // 1 = current height, 2 = twice as tall

    const rowH = d3.max(groups, (g) => pieces[g].L.h) * BUILD_S * V_STRETCH;

    // share of the line the two caps take at full size
    const fullShare = (g) => (pieces[g].L.w + pieces[g].R.w) * BUILD_S / K;
    const capFactor = (g, pct) => pct < EPS ? 0 : Math.min(1, pct / fullShare(g));
    const midPx     = (g, pct) => Math.max(0, pct - fullShare(g)) * K;

    console.log("chart-i: BUILD_S =", BUILD_S.toFixed(3), " rowH =", Math.round(rowH));

    const height = margin.top + rowH + margin.bottom;

    // ---------- measure the sign text (canvas, so it works even if the chart is hidden) ----------
    await document.fonts.ready;
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${SIGN_SIZE}px ${SIGN_FONT}`;
    const textW = {};
    groups.forEach((g) => { textW[g] = ctx.measureText(signNames[g] ?? g).width; });

    // ---------- DOM ----------
    const root = d3.select("#chart-i");
    root.selectAll("*").remove();

    const controls = root.append("div").attr("class", "chart-i-controls")
      .style("margin-bottom", "8px");

    const sliderRow = controls.append("div")
      .style("display", "flex").style("align-items", "center").style("gap", "12px");
    const slider = sliderRow.append("input")
      .attr("type", "range")
      .attr("min", 0).attr("max", years.length - 1)   // index, not year
      .attr("step", 1).attr("value", 0)
      .style("flex", "1");
    const yearLabel = sliderRow.append("span")
      .style("font-weight", "bold").style("min-width", "3em").text(years[0]);

    // year ticks under the slider (states are evenly spaced by index)
    controls.append("div")
      .style("display", "flex").style("justify-content", "space-between")
      .style("font-size", "11px").style("margin-right", "3.9em")
      .selectAll("span").data(years).join("span").text((d) => d);

    const svg = root.append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .style("max-width", `${width}px`)
      .style("overflow", "visible");

    const plot = svg.append("g")
      .attr("transform", `translate(${margin.left}, ${margin.top})`);

    // ground line
    plot.append("line")
      .attr("x1", 0).attr("x2", avail)
      .attr("y1", rowH).attr("y2", rowH)
      .attr("stroke", "#000").attr("stroke-width", 1);

    const bld = plot.selectAll("g.building")
      .data(groups, (d) => d)
      .join("g")
      .attr("class", "building");

    // art group: uniformly scaled by BUILD_S, sitting on the ground line
    const art = bld.append("g").attr("class", "art")
      .attr("transform", (g) =>
       `translate(0, ${rowH - pieces[g].L.h * BUILD_S * V_STRETCH}) scale(${BUILD_S}, ${BUILD_S * V_STRETCH})`);

    art.append("g").attr("class", "cap-left").html((g) => pieces[g].L.html);
    art.append("g").attr("class", "mid").html((g) => pieces[g].M.html)
      .selectAll("*").attr("vector-effect", "non-scaling-stroke");
    art.append("g").attr("class", "cap-right").html((g) => pieces[g].R.html);

    // color: swap only the white fills for the tint; black linework is untouched
    art.each(function (g) {
      const tint = tintFor(g);
      d3.select(this).selectAll("path, rect, polygon").each(function () {
        const f = this.style.fill;   // browsers report "#fff" as "rgb(255, 255, 255)"
        if (f === "rgb(255, 255, 255)" || f === "#fff" || f === "#ffffff" || f === "white") {
          this.style.fill = tint;
        }
      });
    });

    // minimum on-screen thickness for black shapes so thin outlines don't fade to gray
    if (LINE_PX > 0) {
      art.selectAll("path, rect, polygon").each(function () {
        const f = this.style.fill;   // black shapes have no fill set
        if (f === "" || f === "black" || f === "#000" || f === "rgb(0, 0, 0)") {
          this.setAttribute("stroke", "#000");
          this.setAttribute("stroke-width", LINE_PX);
          this.setAttribute("stroke-linejoin", "round");
          this.setAttribute("vector-effect", "non-scaling-stroke");
        }
      });
    }

    // short name: on the building if it fits, underneath if not (position set in update())
    bld.append("text").attr("class", "sign-label")
      .attr("text-anchor", "middle")
      .style("font-size", `${SIGN_SIZE}px`)
      .style("font-family", SIGN_FONT)
      .style("fill", SIGN_COLOR)
      .style("pointer-events", "none")
      .text((g) => signNames[g] ?? g);

    // percent above
    bld.append("text").attr("class", "pct-label")
      .attr("y", -10).attr("text-anchor", "middle")
      .style("font-weight", "bold");

    // ---------- legend ----------
    const legend = root.append("div").attr("class", "chart-i-legend")
      .style("display", "flex").style("flex-wrap", "wrap")
      .style("gap", "6px 28px").style("margin-top", "14px")
      .style("font-size", "13px").style("line-height", "1.3");

    const item = legend.selectAll("div.legend-item").data(groups).join("div")
      .attr("class", "legend-item")
      .style("display", "flex").style("align-items", "center").style("gap", "8px");

    item.append("span")
      .style("width", "12px").style("height", "12px").style("flex", "none")
      .style("background", (g) => tintFor(g))
      .style("border", "1px solid #000");

    item.append("span").html((g) =>
      `<strong>${signNames[g] ?? g}</strong> = ${legendText[g] ?? g}`);

    // ---------- update ----------
    function update(year, duration = 0) {
      const segs = new Map(byYear.get(year).map((s) => [s.group, s]));
      const pct = (g) => (segs.get(g) ? segs.get(g).pct : 0);

      // building positions, end to end (width = share * K)
      let x = 0;
      const pos = new Map();
      groups.forEach((g) => {
        const w = pct(g) * K;
        pos.set(g, { x, w });
        x += w;
      });

      bld.transition().duration(duration)
        .attr("transform", (g) => `translate(${pos.get(g).x},0)`);

      // pieces live inside the BUILD_S-scaled group, so screen px are divided by BUILD_S.
      // each piece's viewBox origin is undone, then it is squished/stretched in x only
      const place = (p, x0, w) =>
        `translate(${x0 / BUILD_S},0) scale(${Math.max(w, 1e-3) / BUILD_S / p.w},1) translate(${-p.x},${-p.y})`;

      const capL = (g) => pieces[g].L.w * BUILD_S * capFactor(g, pct(g));
      const capR = (g) => pieces[g].R.w * BUILD_S * capFactor(g, pct(g));

      bld.select("g.cap-left").transition().duration(duration)
        .attr("opacity", (g) => capFactor(g, pct(g)) > 0 ? 1 : 0)
        .attr("transform", (g) => place(pieces[g].L, 0, capL(g)));

      bld.select("g.mid").transition().duration(duration)
        .attr("opacity", (g) => midPx(g, pct(g)) > 0.01 ? 1 : 0)
        .attr("transform", (g) => {
          const m = midPx(g, pct(g));
          return m > 0.01
            ? place(pieces[g].M, capL(g) - OVERLAP, m + 2 * OVERLAP)
            : place(pieces[g].M, capL(g), 0);
        });

      bld.select("g.cap-right").transition().duration(duration)
        .attr("opacity", (g) => capFactor(g, pct(g)) > 0 ? 1 : 0)
        .attr("transform", (g) =>
          place(pieces[g].R, capL(g) + midPx(g, pct(g)), capR(g)));

      bld.select("text.pct-label").transition().duration(duration)
        .attr("x", (g) => pos.get(g).w / 2)
        .textTween(function (g) {
          const from = parseFloat(this.textContent) / 100 || 0;
          const i = d3.interpolateNumber(from, pct(g));
          return (t) => d3.format(".0%")(i(t));
        });

      // short name: on the building if there's room, otherwise underneath
      const fits = (g) => pos.get(g).w >= textW[g] + 2 * SIGN_PAD;

      bld.select("text.sign-label").transition().duration(duration)
        .attr("x", (g) => pos.get(g).w / 2)
        .attr("y", (g) => fits(g)
          ? rowH - pieces[g].L.h * BUILD_S * V_STRETCH + SIGN_DY
          : rowH + UNDER_DY);

      // hide the labels at 0% (named transition so it doesn't cancel the ones above)
      bld.selectAll("text").transition("fade").duration(duration)
        .style("opacity", function () {
          const g = d3.select(this.parentNode).datum();
          return pct(g) < EPS ? 0 : 1;
        });

      yearLabel.text(year);
    }

    slider.on("input", (e) => update(years[+e.target.value], 400));

    update(years[0]);

  } catch (err) {
    console.error("Chart I failed:", err);
  }
})();
//END CHART I

// CHART J FOCUS CHARTS FOR SPECIFIC TYPES OF BUSINESSES 

function createChartJ(dataPath = "data/focus_small_multiples.json") {
  const metric    = "n";          // "n" = counts, "share" = share of surveyed entries
  const sharedY   = true;         // same y-axis for every button (needs the small helper patch below)
  const lineColor = "#E4572E";    // one color for every series
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fmt  = metric === "share" ? d3.format(".1%") : d3.format("d");

  return d3.json(dataPath).then(raw => {
    // reshape the R export into the helper's data shape
    const series = raw.series.map(s => ({
      key:    slug(s.name),
      label:  s.name,
      values: s.points.map(p => ({ x: p.year, y: p[metric] }))
    }));
    const globalMax = d3.max(series, s => d3.max(s.values, v => v.y));

    const root = d3.select("#chart-j").classed("chart-j", true).html("");
    const buttons = root.append("div").attr("class", "cj-buttons")
      .attr("role", "group").attr("aria-label", "Business type");
    const plot    = root.append("div").attr("class", "cj-plot");
    const readout = root.append("p").attr("class", "cj-readout").attr("aria-live", "polite");
    root.append("p").attr("class", "cj-caption").text(
      (metric === "share" ? "Share of surveyed entries" : "Number of businesses") +
      ` at the surveyed addresses. Surveyed entries per year: ${raw.entries_min}–${raw.entries_max}.`);

    let current = null;

    function setSeries(name) {
      const s = series.find(d => d.key === slug(String(name)));
      if (!s) return;
      current = s.key;

      createHandDrawnLineChart({
        container: plot.node(),
        categories: [{ key: s.key, label: s.label, color: lineColor }],
        data: [{ key: s.key, values: s.values }],
        width: 860,
        mainHeight: 380,
        brush: false,
        yMax: sharedY ? globalMax : null     // ignored unless you add the patch below
      });

      const first = s.values[0], last = s.values[s.values.length - 1];
      readout.text(`${s.label}: ${fmt(first.y)} in ${first.x}, ${fmt(last.y)} in ${last.x}`);

      buttons.selectAll("button")
        .classed("is-active", d => d.key === current)
        .attr("aria-pressed", d => d.key === current);
    }

    buttons.selectAll("button").data(series).join("button")
      .attr("type", "button").attr("class", "cj-btn")
      .text(d => d.label)
      .on("click", (event, d) => setSeries(d.key));

    window.chartJ = { setSeries, names: series.map(d => d.label) };
    setSeries(series[0].key);
    if (window.ScrollTrigger) ScrollTrigger.refresh();
    return window.chartJ;
  });
}

// END CHART J

// CHART K individual store closures

// CHART K REPORTED COMMERCIAL RENT HIKES (NOMINAL DOLLARS)

function createChartK(data = null) {
  const defaultData = [
    {
      name: "Second Childhood",
      detail: "Antique toys",
      year: 2008,
      prevRent: 7000,
      newRent: 15000,
      outcome: "closed",
      source: "Press report"
    },
    {
      name: "Nusraty Afghan Imports",
      detail: "Moved Bleecker St. to Christopher St. (closed 2020)",
      year: 2008,
      prevRent: 7000,
      newRent: 45000,
      outcome: "moved",
      source: "The New York Times"
    },
    {
      name: "Rocco Ristorante",
      detail: "Italian restaurant",
      year: 2012,
      prevRent: 8000,
      newRent: 18000,
      outcome: "closed",
      source: "Press report"
    },
    {
      name: "Arleen Bowman",
      detail: "Local designer boutique",
      year: 2012,
      prevRent: 2500,
      newRent: 35000,
      outcome: "closed",
      source: "The New York Times"
    },
    {
      name: "Cafe Angelique",
      detail: "Café",
      year: 2014,
      prevRent: 16000,
      newRent: 42000,
      outcome: "closed",
      source: "Press report"
    },
    {
      name: "Da'Vinci Shoes",
      detail: "Shoe store",
      year: 2016,
      prevRent: 6000,
      newRent: 40000,
      approx: true,
      outcome: "closed",
      source: "Press report"
    }
  ];

  const accentColor = "#E4572E";
  const mutedColor  = "#9AA0A6";
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fmtCurrency = d3.format("$,.0f");
  const fmtK = d => `$${Math.round(d / 1000)}k`;

  const render = (raw) => {
    const stores = raw.map(d => ({
      ...d,
      key: slug(d.name),
      startYear: d.year - 5,
      mult: (d.newRent / d.prevRent).toFixed(1)
    }));

    const root = d3.select("#chart-k").classed("chart-k", true).html("");
    const buttons = root.append("div").attr("class", "ck-buttons")
      .attr("role", "group").attr("aria-label", "Store case study");
    const plot    = root.append("div").attr("class", "ck-plot");
    const readout = root.append("p").attr("class", "ck-readout").attr("aria-live", "polite");
    root.append("p").attr("class", "ck-caption").text(
      "Reported monthly commercial rents in nominal dollars (not adjusted for inflation). " +
      "Horizontal lines fade in from 5 years prior to renewal; vertical jumps mark the proposed rent in the year each business closed or relocated. " +
      "Sources: The New York Times and local press reports."
    );

    const width = 860;
    const height = 700;
    const margin = { top: 28, right: 175, bottom: 42, left: 64 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = plot.append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .style("max-width", `${width}px`)
      .style("overflow", "visible");

    const defs = svg.append("defs");
    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const xMin = d3.min(stores, d => d.startYear); // 2003
    const xMax = d3.max(stores, d => d.year);      // 2016
    const yMax = 50000;

    const x = d3.scaleLinear().domain([xMin, xMax]).range([0, innerW]);
    const y = d3.scaleLinear().domain([0, yMax]).range([innerH, 0]);

    // Gridlines & Axes
    g.append("g")
      .attr("class", "ck-grid")
      .call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(""))
      .call(sel => sel.select(".domain").remove())
      .call(sel => sel.selectAll("line")
        .attr("stroke", "#E5E5E5")
        .attr("stroke-dasharray", "2,2"));

    g.append("g")
      .attr("class", "ck-axis ck-axis-x")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(7).tickFormat(d3.format("d")))
      .call(sel => sel.select(".domain").attr("stroke", "#666"));

    g.append("g")
      .attr("class", "ck-axis ck-axis-y")
      .call(d3.axisLeft(y).ticks(5).tickFormat(fmtK))
      .call(sel => sel.select(".domain").remove());

    g.append("text")
      .attr("x", 0)
      .attr("y", -10)
      .attr("fill", "#555")
      .attr("font-size", "12px")
      .text("Monthly rent (nominal $)");

    // Left-to-right fade gradients (userSpaceOnUse so horizontal lines render cleanly)
    stores.forEach(d => {
      const grad = defs.append("linearGradient")
        .attr("id", `ck-fade-${d.key}`)
        .attr("gradientUnits", "userSpaceOnUse")
        .attr("x1", x(d.startYear))
        .attr("y1", 0)
        .attr("x2", x(d.year))
        .attr("y2", 0);

      grad.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", accentColor)
        .attr("stop-opacity", 0);

      grad.append("stop")
        .attr("offset", "35%")
        .attr("stop-color", accentColor)
        .attr("stop-opacity", 0.35);

      grad.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", accentColor)
        .attr("stop-opacity", 1);
    });

    // Small vertical label nudges so overlapping 2008 / 2012 endpoints don't collide
    const labelOffsets = {
      "nusraty-afghan-imports": -4,
      "cafe-angelique": -2,
      "da-vinci-shoes": 4,
      "arleen-bowman": 4,
      "rocco-ristorante": 2,
      "second-childhood": 4
    };

    const storeGroups = g.selectAll(".ck-series")
      .data(stores, d => d.key)
      .join("g")
      .attr("class", "ck-series")
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        setSeries(current === d.key ? "all" : d.key);
      });

    // 1. Horizontal 5-year fading baseline
    storeGroups.append("line")
      .attr("class", "ck-baseline")
      .attr("x1", d => x(d.startYear))
      .attr("x2", d => x(d.year))
      .attr("y1", d => y(d.prevRent))
      .attr("y2", d => y(d.prevRent))
      .attr("stroke", d => `url(#ck-fade-${d.key})`)
      .attr("stroke-width", 2.5)
      .attr("stroke-linecap", "round");

    // 2. Vertical renewal jump
    storeGroups.append("line")
      .attr("class", "ck-cliff")
      .attr("x1", d => x(d.year))
      .attr("x2", d => x(d.year))
      .attr("y1", d => y(d.prevRent))
      .attr("y2", d => y(d.newRent))
      .attr("stroke", accentColor)
      .attr("stroke-width", 2.5);

    // 3. Anchor dot at renewal knee
    storeGroups.append("circle")
      .attr("class", "ck-knee")
      .attr("cx", d => x(d.year))
      .attr("cy", d => y(d.prevRent))
      .attr("r", 3)
      .attr("fill", "#fff")
      .attr("stroke", accentColor)
      .attr("stroke-width", 2);

    // 4. Top endpoint marker (filled = closed, hollow = moved)
    storeGroups.append("circle")
      .attr("class", "ck-peak")
      .attr("cx", d => x(d.year))
      .attr("cy", d => y(d.newRent))
      .attr("r", 4.5)
      .attr("fill", d => d.outcome === "moved" ? "#fff" : accentColor)
      .attr("stroke", accentColor)
      .attr("stroke-width", 2.2);

    // 5. Direct end labels
    storeGroups.append("text")
      .attr("class", "ck-label")
      .attr("x", d => x(d.year) + 8)
      .attr("y", d => y(d.newRent) + (labelOffsets[d.key] || 0))
      .attr("dominant-baseline", "middle")
      .attr("font-size", "12px")
      .attr("font-weight", "600")
      .attr("fill", "#222")
      .text(d => `${d.name} (${d.year})`);

    // Subtle legend in top-left for closed vs. moved
    const legend = g.append("g")
      .attr("class", "ck-legend")
      .attr("transform", "translate(8, 6)");

    legend.append("circle")
      .attr("cx", 0).attr("cy", 0).attr("r", 4)
      .attr("fill", accentColor);
    legend.append("text")
      .attr("x", 9).attr("y", 0).attr("dominant-baseline", "middle")
      .attr("font-size", "11px").attr("fill", "#555")
      .text("Closed at renewal");

    legend.append("circle")
      .attr("cx", 118).attr("cy", 0).attr("r", 4)
      .attr("fill", "#fff").attr("stroke", accentColor).attr("stroke-width", 2);
    legend.append("text")
      .attr("x", 127).attr("y", 0).attr("dominant-baseline", "middle")
      .attr("font-size", "11px").attr("fill", "#555")
      .text("Relocated (closed 2020)");

    let current = "all";

    function setSeries(name) {
      const targetKey = slug(String(name));
      const isAll = targetKey === "all";
      const match = isAll ? null : stores.find(d => d.key === targetKey);
      if (!isAll && !match) return;

      current = isAll ? "all" : match.key;

      storeGroups
        .transition().duration(180)
        .style("opacity", d => (isAll || d.key === current) ? 1 : 0.16);

      storeGroups.filter(d => d.key === current).raise();

      if (isAll) {
        readout.text(
          "All 6 cases: proposed renewal rents jumped 2.1× to 14× above prior lease rates (nominal dollars). Click a store to isolate."
        );
      } else {
        const prefix = match.approx ? "nearly " : "";
        const verb = match.outcome === "moved" ? "relocated in" : "closed in";
        readout.text(
          `${match.name} (${match.detail}): ${fmtCurrency(match.prevRent)}/mo → ${prefix}${fmtCurrency(match.newRent)}/mo (${match.mult}×) — ${verb} ${match.year}.`
        );
      }

      buttons.selectAll("button")
        .classed("is-active", d => d.key === current)
        .attr("aria-pressed", d => d.key === current);
    }

    const buttonItems = [{ key: "all", label: "All stores" }, ...stores.map(d => ({ key: d.key, label: d.name }))];

    buttons.selectAll("button")
      .data(buttonItems)
      .join("button")
      .attr("type", "button")
      .attr("class", "ck-btn")
      .text(d => d.label)
      .on("click", (event, d) => setSeries(d.key));

    window.chartK = { setSeries, names: stores.map(d => d.name) };
    setSeries("all");
    if (window.ScrollTrigger) ScrollTrigger.refresh();
    return window.chartK;
  };

  // Accepts either a JSON path string (like createChartJ) or an inline array
  if (typeof data === "string") {
    return d3.json(data).then(render);
  }
  return Promise.resolve(render(data || defaultData));
}

// END CHART K


// end CHART K individual store closures




//END CHARTS

//necessary extra calls
createChartJ();
createChartK();
