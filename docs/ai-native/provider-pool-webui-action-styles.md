# Provider Pool WebUI — Action Console Styles

Defines the CSS component classes for the operation console: action cards,
preview panels, execute confirmation, audit timeline, and disabled states.

> **Closes:** [#651](https://github.com/taoyu051818-sys/lian-nest-server/issues/651)

---

## Design Tokens

Action-specific tokens extend the base design system in `styles.css`.

| Token | Value | Usage |
|-------|-------|-------|
| `--action-preview` | `#60a5fa` | Preview mode accent (blue/info) |
| `--action-preview-bg` | `rgba(96,165,250,0.10)` | Preview badge/panel background |
| `--action-preview-border` | `rgba(96,165,250,0.25)` | Preview border accent |
| `--action-execute` | `#f87171` | Execute mode accent (red/danger) |
| `--action-execute-bg` | `rgba(248,113,113,0.10)` | Execute badge/panel background |
| `--action-execute-border` | `rgba(248,113,113,0.25)` | Execute border accent |
| `--action-safe` | `#34d399` | Safe/read-only action accent (green) |
| `--action-safe-bg` | `rgba(52,211,153,0.10)` | Safe action background |
| `--action-safe-border` | `rgba(52,211,153,0.25)` | Safe action border |
| `--action-disabled-opacity` | `0.45` | Disabled element opacity |
| `--audit-line` | `#262b3a` | Audit timeline vertical line |
| `--audit-dot-size` | `8px` | Timeline dot diameter |

---

## Visual Hierarchy: Preview vs Execute

The operation console enforces a clear visual distinction between
preview (dry-run) and execute (live) modes.

| Mode | Border | Accent | Semantic |
|------|--------|--------|----------|
| **Preview** | Blue left border + blue ring on hover | `--action-preview` | Safe observation, no mutation |
| **Execute** | Red left border + red ring on hover | `--action-execute` | Mutating action, requires confirmation |
| **Safe** | Green left border | `--action-safe` | Read-only or benign action |

**Rule:** Execute actions MUST NOT be visually confused with preview.
The red/blue split is the primary signal. Badge text reinforces the mode.

---

## Component Reference

### Action Console Section

Top-level wrapper for the action console area.

```html
<div class="action-console">
  <div class="action-console__title">Actions</div>
  <!-- action grid or panels here -->
</div>
```

### Action Cards

Grid of available operations. Each card describes one action and its mode.

```html
<div class="action-grid">
  <!-- Preview mode card -->
  <div class="action-card action-card--preview">
    <div class="action-card__header">
      <span class="action-card__name">Reset Cooldown</span>
      <span class="action-card__mode action-card__mode--preview">Preview</span>
    </div>
    <p class="action-card__description">
      Clear cooldown timer for provider-default. Does not affect active workers.
    </p>
    <div class="action-card__meta">
      <span>provider-default</span>
      <span>cooldownExpiresAt</span>
    </div>
    <div class="action-card__footer">
      <span class="action-card__meta">dry-run only</span>
      <button class="action-btn action-btn--preview">Preview</button>
    </div>
  </div>

  <!-- Execute mode card -->
  <div class="action-card action-card--execute">
    <div class="action-card__header">
      <span class="action-card__name">Disable Provider</span>
      <span class="action-card__mode action-card__mode--execute">Execute</span>
    </div>
    <p class="action-card__description">
      Disable provider-default. Active workers will drain before shutdown.
    </p>
    <div class="action-card__meta">
      <span>provider-default</span>
      <span>status: disabled</span>
    </div>
    <div class="action-card__footer">
      <span class="action-card__meta">requires confirmation</span>
      <button class="action-btn action-btn--execute">Execute</button>
    </div>
  </div>
</div>
```

#### Card Mode Modifiers

| Class | Visual | When to use |
|-------|--------|-------------|
| `action-card--preview` | Blue left border | Dry-run / preview actions |
| `action-card--execute` | Red left border | Mutating / live actions |
| `action-card--safe` | Green left border | Read-only or benign actions |
| `action-card--disabled` | 45% opacity, no pointer events | Action unavailable |

### Action Buttons

Buttons inside action cards. Match the card's mode for consistency.

```html
<button class="action-btn action-btn--preview">Preview</button>
<button class="action-btn action-btn--execute">Execute</button>
<button class="action-btn action-btn--safe">View</button>
<button class="action-btn action-btn--disabled" disabled>Unavailable</button>
```

---

### Preview Result Panel

Displays the output of a preview (dry-run) action. Blue accent signals
that no mutation occurred.

```html
<div class="preview-panel">
  <div class="preview-panel__header">
    <div class="preview-panel__indicator"></div>
    <span class="preview-panel__title">Preview Result</span>
  </div>
  <div class="preview-panel__body">
    Would reset cooldown for provider-default.
    Current expiry: 2026-05-11T12:30:00Z
    New state: no cooldown
  </div>
  <div class="preview-panel__footer">
    <button class="action-btn action-btn--preview">Re-preview</button>
    <button class="action-btn action-btn--execute">Execute for Real</button>
  </div>
</div>
```

#### Diff View Variant

For showing before/after state changes in preview:

```html
<div class="preview-panel__body preview-panel__body--diff">
  <span class="diff-remove">- cooldownExpiresAt: "2026-05-11T12:30:00Z"</span>
  <span class="diff-add">+ cooldownExpiresAt: null</span>
</div>
```

---

### Execute Confirmation Banner

Appears when the operator confirms an execute action. Red pulsing indicator
draws attention to the irreversible nature.

```html
<div class="execute-banner">
  <div class="execute-banner__icon"></div>
  <span class="execute-banner__text">
    Executing: Disable provider-default
  </span>
  <span class="execute-banner__detail">awaiting confirmation</span>
</div>
```

---

### Audit Timeline

Vertical timeline showing action history. Each entry records what happened,
when, by whom, and the result.

```html
<div class="audit-timeline">
  <div class="audit-timeline__title">Audit Log</div>
  <ul class="audit-timeline__list">
    <li class="audit-entry audit-entry--preview">
      <div class="audit-entry__header">
        <span class="audit-entry__time">12:05:03</span>
        <span class="audit-entry__action">Reset Cooldown</span>
        <span class="audit-entry__actor">operator</span>
      </div>
      <div class="audit-entry__body">
        Previewed cooldown reset for provider-default.
        <span class="audit-entry__result audit-entry__result--preview">Preview</span>
      </div>
    </li>
    <li class="audit-entry audit-entry--execute">
      <div class="audit-entry__header">
        <span class="audit-entry__time">12:05:18</span>
        <span class="audit-entry__action">Reset Cooldown</span>
        <span class="audit-entry__actor">operator</span>
      </div>
      <div class="audit-entry__body">
        Executed cooldown reset for provider-default.
        <span class="audit-entry__result audit-entry__result--executed">Executed</span>
      </div>
    </li>
    <li class="audit-entry audit-entry--safe">
      <div class="audit-entry__header">
        <span class="audit-entry__time">12:10:00</span>
        <span class="audit-entry__action">Health Check</span>
        <span class="audit-entry__actor">system</span>
      </div>
      <div class="audit-entry__body">
        All providers healthy.
        <span class="audit-entry__result audit-entry__result--success">OK</span>
      </div>
    </li>
  </ul>
</div>
```

#### Entry State Modifiers

| Class | Dot Color | When to use |
|-------|-----------|-------------|
| `audit-entry--preview` | Blue | Dry-run action recorded |
| `audit-entry--execute` | Red | Mutating action executed |
| `audit-entry--safe` | Green | Successful / benign event |
| `audit-entry--warn` | Yellow | Warning condition |
| `audit-entry--error` | Red | Failed action |

#### Result Badge Classes

| Class | Color | Meaning |
|-------|-------|---------|
| `audit-entry__result--preview` | Blue | Dry-run completed |
| `audit-entry__result--executed` | Red | Action performed |
| `audit-entry__result--success` | Green | Operation succeeded |
| `audit-entry__result--failed` | Red | Operation failed |
| `audit-entry__result--skipped` | Muted | Action skipped (precondition not met) |

---

## Disabled States

Disabled states use `opacity: 0.45` and `pointer-events: none` to visually
suppress elements without removing them from the DOM.

### Disabled Action Card

An entire card can be disabled when the action is unavailable:

```html
<div class="action-card action-card--disabled">
  <!-- ... -->
</div>
```

The `::after` pseudo-element on `.action-card__header` auto-inserts a
"disabled" label.

### Disabled Button

```html
<button class="action-btn action-btn--disabled" disabled>Unavailable</button>
```

### Disabled Table Row

```html
<tr class="row-disabled">
  <td>prov-004</td>
  <td>Disabled</td>
</tr>
```

---

## Safety Semantics

| Visual Signal | Meaning | Operator Expectation |
|---------------|---------|---------------------|
| Blue border/badge | Preview mode | No mutation will occur |
| Red border/badge | Execute mode | State will change |
| Green border/badge | Safe action | Read-only or benign |
| Pulsing red dot | Confirmation needed | Irreversible action in progress |
| 45% opacity | Disabled | Action unavailable |
| Timeline red dot | Executed event | Mutation occurred |

**Invariant:** Execute buttons MUST appear with red accent. Preview buttons
MUST appear with blue accent. This color coding is the primary safety signal.

---

## Responsive Behavior

| Breakpoint | Action Grid | Timeline |
|------------|-------------|----------|
| `> 768px` | Multi-column | Full layout |
| `<= 768px` | Single column | Reduced left padding |

---

## References

- [Style Guide](provider-pool-webui-style-guide.md) — base design tokens and components
- [Read-Only Mode](provider-pool-webui-readonly-mode.md) — mutation boundary contract
- [Security](provider-pool-webui-security.md) — secret boundary enforcement
- [Architecture](provider-pool-webui-architecture.md) — component structure
