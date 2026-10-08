# Tikket design

How Tikket looks and behaves, and the rules for keeping it that way. The source of truth is the code: tokens live in `src/app.css`, primitives in `src/lib/components/ui/`. This file explains the intent so new screens match.

## Principles

1. **Calm and dense.** Tikket is a work tool used all day. Small type, tight rows, few decorations. Information first, chrome second.
2. **Charcoal with one accent.** Neutral surfaces, a single lime accent for the primary action and "selected/active" states. Colour is otherwise reserved for meaning (status, priority, type, errors).
3. **Works without JavaScript.** Forms are real forms, checkboxes and radios are native inputs, selects fall back to a native `<select>` until the page hydrates. Enhancement never replaces semantics.
4. **Accessible by default.** Visible focus, labelled controls, keyboard paths for every dialog and menu, reduced-motion respected, no horizontal overflow from 320 px up. Covered by `e2e/08-polish.spec.ts`.
5. **Quiet when empty, clear when broken.** Empty states say what to do next. Errors say what happened and what to try, never a stack trace or a server path.

## Theme

Dark is the default. `.light` forces light; `.theme-system` follows the OS (`prefers-color-scheme`). Users choose in the theme menu.

Components use only the CSS variables below, through Tailwind colour names (`bg-surface`, `text-muted-foreground`, …). **Never write raw hex or oklch values in components.**

### Surfaces and text

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `background` | `#0d0f11` | `#f5f6f4` | Page |
| `surface` | `#171a1d` | `#ffffff` | Cards, inputs, panels |
| `surface-2` | `#1c2023` | `#f8f9f7` | Secondary buttons, code blocks |
| `popover` | `#1a1d21` | `#ffffff` | Menus, selects, dialogs |
| `sidebar` | `#0b0d0f` | `#eef0ec` | App sidebar |
| `muted` / `hover` | `#1f2326` / `#22272a` | `#eef0ec` / `#eef1eb` | Quiet fills, hover rows |
| `border` / `border-strong` / `input` | `#2b3034` / `#3a4045` / `#30363b` | `#e1e4e0` / `#cdd2cc` / `#d3d8d2` | Dividers, hover borders, field borders |
| `foreground` | `#f3f5f4` | `#14181b` | Body text |
| `muted-foreground` | `#9ba3ad` | `#5c656e` | Secondary text |
| `subtle-foreground` | `#7b848d` | `#7c858d` | Placeholders, tertiary text |

### Accent and feedback

| Token | Meaning |
| --- | --- |
| `primary` (`#b8f779` dark, `#a6ee62` light) | The one primary action per view; selected state; checked boxes |
| `primary-foreground` | Text on primary (always near-black) |
| `primary-soft`, `primary-border` | Tinted backgrounds / borders for selected and focused states |
| `link`, `link-hover` | Links. Darker green on light for contrast |
| `destructive` | Errors, delete, invalid fields |
| `warning`, `success`, `info` | Notices and confirmations |
| `ring` | Focus ring (translucent primary) |
| `overlay` | Dialog / sheet backdrop |

### Meaning colours ("tones")

Status, priority, type and internal-note colours are defined once as `--tone-*` and applied through the `tone-<name>` class plus `.tone` (tinted background, border and text), `.tone-dot` or `.tone-text`.

- Status: `open`, `planned`, `progress`, `completed`, `hold`, `declined`, `duplicate`
- Priority: `low`, `medium`, `high`, `critical`
- Type: `bug`, `feature`, `improvement`, `feedback`
- Internal comments / notes: `--internal-bg`, `--internal-border`, `--internal-fg` (amber), so staff never confuse them with public replies.

Colour never carries meaning alone: badges always include a text label or icon.

Project and label colours use the `swatch-*` palette (indigo, violet, sky, teal, emerald, amber, orange, rose, slate) with `swatch-bg` / `swatch-solid`.

## Typography

- Sans: **Inter Variable** (self-hosted via `@fontsource-variable/inter`), then the system stack. Mono: system monospace.
- Body is `0.875rem` (14 px) / 1.5. Page titles `text-xl`–`text-2xl` semibold; section headings `text-sm`–`text-base` semibold; metadata `text-xs`.
- Weights: 400 body, 500 controls and labels, 600 headings. No bold-for-emphasis in running UI text.
- Rich text (`.rich-text`) is 1.65 line height with 0.75 em paragraph spacing, and headings `h2`/`h3` only.

## Shape, depth and spacing

- Radius: `sm` 6 px, `md` 8 px (controls), `lg` 10 px (menus), `xl` 14 px (cards, panels, empty states).
- Depth is mostly borders. `shadow-card` is a faint 1 px shadow for cards and inputs; `shadow-pop` is only for floating layers (menus, popovers, dialogs).
- Spacing follows Tailwind's 4 px scale; page content is capped at `90rem` with `px-4 sm:px-6 lg:px-8` and `py-6 lg:py-8`.
- Layout: fixed 16 rem sidebar (4.25 rem collapsed) from `lg`; below that a sticky top bar with a sheet navigation.

## Components

Use the primitives in `src/lib/components/ui/` before writing new markup.

- **Button** (`button.svelte`): variants `default` (lime, primary), `secondary`, `outline`, `ghost`, `subtle`, `destructive`, `destructive-outline`, `link`. Sizes `default` (36 px), `sm` (32), `xs` (28), `lg` (40), `icon*`. One `default` button per view. Pass `href` to render a link, `loading` to show a spinner. Icon-only buttons need an `aria-label`.
- **Input / Textarea / Select**: 36 px tall, `border-input`, `bg-surface`, focus turns the border `primary-border` with a soft ring, `aria-invalid` turns it red. Wrap in **Field** for label, hint and error. `Select` renders a native `<select>` until hydrated, then the styled list; `searchable` swaps in a combobox; `autosubmit` submits its form on change.
- **Checkbox / radio**: native inputs styled in `app.css` (lime when checked, dash when indeterminate). **Switch** for instant on/off settings.
- **Card**: `rounded-xl border bg-surface shadow-card`. Don't nest cards.
- **Badge**: 22 px pill. `tone` for status/priority/type, `outline`/`muted` for neutral metadata, `solid` rarely.
- **Dialog / ConfirmDialog / Sheet**: focus moves in, is trapped, Escape closes and focus returns to the trigger. Destructive actions confirm with a named button ("Delete project"), never "OK".
- **Menus, popovers, tooltips**: `popover` surface, `shadow-pop`, 150 ms fade/zoom. Tooltips supplement labels, they don't replace them.
- **TabNav**: project navigation; horizontally scrollable on phones with `scroll-quiet`.
- **EmptyState**: dashed `xl` box, icon in a muted tile, a title, one sentence, and the next action(s).
- **ErrorView**: used for 403/404/500: plain explanation, Back and Go to dashboard.
- **Skeleton**: only where loading is perceptible.

Icons are Lucide (`@lucide/svelte/icons/<name>`), 16 px (`size-4`) in controls, 20 px in empty-state tiles. Import the specific icon file, not aliases.

## Interaction

- **Focus**: every focusable element shows a 2 px `ring` outline with 2 px offset (`:focus-visible`). A skip link is the first tab stop.
- **Motion**: short (≈150 ms) fades and colour transitions only. All animation is cut to ~0 under `prefers-reduced-motion`.
- **Feedback**: toasts for completed actions ("Reminder set"), inline `FormMessage` for validation, field-level errors beside the field. Forms keep the user's input when validation fails.
- **Keyboard**: menus and selects open with Enter/Space/arrows; lists support arrow navigation; dialogs trap Tab. The page must not scroll or jump when a menu opens or closes (`hold-scroll.ts` guards this).
- **Destructive and outward-facing actions** (delete, send, publish, restore) always confirm and say what will happen.

## Responsive behaviour

- Designed mobile-first and checked at 320, 375, 390 and 430 px: no horizontal page scroll.
- Grids use `min-w-0` children (set globally) so long titles wrap or truncate instead of widening the page.
- Tables become scrollable regions or stacked rows on phones; the board scrolls horizontally inside its own container.
- Touch targets are at least 32 px; primary tap targets 36 px.

## Voice

- Plain, short, second person. "Your changes were saved", not "Operation successful".
- Say what happened and what to do: "The website could not be reached. Check the address and try again."
- Sentence case for headings, buttons and labels. Curly apostrophes in user-facing copy.
- Never show internal paths, stack traces, tokens or secrets in the UI or logs.

## Adding to the design

1. Reuse a token or primitive. If none fits, add a token in `src/app.css` for **dark, light and `.theme-system`** together.
2. Check both themes and a 320 px viewport.
3. Give every control a name and every field a label; run `npx playwright test e2e/08-polish.spec.ts`.
4. Document anything non-obvious here.
