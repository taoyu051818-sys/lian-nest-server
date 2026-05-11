/**
 * Provider Pool WebUI — client script.
 *
 * Renders provider, worker, queue, and resource-pressure JSON snapshots
 * from the sanitized state and policy files. No secrets are ever loaded
 * or displayed.
 *
 * Expected data sources (relative to the HTML page):
 *   ../../../../.github/ai-state/provider-pool.json          (provider pool)
 *   ../../../../.github/ai-policy/provider-pool-policy.json   (policy)
 *   ../../../../.github/ai-state/provider-pool-webui.json     (worker view)
 */

const STATE_URL = '../../../../.github/ai-state/provider-pool.json';
const POLICY_URL = '../../../../.github/ai-policy/provider-pool-policy.json';
const WEBUI_STATE_URL = '../../../../.github/ai-state/provider-pool-webui.json';
const REFRESH_INTERVAL_MS = 30_000;

// ── helpers ──────────────────────────────────────────────────────────

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') node.className = v;
      else if (k === 'textContent') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    }
  }
  if (children) {
    for (const child of Array.isArray(children) ? children : [children]) {
      node.append(child);
    }
  }
  return node;
}

function statusClass(status) {
  switch (status) {
    case 'available': return 'status-available';
    case 'exhausted': return 'status-exhausted';
    case 'disabled': return 'status-disabled';
    default: return '';
  }
}

function formatTimestamp(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function formatCooldown(expiresAt) {
  if (!expiresAt) return null;
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return 'expired';
  const mins = Math.ceil(remaining / 60_000);
  return `${mins}m remaining`;
}

// ── renderers ────────────────────────────────────────────────────────

function renderGlobalSummary(global) {
  return el('div', { className: 'global-summary' }, [
    el('h2', { textContent: 'Pool Overview' }),
    el('div', { className: 'summary-grid' }, [
      metricCard('Active Workers', global.totalActiveWorkers, global.globalMaxWorkers),
      metricCard('Available', global.availableProviders),
      metricCard('Exhausted', global.exhaustedProviders),
      metricCard('Disabled', global.disabledProviders),
    ]),
    el('p', { className: 'updated-at', textContent: `Last captured: ${formatTimestamp(global.capturedAt)}` }),
  ]);
}

function metricCard(label, value, max) {
  const valueText = max != null ? `${value} / ${max}` : String(value);
  return el('div', { className: 'metric-card' }, [
    el('span', { className: 'metric-value', textContent: valueText }),
    el('span', { className: 'metric-label', textContent: label }),
  ]);
}

function renderProviderCard(provider, policyEntry) {
  const cooldown = formatCooldown(provider.cooldownExpiresAt);
  const children = [
    el('div', { className: 'provider-header' }, [
      el('span', { className: 'provider-id', textContent: provider.id }),
      el('span', { className: `provider-status ${statusClass(provider.status)}`, textContent: provider.status }),
    ]),
    el('div', { className: 'provider-details' }, [
      detailRow('Concurrency', `${provider.currentConcurrency} / ${provider.maxConcurrency}`),
      detailRow('Consecutive Failures', provider.consecutiveFailures),
      detailRow('Total Quota Events', provider.totalQuotaEvents),
      detailRow('Last Failure Class', provider.lastFailureClass ?? 'none'),
      detailRow('Last Health Check', formatTimestamp(provider.lastHealthCheckAt)),
    ]),
  ];

  if (cooldown) {
    children.push(el('p', { className: 'cooldown', textContent: `Cooldown: ${cooldown}` }));
  }

  if (policyEntry) {
    children.push(el('div', { className: 'policy-info' }, [
      detailRow('Label', policyEntry.label),
      detailRow('Source', policyEntry.source),
      detailRow('Capabilities', (policyEntry.capabilities ?? []).join(', ') || '—'),
    ]));
  }

  return el('div', { className: 'provider-card' }, children);
}

function detailRow(label, value) {
  return el('div', { className: 'detail-row' }, [
    el('span', { className: 'detail-label', textContent: label }),
    el('span', { className: 'detail-value', textContent: String(value) }),
  ]);
}

function renderError(message) {
  return el('div', { className: 'error-banner', textContent: `Error: ${message}` });
}

// ── worker view renderers ────────────────────────────────────────────

function pressureLevelClass(level) {
  switch (level) {
    case 'normal': return 'status-available';
    case 'elevated': return 'status-exhausted';
    case 'critical': return 'status-disabled';
    default: return '';
  }
}

function workerStatusClass(status) {
  switch (status) {
    case 'running': return 'status-available';
    case 'cooling-down': return 'status-exhausted';
    case 'draining': return 'status-disabled';
    default: return '';
  }
}

function queueStateClass(state) {
  switch (state) {
    case 'running': return 'status-available';
    case 'queued':
    case 'launching': return 'status-exhausted';
    case 'blocked': return 'status-disabled';
    case 'pr-created': return 'status-available';
    case 'done': return '';
    default: return '';
  }
}

function formatElapsed(startedAt) {
  if (!startedAt) return '—';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return '—';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function renderPressureSection(pressure) {
  if (!pressure) return null;
  const levelClass = pressureLevelClass(pressure.level);
  const pct = pressure.utilizationPct ?? 0;
  const barClass = pct < 60 ? 'bar-fill--green' : pct < 90 ? 'bar-fill--yellow' : 'bar-fill--red';
  const children = [
    el('h2', { textContent: 'Resource Pressure' }),
    el('div', { className: 'summary-grid' }, [
      metricCard('Pressure Level', pressure.level ?? '—'),
      metricCard('Utilization', `${pct.toFixed(1)}%`),
      metricCard('Nearest Cooldown', pressure.nearestCooldownExpiry
        ? formatTimestamp(pressure.nearestCooldownExpiry)
        : 'none'),
    ]),
    el('div', { className: 'bar-track' }, [
      el('div', { className: `bar-fill ${barClass}`, style: `width:${Math.min(pct, 100)}%` }),
    ]),
  ];
  return el('div', { className: 'pressure-section' }, children);
}

function renderQueueSection(queue, queueEntries) {
  if (!queue && !queueEntries) return null;
  const children = [el('h2', { textContent: 'Queue' })];

  if (queue) {
    children.push(
      el('div', { className: 'summary-grid' }, [
        metricCard('Pending', queue.pendingTasks ?? 0),
        metricCard('Blocked (Exhaustion)', queue.blockedByExhaustion ?? 0),
        metricCard('Blocked (Conflict)', queue.blockedByConflict ?? 0),
        metricCard('Blocked (Capacity)', queue.blockedByCapacity ?? 0),
      ]),
    );
  }

  if (queueEntries && queueEntries.length > 0) {
    const rows = queueEntries.map(entry =>
      el('tr', null, [
        el('td', { textContent: entry.issueNumber ? `#${entry.issueNumber}` : '—' }),
        el('td', null, [
          el('span', { className: `queue-state ${queueStateClass(entry.state)}`, textContent: entry.state }),
        ]),
        el('td', { textContent: entry.conflictGroup ?? '—' }),
        el('td', { textContent: entry.actorRole ?? '—' }),
        el('td', { textContent: entry.reason ?? '—' }),
        el('td', { textContent: formatTimestamp(entry.updatedAt) }),
      ]),
    );
    children.push(
      el('table', { className: 'queue-table' }, [
        el('thead', null, [
          el('tr', null, [
            el('th', { textContent: 'Issue' }),
            el('th', { textContent: 'State' }),
            el('th', { textContent: 'Conflict Group' }),
            el('th', { textContent: 'Role' }),
            el('th', { textContent: 'Reason' }),
            el('th', { textContent: 'Updated' }),
          ]),
        ]),
        el('tbody', null, rows),
      ]),
    );
  }

  return el('div', { className: 'queue-section' }, children);
}

function renderWorkersSection(workers, assignmentData) {
  const hasWebUIWorkers = workers && workers.length > 0;
  const hasAssignments = assignmentData && assignmentData.assignments
    && assignmentData.assignments.length > 0;
  if (!hasWebUIWorkers && !hasAssignments) return null;

  const children = [el('h2', { textContent: 'Workers' })];

  // Prefer the WebUI state contract workers array
  if (hasWebUIWorkers) {
    const rows = workers.map(w =>
      el('tr', null, [
        el('td', { textContent: w.issue ? `#${w.issue}` : '—' }),
        el('td', { textContent: w.branch ?? '—' }),
        el('td', { textContent: w.conflictGroup ?? '—' }),
        el('td', { textContent: w.providerId ?? '—' }),
        el('td', null, [
          el('span', { className: `worker-status ${workerStatusClass(w.status)}`, textContent: w.status }),
        ]),
        el('td', { textContent: formatElapsed(w.startedAt) }),
      ]),
    );
    children.push(
      el('table', { className: 'workers-table' }, [
        el('thead', null, [
          el('tr', null, [
            el('th', { textContent: 'Issue' }),
            el('th', { textContent: 'Branch' }),
            el('th', { textContent: 'Conflict Group' }),
            el('th', { textContent: 'Provider' }),
            el('th', { textContent: 'Status' }),
            el('th', { textContent: 'Elapsed' }),
          ]),
        ]),
        el('tbody', null, rows),
      ]),
    );
  } else if (hasAssignments) {
    // Fallback: use assignment state data
    const rows = assignmentData.assignments.map(a =>
      el('tr', null, [
        el('td', { textContent: a.issueNumber ? `#${a.issueNumber}` : a.taskId }),
        el('td', { textContent: a.providerId }),
        el('td', { textContent: a.taskType ?? '—' }),
        el('td', { textContent: a.actorRole ?? '—' }),
        el('td', { textContent: formatTimestamp(a.assignedAt) }),
      ]),
    );
    children.push(
      el('table', { className: 'workers-table' }, [
        el('thead', null, [
          el('tr', null, [
            el('th', { textContent: 'Task' }),
            el('th', { textContent: 'Provider' }),
            el('th', { textContent: 'Type' }),
            el('th', { textContent: 'Role' }),
            el('th', { textContent: 'Assigned' }),
          ]),
        ]),
        el('tbody', null, rows),
      ]),
    );
  }

  return el('div', { className: 'workers-section' }, children);
}

// ── main app ─────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function refresh(root) {
  let state, policy, webuiState;
  try {
    [state, policy] = await Promise.all([fetchJSON(STATE_URL), fetchJSON(POLICY_URL)]);
  } catch (err) {
    root.replaceChildren(renderError(err.message));
    return;
  }

  // WebUI state is optional — the reconciler may not have written it yet
  try {
    webuiState = await fetchJSON(WEBUI_STATE_URL);
  } catch {
    webuiState = null;
  }

  const policyMap = Object.fromEntries(
    (policy.providers ?? []).map(p => [p.id, p]),
  );

  const children = [
    renderGlobalSummary(state.global ?? {}),
    el('h2', { textContent: 'Providers' }),
  ];

  for (const provider of state.providers ?? []) {
    children.push(renderProviderCard(provider, policyMap[provider.id]));
  }

  // Worker view sections from the WebUI state projection
  if (webuiState) {
    const pressureEl = renderPressureSection(webuiState.pressure);
    if (pressureEl) children.push(pressureEl);

    const queueEl = renderQueueSection(
      webuiState.queue,
      webuiState.queueEntries,
    );
    if (queueEl) children.push(queueEl);

    const workersEl = renderWorkersSection(
      webuiState.workers,
      webuiState.assignments,
    );
    if (workersEl) children.push(workersEl);
  }

  root.replaceChildren(...children);
}

function boot() {
  const root = document.getElementById('provider-pool-root');
  if (!root) {
    console.error('[provider-pool] #provider-pool-root element not found');
    return;
  }
  refresh(root);
  setInterval(() => refresh(root), REFRESH_INTERVAL_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
