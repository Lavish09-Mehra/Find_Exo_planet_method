/* ---------------------------------------------------------------------------
   ExoSignal front end
   Vanilla JS, no build step. Talks to the Flask model endpoints.
--------------------------------------------------------------------------- */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const CLASS_VARS = {
  Transit: "var(--accent)",
  "Radial Velocity": "var(--rv)",
  Other: "var(--other)",
};

const CLASS_LABELS = {
  Transit: "Transit",
  "Radial Velocity": "Radial velocity",
  Other: "Other",
};

const CLASS_ICONS = {
  Transit: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <circle cx="12" cy="12" r="6.4"></circle>
      <path d="M2.6 12h18.8"></path>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"></circle>
    </svg>`,
  "Radial Velocity": `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2.8 12c2.1 0 2.1-6 4.6-6s2.1 12 4.6 12 2.1-6 4.6-6 2.1 0 4.6 0"></path>
    </svg>`,
  Other: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <path d="M12 2.8v18.4M2.8 12h18.4M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"></path>
      <circle cx="12" cy="12" r="2.1" fill="var(--surface)" stroke="currentColor"></circle>
    </svg>`,
};

const SWEEP_SHORT = {
  pl_orbper: "Period",
  pl_radj: "Radius",
  st_optmag: "V mag",
  st_teff: "Teff",
  st_mass: "Mass",
};

const SWEEP_DISPLAY = {
  pl_orbper: "orbital period",
  pl_radj: "planet radius",
  st_optmag: "V-band magnitude",
  st_teff: "effective temperature",
  st_mass: "stellar mass",
};

const ADV_MAP = {
  pl_orbper: "pl_orbpererr1",
  pl_radj: "pl_radjerr1",
  st_teff: "st_tefferr1",
  st_mass: "st_masserr1",
  st_rad: "st_raderr1",
};

const PREFERRED_ORDER = ["Transit", "Radial Velocity", "Other"];

const state = {
  meta: null,
  values: {},
  advanced: {},
  flags: { pl_kepflag: "", pl_k2flag: "", pl_ttvflag: "" },
  band: "",
  activePreset: null,
  applyingPreset: false,
  fields: new Map(),
  displayOrder: [],
  sweepFeature: "pl_orbper",
  sweep: null,
  predictSeq: 0,
  sweepSeq: 0,
  chartGeometry: null,
  chartResizeFrame: 0,
  lastPrediction: null,
  theme: "light",
};

const els = {};

/* ---------------------------------------------------------------------------
   Small utilities
--------------------------------------------------------------------------- */

function debounce(fn, delay) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatNumber(value, decimals = 2) {
  if (!isFiniteNumber(value)) return "—";
  const rounded = Number(value.toFixed(decimals));
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  }).format(rounded);
}

function formatCompact(value) {
  if (!isFiniteNumber(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute >= 10000) return `${(value / 1000).toFixed(0)}k`;
  if (absolute >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (absolute >= 100) return value.toFixed(0);
  if (absolute >= 10) return value.toFixed(1);
  if (absolute >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

function percent(value) {
  return `${(value * 100).toFixed(value >= 0.9995 ? 0 : 1)}%`;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = payload.error || "";
    } catch (_) {
      detail = "";
    }
    throw new Error(detail || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

function classLabel(key) {
  return CLASS_LABELS[key] || key;
}

function classVar(key) {
  return CLASS_VARS[key] || "var(--accent)";
}

function classMeta(key) {
  return state.meta?.classes?.find((item) => item.key === key) || null;
}

/* ---------------------------------------------------------------------------
   Theme
--------------------------------------------------------------------------- */

function setupTheme() {
  const stored = window.localStorage.getItem("exosignal-theme");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(stored === "dark" || stored === "light" ? stored : systemDark ? "dark" : "light");

  els.themeToggle.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
    window.localStorage.setItem("exosignal-theme", state.theme);
  });
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  els.themeToggle.setAttribute("aria-label", label);
  els.themeToggle.setAttribute("title", label);
}

/* ---------------------------------------------------------------------------
   Primary field rendering
--------------------------------------------------------------------------- */

function setupShell() {
  els.themeToggle = $("#themeToggle");
  els.modelStatus = $("#modelStatus");
  els.modelStatusText = $("#modelStatusText");
  els.presetList = $("#presetList");
  els.resetButton = $("#resetButton");
  els.form = $("#predictForm");
  els.resultPanel = $("#resultPanel");
  els.livePill = $("#livePill");
  els.liveText = $("#liveText");
  els.confidenceValue = $("#confidenceValue");
  els.ringProgress = $("#ringProgress");
  els.predictionLabel = $("#predictionLabel");
  els.predictionBlurb = $("#predictionBlurb");
  els.probabilityList = $("#probabilityList");
  els.inputsUsed = $("#inputsUsed");
  els.inferenceTime = $("#inferenceTime");
  els.sweepTabs = $("#sweepTabs");
  els.chartShell = $("#chartShell");
  els.chartCanvas = $("#chartCanvas");
  els.chartLegend = $("#chartLegend");
  els.chartTooltip = $("#chartTooltip");
  els.chartLoading = $("#chartLoading");
  els.sweepNote = $("#sweepNote");
  els.statGrid = $("#statGrid");
  els.importanceList = $("#importanceList");
  els.classList = $("#classList");
  els.modelFacts = $("#modelFacts");
  els.heroStats = $("#heroStats");
  els.heroArtifactName = $("#heroArtifactName");
  els.advanced = $("#advancedPanel");
}

function renderPrimaryFields(fields) {
  const groups = {
    planet: $('[data-group="planet"]'),
    star: $('[data-group="star"]'),
    sky: $('[data-group="sky"]'),
  };

  Object.values(groups).forEach((group) => {
    group.innerHTML = "";
  });

  fields.forEach((field) => {
    const group = groups[field.group] || groups.planet;
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    wrapper.dataset.feature = field.name;

    const labelId = `label-${field.name}`;
    const rangeId = `range-${field.name}`;
    const numberId = `number-${field.name}`;
    const unit = field.unit ? `<span class="field-unit">${field.unit}</span>` : `<span class="field-unit">${field.log ? "log scale" : ""}</span>`;

    wrapper.innerHTML = `
      <div class="field-head">
        <label id="${labelId}" for="${rangeId}">${field.label}</label>
        ${unit}
      </div>
      <div class="field-inputs">
        <div class="range-shell">
          <input class="range" id="${rangeId}" type="range" aria-labelledby="${labelId}">
        </div>
        <div class="number-wrap">
          <input class="number" id="${numberId}" type="number" inputmode="decimal" aria-labelledby="${labelId}">
        </div>
      </div>`;

    group.appendChild(wrapper);

    const range = $(".range", wrapper);
    const number = $(".number", wrapper);
    const shell = $(".range-shell", wrapper);

    if (field.log) {
      range.min = "0";
      range.max = "1000";
      range.step = "1";
      range.dataset.log = "true";
      range.dataset.min = String(field.min);
      range.dataset.max = String(field.max);
    } else {
      range.min = String(field.min);
      range.max = String(field.max);
      range.step = String(field.step);
    }

    number.min = String(field.min);
    number.max = String(field.max);
    number.step = String(field.step);

    range.addEventListener("input", () => {
      const value = sliderToValue(field, Number(range.value));
      const rounded = roundTo(value, field.decimals);
      state.values[field.name] = rounded;
      number.value = String(rounded);
      updateFill(shell, range);
      markCustom();
      schedulePredict();
    });

    number.addEventListener("input", () => {
      const raw = number.value.trim();
      if (raw === "" || raw === "-") return;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      const value = clamp(parsed, field.min, field.max);
      state.values[field.name] = value;
      syncRange(field, range, shell, value);
      markCustom();
      schedulePredict();
    });

    number.addEventListener("blur", () => {
      const value = state.values[field.name];
      number.value = String(roundTo(value, field.decimals));
      syncRange(field, range, shell, value);
    });

    state.fields.set(field.name, { field, wrapper, range, number, shell });
  });

  fields.forEach((field) => setFieldValue(field.name, state.values[field.name], { silent: true }));
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sliderToValue(field, sliderValue) {
  if (!field.log) return sliderValue;
  const t = sliderValue / 1000;
  const min = Math.log(field.min);
  const max = Math.log(field.max);
  return Math.exp(min + t * (max - min));
}

function valueToSlider(field, value) {
  if (!field.log) return value;
  const clamped = clamp(value, field.min, field.max);
  const t = (Math.log(clamped) - Math.log(field.min)) / (Math.log(field.max) - Math.log(field.min));
  return Math.round(t * 1000);
}

function syncRange(field, range, shell, value) {
  const clamped = clamp(value, field.min, field.max);
  range.value = String(valueToSlider(field, clamped));
  updateFill(shell, range);
}

function updateFill(shell, range) {
  const min = Number(range.min);
  const max = Number(range.max);
  const value = Number(range.value);
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  shell.style.setProperty("--fill", `${clamp(fill, 0, 100)}%`);
}

function setFieldValue(name, value, { silent = false } = {}) {
  const entry = state.fields.get(name);
  if (!entry) return;
  const { field, range, number, shell } = entry;
  const clamped = clamp(value, field.min, field.max);
  state.values[name] = clamped;
  range.value = String(valueToSlider(field, clamped));
  number.value = String(roundTo(clamped, field.decimals));
  updateFill(shell, range);
  if (!silent) markCustom();
}

/* ---------------------------------------------------------------------------
   Presets and advanced controls
--------------------------------------------------------------------------- */

function renderPresets(presets) {
  els.presetList.innerHTML = "";
  presets.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-button";
    button.dataset.preset = preset.id;
    button.innerHTML = `${preset.name}<span>${preset.hint}</span>`;
    button.title = `${preset.name} — ${preset.hint}`;
    button.addEventListener("click", () => applyPreset(preset));
    els.presetList.appendChild(button);
  });
}

function applyPreset(preset) {
  state.applyingPreset = true;
  clearAdvanced({ silent: true });
  Object.entries(preset.values).forEach(([name, value]) => {
    setFieldValue(name, value, { silent: true });
  });
  state.activePreset = preset.id;
  state.applyingPreset = false;
  updatePresetSelection();
  predict();
}

function updatePresetSelection() {
  $$(".preset-button", els.presetList).forEach((button) => {
    const active = button.dataset.preset === state.activePreset;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function markCustom() {
  if (state.applyingPreset) return;
  if (state.activePreset) {
    state.activePreset = null;
    updatePresetSelection();
  }
}

function setupAdvanced() {
  $$("[data-adv]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.adv;
      const raw = input.value.trim();
      if (raw === "") {
        delete state.advanced[key];
      } else {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          delete state.advanced[key];
        } else {
          state.advanced[key] = parsed;
        }
      }
      markCustom();
      schedulePredict();
    });
  });

  $$("[data-flag]").forEach((group) => {
    const flag = group.dataset.flag;
    group.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-value]");
      if (!button) return;
      state.flags[flag] = button.dataset.value;
      $$("button", group).forEach((item) => {
        item.setAttribute("aria-pressed", item === button ? "true" : "false");
      });
      markCustom();
      schedulePredict();
    });
  });

  $$("[data-band]").forEach((group) => {
    group.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-value]");
      if (!button) return;
      state.band = button.dataset.value;
      $$("button", group).forEach((item) => {
        item.setAttribute("aria-pressed", item === button ? "true" : "false");
      });
      markCustom();
      schedulePredict();
    });
  });
}

function clearAdvanced({ silent = false } = {}) {
  state.advanced = {};
  state.flags = { pl_kepflag: "", pl_k2flag: "", pl_ttvflag: "" };
  state.band = "";

  $$("[data-adv]").forEach((input) => {
    input.value = "";
  });

  $$("[data-flag]").forEach((group) => {
    $$("button", group).forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.value === "" ? "true" : "false");
    });
  });

  const bandGroup = $("[data-band]");
  if (bandGroup) {
    $$("button", bandGroup).forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.value === "" ? "true" : "false");
    });
  }

  if (!silent) {
    markCustom();
    schedulePredict();
  }
}

function collectFeatures() {
  const features = { ...state.values };

  Object.entries(state.advanced).forEach(([key, value]) => {
    if (isFiniteNumber(value)) features[ADV_MAP[key]] = value;
  });

  Object.entries(state.flags).forEach(([key, value]) => {
    if (value === "0" || value === "1") features[key] = Number(value);
  });

  if (state.band === "kepler") {
    features["st_optband_Kepler-band"] = 1;
    features["st_optband_V (Johnson)"] = 0;
  } else if (state.band === "v") {
    features["st_optband_Kepler-band"] = 0;
    features["st_optband_V (Johnson)"] = 1;
  }

  return features;
}

/* ---------------------------------------------------------------------------
   Prediction
--------------------------------------------------------------------------- */

const schedulePredict = debounce(() => predict(), 240);
const scheduleSweep = debounce(() => fetchSweep(), 520);

async function predict() {
  const sequence = ++state.predictSeq;
  setBusy(true);

  try {
    const data = await fetchJSON("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features: collectFeatures() }),
    });

    if (sequence !== state.predictSeq) return;
    state.lastPrediction = data;
    updateResult(data);
    scheduleSweep();
  } catch (error) {
    if (sequence !== state.predictSeq) return;
    showModelError(error);
  } finally {
    if (sequence === state.predictSeq) setBusy(false);
  }
}

function setBusy(busy) {
  els.livePill.classList.toggle("is-busy", busy);
  els.liveText.textContent = busy ? "computing" : "live";
}

function showModelError(error) {
  console.error(error);
  els.livePill.classList.remove("is-busy");
  els.liveText.textContent = "offline";
  els.modelStatus.classList.add("is-error");
  els.modelStatusText.textContent = "Model unavailable";
  els.predictionBlurb.textContent = "The prediction endpoint did not respond. Check that the Flask server is running.";
}

function updateResult(data) {
  const label = classLabel(data.prediction);
  const meta = classMeta(data.prediction);
  const confidence = clamp(data.confidence, 0, 1);

  const previousLabel = els.predictionLabel.textContent;
  els.predictionLabel.textContent = label;
  if (previousLabel !== label) {
    els.predictionLabel.classList.remove("is-changing");
    // Restart the small entrance animation.
    void els.predictionLabel.offsetWidth;
    els.predictionLabel.classList.add("is-changing");
  }

  els.predictionBlurb.textContent = meta?.tagline || "Model estimate from the bundled artifact.";
  els.confidenceValue.textContent = `${Math.round(confidence * 100)}%`;

  const circumference = 358.14;
  els.ringProgress.style.stroke = classVar(data.prediction);
  els.ringProgress.style.strokeDashoffset = String(circumference * (1 - confidence));

  els.inputsUsed.textContent = `${data.inputs_used} / ${data.total_inputs} inputs set`;
  els.inferenceTime.textContent = `${data.elapsed_ms.toFixed(1)} ms`;

  ensureProbabilityRows();

  const best = data.probabilities.reduce((a, b) => (a.value > b.value ? a : b), data.probabilities[0]);
  data.probabilities.forEach((entry) => {
    const row = $(`.probability-row[data-class="${cssEscape(entry.label)}"]`, els.probabilityList);
    if (!row) return;
    row.classList.toggle("is-best", entry.label === best.label);
    row.style.setProperty("--class-color", classVar(entry.label));
    const fill = $(".prob-fill", row);
    const value = $(".prob-value", row);
    fill.style.width = `${clamp(entry.value, 0, 1) * 100}%`;
    value.textContent = percent(entry.value);
  });

  if (state.sweep) {
    renderChart(state.sweep, { animate: false });
  }
}

function ensureProbabilityRows() {
  if (!els.probabilityList.querySelector(".probability-row.is-placeholder")) {
    return;
  }

  els.probabilityList.innerHTML = "";
  state.displayOrder.forEach((key) => {
    const row = document.createElement("div");
    row.className = "probability-row";
    row.dataset.class = key;
    row.style.setProperty("--class-color", classVar(key));
    row.innerHTML = `
      <span class="prob-label">${classLabel(key)}</span>
      <span class="prob-track"><span class="prob-fill"></span></span>
      <span class="prob-value">—</span>`;
    els.probabilityList.appendChild(row);
  });
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

/* ---------------------------------------------------------------------------
   Sweep chart
--------------------------------------------------------------------------- */

function setupSweepTabs(sweeps) {
  els.sweepTabs.innerHTML = "";
  Object.entries(sweeps).forEach(([key, meta]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sweep-tab";
    button.dataset.sweep = key;
    button.textContent = SWEEP_SHORT[key] || meta.label;
    button.title = `Sweep ${meta.label.toLowerCase()}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", key === state.sweepFeature ? "true" : "false");
    button.addEventListener("click", () => {
      if (state.sweepFeature === key) return;
      state.sweepFeature = key;
      $$(".sweep-tab", els.sweepTabs).forEach((tab) => {
        tab.setAttribute("aria-selected", tab.dataset.sweep === key ? "true" : "false");
      });
      updateSweepNote();
      els.chartLoading.hidden = false;
      fetchSweep();
    });
    els.sweepTabs.appendChild(button);
  });
}

function updateSweepNote() {
  const label = SWEEP_DISPLAY[state.sweepFeature] || state.sweepFeature;
  els.sweepNote.textContent = `Probabilities as ${label} varies. All other values are held fixed.`;
}

async function fetchSweep() {
  if (!state.meta) return;
  const sequence = ++state.sweepSeq;
  els.chartLoading.hidden = false;

  try {
    const data = await fetchJSON("/api/sweep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature: state.sweepFeature,
        features: collectFeatures(),
        points: 52,
      }),
    });
    if (sequence !== state.sweepSeq) return;
    state.sweep = data;
    els.chartLoading.hidden = true;
    renderChart(data, { animate: true });
  } catch (error) {
    if (sequence !== state.sweepSeq) return;
    console.error(error);
    els.chartLoading.hidden = true;
  }
}

function renderChart(data, { animate = true } = {}) {
  if (!data || !els.chartCanvas) return;
  hideChartHover();
  const width = Math.max(280, els.chartCanvas.clientWidth || els.chartCanvas.parentElement?.clientWidth || 520);
  const height = 152;
  const margin = { top: 8, right: 8, bottom: 22, left: 30 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = data.values;
  const count = values.length;
  const classes = state.displayOrder.filter((key) => data.series[key]);
  const currentValue = Number(collectFeatures()[data.feature]);

  const xOf = (index) => margin.left + (index / Math.max(1, count - 1)) * plotWidth;
  const yOf = (value) => margin.top + (1 - clamp(value, 0, 1)) * plotHeight;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((tick) => {
      const y = yOf(tick);
      return `
        <line class="chart-grid-line" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}"></line>
        <text class="chart-grid-label" x="${margin.left - 7}" y="${y + 3}" text-anchor="end">${Math.round(tick * 100)}</text>`;
    })
    .join("");

  const tickIndices = count > 2 ? [0, Math.floor((count - 1) / 2), count - 1] : [0, count - 1];
  const xTicks = tickIndices
    .map((index, position) => {
      const x = xOf(index);
      const anchor = position === 0 ? "start" : position === tickIndices.length - 1 ? "end" : "middle";
      return `<text class="chart-grid-label" x="${x}" y="${height - 6}" text-anchor="${anchor}">${formatCompact(values[index])}</text>`;
    })
    .join("");

  const paths = classes
    .map((key) => {
      const points = data.series[key].map((value, index) => `${xOf(index).toFixed(2)},${yOf(value).toFixed(2)}`);
      const d = `M ${points.join(" L ")}`;
      return `<path class="chart-path" data-class="${cssEscape(key)}" d="${d}" style="stroke:${classVar(key)}"></path>`;
    })
    .join("");

  let marker = "";
  if (Number.isFinite(currentValue)) {
    const ratio = sweepRatio(data, currentValue);
    if (ratio >= 0 && ratio <= 1) {
      const x = margin.left + ratio * plotWidth;
      const nearest = Math.round(ratio * (count - 1));
      const dots = classes
        .map((key) => {
          const value = data.series[key][nearest];
          return `<circle class="chart-current-dot" cx="${x}" cy="${yOf(value)}" r="3" style="fill:${classVar(key)}"></circle>`;
        })
        .join("");
      marker = `<line class="chart-current-line" x1="${x}" y1="${margin.top}" x2="${x}" y2="${margin.top + plotHeight}"></line>${dots}`;
    }
  }

  const hoverDots = classes
    .map(
      (key) =>
        `<circle class="chart-hover-dot" data-class="${cssEscape(key)}" r="2.7" style="fill:${classVar(key)}" visibility="hidden"></circle>`
    )
    .join("");

  const svg = `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
      <g class="chart-grid">${grid}</g>
      <g class="chart-lines">${paths}</g>
      ${marker}
      <line class="chart-hover-line" x1="0" y1="${margin.top}" x2="0" y2="${margin.top + plotHeight}" visibility="hidden"></line>
      ${hoverDots}
      <g class="chart-x-ticks">${xTicks}</g>
      <rect class="chart-hit" x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}"></rect>
    </svg>`;

  els.chartCanvas.innerHTML = svg;
  els.chartLegend.innerHTML = classes
    .map(
      (key) =>
        `<span class="legend-item" style="--class-color:${classVar(key)}"><span class="legend-swatch"></span>${classLabel(key)}</span>`
    )
    .join("");

  state.chartGeometry = {
    width,
    height,
    margin,
    plotWidth,
    plotHeight,
    values,
    count,
    classes,
    data,
    xOf,
    yOf,
  };

  const svgElement = $("svg", els.chartCanvas);
  const hit = $(".chart-hit", els.chartCanvas);
  if (hit && svgElement) {
    hit.addEventListener("pointermove", (event) => handleChartHover(event, svgElement));
    hit.addEventListener("pointerleave", hideChartHover);
  }

  els.chartCanvas.setAttribute(
    "aria-label",
    `Probability curves for ${SWEEP_DISPLAY[data.feature] || data.feature}, from ${formatCompact(values[0])} to ${formatCompact(values[count - 1])}.`
  );

  if (animate && !prefersReducedMotion()) {
    $$(".chart-path", els.chartCanvas).forEach((path, index) => {
      const length = path.getTotalLength();
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length}`;
      path.style.transition = "none";
      window.requestAnimationFrame(() => {
        path.style.transition = `stroke-dashoffset 0.75s var(--ease) ${index * 0.04}s`;
        path.style.strokeDashoffset = "0";
      });
    });
  }
}

function sweepRatio(data, value) {
  const meta = data.meta;
  if (!meta) return -1;
  if (meta.scale === "log") {
    if (value <= 0) return -1;
    return (Math.log(value) - Math.log(meta.min)) / (Math.log(meta.max) - Math.log(meta.min));
  }
  return (value - meta.min) / (meta.max - meta.min);
}

function handleChartHover(event, svgElement) {
  const geometry = state.chartGeometry;
  if (!geometry) return;

  const rect = svgElement.getBoundingClientRect();
  const scaleX = geometry.width / rect.width;
  const localX = (event.clientX - rect.left) * scaleX;
  const ratio = clamp((localX - geometry.margin.left) / geometry.plotWidth, 0, 1);
  const index = Math.round(ratio * (geometry.count - 1));
  const x = geometry.xOf(index);

  const line = $(".chart-hover-line", svgElement);
  line.setAttribute("x1", x);
  line.setAttribute("x2", x);
  line.setAttribute("visibility", "visible");

  const dots = $$(".chart-hover-dot", svgElement);
  geometry.classes.forEach((key, classIndex) => {
    const value = geometry.data.series[key][index];
    const dot = dots[classIndex];
    if (!dot) return;
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", geometry.yOf(value));
    dot.setAttribute("visibility", "visible");
  });

  const rows = geometry.classes
    .map((key) => {
      const value = geometry.data.series[key][index];
      return `<span class="tooltip-row"><span>${classLabel(key)}</span><span>${percent(value)}</span></span>`;
    })
    .join("");

  const featureValue = geometry.values[index];
  const unit = geometry.data.meta?.unit ? ` ${geometry.data.meta.unit}` : "";
  els.chartTooltip.innerHTML = `<span class="tooltip-value">${formatNumber(featureValue, 2)}${unit}</span>${rows}`;
  els.chartTooltip.hidden = false;

  const localY = (event.clientY - rect.top) * (geometry.height / rect.height);
  const offsetLeft = els.chartCanvas.offsetLeft;
  const offsetTop = els.chartCanvas.offsetTop;
  const left = clamp(offsetLeft + x, 58, offsetLeft + geometry.width - 58);
  els.chartTooltip.style.left = `${left}px`;
  els.chartTooltip.style.top = `${clamp(offsetTop + localY - 12, 18, offsetTop + geometry.height - 20)}px`;
}

function hideChartHover() {
  if (!els.chartCanvas) return;
  const line = $(".chart-hover-line", els.chartCanvas);
  if (line) line.setAttribute("visibility", "hidden");
  $$(".chart-hover-dot", els.chartCanvas).forEach((dot) => dot.setAttribute("visibility", "hidden"));
  els.chartTooltip.hidden = true;
}

function setupChartResize() {
  if (!("ResizeObserver" in window)) return;
  const observer = new ResizeObserver(() => {
    if (!state.sweep) return;
    window.cancelAnimationFrame(state.chartResizeFrame);
    state.chartResizeFrame = window.requestAnimationFrame(() => {
      renderChart(state.sweep, { animate: false });
    });
  });
  observer.observe(els.chartCanvas);
}

/* ---------------------------------------------------------------------------
   Model section
--------------------------------------------------------------------------- */

function renderModel(meta) {
  const model = meta.model;

  els.heroArtifactName.textContent = model.artifact;
  els.heroStats.innerHTML = `
    <div class="artifact-stat"><strong>${formatNumber(model.iterations, 0)}</strong><span>trees</span></div>
    <div class="artifact-stat"><strong>${formatNumber(model.features, 0)}</strong><span>features</span></div>
    <div class="artifact-stat"><strong>${formatNumber(model.classes, 0)}</strong><span>classes</span></div>`;

  const stats = [
    {
      label: "Estimator",
      value: "Gradient boosted",
      foot: model.estimator,
    },
    {
      label: "Boosting rounds",
      value: formatNumber(model.iterations, 0),
      foot: `learning rate ${model.learning_rate}`,
    },
    {
      label: "Input features",
      value: formatNumber(model.features, 0),
      foot: "standardized at inference",
    },
    {
      label: "Discovery classes",
      value: formatNumber(model.classes, 0),
      foot: meta.classes.map((item) => classLabel(item.key)).join(" · "),
    },
  ];

  els.statGrid.innerHTML = stats
    .map(
      (stat) => `
      <div class="stat-card">
        <span class="stat-label">${stat.label}</span>
        <strong class="stat-value">${stat.value}</strong>
        <span class="stat-foot">${stat.foot}</span>
      </div>`
    )
    .join("");

  renderImportance(meta.importance);
  renderClasses(meta.classes);
  renderFacts(model);
}

function renderImportance(importance) {
  if (!importance.length) {
    els.importanceList.innerHTML = `<p class="panel-note">Feature importance could not be read from this artifact.</p>`;
    return;
  }

  const rows = importance.slice(0, 8);
  const maxShare = Math.max(...rows.map((row) => row.share), 0.0001);

  els.importanceList.innerHTML = rows
    .map((row, index) => {
      const width = clamp((row.share / maxShare) * 100, 1.5, 100);
      return `
        <div class="importance-row" style="animation-delay: ${index * 0.03}s">
          <span class="importance-name" title="${row.label}">${row.label}</span>
          <span class="importance-track"><span class="importance-fill" style="width: ${width}%"></span></span>
          <span class="importance-share">${(row.share * 100).toFixed(1)}%</span>
        </div>`;
    })
    .join("");
}

function renderClasses(classes) {
  const order = PREFERRED_ORDER.filter((key) => classes.some((item) => item.key === key));
  const ordered = order.length ? order : classes.map((item) => item.key);

  els.classList.innerHTML = ordered
    .map((key) => {
      const meta = classes.find((item) => item.key === key);
      return `
        <div class="class-row" style="--class-color: ${classVar(key)}">
          <span class="class-icon">${CLASS_ICONS[key] || CLASS_ICONS.Other}</span>
          <div>
            <div class="class-name">${classLabel(key)}</div>
            <div class="class-tagline">${meta?.tagline || ""}</div>
          </div>
        </div>`;
    })
    .join("");
}

function renderFacts(model) {
  const facts = [
    ["Artifact", model.artifact],
    ["Size", `${model.artifact_size_mb} MB`],
    ["Learning rate", model.learning_rate],
    ["Max leaves", model.max_leaf_nodes],
    ["Random state", model.random_state],
    ["Standardizer", "StandardScaler"],
  ];

  els.modelFacts.innerHTML = facts
    .map(
      ([label, value]) => `
      <div class="fact-row">
        <span class="fact-label">${label}</span>
        <span class="fact-value" title="${value}">${value}</span>
      </div>`
    )
    .join("");
}

/* ---------------------------------------------------------------------------
   Init
--------------------------------------------------------------------------- */

async function init() {
  setupShell();
  setupTheme();
  setupAdvanced();
  setupChartResize();

  els.resetButton.addEventListener("click", () => {
    state.applyingPreset = true;
    state.activePreset = null;
    clearAdvanced({ silent: true });
    Object.entries(state.meta.defaults).forEach(([name, value]) => {
      setFieldValue(name, value, { silent: true });
    });
    state.applyingPreset = false;
    updatePresetSelection();
    predict();
  });

  els.form.addEventListener("submit", (event) => event.preventDefault());
  setupTopbarScroll();
  setupReveal();

  try {
    const meta = await fetchJSON("/api/meta");
    state.meta = meta;
    state.values = { ...meta.defaults };
    state.displayOrder = PREFERRED_ORDER.filter((key) => meta.classes.some((item) => item.key === key));

    renderPresets(meta.presets);
    renderPrimaryFields(meta.primaryFields);
    setupSweepTabs(meta.sweeps);
    updateSweepNote();
    renderModel(meta);

    els.modelStatus.classList.remove("is-error");
    els.modelStatusText.textContent = "Model ready";

    await predict();
    fetchSweep();
  } catch (error) {
    console.error(error);
    els.modelStatus.classList.add("is-error");
    els.modelStatusText.textContent = "Model unavailable";
    els.predictionLabel.textContent = "Not connected";
    els.predictionBlurb.textContent = "Start the Flask server to load the bundled artifact.";
    els.livePill.classList.remove("is-busy");
    els.liveText.textContent = "offline";
  }
}

function setupTopbarScroll() {
  const topbar = $(".topbar");
  const onScroll = () => {
    topbar.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function setupReveal() {
  const targets = $$(".section-block, .site-footer");
  targets.forEach((element) => element.classList.add("reveal"));

  if (!("IntersectionObserver" in window)) {
    targets.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );

  targets.forEach((element) => observer.observe(element));
}

document.addEventListener("DOMContentLoaded", init);
