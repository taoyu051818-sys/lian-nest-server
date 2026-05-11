# Provider Pool WebUI Style Guide

Design tokens, component classes, and usage patterns for the provider pool
worker dashboard stylesheet.

> **Closes:** [#607](https://github.com/taoyu051818-sys/lian-nest-server/issues/607)

---

## Design Tokens (CSS Custom Properties)

All design tokens are defined on `:root` in
`tools/provider-pool-webui/public/styles.css`.

### Surface Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--surface-bg` | `#0f1117` | Page background |
| `--surface-card` | `#161922` | Card/panel backgrounds |
| `--surface-card-hover` | `#1c2030` | Card hover state |
| `--surface-border` | `#262b3a` | Borders and dividers |
| `--surface-overlay` | `rgba(0,0,0,0.6)` | Modal/overlay backdrop |

### Text Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--text-primary` | `#e2e4ea` | Headings, key values |
| `--text-secondary` | `#8b8fa4` | Body text, detail values |
| `--text-muted` | `#565b72` | Labels, timestamps |
| `--text-inverse` | `#0f1117` | Text on bright backgrounds |

### Status Colors

| Token | Value | Semantic |
|-------|-------|----------|
| `--status-available` | `#34d399` | Healthy / running / green |
| `--status-available-bg` | `rgba(52,211,153,0.12)` | Available badge background |
| `--status-exhausted` | `#fbbf24` | Warning / cooling-down / yellow |
| `--status-exhausted-bg` | `rgba(251,191,36,0.12)` | Exhausted badge background |
| `--status-disabled` | `#f87171` | Error / disabled / red |
| `--status-disabled-bg` | `rgba(248,113,113,0.12)` | Disabled badge background |
| `--accent-blue` | `#60a5fa` | Info / draining / blue |
| `--accent-blue-bg` | `rgba(96,165,250,0.12)` | Blue badge background |

### Spacing Scale

4px grid: `--sp-1` (4px) through `--sp-8` (32px).

### Typography

| Token | Value | Usage |
|-------|-------|-------|
| `--font-mono` | JetBrains Mono / Fira Code / Cascadia Code | IDs, code, metrics |
| `--font-sans` | Inter / system stack | Body text |
| `--text-xs` | `0.6875rem` | Labels, timestamps |
| `--text-sm` | `0.75rem` | Body text, table cells |
| `--text-base` | `0.8125rem` | Default body |
| `--text-lg` | `1rem` | Headings, large values |

### Border Radius

`--radius-sm` (4px), `--radius-md` (6px), `--radius-lg` (8px).

---

## Component Reference

### Summary Cards

Top-level metric cards for global pool overview.

```html
<div class="summary">
  <div class="summary-card">
    <div class="summary-card__label">Total Providers</div>
    <div class="summary-card__value">4</div>
  </div>
  <!-- ... -->
</div>
```

### Status Badges

Inline status indicators for providers and workers.

| Class | Color | Usage |
|-------|-------|-------|
| `badge badge-available` | Green | Available provider |
| `badge badge-exhausted` | Yellow | Exhausted provider (cooldown) |
| `badge badge-disabled` | Red | Disabled provider |
| `badge badge-running` | Green | Running worker |
| `badge badge-cooling-down` | Yellow | Worker in cooldown |
| `badge badge-draining` | Blue | Worker draining |

Status dot variant (inside badge):
```html
<span class="provider-card__status-dot provider-card__status-dot--available"></span>
```

### Provider Cards

Grid of provider status cards with concurrency visualization.

```html
<div class="provider-grid">
  <div class="provider-card provider-card--available">
    <div class="provider-card__header">
      <span class="provider-card__id">provider-default</span>
      <span class="provider-card__status-badge provider-card__status-badge--available">
        available
      </span>
    </div>
    <div class="provider-card__metrics">
      <div class="metric-cell">
        <span class="metric-cell__label">Concurrency</span>
        <span class="metric-cell__value">2 / 5</span>
      </div>
    </div>
    <div class="concurrency-bar">
      <div class="concurrency-bar__track">
        <div class="concurrency-bar__fill concurrency-bar__fill--low" style="width:40%"></div>
      </div>
    </div>
    <div class="provider-card__details">
      <div class="detail-row">
        <span class="detail-row__key">Last Health Check</span>
        <span class="detail-row__value">2026-05-11 12:00</span>
      </div>
    </div>
  </div>
</div>
```

Concurrency bar fill classes:
- `concurrency-bar__fill--low` — < 60% (green)
- `concurrency-bar__fill--mid` — 60–85% (yellow)
- `concurrency-bar__fill--high` — > 85% (red)

### Worker Cards

Grid of active worker assignments, or table rows.

```html
<div class="worker-grid">
  <div class="worker-card worker-card--running">
    <div class="worker-card__header">
      <span class="worker-card__id">#443</span>
      <span class="badge badge-running">running</span>
    </div>
    <span class="worker-card__provider">provider-default</span>
    <div class="worker-card__details">
      <div class="detail-row">
        <span class="detail-row__key">Branch</span>
        <span class="detail-row__value mono">claude/wave15-...</span>
      </div>
      <div class="detail-row">
        <span class="detail-row__key">Conflict Group</span>
        <span class="detail-row__value">messages</span>
      </div>
    </div>
  </div>
</div>
```

Worker card status modifiers:
- `worker-card--running` — green left border
- `worker-card--cooling-down` — yellow left border
- `worker-card--draining` — blue left border

### Tables

Data tables for providers, workers, and resources.

```html
<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Status</th>
        <th>Workers</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="mono">prov-001</td>
        <td><span class="badge badge-available">Available</span></td>
        <td>4</td>
      </tr>
    </tbody>
  </table>
</div>
```

### Utilization Bars

Horizontal progress bars for load and resource utilization.

```html
<div class="bar-track">
  <div class="bar-fill bar-fill--green" style="width: 45%"></div>
</div>
```

Fill variants: `bar-fill--green`, `bar-fill--yellow`, `bar-fill--red`.

### Resource Cards

Grid cards for system resource utilization (CPU, memory, GPU).

```html
<div class="resource-grid">
  <div class="resource-card">
    <div class="resource-card__name">CPU Cores</div>
    <div class="resource-card__stats">
      <span>21 / 32</span>
      <span class="resource-card__pct">66%</span>
    </div>
    <div class="bar-track">
      <div class="bar-fill bar-fill--yellow" style="width:66%"></div>
    </div>
  </div>
</div>
```

### Queue State

Queue depth cards showing pending and blocked task counts.

```html
<div class="queue-grid">
  <div class="queue-card">
    <div class="queue-card__label">Pending</div>
    <div class="queue-card__value">3</div>
  </div>
  <div class="queue-card queue-card--blocked">
    <div class="queue-card__label">Blocked by Exhaustion</div>
    <div class="queue-card__value queue-card__value--zero">0</div>
  </div>
</div>
```

Modifiers:
- `queue-card--active` — yellow border (has pending tasks)
- `queue-card--blocked` — red border (blocked tasks > 0)
- `queue-card__value--zero` — muted text when value is 0

### Pressure Gauge

Resource pressure indicator bar with animated status dot.

```html
<div class="pressure-gauge">
  <div class="pressure-gauge__indicator pressure-gauge__indicator--normal"></div>
  <span class="pressure-gauge__label">normal</span>
  <div class="pressure-bar">
    <div class="pressure-bar__track">
      <div class="pressure-bar__fill pressure-bar__fill--normal" style="width:13%"></div>
    </div>
  </div>
  <span class="pressure-gauge__detail">13.3% utilization</span>
</div>
```

Pressure levels:
- `normal` — green, no animation
- `elevated` — yellow, slow pulse
- `critical` — red, fast pulse

### Failure Tags

Inline tags for failure classification.

| Class | Color | Usage |
|-------|-------|-------|
| `failure-tag--exhaustion` | Yellow | Quota exhaustion |
| `failure-tag--auth` | Red | Auth failure |
| `failure-tag--runtime` | Blue | Runtime error |

### Cooldown Timer

Monospace countdown display.

```html
<span class="cooldown-timer">5m remaining</span>
```

### Event Feed

Activity log for recent pool events.

```html
<div class="event-feed">
  <div class="event-feed__title">Activity</div>
  <ul class="event-feed__list">
    <li class="event-row">
      <span class="event-row__time">12:05</span>
      <span class="event-row__message">Provider exhausted</span>
      <span class="event-row__provider">prov-003</span>
    </li>
  </ul>
</div>
```

### Layout Shell

Top-level page structure.

```html
<div class="app-shell">
  <header class="app-header">
    <h1 class="app-header__title">Provider Pool Dashboard</h1>
    <span class="app-header__status">127.0.0.1:4179</span>
  </header>
  <main class="app-main">
    <!-- content -->
  </main>
  <footer class="footer-bar">
    <span class="footer-bar__timestamp">2026-05-11T12:00:00Z</span>
  </footer>
</div>
```

---

## Status Color Mapping

| Data Status | CSS Class Pattern | Color |
|-------------|-------------------|-------|
| `available` | `*--available` | Green |
| `exhausted` | `*--exhausted` | Yellow |
| `disabled` | `*--disabled` | Red |
| `running` | `*--running` | Green |
| `cooling-down` | `*--cooling-down` | Yellow |
| `draining` | `*--draining` | Blue |
| `normal` (pressure) | `*--normal` | Green |
| `elevated` (pressure) | `*--elevated` | Yellow |
| `critical` (pressure) | `*--critical` | Red |

---

## Responsive Breakpoints

| Breakpoint | Behavior |
|------------|----------|
| `> 768px` | Full multi-column grids |
| `<= 768px` | Single-column provider/worker grid, 2-col resource grid, 2-col queue grid |
| `<= 480px` | Single-column everything |

---

## Accessibility

- `.sr-only` class for screen-reader-only content
- Status conveyed via color AND text (never color alone)
- Monospace font used for all machine-readable values (IDs, timestamps)
- Focus states inherit browser defaults on interactive elements

---

## References

- [State Contract](provider-pool-webui-state-contract.md) — field names and types
- [Architecture](provider-pool-webui-architecture.md) — component structure
- [Security](provider-pool-webui-security.md) — secret boundary
