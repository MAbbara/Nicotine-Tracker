/* Active-plan overview glue. Chart, entrance, and the editor adapter
   arrive in later tasks of the port plan. */

const overview = document.querySelector('.journey-overview');

if (overview) {
  const adjustToggle = overview.querySelector('[data-adjust-toggle]');
  const adjustBody = document.getElementById('adjust-body');
  if (adjustToggle && adjustBody) {
    adjustToggle.addEventListener('click', () => {
      const open = adjustToggle.getAttribute('aria-expanded') === 'true';
      adjustToggle.setAttribute('aria-expanded', String(!open));
      adjustBody.classList.toggle('is-open', !open);
    });
  }
}

export {};
