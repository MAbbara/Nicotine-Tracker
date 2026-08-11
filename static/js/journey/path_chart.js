const SVG_NS = 'http://www.w3.org/2000/svg';
const DAY_MS = 86_400_000;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const parseISODay = (value) => Date.parse(`${value}T00:00:00Z`);
const toISODate = (value) => new Date(value).toISOString().slice(0, 10);
export const fmtDayShort = (value) => {
  const date = new Date(parseISODay(value));
  return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}`;
};
export const fmtDayLong = (value) => {
  const date = new Date(parseISODay(value));
  return `${date.getUTCDate()} ${MONTHS_LONG[date.getUTCMonth()]}`;
};

function svgElement(tag, attributes) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

export function normalizeStages(stages = []) {
  return stages.map((stage) => {
    const rawMg = stage.mg ?? stage.nicotine_ceiling_mg;
    const normalized = {
      start: stage.start ?? stage.start_date,
      end: stage.end ?? stage.end_date,
      mg: rawMg === null || rawMg === undefined ? Number.NaN : Number(rawMg),
    };
    const milestoneLabel = stage.milestoneLabel ?? stage.milestone_label;
    if (milestoneLabel) normalized.milestoneLabel = String(milestoneLabel);
    return normalized;
  }).filter((stage) => (
    stage.start && stage.end && Number.isFinite(stage.mg) && stage.mg >= 0
  ));
}

export function resolveChartDomain(payload, previewStages = []) {
  const starts = [payload?.start, ...previewStages.map((stage) => stage.start)]
    .filter((value) => Number.isFinite(parseISODay(value)));
  const ends = [payload?.end, ...previewStages.map((stage) => stage.end)]
    .filter((value) => Number.isFinite(parseISODay(value)));
  const start = starts.sort((left, right) => parseISODay(left) - parseISODay(right))[0] || null;
  const end = ends.sort((left, right) => parseISODay(right) - parseISODay(left))[0] || null;
  const today = parseISODay(payload?.today);
  return {
    start,
    end,
    todayInRange: Boolean(
      start && end && Number.isFinite(today)
      && today >= parseISODay(start) && today <= parseISODay(end)
    ),
  };
}

export function milestonePresentation(previous, stage) {
  const changed = previous.mg !== stage.mg;
  const verb = changed ? 'changes to' : 'continues at';
  return {
    tip: `${fmtDayShort(stage.start)} · ceiling ${verb} ${stage.mg.toFixed(2)} mg`,
    accessibleName: `${fmtDayLong(stage.start)}: nicotine ceiling ${verb} ${stage.mg.toFixed(2)} mg`,
    changed,
  };
}

export function createPathChart(figure, payload) {
  const svg = figure?.querySelector('[data-path-chart]');
  const tooltip = figure?.querySelector('[data-chart-tooltip]');
  if (!figure || !svg || !tooltip) return null;

  const stages = normalizeStages(payload?.stages);
  const valid = payload?.start && payload?.end && stages.length > 0;
  const listeners = [];
  let preview = null;
  let pinned = false;

  const listen = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push([target, type, handler]);
  };
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hideTooltip = () => {
    tooltip.hidden = true;
    pinned = false;
  };
  const showTooltip = (button) => {
    tooltip.textContent = button.dataset.tipText;
    const x = Number(button.dataset.tipX);
    const y = Number(button.dataset.tipY);
    const width = 220;
    tooltip.style.left = `${Math.min(Math.max(8, x - width / 2), 760 - width - 8)}px`;
    tooltip.style.top = `${Math.max(0, y - 66)}px`;
    tooltip.hidden = false;
  };

  listen(document, 'keydown', (event) => {
    if (event.key === 'Escape') hideTooltip();
  });
  listen(document, 'pointerdown', (event) => {
    if (pinned && !event.target.closest?.('.path-hotspot')) hideTooltip();
  });

  function render() {
    svg.replaceChildren();
    figure.querySelectorAll('.path-hotspot').forEach((button) => button.remove());
    hideTooltip();
    if (!valid) return;

    const domain = resolveChartDomain(payload, preview || []);
    if (!domain.start || !domain.end) return;
    const margin = { top: 30, right: 46, bottom: 42, left: 54 };
    const width = 760;
    const height = 340;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const span = Math.max(1, Math.round((parseISODay(domain.end) - parseISODay(domain.start)) / DAY_MS));
    const dayIndex = (value) => Math.round((parseISODay(value) - parseISODay(domain.start)) / DAY_MS);
    const xAtIndex = (index) => margin.left + Math.min(Math.max(index, 0), span) * (innerWidth / span);
    const xFor = (value) => xAtIndex(dayIndex(value));
    const stageEndX = (stage) => xAtIndex(dayIndex(stage.end) + 1);
    const maximum = Math.max(1, ...stages.map((stage) => stage.mg), ...(preview || []).map((stage) => stage.mg));
    const yFor = (mg) => margin.top + (1 - (mg / maximum)) * innerHeight;
    const todayIndex = dayIndex(payload.today);
    const todayX = xAtIndex(todayIndex);
    const motion = reducedMotion() ? '' : ' draw-in';

    const tickStep = maximum <= 8 ? 2 : Math.ceil(maximum / 4);
    for (let mg = 0; mg <= maximum + tickStep / 2; mg += tickStep) {
      const y = yFor(Math.min(mg, maximum));
      svg.appendChild(svgElement('line', {
        x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: 'chart-grid',
      }));
      const label = svgElement('text', {
        x: margin.left - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-axis-label',
      });
      label.textContent = `${Math.min(mg, maximum).toFixed(mg % 1 ? 1 : 0)} mg`;
      svg.appendChild(label);
      if (mg >= maximum) break;
    }

    const tickIndexes = [...new Set([0, Math.round(span * 0.27), Math.round(span * 0.55), Math.round(span * 0.83), span])];
    tickIndexes.sort((a, b) => a - b).forEach((index) => {
      const label = svgElement('text', {
        x: xAtIndex(index), y: height - 14, 'text-anchor': 'middle', class: 'chart-axis-label',
      });
      label.textContent = fmtDayShort(toISODate(parseISODay(domain.start) + index * DAY_MS));
      svg.appendChild(label);
    });

    const addSegment = (x1, y1, x2, y2, className) => {
      const path = svgElement('path', {
        d: y1 === y2 ? `M ${x1} ${y1} H ${x2}` : `M ${x1} ${y1} V ${y2}`,
        class: className,
        'data-chart-step': '',
      });
      if (!reducedMotion()) path.setAttribute('pathLength', '1');
      svg.appendChild(path);
    };

    stages.forEach((stage, index) => {
      const x1 = xFor(stage.start);
      const x2 = stageEndX(stage);
      const y = yFor(stage.mg);
      if (x1 < todayX && x2 > todayX) {
        addSegment(x1, y, todayX, y, `chart-step chart-step--past${motion}`);
        addSegment(todayX, y, x2, y, 'chart-step chart-step--future');
      } else {
        const side = x2 <= todayX ? `chart-step chart-step--past${motion}` : 'chart-step chart-step--future';
        addSegment(x1, y, x2, y, side);
      }
      const next = stages[index + 1];
      if (next) {
        const transitionX = xFor(next.start);
        addSegment(
          transitionX,
          y,
          transitionX,
          yFor(next.mg),
          transitionX <= todayX ? `chart-step chart-step--past${motion}` : 'chart-step chart-step--future',
        );
      }
    });

    if (preview?.length) {
      let data = '';
      preview.forEach((stage, index) => {
        const x1 = Math.min(xFor(stage.start), width - margin.right);
        const x2 = stageEndX(stage);
        const y = yFor(stage.mg);
        data += `M ${x1} ${y} H ${x2} `;
        const next = preview[index + 1];
        if (next) data += `M ${Math.min(xFor(next.start), width - margin.right)} ${y} V ${yFor(next.mg)} `;
      });
      svg.appendChild(svgElement('path', {
        d: data, class: 'chart-preview-step', 'data-preview-path': '',
      }));
    }

    const milestoneCandidates = stages.slice(1).map((stage, index) => ({
      stage,
      previous: stages[index],
      x: xFor(stage.start),
    }));
    const visibleMilestones = [];
    for (const candidate of milestoneCandidates) {
      const previous = visibleMilestones.at(-1);
      if (!previous || candidate.x - previous.x >= 48) visibleMilestones.push(candidate);
    }
    visibleMilestones.forEach(({ previous, stage, x }) => {
      const button = document.createElement('button');
      const y = yFor(stage.mg);
      const presentation = milestonePresentation(previous, stage);
      button.type = 'button';
      button.className = 'path-hotspot';
      button.dataset.milestone = stage.start;
      button.dataset.tipText = presentation.tip;
      button.dataset.tipX = x;
      button.dataset.tipY = y;
      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
      button.setAttribute('aria-label', presentation.accessibleName);
      const marker = document.createElement('span');
      marker.className = 'path-hotspot__diamond';
      marker.setAttribute('aria-hidden', 'true');
      button.appendChild(marker);
      listen(button, 'focus', () => showTooltip(button));
      listen(button, 'blur', () => { if (!pinned) hideTooltip(); });
      listen(button, 'pointerenter', () => showTooltip(button));
      listen(button, 'pointerleave', () => { if (!pinned) hideTooltip(); });
      listen(button, 'click', () => { pinned = true; showTooltip(button); });
      figure.appendChild(button);
    });

    if (domain.todayInRange) {
      svg.appendChild(svgElement('line', {
        x1: todayX, x2: todayX, y1: margin.top, y2: height - margin.bottom, class: 'chart-today-rule',
      }));
      const current = stages.find((stage) => dayIndex(stage.start) <= todayIndex
        && todayIndex <= dayIndex(stage.end));
      if (current) svg.appendChild(svgElement('circle', {
        cx: todayX, cy: yFor(current.mg), r: 4.5, class: 'chart-today-dot',
      }));
      const todayLabel = svgElement('text', {
        x: todayX, y: margin.top - 10, 'text-anchor': 'middle', class: 'chart-today-label',
      });
      todayLabel.textContent = 'Today';
      svg.appendChild(todayLabel);
    }

    const first = stages[0];
    const last = stages.at(-1);
    svg.setAttribute('aria-label', `Stepped chart of confirmed daily nicotine ceilings from ${first.mg.toFixed(2)} mg on ${fmtDayLong(first.start)} to ${last.mg.toFixed(2)} mg on ${fmtDayLong(payload.end)}.`);
  }

  render();
  return {
    setPreview(stagesOrNull) {
      preview = stagesOrNull ? normalizeStages(stagesOrNull) : null;
      render();
    },
    redraw: render,
    destroy() {
      listeners.splice(0).forEach(([target, type, handler]) => target.removeEventListener(type, handler));
      figure.querySelectorAll('.path-hotspot').forEach((button) => button.remove());
    },
  };
}
