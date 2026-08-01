export function createDisclosure({ trigger, panel, documentTarget = document }) {
  if (!trigger || !panel) return null;

  const setOpen = (open, { restoreFocus = false } = {}) => {
    panel.hidden = !open;
    panel.classList.toggle('hidden', !open);
    panel.classList.toggle('opacity-0', !open);
    panel.classList.toggle('opacity-100', open);
    trigger.setAttribute('aria-expanded', String(open));
    if (!open && restoreFocus) trigger.focus();
  };
  const isOpen = () => trigger.getAttribute('aria-expanded') === 'true';
  const open = () => setOpen(true);
  const close = (options) => setOpen(false, options);
  const toggle = () => setOpen(!isOpen());

  trigger.setAttribute('aria-expanded', 'false');
  setOpen(false);
  trigger.addEventListener('click', toggle);
  trigger.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    open();
    panel.querySelector('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus();
  });
  documentTarget.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      close({ restoreFocus: true });
    }
  });
  documentTarget.addEventListener('click', (event) => {
    if (isOpen() && !panel.contains(event.target) && !trigger.contains(event.target)) {
      close();
    }
  });

  return { open, close, toggle, isOpen };
}
