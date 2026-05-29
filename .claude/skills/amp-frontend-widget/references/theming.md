# Theming — widget + playground

> **Status:** TODO. Defines the minimal theme surface for the embed widget and the alignment with the existing dashboard for the playground.

## Widget theming (embed)

Three theme modes via `data-theme`:

- `light` — light background, dark text
- `dark` — dark background, light text
- `auto` — follows the host page's `prefers-color-scheme`

Plus one customer-controllable accent: `data-brand-color="#hex"`.

Single accent token is intentional. We do NOT try to mimic the customer's full design system in a 30KB widget — that's a losing battle and ends up looking off either way. Customers who need pixel-perfect brand match get the playground export with custom CSS injection (Phase 2).

### Widget tokens (computed at iframe init)

```css
:root {
  --amp-bg:           /* light: #fff;        dark: #0a0a0a */
  --amp-fg:           /* light: #0a0a0a;     dark: #ededed */
  --amp-fg-muted:     /* light: #6b7280;     dark: #9ca3af */
  --amp-border:       /* light: #e5e7eb;     dark: #262626 */
  --amp-bubble-user:  /* light: #f3f4f6;     dark: #171717 */
  --amp-bubble-ai:    /* light: #fff;        dark: #0a0a0a */
  --amp-accent:       /* always = data-brand-color or default #0a0a0a */
  --amp-accent-fg:    /* computed contrast — white or black */
}
```

Auto-mode flips on `(prefers-color-scheme: dark)` media query change without reload.

### Font

Widget uses a system stack — no web font download to keep bundle size + perceived perf tight:

```css
font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
             "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
font-family-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
```

Numbers (cost indicators) use the mono stack.

## Playground theming (inside `01-frontend-end`)

Playground IS the dashboard. Follows the existing dashboard tokens — Geist + Geist Mono, the `bg-*` / `text-*` token system, `var(--surface-primary)` etc. (per `nemo-router-mono-repo/CLAUDE.md` "Preferences" section).

Hard rules inherited from the existing dashboard:

- **Never `font-bold`.** Repo is `font-bold`-free. Headings and numbers use `font-semibold` (600).
- **No raw hex.** All colors come from CSS custom-property tokens defined in `globals.css`.
- **Geist Mono for ALL numbers.** Cost values, latency, iteration counts, token counts.
- **Geist (sans) for body + headings.**
- **No fallback fonts.** `--font-sans` / `--font-mono` resolve to Geist only.
- **Mint + indigo are landing-only.** Don't bring them into the dashboard / playground.
- **Active control color:** `bg-text-primary text-surface-primary` (matches existing button conventions).
- **Icon color:** `text-text-secondary` on `bg-surface-secondary` background pill.

## Brand color flow — how `data-brand-color` reaches the widget

1. Customer sets `data-brand-color="#ff6600"` in the embed snippet.
2. Loader script validates: must match `^#[0-9a-fA-F]{6}$` or rejects to default.
3. Loader passes via postMessage to iframe.
4. Iframe writes `document.documentElement.style.setProperty('--amp-accent', color)`.
5. Iframe computes `--amp-accent-fg` via WCAG contrast — picks white or black for legibility.
6. Buttons, send icon, link colors, focus rings all reference `var(--amp-accent)`.

## Dark mode in the widget

The widget renders inside an iframe, so the host page's CSS can't affect it. Three modes:

- `data-theme="light"` — forces light tokens regardless of host
- `data-theme="dark"` — forces dark tokens regardless of host
- `data-theme="auto"` — iframe listens to its OWN `matchMedia('(prefers-color-scheme: dark)')` (system-level signal, not host-page)

This means: if a customer's site is dark but the user's OS is set to light, `auto` mode will render light. We could do better via postMessage signaling, but it adds complexity and the system-level signal is "right" most of the time.

## Animation policy

Widget:
- Open / close transition: 200ms ease-out
- Message append: subtle fade-in (150ms)
- Tool call chip appearance: opacity 0 → 1 + 8px y-offset (150ms)
- Respect `prefers-reduced-motion`: skip transitions entirely

Playground:
- Inherits dashboard motion tokens (`src/lib/motion-tokens.ts`)
- `DURATION.short` for hover, `DURATION.standard` for layout
- `EASE.out` (never `EASE.spring` in dashboard per repo standards)

## Accessibility (both surfaces)

- Color contrast ≥ AA (4.5:1 body, 3:1 large text). Validated by `--amp-accent-fg` contrast pick.
- All interactive elements keyboard-accessible (Tab / Enter / Esc).
- Esc closes the widget.
- Screen reader: chat region uses `role="log" aria-live="polite"` for new messages.
- Send button: `aria-label="Send message"`; loading state announced as `aria-busy="true"`.
- Focus visible: 2px outline using `--amp-accent`.

## What NOT to add (deliberate restraint)

- Custom fonts (bundle bloat, brand-mimicry trap)
- Multi-color brand palettes (just one accent — keeps UI predictable)
- Custom emoji / avatar uploads (Phase 2 if requested)
- Brand logo in widget header (Phase 2 — needs a settings UI, not a `data-` attr)
