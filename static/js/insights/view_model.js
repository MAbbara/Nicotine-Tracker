function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value, maximumFractionDigits = 1) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(
    finiteNumber(value),
  );
}

function pluralize(value, singular, plural = `${singular}s`) {
  return `${formatNumber(value)} ${Number(value) === 1 ? singular : plural}`;
}

function leadingEntry(values) {
  return Object.entries(values || {}).reduce((leader, [label, rawValue]) => {
    const value = finiteNumber(rawValue);
    if (value <= 0 || (leader && value <= leader.value)) return leader;
    return { label, value };
  }, null);
}

function leadingHeatmapEntry(series) {
  return (series || []).reduce((leader, daySeries) => {
    return (daySeries.data || []).reduce((dayLeader, point, index) => {
      const value = finiteNumber(typeof point === 'object' ? point.y : point);
      if (value <= 0 || (dayLeader && value <= dayLeader.value)) return dayLeader;
      const hour = typeof point === 'object' && point.x != null
        ? String(point.x)
        : `${String(index).padStart(2, '0')}:00`;
      return {
        day: String(daySeries.name || 'Unknown day'),
        hour,
        value,
      };
    }, leader);
  }, null);
}

function comparisonHeadline(data, rangeDays) {
  const comparison = data.comparison || {};
  const total = finiteNumber(comparison.current_total, finiteNumber(data.total_pouches));
  const observedDays = finiteNumber(data.observed_days);

  if (!comparison.available) {
    return `You logged ${pluralize(total, 'pouch', 'pouches')} across ${pluralize(observedDays, 'day')}.`;
  }

  if (comparison.direction === 'steady') {
    return `Your use was steady compared with the previous ${pluralize(rangeDays, 'day')}.`;
  }

  const percent = Number(comparison.percent_change);
  if (comparison.percent_change != null && Number.isFinite(percent)) {
    const direction = comparison.direction === 'down' ? 'less' : 'more';
    return `You used ${formatNumber(Math.abs(percent))}% ${direction} than the previous ${pluralize(rangeDays, 'day')}.`;
  }

  if (finiteNumber(comparison.previous_total) === 0 && total > 0) {
    return `You logged ${pluralize(total, 'pouch', 'pouches')}; the previous ${pluralize(rangeDays, 'day')} had none.`;
  }

  return `You logged ${pluralize(total, 'pouch', 'pouches')} across ${pluralize(observedDays, 'day')}.`;
}

function comparisonInterpretation(data) {
  const comparison = data.comparison || {};
  if (!comparison.available) {
    return 'This range gives you a useful baseline. Another complete range will make direction clearer.';
  }
  if (comparison.direction === 'down') {
    return 'Your recent pattern is moving in the same direction as your plan. Keep the part of your routine that helped.';
  }
  if (comparison.direction === 'up') {
    return 'This is useful context, not a verdict. Look for what made this range harder, then choose one adjustment.';
  }
  return 'A consistent range gives you a clear baseline for the next adjustment.';
}

function patternSection({ available, values, heading, availableCopy, unavailableCopy }) {
  const leader = available ? leadingEntry(values) : null;
  return {
    available: Boolean(leader),
    heading,
    leadingLabel: leader?.label || null,
    leadingValue: leader?.value || 0,
    interpretation: leader ? availableCopy(leader) : unavailableCopy,
  };
}

export function buildInsightsViewModel(data = {}, rangeDays = 30) {
  const range = Math.max(1, Math.trunc(finiteNumber(data.range_days, rangeDays || 30)));
  const total = finiteNumber(data.comparison?.current_total, finiteNumber(data.total_pouches));
  const observedDays = finiteNumber(data.observed_days);
  const logCount = finiteNumber(data.log_count);
  const sufficiency = data.data_sufficiency || {};
  const state = logCount <= 0 ? 'empty' : sufficiency.trend ? 'ready' : 'sparse';

  let headline;
  let interpretation;
  if (state === 'empty') {
    headline = 'Your patterns will appear after your first log.';
    interpretation = 'Start with one honest entry. Insights becomes more useful as your day-to-day pattern takes shape.';
  } else if (state === 'sparse') {
    headline = 'Keep logging to reveal a reliable direction.';
    interpretation = `You logged ${pluralize(total, 'pouch', 'pouches')} across ${pluralize(observedDays, 'day')}. Continue logging so this view can compare complete patterns.`;
  } else {
    headline = comparisonHeadline(data, range);
    interpretation = comparisonInterpretation(data);
  }

  const timePattern = patternSection({
    available: Boolean(sufficiency.time_pattern),
    values: data.consumption_by_time_of_day,
    heading: 'When it happens',
    availableCopy: ({ label }) => `${label} is your most active part of the day. Plan support just before it begins.`,
    unavailableCopy: 'Keep logging throughout the day to reveal a dependable time pattern.',
  });
  const productPattern = patternSection({
    available: Boolean(sufficiency.brand_pattern),
    values: data.brand_analysis,
    heading: 'What you reach for',
    availableCopy: ({ label }) => `${label} appears most often in this range. Use that context when you adjust your plan.`,
    unavailableCopy: 'A few more product logs will reveal what you reach for most often.',
  });
  const weeklyPattern = patternSection({
    available: Boolean(sufficiency.trend),
    values: data.consumption_by_day_of_week,
    heading: 'Weekly pattern',
    availableCopy: ({ label }) => `${label} has the most logged pouches in this range. Use it as a cue to plan support, not a verdict.`,
    unavailableCopy: 'Log across more complete days to reveal a dependable weekly pattern.',
  });
  const hourlyLeader = sufficiency.heatmap
    ? leadingHeatmapEntry(data.heatmap_data)
    : null;
  const hourlyDetail = {
    available: Boolean(hourlyLeader),
    heading: 'Day and hour detail',
    leadingLabel: hourlyLeader ? `${hourlyLeader.day} at ${hourlyLeader.hour}` : null,
    leadingValue: hourlyLeader?.value || 0,
    interpretation: hourlyLeader
      ? `${hourlyLeader.day} around ${hourlyLeader.hour} has the highest logged use in this detail. Consider support before that time.`
      : 'Log across more days and times to reveal a dependable hourly pattern.',
  };

  return {
    state,
    headline,
    interpretation,
    metrics: [
      {
        key: 'current-use',
        label: `Pouches in ${pluralize(range, 'day')}`,
        value: formatNumber(total),
      },
      {
        key: 'daily-average',
        label: 'Daily average',
        value: formatNumber(data.daily_average),
      },
      {
        key: 'days-observed',
        label: 'Days with logs',
        value: formatNumber(observedDays),
      },
    ],
    sections: { timePattern, weeklyPattern, productPattern, hourlyDetail },
    nextStep: state === 'ready'
      ? {
        label: timePattern.available
          ? `Plan for ${timePattern.leadingLabel}`
          : 'Review your support plan',
        href: '/journey/',
        description: timePattern.available
          ? 'Review your support plan and add help before this window begins.'
          : 'Use this pattern to choose one practical adjustment.',
      }
      : {
        label: 'Log today',
        href: '/today/',
        description: 'A quick entry is enough to keep your pattern honest.',
      },
  };
}
