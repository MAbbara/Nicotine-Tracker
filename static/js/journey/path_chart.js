/* The path chart: stepped plan descent rendered from the server-provided
   payload (see routes/journey.py::_plan_presentation.path_payload).

   payload = {
     start: 'YYYY-MM-DD' | null,
     end: 'YYYY-MM-DD',
     today: 'YYYY-MM-DD',
     endTarget: number | null,
     stages: [{ start, end, pouches: number|null, mg: string|null, revision }],
   }

   createPathChart(figure, payload) -> { setPreview, redraw, destroy }
   setPreview accepts chart stages or serializer stages
   ({ start_date, end_date, target_pouches }) and draws a terracotta overlay. */

const SVGNS = 'http://www.w3.org/2000/svg';
const DAY_MS = 86400000;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const parseDay = (s) => Date.parse(`${s}T00:00:00Z`);
const toISO = (ms) => new Date(ms).toISOString().slice(0, 10);
const fmtShort = (s) => {
  const d = new Date(parseDay(s));
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
};
const fmtLong = (s) => {
  const d = new Date(parseDay(s));
  return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]}`;
};

export { fmtShort as fmtDayShort, fmtLong as fmtDayLong, parseDay as parseISODay };

function el(tag, attrs) {
  const node = document.createElementNS(SVGNS, tag);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  return node;
}

function normalizeStages(stages) {
  return (stages || [])
    .map((st) => ({
      start: st.start || st.start_date,
      end: st.end || st.end_date,
      pouches: st.pouches !== undefined ? st.pouches : st.target_pouches,
    }))
    .filter((st) => st.start && st.end && st.pouches !== null && st.pouches !== undefined);
}

export function createPathChart(figure, payload) {
  const svg = figure.querySelector('[data-path-chart]');
  const tip = figure.querySelector('[data-chart-tooltip]');
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stages = normalizeStages(payload.stages);
  const valid = payload.start && payload.end && stages.length > 0;
  const span = valid
    ? Math.max(1, Math.round((parseDay(payload.end) - parseDay(payload.start)) / DAY_MS))
    : 0;

  let pinned = false;
  const showTip = (button) => {
    tip.textContent = button.dataset.tipText;
    const x = Number(button.dataset.tipX);
    const y = Number(button.dataset.tipY);
    const tw = 220;
    tip.style.left = `${Math.min(Math.max(8, x - tw / 2), 760 - tw - 8)}px`;
    tip.style.top = `${Math.max(0, y - 66)}px`;
    tip.hidden = false;
  };
  const hideTip = () => { tip.hidden = true; pinned = false; };
  const onKeydown = (event) => { if (event.key === 'Escape') hideTip(); };
  const onPointerDown = (event) => {
    if (pinned && !(event.target.closest && event.target.closest('.path-hotspot'))) hideTip();
  };
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('pointerdown', onPointerDown);

  function render(previewStages) {
    svg.textContent = '';
    figure.querySelectorAll('.path-hotspot').forEach((b) => b.remove());
    hideTip();
    if (!valid) return;

    const reduced = reducedMotion();
    const M = { top: 30, right: 46, bottom: 42, left: 38 };
    const W = 760;
    const H = 340;
    const IW = W - M.left - M.right;
    const IH = H - M.top - M.bottom;
    const dayIndex = (s) => Math.round((parseDay(s) - parseDay(payload.start)) / DAY_MS);
    const xIndex = (i) => M.left + Math.min(Math.max(i, 0), span) * (IW / span);
    const X = (s) => xIndex(dayIndex(s));
    const maxPouches = Math.max(8, ...stages.map((s) => s.pouches));
    const Y = (p) => M.top + (1 - p / maxPouches) * IH;
    const todayX = xIndex(dayIndex(payload.today));
    const stageX2 = (st) => xIndex(dayIndex(st.end) + 1);

    // grid + y labels (pouch counts)
    for (let p = 0; p <= maxPouches; p += 2) {
      svg.appendChild(el('line', { x1: M.left, x2: W - M.right, y1: Y(p), y2: Y(p), class: 'chart-grid' }));
      if (p > 0) {
        const t = el('text', { x: M.left - 8, y: Y(p) + 4, 'text-anchor': 'end', class: 'chart-axis-label' });
        t.textContent = p;
        svg.appendChild(t);
      }
    }
    // x labels (proportional, deduped)
    const tickIdx = [...new Set([0, Math.round(span * 0.27), Math.round(span * 0.55), Math.round(span * 0.83), span])].sort((a, b) => a - b);
    tickIdx.forEach((i) => {
      const t = el('text', { x: xIndex(i), y: H - 14, 'text-anchor': 'middle', class: 'chart-axis-label' });
      t.textContent = fmtShort(toISO(parseDay(payload.start) + i * DAY_MS));
      svg.appendChild(t);
    });

    const pastCls = `chart-step chart-step--past${reduced ? '' : ' draw-in'}`;
    const futureCls = `chart-step chart-step--future${reduced ? '' : ' fade-in'}`;
    const addSeg = (x1, y1, x2, y2, cls, draw) => {
      const d = y1 === y2 ? `M ${x1} ${y1} H ${x2}` : `M ${x1} ${y1} V ${y2}`;
      const attrs = { d, class: cls, 'data-chart-step': '' };
      if (draw) attrs.pathLength = '1';
      svg.appendChild(el('path', attrs));
    };

    // stage steps, split at today
    stages.forEach((st, i) => {
      const x1 = X(st.start);
      const x2 = stageX2(st);
      const y = Y(st.pouches);
      if (x1 < todayX && x2 > todayX) {
        addSeg(x1, y, todayX, y, pastCls, !reduced);
        addSeg(todayX, y, x2, y, futureCls, false);
      } else if (x2 <= todayX) {
        addSeg(x1, y, x2, y, pastCls, !reduced);
      } else {
        addSeg(x1, y, x2, y, futureCls, false);
      }
      const next = stages[i + 1];
      if (next) {
        const xr = X(next.start);
        const isPast = xr <= todayX;
        addSeg(xr, y, xr, Y(next.pouches), isPast ? pastCls : futureCls, !reduced && isPast);
      }
    });

    // preview overlay (proposed future)
    if (previewStages && previewStages.length) {
      let d = '';
      previewStages.forEach((st, i) => {
        const x1 = Math.min(X(st.start), W - M.right);
        const x2 = stageX2(st);
        const y = Y(st.pouches);
        d += `M ${x1} ${y} H ${x2} `;
        const next = previewStages[i + 1];
        if (next) d += `M ${Math.min(X(next.start), W - M.right)} ${y} V ${Y(next.pouches)} `;
      });
      svg.appendChild(el('path', { d, class: `chart-preview-step${reduced ? '' : ' fade-in'}`, 'data-preview-path': '' }));
    }

    // milestones (step-down dates) as real buttons
    stages.forEach((st, i) => {
      if (i === 0) return;
      const x = X(st.start);
      const y = Y(st.pouches);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'path-hotspot';
      button.dataset.milestone = st.start;
      button.dataset.tipText = `${fmtShort(st.start)} · steps down to ${st.pouches} pouches`;
      button.dataset.tipX = x;
      button.dataset.tipY = y;
      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
      button.setAttribute('aria-label', `${fmtLong(st.start)}: target steps down to ${st.pouches} pouches`);
      const diamond = document.createElement('span');
      diamond.className = 'path-hotspot__diamond';
      diamond.setAttribute('aria-hidden', 'true');
      button.appendChild(diamond);
      button.addEventListener('focus', () => showTip(button));
      button.addEventListener('blur', () => { if (!pinned) hideTip(); });
      button.addEventListener('pointerenter', () => showTip(button));
      button.addEventListener('pointerleave', () => { if (!pinned) hideTip(); });
      button.addEventListener('click', () => { pinned = true; showTip(button); });
      figure.appendChild(button);
    });

    // today rule, dot, label
    svg.appendChild(el('line', { x1: todayX, x2: todayX, y1: M.top, y2: H - M.bottom, class: 'chart-today-rule' }));
    const current = stages.find((s) => dayIndex(s.start) <= dayIndex(payload.today) && dayIndex(payload.today) <= dayIndex(s.end));
    if (current) svg.appendChild(el('circle', { cx: todayX, cy: Y(current.pouches), r: 4.5, class: 'chart-today-dot' }));
    const todayLabel = el('text', { x: todayX, y: M.top - 10, 'text-anchor': 'middle', class: 'chart-today-label' });
    todayLabel.textContent = 'Today';
    svg.appendChild(todayLabel);

    // end flag
    const last = stages[stages.length - 1];
    const ex = X(payload.end);
    const ey = Y(last.pouches);
    svg.appendChild(el('line', { x1: ex, x2: ex, y1: ey - 16, y2: ey, class: 'chart-flag-pole' }));
    svg.appendChild(el('path', { d: `M ${ex} ${ey - 16} l 10 4 l -10 4 Z`, class: 'chart-flag' }));
    const flagLabel = el('text', { x: Math.min(ex + 10, W - 4), y: ey - 24, 'text-anchor': 'end', class: 'chart-flag-label' });
    flagLabel.textContent = `${fmtShort(payload.end)} · ${last.pouches} pouches`;
    svg.appendChild(flagLabel);

    svg.setAttribute(
      'aria-label',
      `Stepped chart of daily pouch targets from ${stages[0].pouches} on ${fmtLong(stages[0].start)} `
      + `down to ${last.pouches} on ${fmtLong(payload.end)}. Today, ${fmtLong(payload.today)}, `
      + `sits on the ${(current || last).pouches}-pouch step.`,
    );
  }

  let preview = null;
  render(null);

  return {
    setPreview(stagesOrNull) {
      preview = stagesOrNull ? normalizeStages(stagesOrNull) : null;
      render(preview);
    },
    redraw() {
      render(preview);
    },
    destroy() {
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('pointerdown', onPointerDown);
    },
  };
}
