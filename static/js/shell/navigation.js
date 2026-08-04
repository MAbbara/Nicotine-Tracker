const navigationRegistry = new WeakSet();

export function destinationForLocation(pathname = '/', endpoint = '') {
  const path = String(pathname).toLowerCase();
  const name = String(endpoint).toLowerCase();
  if (path === '/log' || path.startsWith('/log/') || name.startsWith('logging.')) return 'logbook';
  if (path.startsWith('/journey') || path.startsWith('/goals') || name.startsWith('journey.') || name.startsWith('goals.')) return 'journey';
  if (path.startsWith('/insights') || name.startsWith('insights.')) return 'insights';
  if (path.startsWith('/you') || path.startsWith('/settings') || path.startsWith('/catalog') || name.startsWith('you.') || name.startsWith('settings.') || name.startsWith('catalog.')) return 'you';
  return 'today';
}

function destinationForLink(link) {
  const label = link.textContent?.trim().toLowerCase();
  if (['today', 'logbook', 'journey', 'insights', 'you'].includes(label)) return label;
  try {
    return destinationForLocation(new URL(link.href, 'https://local.invalid').pathname);
  } catch (_) {
    return 'today';
  }
}

export function activateNavigation(nav, { pathname = '/', endpoint = '' } = {}) {
  if (!nav) return null;
  const links = Array.from(nav.querySelectorAll?.('a') || []);
  const active = destinationForLocation(pathname, endpoint);
  let selected = false;
  for (const link of links) {
    const isActive = !selected && destinationForLink(link) === active;
    if (isActive) {
      link.setAttribute('aria-current', 'page');
      selected = true;
    } else {
      link.removeAttribute('aria-current');
    }
    link.hidden = false;
  }
  return selected ? active : null;
}

export function initNavigation(doc = globalThis.document, location = globalThis.location) {
  const nav = doc?.querySelector?.('[data-primary-navigation]');
  if (!nav) return null;
  if (!navigationRegistry.has(nav)) navigationRegistry.add(nav);
  return activateNavigation(nav, { pathname: location?.pathname || '/' });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initNavigation(document, globalThis.location), { once: true });
  } else {
    initNavigation(document, globalThis.location);
  }
}
