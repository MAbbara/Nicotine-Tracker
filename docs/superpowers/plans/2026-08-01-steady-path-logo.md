# Steady Path Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and place a standalone Steady Path logo symbol plus a `NicotineTracker` horizontal lockup that match the project’s warm, calm design system.

**Architecture:** Use the built-in image generation workflow to create a logo-brand raster concept on a flat warm-ivory field, then preserve the selected outputs as versioned project assets. Validate the symbol and lockup visually at full size and reduced icon size before changing any consuming references.

**Tech Stack:** Built-in image generation tool, local image inspection, project static asset directory.

## Global Constraints

- Primary color is mineral green.
- Accent color is restrained terracotta and is limited to the waypoint.
- Supporting surface is warm ivory.
- Geometry is soft, organic, rounded, and editorial.
- The exact wordmark text is `NicotineTracker`.
- Avoid gradients, neon colors, glossy effects, emoji, medical symbols, shame/failure imagery, and dense detail.
- Do not overwrite the existing `static/favicon.png`.

---

### Task 1: Generate the logo-brand concept

**Files:**
- Create: generated preview artifact under the built-in image-generation output location

**Interfaces:**
- Consumes: approved Steady Path design specification
- Produces: a square symbol concept and a horizontal lockup concept suitable for project use

- [ ] **Step 1: Generate the standalone symbol**

Use the built-in image generator with this prompt:

```text
Use case: logo-brand
Asset type: standalone app symbol, vector-friendly raster logo concept
Primary request: Create a refined standalone logo symbol for a calm nicotine-pouch reduction app called NicotineTracker. Use a compact rounded pouch/leaf form with one simple ascending path cut through it. The path should end in one small terracotta waypoint, suggesting the next manageable step and steady progress rather than a finish line.
Scene/backdrop: perfectly flat warm ivory background, no texture
Subject: one centered abstract pouch/leaf mark with a clear ascending path and one waypoint
Style/medium: minimal editorial identity design, flat geometric illustration, vector-friendly, crisp edges
Composition/framing: centered square composition with generous padding; the symbol must remain recognizable at favicon size
Lighting/mood: calm, grounded, quietly optimistic; no dramatic lighting
Color palette: mineral green primary, restrained terracotta waypoint, warm ivory background
Materials/textures: flat color only, no gradients, no shadows, no gloss
Text (verbatim): no text
Constraints: avoid cigarettes, pills, medical crosses, lungs, smoke, flames, generic bar charts, arrows, checkmarks, and literal nicotine imagery; keep the construction simple enough to redraw as SVG
Avoid: neon, purple-blue gradients, glossy effects, emoji, dense detail, watermark
```

- [ ] **Step 2: Generate the horizontal lockup**

Use the same art direction with this additional requirement:

```text
Create a horizontal lockup using the same Steady Path symbol at left and the exact wordmark "NicotineTracker" at right. Use a calm humanist sans-serif wordmark treatment with comfortable spacing and strong legibility at small navigation widths. Keep the symbol and wordmark optically balanced. Do not add a slogan or extra text.
```

### Task 2: Inspect and select the assets

**Files:**
- Read: generated symbol and lockup previews

**Interfaces:**
- Consumes: generated previews from Task 1
- Produces: selected symbol and lockup variants for project placement

- [ ] **Step 1: Inspect the full-size previews**

Check that the mark reads as steady progress, uses the approved palette, contains no prohibited imagery, and that the lockup text is exactly `NicotineTracker`.

- [ ] **Step 2: Inspect reduced-size previews**

Review the symbol at approximately 16px, 24px, 32px, and 48px equivalent sizes. Reject any version where the pouch/leaf silhouette or path collapses into an indistinct blob.

- [ ] **Step 3: Run one targeted regeneration if needed**

If the text is malformed, the waypoint is too prominent, or the path is not legible, regenerate only the affected asset with one targeted prompt change. Do not change the approved concept.

### Task 3: Place versioned project assets

**Files:**
- Create: `static/brand/nicotine-tracker-steady-path-symbol.png`
- Create: `static/brand/nicotine-tracker-steady-path-lockup.png`
- Create: `static/brand/nicotine-tracker-steady-path-symbol-dark.png`

**Interfaces:**
- Consumes: selected generated assets from Task 2
- Produces: project-local logo files available for future template integration

- [ ] **Step 1: Create the asset directory if absent**

Create `static/brand/` only if it does not already exist.

- [ ] **Step 2: Copy the selected assets without overwriting existing files**

Use the exact versioned filenames above. Preserve `static/favicon.png` and all archive assets.

- [ ] **Step 3: Verify image metadata**

Confirm each file is readable, has the expected orientation, and has non-zero dimensions appropriate to its use.

### Task 4: Final visual verification

**Files:**
- Read: `static/brand/nicotine-tracker-steady-path-symbol.png`
- Read: `static/brand/nicotine-tracker-steady-path-lockup.png`
- Read: `static/brand/nicotine-tracker-steady-path-symbol-dark.png`

**Interfaces:**
- Consumes: project-local assets from Task 3
- Produces: verified deliverables and a concise handoff summary

- [ ] **Step 1: Re-open the project-local files**

Inspect the copied files rather than relying only on the generation preview.

- [ ] **Step 2: Verify acceptance criteria**

Confirm the symbol communicates steady progress without literal nicotine imagery, the lockup is legible, light and dark use cases are covered, and no existing asset was overwritten.

- [ ] **Step 3: Report paths and limitations**

Report the exact saved paths, note that the assets are raster and vector-friendly rather than true SVG, and state that no existing favicon/template references were changed unless explicitly requested.
