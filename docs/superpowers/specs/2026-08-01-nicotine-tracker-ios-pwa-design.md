# iOS Home-Screen App Behavior Design

## Goal

Make the entire Nicotine Tracker site installable from iOS Safari as a standalone home-screen web app. After installation, navigation among the marketing, authentication, and authenticated tracker pages should remain inside the home-screen app instead of handing the user back to Safari.

## Context and root cause

The live application is server-rendered Flask/Jinja with normal same-origin links. Its active layouts currently provide a favicon and viewport metadata, but no web app manifest, Apple standalone metadata, or active PWA entrypoint. Archived files contain an older PWA experiment, but they are not used by the current application.

The standalone navigation behavior is provided by the installed app's manifest scope and iOS metadata, not by converting the site to a client-side router. A service worker is not required for this behavior and would introduce unnecessary risks if authenticated HTML were cached.

## Chosen approach

Add the smallest PWA foundation that covers the existing server-rendered site:

1. Serve a valid manifest from a root-level URL.
2. Set `/` as the manifest `start_url` and `scope`, with standalone display behavior.
3. Add the manifest link, Apple standalone metadata, application name, and touch-icon link to the marketing, authentication, and app layouts.
4. Generate deterministic 180px, 192px, and 512px PNG derivatives from the existing 1024px application icon for Apple touch and manifest declarations.
5. Do not add a service worker, client-side router, offline HTML cache, or navigation rewrite.

The root route already provides the desired launch split: authenticated sessions redirect to Today, and unauthenticated sessions render the public landing page. All current internal page links are same-origin and remain within the root scope.

## Manifest contract

The manifest must:

- Be reachable at `/manifest.webmanifest` and return the `application/manifest+json` media type.
- Identify the app as “Nicotine Tracker” with a short name suitable for the iOS home screen.
- Use `/` for `start_url` and `scope`.
- Use `display: "standalone"` and a warm theme/background matching the current light shell.
- Include an app `id` rooted at `/` so future manifest updates do not create a second logical app.
- Include 180px Apple touch-icon coverage plus 192px and 512px PNG declarations for standard and maskable use, with metadata matching the generated files.

## Layout metadata contract

Each user-facing HTML layout must include:

- A manifest link.
- `apple-mobile-web-app-capable=yes`.
- `apple-mobile-web-app-title=Nicotine Tracker`.
- An Apple status-bar style compatible with the warm light shell.
- `mobile-web-app-capable=yes` for other install-capable browsers.
- An Apple touch icon link.

The existing viewport and theme-color metadata remain in place. The metadata must be present on marketing, login/register/authentication, and authenticated app pages so a user can install from any relevant Safari page and the installed app has consistent identity.

## Navigation and session behavior

No client-side navigation interception is needed. Existing normal links and form submissions remain the source of truth. Because the manifest scope is `/`, all same-origin application routes remain in the standalone context, including `/auth/*`, `/today/*`, `/journey/*`, `/insights/*`, `/you/*`, `/settings/*`, `/catalog/*`, `/log/*`, and `/cravings/*`.

External destinations, if added later, may open outside the standalone app; they must not be broadened into the PWA scope by accident.

## Error handling and operational constraints

- If the manifest cannot be served, the site continues to work as a normal browser site; installation enhancement is the only degraded behavior.
- No authenticated response may be cached by a service worker because no service worker is part of this change.
- Production installation requires HTTPS. Localhost development remains suitable for testing.
- After deployment, users who installed an older home-screen bookmark may need to remove it and add the site again so iOS reads the new metadata and manifest.

## Testing and verification

Add focused tests for:

1. The manifest response status, media type, and required fields.
2. Required PWA metadata on `/`, `/auth/login`, and `/today/`.
3. Same-origin route links remaining under the `/` scope.

Run the focused tests first, then the existing JavaScript and Python test suites, and finally the relevant browser tests. A real iOS Safari check remains necessary for final platform confirmation because desktop Playwright cannot reproduce every iOS home-screen lifecycle detail.

## Out of scope

- Offline HTML or API caching.
- Background sync.
- Push notifications.
- Replacing Flask/Jinja with a SPA.
- Redesigning the install prompt or adding a custom install banner.
- Changing authentication, session, or route behavior beyond PWA metadata and manifest delivery.
