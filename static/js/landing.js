/* Landing page interactions: entrance reveals + the live Today sketch.
   Progressive enhancement: without JS, all content stays visible. */
(function () {
  "use strict";

  document.documentElement.classList.add("landing-js");

  /* ---------- Entrance reveals ---------- */
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var riseEls = Array.prototype.slice.call(document.querySelectorAll(".landing-rise"));
  if (reduceMotion || !("IntersectionObserver" in window)) {
    riseEls.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    riseEls.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Live Today sketch ---------- */
  var PLAN = 6;
  var state = { count: 3, mg: 13.0, entries: 3 };
  var lastLog = null;
  var hideTimer = null;

  var sumCount = document.getElementById("sumCount");
  var toast = document.getElementById("undoToast");
  if (!sumCount || !toast) { return; }

  var sumMg = document.getElementById("sumMg");
  var sumEntries = document.getElementById("sumEntries");
  var toastTitle = document.getElementById("toastTitle");
  var toastSub = document.getElementById("toastSub");
  var toastRule = document.getElementById("toastRule");
  var toastUndo = document.getElementById("toastUndo");

  function paceLine() {
    if (state.count < PLAN) {
      return state.count + " of " + PLAN + " today — inside your plan";
    }
    if (state.count === PLAN) {
      return "6 of 6 — plan complete for today";
    }
    return state.count + " of " + PLAN + " — past the plan, noted without judgment";
  }

  function renderSummary() {
    sumCount.textContent = state.count;
    sumMg.textContent = state.mg.toFixed(1) + " mg";
    sumEntries.textContent = state.entries;
  }

  function showToast() {
    toast.hidden = false;
    toastRule.classList.remove("quick-log-undo__rule--running");
    void toastRule.offsetWidth; /* restart the countdown animation */
    toastRule.classList.add("quick-log-undo__rule--running");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideToast, 10000);
  }

  function hideToast() {
    toast.hidden = true;
    lastLog = null;
    clearTimeout(hideTimer);
  }

  function logPouch(brand, mg) {
    state.count += 1;
    state.mg += mg;
    state.entries += 1;
    lastLog = { brand: brand, mg: mg };
    renderSummary();
    toastTitle.textContent = brand + " · " + mg + " mg logged";
    toastSub.textContent = paceLine();
    showToast();
  }

  Array.prototype.forEach.call(document.querySelectorAll(".quick-pouch"), function (btn) {
    btn.addEventListener("click", function () {
      logPouch(btn.dataset.brand, parseFloat(btn.dataset.mg));
    });
  });

  toastUndo.addEventListener("click", function () {
    if (!lastLog) { hideToast(); return; }
    state.count -= 1;
    state.mg -= lastLog.mg;
    state.entries -= 1;
    renderSummary();
    hideToast();
  });

  /* ---------- Craving pause ---------- */
  var cravingBtn = document.getElementById("cravingBtn");
  var pausePanel = document.getElementById("pausePanel");
  var passedBtn = document.getElementById("passedBtn");
  var logAnywayBtn = document.getElementById("logAnywayBtn");
  var pauseResolved = document.getElementById("pauseResolved");

  cravingBtn.addEventListener("click", function () {
    var open = pausePanel.classList.toggle("is-open");
    cravingBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) { pauseResolved.textContent = ""; }
  });
  passedBtn.addEventListener("click", function () {
    pauseResolved.textContent = "Noted — that urge passed. That counts.";
  });
  logAnywayBtn.addEventListener("click", function () {
    logPouch("A pouch", 6);
    pauseResolved.textContent = "Logged. Honesty beats perfection.";
  });

  /* ---------- Craving intensity + triggers ---------- */
  var dots = Array.prototype.slice.call(document.querySelectorAll(".landing-dot"));
  var intensityValue = document.getElementById("intensityValue");
  dots.forEach(function (dot, i) {
    dot.addEventListener("click", function () {
      var level = i + 1;
      intensityValue.textContent = level;
      dots.forEach(function (d, j) {
        d.setAttribute("aria-pressed", j < level ? "true" : "false");
      });
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".landing-chip"), function (chip) {
    chip.addEventListener("click", function () {
      chip.setAttribute("aria-pressed", chip.getAttribute("aria-pressed") === "true" ? "false" : "true");
    });
  });

  renderSummary();
})();
