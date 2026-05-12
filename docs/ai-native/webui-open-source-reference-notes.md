# WebUI Open-Source Reference Notes

Patterns observed in New API (open-webui) and llama.cpp UI that inform
the local operations console design. These are reference observations
only — no source code is copied or imported.

> **Closes:** [#1115](https://github.com/taoyu051818-sys/lian-nest-server/issues/1115)
> **Scope:** Documentation only. No runtime changes.

---

## Purpose

Capture UI patterns from mature open-source admin and chat interfaces
that align with the WebUI control console goals: dense admin layout,
visible action buttons, preview-first flows, and chat-like operator
feedback. The guidance here is "adopt the pattern, not the code."

---

## Pattern 1: Sidebar Shell

### Observation

Both New API and llama.cpp UI use a persistent left sidebar as the
primary navigation shell. The sidebar typically contains:

- A compact logo/brand area at the top
- Navigation items with icon + label
- Active state indicated by background color or left border accent
- Collapsible on narrow viewports, but defaults to expanded on desktop
- A footer area for settings or user context

### Relevance to Operations Console

The operations console already uses a left-nav admin shell. The
reference confirms this pattern works well for:

- Switching between Dashboard, Operation Console, Planning, and Audit tabs
- Keeping navigation visible while working in the main content area
- Providing a consistent frame that doesn't shift during action execution

### Adoption Guidance

- Use a fixed-width sidebar (200-240px) with icon + text nav items
- Highlight the active tab with a left border accent or background shift
- Keep nav items flat (no nested menus) since the console has few top-level sections
- Place "Audit Log" and "Export" at the bottom of the nav as secondary items

**Do not:** Copy CSS classes, component structure, or icon sets from
external repos. Implement from scratch using the project's existing
style tokens.

---

## Pattern 2: Dense Tables

### Observation

Admin dashboards in both projects use dense data tables for status
overviews. Common traits:

- Compact row height (32-40px) with minimal vertical padding
- Monospace or tabular-nums font for numeric columns
- Status columns use colored badges or dots (not just text)
- Sticky header on scroll
- Row hover highlight for scanability
- No horizontal scroll on desktop — columns sized to fit

### Relevance to Operations Console

Provider status, queue entries, worker lists, and audit logs all
benefit from dense tabular presentation. The current dashboard already
shows provider status in a table; the reference validates this approach.

### Adoption Guidance

- Use `<table>` with `border-collapse: collapse` and tight `padding: 4px 8px`
- Status badges: small inline elements with background color (green/yellow/red/grey)
- Numeric columns: `font-variant-numeric: tabular-nums` for alignment
- Keep tables under 8 rows visible without scroll; paginate or lazy-load the rest
- Row click navigates to detail; row hover shows action buttons inline

**Do not:** Import a table library. Style native HTML tables with
project CSS variables.

---

## Pattern 3: Action Cards

### Observation

Both UIs present discrete actions as card-like containers with:

- A clear title and short description
- A primary action button (large, high-contrast)
- A secondary or destructive action button (smaller, muted color)
- Visual state indicators: loading spinner, success checkmark, error icon
- Preview/confirmation step before destructive actions

### Relevance to Operations Console

The operation console action modules (compile-tasks, launch-batch,
merge-prs, etc.) map directly to this card pattern. Each action is a
self-contained unit with preview + execute + confirmation.

### Adoption Guidance

- One card per action module, arranged in a responsive grid (2-3 columns)
- Card header: action label + risk badge (Low/Medium/High/Critical)
- Card body: short description + current state summary
- Card footer: Preview button (blue) + Execute button (red for dangerous, green for safe)
- Preview result shown inline within the card, replacing the description area
- Confirmation input appears below the preview result, inline in the card

Layout sketch:

```
┌─────────────────────────────────────────────┐
│  Launch Batch                    [HIGH]     │
│  Run launch gate on queued tasks and        │
│  dispatch workers.                          │
│                                             │
│  ┌─ Preview ─────────────────────────────┐  │
│  │ 3 tasks ready, 2 providers available  │  │
│  │ conflict-group: auth-slice (1 task)   │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  Confirm: [________]                        │
│  [Preview]  [Execute]                       │
└─────────────────────────────────────────────┘
```

**Do not:** Copy card component implementations. Build cards with
semantic HTML (`<article>`, `<header>`, `<footer>`) and project CSS.

---

## Pattern 4: Chat-Like Command Panel

### Observation

New API's chat interface uses a pattern that adapts well to operator
feedback:

- Messages appear in a scrollable timeline (newest at bottom)
- Each message has a role indicator (user/system) and timestamp
- System responses include structured content (code blocks, tables, status badges)
- Input area at the bottom with a send button and keyboard shortcut (Enter)
- Auto-scroll to newest message; manual scroll pauses auto-scroll

### Relevance to Operations Console

After executing an action, the console needs to show the result to the
operator. A chat-like feedback panel provides:

- A chronological log of all actions taken in the session
- Structured display of preview results, execution outcomes, and errors
- A natural place to surface audit entries and rollback instructions

### Adoption Guidance

- Use a fixed-height panel (300-400px) at the bottom of the operation console
- Each action result is a "message" with: timestamp, action label, status icon, and result payload
- Successful results: green left border, structured JSON or summary
- Failed results: red left border, error message with retry suggestion
- Preview results: blue left border, projected outcome with confirmation prompt
- Scrollback limited to last 50 entries; older entries available via audit export
- No actual chat input — the "command" comes from action card buttons

Layout sketch:

```
┌─────────────────────────────────────────────┐
│  Session Feedback                           │
│                                             │
│  ▸ 10:32  [plan.next.batch] ✓ Preview      │
│           3 candidates, 0 blocked           │
│                                             │
│  ▸ 10:33  [launch-batch] ✓ Executed         │
│           Launched 2 workers, audit-042     │
│                                             │
│  ▸ 10:35  [provider-rotation] ✗ Blocked     │
│           Confirmation mismatch             │
│                                             │
│  ─────────────────────────────────────────  │
│  [Export Audit]              3 entries      │
└─────────────────────────────────────────────┘
```

**Do not:** Implement a real chat/messaging system. This is a
session-scoped action feedback log, not a conversation interface.

---

## Pattern 5: Adopt-Without-Copying Guidance

### Principle

External open-source projects are pattern references, not code sources.
The operations console must be built from scratch using the project's
own tooling, style system, and component patterns.

### Rules

| Rule | Rationale |
|------|-----------|
| No source code copied from external repos | Licensing, maintainability, and security |
| No external CSS frameworks imported | The project uses inline styles and CSS variables |
| No external JS libraries for UI | Keep the bundle minimal; vanilla JS is sufficient |
| Patterns inform structure, not implementation | The same pattern can be implemented many ways |
| Document the pattern, not the code | This file captures "what" and "why", not "how" |

### What "Adopt" Means

- **Sidebar shell** → use a `<nav>` element with styled links, not a React sidebar component
- **Dense tables** → use `<table>` with tight padding, not a data grid library
- **Action cards** → use `<article>` with semantic sections, not a card component framework
- **Chat-like feedback** → use a scrollable `<div>` with structured entries, not a chat SDK

### What "Don't Copy" Means

- Don't `git subtree add` or `npm install` external UI projects
- Don't extract CSS variables, color tokens, or design tokens from external repos
- Don't replicate pixel-perfect layouts — adapt the pattern to the project's needs
- Don't reference external repo file paths in code comments

---

## Cross-References

- [WebUI Operation Runbook](webui-operation-runbook.md) — step-by-step operator guide
- [Provider Pool WebUI](../../tools/provider-pool-webui/README.md) — server and console overview
- [Provider Pool WebUI API Contract](../contracts/provider-pool-webui-api.md) — API surface
- [WebUI Control Map](webui-control-map.md) — action-to-endpoint mapping
