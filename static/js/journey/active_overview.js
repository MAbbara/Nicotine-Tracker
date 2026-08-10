/* Active-plan overview glue: path chart, entrance motion, collapse/accordion
   controllers. The editor adapter lands in a later task of the port plan. */

import { createPathChart } from './path_chart.js';

const overview = document.querySelector('.journey-overview');

if (overview) {
  document.documentElement.classList.add('journey-js');

  // The path chart, from the server-rendered JSON island.
  const island = overview.querySelector('[data-path-data]');
  let chart = null;
  let payload = null;
  if (island) {
    payload = JSON.parse(island.textContent);
    chart = createPathChart(overview.querySelector('.path-figure'), payload);
    window.JOURNEY_OVERVIEW = { chart, payload };
  }

  // Entrance: reveal .rise sections as they enter view.
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  overview.querySelectorAll('.rise').forEach((el) => io.observe(el));

  // Adjust section collapse (grid-rows animation).
  const adjustToggle = overview.querySelector('[data-adjust-toggle]');
  const adjustBody = document.getElementById('adjust-body');
  if (adjustToggle && adjustBody) {
    adjustToggle.addEventListener('click', () => {
      const open = adjustToggle.getAttribute('aria-expanded') === 'true';
      adjustToggle.setAttribute('aria-expanded', String(!open));
      adjustBody.classList.toggle('is-open', !open);
    });
  }

  // Animated accordions: details[data-accordion] unfold via grid-rows.
  // The open attribute is kept during the close transition so the content
  // stays visible while collapsing; reduced motion keeps native toggling.
  const reducedMotionNow = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  overview.querySelectorAll('details[data-accordion]').forEach((details) => {
    const summary = details.querySelector('summary');
    const collapse = details.querySelector('[data-accordion-collapse]');
    if (!summary || !collapse) return;
    let animating = false;
    const afterTransition = (fn) => {
      let done = false;
      const wrap = (event) => {
        if (event && event.propertyName && event.propertyName !== 'grid-template-rows') return;
        if (done) return;
        done = true;
        collapse.removeEventListener('transitionend', wrap);
        animating = false;
        fn();
      };
      collapse.addEventListener('transitionend', wrap);
      setTimeout(wrap, 350); // safety: transition duration + margin
    };
    summary.addEventListener('click', (event) => {
      if (animating) {
        event.preventDefault();
        return;
      }
      if (reducedMotionNow()) return; // native instant toggle
      event.preventDefault();
      animating = true;
      if (!details.open) {
        details.open = true; // children render (UA unhides)
        void collapse.offsetHeight; // flush the 0fr state so the transition has a start
        collapse.classList.add('is-open'); // 0fr -> 1fr
        afterTransition(() => {});
      } else {
        collapse.classList.remove('is-open'); // 1fr -> 0fr
        afterTransition(() => {
          details.open = false; // UA re-hides the collapsed content
        });
      }
    });
  });
}

export {};
