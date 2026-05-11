/**
 * Provider Pool WebUI — client script.
 *
 * Renders provider, worker, queue, and resource-pressure JSON snapshots
 * from the sanitized state and policy files. No secrets are ever loaded
 * or displayed.
 *
 * Includes Operation Console for preview/execute/audit of controlled
 * actions. All actions default to preview mode; execute requires typed
 * confirmation and respects policy guard semantics.
 *
 * Expected data sources (relative to the HTML page):
 *   ../../../../.github/ai-state/provider-pool.json          (provider pool)
 *   ../../../../.github/ai-policy/provider-pool-policy.json   (policy)
 *   ../../../../.github/ai-state/provider-pool-webui.json     (worker view)
 */

const STATE_URL = '../../../../.github/ai-state/provider-pool.json';
const POLICY_URL = '../../../../.github/ai-policy/provider-pool-policy.json';
const WEBUI_STATE_URL = '../../../../.github/ai-state/provider-pool-webui.json';
const PLANNING_URL = '/api/planning';
const REFRESH_INTERVAL_MS = 30_000;

// Action API endpoints (relative to WebUI server origin)
const ACTIONS_LIST_URL = '/api/actions';
const ACTIONS_PREVIEW_URL = '/api/actions/preview';
const ACTIONS_EXECUTE_URL = '/api/actions/execute';
const SERVER_AUDIT_URL = '/api/audit';

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

// ── operation console ─────────────────────────────────────────────────

const ACTION_REGISTRY = {
  provider: [
    {
      id: 'provider.retry',
      label: 'Retry Provider',
      description: 'Attempt to re-enable a disabled or exhausted provider',
      riskLevel: 'low',
      confirmPhrase: 'RETRY',
      applicable: (p) => p.status === 'exhausted' || p.status === 'disabled',
      preview: (p) => ({
        action: 'provider.retry',
        target: p.id,
        currentStatus: p.status,
        willBecome: 'available',
        requiresGuard: true,
      }),
    },
    {
      id: 'provider.clearCooldown',
      label: 'Clear Cooldown',
      description: 'Remove the cooldown timer on a provider',
      riskLevel: 'medium',
      confirmPhrase: 'CLEAR',
      applicable: (p) => !!p.cooldownExpiresAt,
      preview: (p) => ({
        action: 'provider.clearCooldown',
        target: p.id,
        cooldownExpiresAt: p.cooldownExpiresAt,
        willRemoveCooldown: true,
        requiresGuard: true,
      }),
    },
    {
      id: 'provider.disable',
      label: 'Disable Provider',
      description: 'Manually disable a provider (blocks new assignments)',
      riskLevel: 'high',
      confirmPhrase: 'DISABLE',
      humanRequired: true,
      applicable: (p) => p.status === 'available',
      preview: (p) => ({
        action: 'provider.disable',
        target: p.id,
        currentStatus: p.status,
        willBecome: 'disabled',
        humanRequired: true,
        blocker: 'Operator must confirm — provider will stop accepting tasks',
      }),
    },
  ],
  queue: [
    {
      id: 'queue.retryBlocked',
      label: 'Retry Blocked Tasks',
      description: 'Re-queue tasks blocked by exhaustion or conflict',
      riskLevel: 'low',
      confirmPhrase: 'RETRY',
      applicable: (_q, entries) => entries?.some((e) => e.state === 'blocked'),
      preview: (_q, entries) => {
        const blocked = (entries || []).filter((e) => e.state === 'blocked');
        return {
          action: 'queue.retryBlocked',
          affectedTasks: blocked.length,
          tasks: blocked.map((e) => e.issueNumber ? `#${e.issueNumber}` : e.taskId),
          requiresGuard: true,
        };
      },
    },
    {
      id: 'queue.clearStale',
      label: 'Clear Stale Entries',
      description: 'Remove queue entries older than 2 hours with no update',
      riskLevel: 'medium',
      confirmPhrase: 'CLEAR',
      applicable: (_q, entries) => entries?.some((e) => {
        if (!e.updatedAt) return false;
        return Date.now() - new Date(e.updatedAt).getTime() > 7_200_000;
      }),
      preview: (_q, entries) => {
        const stale = (entries || []).filter((e) => {
          if (!e.updatedAt) return false;
          return Date.now() - new Date(e.updatedAt).getTime() > 7_200_000;
        });
        return {
          action: 'queue.clearStale',
          affectedTasks: stale.length,
          tasks: stale.map((e) => e.issueNumber ? `#${e.issueNumber}` : e.taskId),
          requiresGuard: true,
        };
      },
    },
  ],
  global: [
    {
      id: 'global.refreshState',
      label: 'Force State Refresh',
      description: 'Trigger an immediate state file refresh',
      riskLevel: 'low',
      confirmPhrase: 'REFRESH',
      applicable: () => true,
      preview: () => ({
        action: 'global.refreshState',
        willRefresh: ['provider-pool.json', 'provider-pool-webui.json'],
        requiresGuard: false,
      }),
    },
    {
      id: 'global.exportAudit',
      label: 'Export Audit Log',
      description: 'Download the operation console audit log as JSON',
      riskLevel: 'low',
      confirmPhrase: 'EXPORT',
      applicable: () => auditLog.length > 0,
      preview: () => ({
        action: 'global.exportAudit',
        entryCount: auditLog.length,
        requiresGuard: false,
      }),
    },
  ],
};

const auditLog = [];
let cachedServerActions = [];
let cachedServerAudit = [];

function logAuditEvent(entry) {
  auditLog.push({
    ...entry,
    timestamp: new Date().toISOString(),
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  });
}

// ── server action module integration ─────────────────────────────────

async function fetchServerActions() {
  try {
    const data = await fetchJSON(ACTIONS_LIST_URL);
    return Array.isArray(data.actions) ? data.actions : [];
  } catch {
    return [];
  }
}

async function fetchServerAudit() {
  try {
    const data = await fetchJSON(SERVER_AUDIT_URL);
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

async function requestServerPreview(actionId, payload) {
  const res = await fetch(ACTIONS_PREVIEW_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionId, payload }),
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Preview failed (${res.status})`);
  return data;
}

async function requestServerExecute(actionId, payload) {
  const res = await fetch(ACTIONS_EXECUTE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionId, payload, confirm: true }),
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Execution failed (${res.status})`);
  return data;
}

function riskClass(level) {
  switch (level) {
    case 'low': return 'status-available';
    case 'medium': return 'status-exhausted';
    case 'high': return 'status-disabled';
    default: return '';
  }
}

function riskBadge(level) {
  return el('span', {
    className: `risk-badge ${riskClass(level)}`,
    textContent: level.toUpperCase(),
  });
}

function renderPreviewPayload(payload) {
  const entries = Object.entries(payload);
  const rows = entries.map(([key, value]) =>
    el('tr', null, [
      el('td', { className: 'preview-key', textContent: key }),
      el('td', { className: 'preview-value', textContent: formatPreviewValue(value) }),
    ]),
  );
  return el('table', { className: 'preview-table' }, [
    el('thead', null, [el('tr', null, [
      el('th', { textContent: 'Field' }),
      el('th', { textContent: 'Value' }),
    ])]),
    el('tbody', null, rows),
  ]);
}

function formatPreviewValue(value) {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '(empty)';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderActionCard(action, contextData, allData) {
  const { provider, queue, queueEntries } = contextData;
  const isApplicable = action.applicable(
    provider || {},
    provider ? undefined : (queue || null),
    provider ? undefined : (queueEntries || null),
  );

  const card = el('div', { className: `action-card ${isApplicable ? '' : 'action-card--disabled'}` });

  const header = el('div', { className: 'action-card__header' }, [
    el('span', { className: 'action-card__label', textContent: action.label }),
    riskBadge(action.riskLevel),
  ]);
  card.append(header);

  const desc = el('p', { className: 'action-card__desc', textContent: action.description });
  card.append(desc);

  if (action.humanRequired) {
    card.append(el('div', { className: 'action-card__blocker', textContent: '⚠ Human approval required' }));
  }

  if (!isApplicable) {
    card.append(el('p', { className: 'action-card__na', textContent: 'Not applicable to current state' }));
    return card;
  }

  // Preview button
  const previewBtn = el('button', {
    className: 'action-btn action-btn--preview',
    textContent: 'Preview',
    onClick: () => showPreview(action, contextData, allData, card),
  });
  card.append(previewBtn);

  return card;
}

function showPreview(action, contextData, allData, parentCard) {
  // Remove any existing preview/execute panel in this card
  const existing = parentCard.querySelector('.action-panel');
  if (existing) existing.remove();

  const previewData = action.preview(
    contextData.provider || {},
    contextData.provider ? undefined : (contextData.queue || null),
    contextData.provider ? undefined : (contextData.queueEntries || null),
  );

  const panel = el('div', { className: 'action-panel' });
  panel.append(el('h4', { className: 'action-panel__title', textContent: 'Preview' }));

  if (previewData.humanRequired) {
    panel.append(el('div', { className: 'action-panel__warning', textContent: previewData.blocker || 'Human approval required' }));
  }

  if (previewData.requiresGuard) {
    panel.append(el('p', { className: 'action-panel__guard', textContent: 'Guard validation will run before execution' }));
  }

  panel.append(renderPreviewPayload(previewData));

  // Execute button (only after preview)
  const executeBtn = el('button', {
    className: 'action-btn action-btn--execute',
    textContent: 'Execute…',
    onClick: () => showExecuteConfirm(action, contextData, allData, panel),
  });
  panel.append(executeBtn);

  parentCard.append(panel);
}

function showExecuteConfirm(action, contextData, allData, parentPanel) {
  const existing = parentPanel.querySelector('.execute-confirm');
  if (existing) existing.remove();

  const confirm = el('div', { className: 'execute-confirm' });

  if (action.riskLevel === 'high' || action.humanRequired) {
    confirm.append(el('div', { className: 'execute-confirm__blocker', textContent: 'This action requires human approval and cannot be auto-executed' }));
    parentPanel.append(confirm);
    return;
  }

  confirm.append(el('p', {
    className: 'execute-confirm__prompt',
    textContent: `Type "${action.confirmPhrase}" to confirm execution:`,
  }));

  const input = el('input', {
    className: 'execute-confirm__input',
    type: 'text',
    placeholder: action.confirmPhrase,
    autocomplete: 'off',
  });
  confirm.append(input);

  const btnRow = el('div', { className: 'execute-confirm__actions' });

  const cancelBtn = el('button', {
    className: 'action-btn action-btn--cancel',
    textContent: 'Cancel',
    onClick: () => confirm.remove(),
  });

  const goBtn = el('button', {
    className: 'action-btn action-btn--execute action-btn--disabled',
    textContent: 'Execute',
    disabled: 'true',
  });

  input.addEventListener('input', () => {
    const match = input.value.trim() === action.confirmPhrase;
    goBtn.disabled = !match;
    goBtn.className = `action-btn action-btn--execute ${match ? '' : 'action-btn--disabled'}`;
  });

  goBtn.addEventListener('click', () => {
    if (input.value.trim() !== action.confirmPhrase) return;
    executeAction(action, contextData, allData, confirm);
  });

  btnRow.append(cancelBtn, goBtn);
  confirm.append(btnRow);
  parentPanel.append(confirm);
  input.focus();
}

function executeAction(action, contextData, _allData, confirmEl) {
  const previewData = action.preview(
    contextData.provider || {},
    contextData.provider ? undefined : (contextData.queue || null),
    contextData.provider ? undefined : (contextData.queueEntries || null),
  );

  // Record in audit log
  logAuditEvent({
    action: action.id,
    riskLevel: action.riskLevel,
    target: contextData.provider?.id || 'global',
    payload: previewData,
    mode: 'execute',
    status: 'dispatched',
    note: 'Client-side dispatch recorded; server guard required for mutation',
  });

  // Replace confirm with result
  confirmEl.replaceChildren(
    el('div', { className: 'execute-result execute-result--dispatched' }, [
      el('p', { textContent: `Action "${action.label}" dispatched for guard validation` }),
      el('p', { className: 'execute-result__note', textContent: 'Server guard must approve before mutation is applied' }),
    ]),
  );
}

// ── server action module cards ────────────────────────────────────────

function renderServerActionCards(serverActions, allData) {
  if (!serverActions || serverActions.length === 0) return null;

  const section = el('div', { className: 'console-group' });
  section.append(el('h3', { textContent: 'Action Modules (Server)' }));

  const grid = el('div', { className: 'action-grid' });
  for (const action of serverActions) {
    grid.append(renderServerActionCard(action, allData));
  }
  section.append(grid);
  return section;
}

function renderServerActionCard(actionMeta, allData) {
  const card = el('div', { className: 'action-card action-card--server' });

  const header = el('div', { className: 'action-card__header' }, [
    el('span', { className: 'action-card__label', textContent: actionMeta.label }),
    el('div', { className: 'action-card__badges' }, [
      riskBadge(actionMeta.dangerous ? 'high' : 'low'),
      el('span', {
        className: 'risk-badge',
        style: 'background:rgba(96,165,250,0.12);color:#60a5fa',
        textContent: 'MODULE',
      }),
    ]),
  ]);
  card.append(header);

  if (actionMeta.description) {
    card.append(el('p', { className: 'action-card__desc', textContent: actionMeta.description }));
  }

  if (actionMeta.dangerous) {
    card.append(el('div', { className: 'action-card__blocker', textContent: '⚠ Dangerous — requires explicit confirmation' }));
  }

  // Build payload form
  const form = buildPayloadForm(actionMeta, allData);
  card.append(form);

  // Preview button
  const previewBtn = el('button', {
    className: 'action-btn action-btn--preview',
    textContent: 'Preview',
  });

  const resultContainer = el('div', { className: 'server-action-result' });
  card.append(previewBtn);
  card.append(resultContainer);

  previewBtn.addEventListener('click', async () => {
    const payload = collectFormPayload(form);
    resultContainer.replaceChildren(el('p', { className: 'action-panel__guard', textContent: 'Requesting preview…' }));

    try {
      const previewResult = await requestServerPreview(actionMeta.id, payload);
      showServerPreviewResult(previewResult, actionMeta, payload, resultContainer, allData);
    } catch (err) {
      resultContainer.replaceChildren(
        el('div', { className: 'action-panel__warning', textContent: `Preview error: ${err.message}` }),
      );
    }
  });

  return card;
}

function buildPayloadForm(actionMeta, allData) {
  const form = el('div', { className: 'action-form' });
  const providers = allData.state?.providers || [];

  // If the action id hints at provider context, add a provider selector
  const isProviderAction = /provider|cooldown|retry/i.test(actionMeta.id);

  if (isProviderAction && providers.length > 0) {
    const selectWrap = el('div', { className: 'action-form__field' });
    selectWrap.append(el('label', { className: 'action-form__label', textContent: 'Provider' }));

    const select = el('select', { className: 'action-form__select', 'data-field': 'providerId' });
    select.append(el('option', { value: '', textContent: '— select provider —' }));
    for (const p of providers) {
      select.append(el('option', { value: p.id, textContent: `${p.id} (${p.status})` }));
    }
    selectWrap.append(select);
    form.append(selectWrap);
  }

  // Structured reason field for provider-rotation
  if (actionMeta.id === 'provider-rotation') {
    const reasonWrap = el('div', { className: 'action-form__field' });
    reasonWrap.append(el('label', { className: 'action-form__label', textContent: 'Reason (optional)' }));
    const reasonInput = el('input', {
      className: 'action-form__input',
      type: 'text',
      'data-field': 'reason',
      placeholder: 'e.g. credential rotation, quota reset',
      autocomplete: 'off',
    });
    reasonWrap.append(reasonInput);
    form.append(reasonWrap);
  }

  // Generic JSON payload editor for advanced params
  const jsonWrap = el('div', { className: 'action-form__field' });
  jsonWrap.append(el('label', { className: 'action-form__label', textContent: 'Payload (JSON)' }));
  const textarea = el('textarea', {
    className: 'action-form__textarea',
    'data-field': 'jsonPayload',
    placeholder: '{}',
    rows: '3',
  });
  jsonWrap.append(textarea);
  form.append(jsonWrap);

  return form;
}

function collectFormPayload(form) {
  const payload = {};

  // Collect select fields
  for (const select of form.querySelectorAll('select[data-field]')) {
    if (select.value) payload[select.dataset.field] = select.value;
  }

  // Collect text input fields
  for (const input of form.querySelectorAll('input[data-field]')) {
    if (input.value) payload[input.dataset.field] = input.value;
  }

  // Merge JSON payload if provided
  const textarea = form.querySelector('textarea[data-field="jsonPayload"]');
  if (textarea && textarea.value.trim()) {
    try {
      const jsonPayload = JSON.parse(textarea.value.trim());
      Object.assign(payload, jsonPayload);
    } catch {
      // ignore invalid JSON — server will handle it
    }
  }

  return payload;
}

function showServerPreviewResult(previewResult, actionMeta, payload, container, _allData) {
  container.replaceChildren();

  // Preview result panel
  const panel = el('div', { className: 'action-panel' });
  panel.append(el('h4', { className: 'action-panel__title', textContent: 'Server Preview' }));

  if (previewResult.dryRun) {
    panel.append(el('p', { className: 'action-panel__guard', textContent: 'DRY RUN — no side effects' }));
  }

  if (previewResult.preview) {
    panel.append(renderPreviewPayload(previewResult.preview));
  } else if (previewResult.message) {
    panel.append(el('p', { className: 'action-card__desc', textContent: previewResult.message }));
  }

  // Execute button (only after preview)
  const executeBtn = el('button', {
    className: 'action-btn action-btn--execute',
    textContent: 'Execute…',
  });
  panel.append(executeBtn);
  container.append(panel);

  // Execute confirmation flow
  executeBtn.addEventListener('click', () => {
    const existing = panel.querySelector('.execute-confirm');
    if (existing) existing.remove();

    const confirm = el('div', { className: 'execute-confirm' });

    confirm.append(el('p', {
      className: 'execute-confirm__prompt',
      textContent: `Type "EXECUTE" to run "${actionMeta.label}" on server:`,
    }));

    const input = el('input', {
      className: 'execute-confirm__input',
      type: 'text',
      placeholder: 'EXECUTE',
      autocomplete: 'off',
    });
    confirm.append(input);

    const btnRow = el('div', { className: 'execute-confirm__actions' });

    const cancelBtn = el('button', {
      className: 'action-btn action-btn--cancel',
      textContent: 'Cancel',
      onClick: () => confirm.remove(),
    });

    const goBtn = el('button', {
      className: 'action-btn action-btn--execute action-btn--disabled',
      textContent: 'Execute',
      disabled: 'true',
    });

    input.addEventListener('input', () => {
      const match = input.value.trim() === 'EXECUTE';
      goBtn.disabled = !match;
      goBtn.className = `action-btn action-btn--execute ${match ? '' : 'action-btn--disabled'}`;
    });

    goBtn.addEventListener('click', async () => {
      if (input.value.trim() !== 'EXECUTE') return;

      confirm.replaceChildren(el('p', { className: 'action-panel__guard', textContent: 'Executing…' }));

      try {
        const result = await requestServerExecute(actionMeta.id, payload);
        // Record in client audit
        logAuditEvent({
          action: actionMeta.id,
          riskLevel: actionMeta.dangerous ? 'high' : 'low',
          target: payload.providerId || 'server-module',
          payload,
          mode: 'execute',
          status: result.ok ? 'success' : 'failed',
          serverAuditId: result.auditId,
        });

        const resultPanel = el('div', { className: 'execute-result execute-result--dispatched' }, [
          el('p', { textContent: result.ok
            ? `Action "${actionMeta.label}" executed successfully`
            : `Action "${actionMeta.label}" failed`,
          }),
        ]);
        if (result.auditId) {
          resultPanel.append(el('p', { className: 'execute-result__note', textContent: `Audit ID: ${result.auditId}` }));
        }
        if (result.result) {
          resultPanel.append(el('pre', {
            className: 'execute-result__payload',
            textContent: JSON.stringify(result.result, null, 2),
          }));
        }
        confirm.replaceWith(resultPanel);
      } catch (err) {
        logAuditEvent({
          action: actionMeta.id,
          riskLevel: actionMeta.dangerous ? 'high' : 'low',
          target: payload.providerId || 'server-module',
          payload,
          mode: 'execute',
          status: 'error',
          note: err.message,
        });
        confirm.replaceChildren(
          el('div', { className: 'action-panel__warning', textContent: `Execution error: ${err.message}` }),
        );
      }
    });

    btnRow.append(cancelBtn, goBtn);
    confirm.append(btnRow);
    panel.append(confirm);
    input.focus();
  });
}

function renderOperationConsole(allData) {
  const { state, policy, webuiState } = allData;
  const container = el('div', { className: 'console-section' });
  container.append(el('h2', { textContent: 'Operation Console' }));

  // Preview mode indicator
  container.append(el('div', { className: 'console-mode-banner' }, [
    el('span', { className: 'console-mode-label', textContent: 'MODE:' }),
    el('span', { className: 'console-mode-value', textContent: 'PREVIEW (default)' }),
    el('span', { className: 'console-mode-note', textContent: 'Execute requires typed confirmation' }),
  ]));

  // Server action modules (loaded from action module directory)
  const serverSection = renderServerActionCards(cachedServerActions, allData);
  if (serverSection) container.append(serverSection);

  // Provider actions (client-side)
  const providers = state?.providers || [];
  if (providers.length > 0) {
    const providerSection = el('div', { className: 'console-group' });
    providerSection.append(el('h3', { textContent: 'Provider Actions' }));

    for (const provider of providers) {
      const providerBlock = el('div', { className: 'console-provider-block' });
      providerBlock.append(el('h4', {
        className: 'console-provider-id',
        textContent: `${provider.id} (${provider.status})`,
      }));

      const actionGrid = el('div', { className: 'action-grid' });
      for (const action of ACTION_REGISTRY.provider) {
        actionGrid.append(renderActionCard(action, { provider }, allData));
      }
      providerBlock.append(actionGrid);
      providerSection.append(providerBlock);
    }
    container.append(providerSection);
  }

  // Queue actions (client-side)
  if (webuiState?.queueEntries?.length > 0 || webuiState?.queue) {
    const queueSection = el('div', { className: 'console-group' });
    queueSection.append(el('h3', { textContent: 'Queue Actions' }));

    const actionGrid = el('div', { className: 'action-grid' });
    for (const action of ACTION_REGISTRY.queue) {
      actionGrid.append(renderActionCard(
        action,
        { queue: webuiState?.queue, queueEntries: webuiState?.queueEntries },
        allData,
      ));
    }
    queueSection.append(actionGrid);
    container.append(queueSection);
  }

  // Global actions (client-side)
  const globalSection = el('div', { className: 'console-group' });
  globalSection.append(el('h3', { textContent: 'Global Actions' }));

  const globalGrid = el('div', { className: 'action-grid' });
  for (const action of ACTION_REGISTRY.global) {
    globalGrid.append(renderActionCard(action, {}, allData));
  }
  globalSection.append(globalGrid);
  container.append(globalSection);

  // Merged audit log (client + server)
  container.append(renderAuditSection());

  return container;
}

function renderAuditSection() {
  const section = el('div', { className: 'console-group console-audit' });
  section.append(el('h3', { textContent: 'Audit Log' }));

  // Merge client-side and server-side audit entries
  const serverRows = (cachedServerAudit || []).map((entry) =>
    el('tr', { className: 'audit-row--server' }, [
      el('td', { className: 'mono', textContent: formatTimestamp(entry.completedAt || entry.startedAt) }),
      el('td', { textContent: entry.actionId }),
      el('td', null, [riskBadge(entry.status === 'error' ? 'high' : 'low')]),
      el('td', { textContent: 'server' }),
      el('td', { textContent: 'execute' }),
      el('td', null, [
        el('span', {
          className: `badge ${entry.status === 'success' ? 'badge-available' : 'badge-disabled'}`,
          textContent: entry.status,
        }),
      ]),
    ]),
  );

  const clientRows = auditLog.map((entry) =>
    el('tr', null, [
      el('td', { className: 'mono', textContent: formatTimestamp(entry.timestamp) }),
      el('td', { textContent: entry.action }),
      el('td', null, [riskBadge(entry.riskLevel)]),
      el('td', { textContent: entry.target || '—' }),
      el('td', { textContent: entry.mode }),
      el('td', { textContent: entry.status }),
    ]),
  );

  const allRows = [...serverRows, ...clientRows];

  if (allRows.length === 0) {
    section.append(el('p', { className: 'empty-state', textContent: 'No operations recorded in this session' }));
    return section;
  }

  section.append(
    el('table', { className: 'audit-table' }, [
      el('thead', null, [el('tr', null, [
        el('th', { textContent: 'Time' }),
        el('th', { textContent: 'Action' }),
        el('th', { textContent: 'Risk' }),
        el('th', { textContent: 'Target' }),
        el('th', { textContent: 'Mode' }),
        el('th', { textContent: 'Status' }),
      ])]),
      el('tbody', null, allRows),
    ]),
  );

  // Refresh server audit button
  const refreshBtn = el('button', {
    className: 'action-btn action-btn--safe',
    textContent: 'Refresh Server Audit',
    onClick: async () => {
      cachedServerAudit = await fetchServerAudit();
      const parent = section.parentElement;
      if (parent) {
        const oldAudit = parent.querySelector('.console-audit');
        if (oldAudit) oldAudit.replaceWith(renderAuditSection());
      }
    },
  });
  section.append(refreshBtn);

  return section;
}

// ── planning console ──────────────────────────────────────────────────

function trustColor(trust) {
  if (trust >= 70) return 'status-available';
  if (trust >= 40) return 'status-exhausted';
  return 'status-disabled';
}

function severityColor(severity) {
  switch (severity) {
    case 'low': return 'status-available';
    case 'medium': return 'status-exhausted';
    case 'high':
    case 'critical': return 'status-disabled';
    default: return '';
  }
}

function readinessColor(readiness) {
  switch (readiness) {
    case 'ready': return 'status-available';
    case 'blocked': return 'status-disabled';
    case 'done': return '';
    default: return '';
  }
}

function healthStateColor(state) {
  switch (state) {
    case 'green': return 'status-available';
    case 'yellow': return 'status-exhausted';
    case 'red':
    case 'black': return 'status-disabled';
    default: return '';
  }
}

function renderMetaSignals(signals) {
  if (!signals) return null;
  const s = signals.signals || {};
  const container = el('div', { className: 'planning-section' });
  container.append(el('h3', { textContent: 'Meta Signals' }));

  const trustVal = s.trust ?? 0;
  const trustBarClass = trustVal >= 70 ? 'bar-fill--green' : trustVal >= 40 ? 'bar-fill--yellow' : 'bar-fill--red';

  const grid = el('div', { className: 'planning-signals-grid' }, [
    el('div', { className: 'planning-signal-card' }, [
      el('span', { className: 'planning-signal-label', textContent: 'Trust' }),
      el('span', { className: `planning-signal-value ${trustColor(trustVal)}`, textContent: String(trustVal) }),
      el('div', { className: 'bar-track' }, [
        el('div', { className: `bar-fill ${trustBarClass}`, style: `width:${trustVal}%` }),
      ]),
    ]),
    el('div', { className: 'planning-signal-card' }, [
      el('span', { className: 'planning-signal-label', textContent: 'Failure' }),
      el('span', { className: 'planning-signal-value', textContent: String(s.failureScore ?? 0) }),
    ]),
    el('div', { className: 'planning-signal-card' }, [
      el('span', { className: 'planning-signal-label', textContent: 'Friction' }),
      el('span', { className: 'planning-signal-value', textContent: String(s.frictionScore ?? 0) }),
    ]),
    el('div', { className: 'planning-signal-card' }, [
      el('span', { className: 'planning-signal-label', textContent: 'Risk' }),
      el('span', { className: 'planning-signal-value', textContent: String(s.riskScore ?? 0) }),
    ]),
    el('div', { className: 'planning-signal-card' }, [
      el('span', { className: 'planning-signal-label', textContent: 'Cost (min)' }),
      el('span', { className: 'planning-signal-value', textContent: String(s.cost ?? 0) }),
    ]),
    el('div', { className: 'planning-signal-card' }, [
      el('span', { className: 'planning-signal-label', textContent: 'Top Pain' }),
      el('span', { className: 'planning-signal-value font-mono', textContent: s.topPain ?? 'none' }),
    ]),
  ]);

  container.append(grid);
  return container;
}

function renderGapLedger(gaps) {
  if (!gaps || gaps.length === 0) return null;
  const container = el('div', { className: 'planning-section' });
  container.append(el('h3', { textContent: 'Gap Ledger' }));

  const rows = gaps.map((g) =>
    el('tr', null, [
      el('td', { className: 'mono', textContent: formatTimestamp(g.recordedAt) }),
      el('td', { textContent: g.gapType }),
      el('td', null, [
        el('span', { className: `badge ${severityColor(g.severity)}`, textContent: g.severity }),
      ]),
      el('td', { textContent: g.description }),
      el('td', { textContent: g.issue ? `#${g.issue}` : '—' }),
      el('td', { textContent: g.branch ?? '—' }),
    ]),
  );

  container.append(
    el('div', { className: 'table-wrap' }, [
      el('table', null, [
        el('thead', null, [el('tr', null, [
          el('th', { textContent: 'Time' }),
          el('th', { textContent: 'Type' }),
          el('th', { textContent: 'Severity' }),
          el('th', { textContent: 'Description' }),
          el('th', { textContent: 'Issue' }),
          el('th', { textContent: 'Branch' }),
        ])]),
        el('tbody', null, rows),
      ]),
    ]),
  );

  return container;
}

function renderProposedBatch(batch) {
  if (!batch) return null;
  const candidates = batch.candidates || [];
  if (candidates.length === 0) return null;

  const container = el('div', { className: 'planning-section' });
  container.append(el('h3', { textContent: 'Proposed Batch' }));

  if (batch.conflictWarnings && batch.conflictWarnings.length > 0) {
    for (const warn of batch.conflictWarnings) {
      container.append(el('div', {
        className: 'warning-banner',
        textContent: `Conflict: ${warn}`,
      }));
    }
  }

  const rows = candidates.map((c) =>
    el('tr', null, [
      el('td', { textContent: c.issueNumber ? `#${c.issueNumber}` : '—' }),
      el('td', { textContent: c.title ?? '—' }),
      el('td', { textContent: c.taskType }),
      el('td', null, [riskBadge(c.risk)]),
      el('td', { textContent: c.conflictGroup ?? '—' }),
      el('td', { textContent: c.actorRole ?? '—' }),
      el('td', null, [
        el('span', { className: `badge ${readinessColor(c.readiness)}`, textContent: c.readiness }),
      ]),
      el('td', { textContent: c.readinessNote ?? '—' }),
    ]),
  );

  container.append(
    el('div', { className: 'table-wrap' }, [
      el('table', null, [
        el('thead', null, [el('tr', null, [
          el('th', { textContent: 'Issue' }),
          el('th', { textContent: 'Title' }),
          el('th', { textContent: 'Type' }),
          el('th', { textContent: 'Risk' }),
          el('th', { textContent: 'Conflict Group' }),
          el('th', { textContent: 'Role' }),
          el('th', { textContent: 'Readiness' }),
          el('th', { textContent: 'Note' }),
        ])]),
        el('tbody', null, rows),
      ]),
    ]),
  );

  return container;
}

function renderBatchPreview(launchPlan) {
  if (!launchPlan) return null;
  const container = el('div', { className: 'planning-section' });
  container.append(el('h3', { textContent: 'Batch Preview' }));

  // Main health indicator
  if (launchPlan.mainHealth) {
    const mh = launchPlan.mainHealth;
    const healthRow = el('div', { className: 'planning-health-row' }, [
      el('span', { className: 'planning-health-label', textContent: 'Main Health' }),
      el('span', {
        className: `badge ${healthStateColor(mh.state)}`,
        textContent: (mh.state || '—').toUpperCase(),
      }),
      el('span', {
        className: 'planning-health-time mono',
        textContent: formatTimestamp(mh.capturedAt),
      }),
    ]);
    if (mh.reason) {
      healthRow.append(el('span', { className: 'planning-health-reason', textContent: mh.reason }));
    }
    container.append(healthRow);
  }

  // Budget summary
  if (launchPlan.budgetReservations) {
    const b = launchPlan.budgetReservations;
    const budgetGrid = el('div', { className: 'planning-budget-grid' }, [
      el('div', { className: 'planning-budget-card' }, [
        el('span', { className: 'planning-signal-label', textContent: 'Tasks' }),
        el('span', { className: 'planning-signal-value', textContent: String(b.taskCount ?? 0) }),
      ]),
      el('div', { className: 'planning-budget-card' }, [
        el('span', { className: 'planning-signal-label', textContent: 'Max Files' }),
        el('span', { className: 'planning-signal-value', textContent: String(b.totalMaxFiles ?? 0) }),
      ]),
      el('div', { className: 'planning-budget-card' }, [
        el('span', { className: 'planning-signal-label', textContent: 'Max Lines' }),
        el('span', { className: 'planning-signal-value', textContent: String(b.totalMaxLinesChanged ?? 0) }),
      ]),
      el('div', { className: 'planning-budget-card' }, [
        el('span', { className: 'planning-signal-label', textContent: 'Soft Limit' }),
        el('span', { className: 'planning-signal-value', textContent: b.softTimeMinutesMax ? `${b.softTimeMinutesMax}m` : '—' }),
      ]),
      el('div', { className: 'planning-budget-card' }, [
        el('span', { className: 'planning-signal-label', textContent: 'Hard Limit' }),
        el('span', { className: 'planning-signal-value', textContent: b.hardTimeMinutesMax ? `${b.hardTimeMinutesMax}m` : '—' }),
      ]),
    ]);
    container.append(budgetGrid);
  }

  // Selected tasks
  const selected = launchPlan.selectedTasks || [];
  if (selected.length > 0) {
    container.append(el('h4', { textContent: 'Selected Tasks' }));
    const selRows = selected.map((t) =>
      el('tr', null, [
        el('td', { textContent: t.targetIssue ? `#${t.targetIssue}` : '—' }),
        el('td', { textContent: t.taskType }),
        el('td', null, [riskBadge(t.risk)]),
        el('td', { textContent: t.conflictGroup ?? '—' }),
        el('td', { textContent: t.workerType ?? '—' }),
        el('td', { textContent: (t.sharedLocks || []).join(', ') || '—' }),
        el('td', { textContent: t.decision?.reason || '—' }),
      ]),
    );
    container.append(
      el('div', { className: 'table-wrap' }, [
        el('table', null, [
          el('thead', null, [el('tr', null, [
            el('th', { textContent: 'Issue' }),
            el('th', { textContent: 'Type' }),
            el('th', { textContent: 'Risk' }),
            el('th', { textContent: 'Conflict Group' }),
            el('th', { textContent: 'Worker Type' }),
            el('th', { textContent: 'Locks' }),
            el('th', { textContent: 'Decision' }),
          ])]),
          el('tbody', null, selRows),
        ]),
      ]),
    );
  }

  // Rejected tasks
  const rejected = launchPlan.rejectedTasks || [];
  if (rejected.length > 0) {
    container.append(el('h4', { textContent: 'Rejected Tasks' }));
    const rejRows = rejected.map((t) =>
      el('tr', null, [
        el('td', { textContent: t.targetIssue ? `#${t.targetIssue}` : '—' }),
        el('td', { textContent: t.taskType }),
        el('td', null, [riskBadge(t.risk)]),
        el('td', { textContent: t.conflictGroup ?? '—' }),
        el('td', { textContent: t.workerType ?? '—' }),
        el('td', null, [
          el('span', { className: 'badge badge--warn', textContent: t.decision?.rule || 'blocked' }),
        ]),
        el('td', { textContent: t.decision?.reason || '—' }),
      ]),
    );
    container.append(
      el('div', { className: 'table-wrap' }, [
        el('table', null, [
          el('thead', null, [el('tr', null, [
            el('th', { textContent: 'Issue' }),
            el('th', { textContent: 'Type' }),
            el('th', { textContent: 'Risk' }),
            el('th', { textContent: 'Conflict Group' }),
            el('th', { textContent: 'Worker Type' }),
            el('th', { textContent: 'Rule' }),
            el('th', { textContent: 'Reason' }),
          ])]),
          el('tbody', null, rejRows),
        ]),
      ]),
    );
  }

  // Acquired locks
  const locks = launchPlan.locksAcquired || [];
  if (locks.length > 0) {
    container.append(el('h4', { textContent: 'Acquired Locks' }));
    const lockRows = locks.map((l) =>
      el('tr', null, [
        el('td', { className: 'mono', textContent: l.lockName }),
        el('td', { textContent: l.holderIssue ? `#${l.holderIssue}` : '—' }),
        el('td', { textContent: l.conflictGroup ?? '—' }),
      ]),
    );
    container.append(
      el('div', { className: 'table-wrap' }, [
        el('table', null, [
          el('thead', null, [el('tr', null, [
            el('th', { textContent: 'Lock' }),
            el('th', { textContent: 'Holder' }),
            el('th', { textContent: 'Conflict Group' }),
          ])]),
          el('tbody', null, lockRows),
        ]),
      ]),
    );
  }

  // All-allowed indicator
  container.append(el('div', {
    className: `planning-all-allowed ${launchPlan.allAllowed ? 'planning-all-allowed--ok' : 'planning-all-allowed--blocked'}`,
    textContent: launchPlan.allAllowed ? 'All tasks cleared for dispatch' : 'Some tasks blocked by gate',
  }));

  return container;
}

function renderPlanningConsole(planningData) {
  const container = el('div', { className: 'console-section' });
  container.append(el('h2', { textContent: 'Planning Console' }));

  // View-only banner
  container.append(el('div', { className: 'console-mode-banner' }, [
    el('span', { className: 'console-mode-label', textContent: 'MODE:' }),
    el('span', { className: 'console-mode-value', textContent: 'VIEW ONLY' }),
    el('span', { className: 'console-mode-note', textContent: 'No mutation actions — planning data is read-only' }),
  ]));

  if (!planningData) {
    container.append(el('p', { className: 'empty-state', textContent: 'No planning data available' }));
    return container;
  }

  // Captured-at timestamp
  if (planningData.capturedAt) {
    container.append(el('p', {
      className: 'planning-captured-at',
      textContent: `Last captured: ${formatTimestamp(planningData.capturedAt)}`,
    }));
  }

  // Meta signals
  const signalsEl = renderMetaSignals(planningData.metaSignals);
  if (signalsEl) container.append(signalsEl);

  // Gap ledger
  const gapsEl = renderGapLedger(planningData.gaps);
  if (gapsEl) container.append(gapsEl);

  // Proposed batch
  const batchEl = renderProposedBatch(planningData.proposedBatch);
  if (batchEl) container.append(batchEl);

  // Batch preview / launch plan
  const previewEl = renderBatchPreview(planningData.launchPlan);
  if (previewEl) container.append(previewEl);

  return container;
}

function injectConsoleStyles() {
  if (document.getElementById('console-styles')) return;
  const style = document.createElement('style');
  style.id = 'console-styles';
  style.textContent = `
    .console-section { margin-top: 24px; }
    .console-mode-banner {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; background: var(--surface-card, #161922);
      border: 1px solid var(--surface-border, #262b3a);
      border-radius: 6px; margin-bottom: 16px; font-size: 12px;
    }
    .console-mode-label { color: var(--text-muted, #565b72); text-transform: uppercase; letter-spacing: .04em; }
    .console-mode-value { font-weight: 600; color: var(--status-available, #34d399); }
    .console-mode-note { color: var(--text-muted, #565b72); margin-left: auto; }
    .console-group { margin-bottom: 20px; }
    .console-group h3 {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .04em; color: var(--text-muted, #8b8fa4); margin-bottom: 10px;
    }
    .console-provider-block { margin-bottom: 12px; }
    .console-provider-id {
      font-family: var(--font-mono, monospace); font-size: 13px;
      font-weight: 600; margin-bottom: 8px;
    }
    .action-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 10px;
    }
    .action-card {
      background: var(--surface-card, #161922); border: 1px solid var(--surface-border, #262b3a);
      border-radius: 6px; padding: 12px; transition: background 120ms ease;
    }
    .action-card:hover { background: var(--surface-card-hover, #1c2030); }
    .action-card--disabled { opacity: 0.5; pointer-events: none; }
    .action-card__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .action-card__label { font-weight: 600; font-size: 13px; }
    .action-card__desc { font-size: 11px; color: var(--text-muted, #8b8fa4); margin-bottom: 8px; }
    .action-card__blocker {
      font-size: 11px; color: var(--status-disabled, #f87171);
      background: rgba(248,113,113,0.1); padding: 4px 8px; border-radius: 4px; margin-bottom: 8px;
    }
    .action-card__na { font-size: 11px; color: var(--text-muted, #565b72); font-style: italic; }
    .risk-badge {
      display: inline-block; padding: 1px 6px; border-radius: 3px;
      font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
    }
    .action-btn {
      padding: 4px 12px; border-radius: 4px; border: 1px solid var(--surface-border, #262b3a);
      background: var(--surface-card, #161922); color: var(--text-primary, #e2e4ea);
      font-size: 12px; cursor: pointer; transition: background 120ms ease;
    }
    .action-btn:hover { background: var(--surface-card-hover, #1c2030); }
    .action-btn--preview { border-color: var(--accent-blue, #60a5fa); color: var(--accent-blue, #60a5fa); }
    .action-btn--execute { border-color: var(--status-exhausted, #fbbf24); color: var(--status-exhausted, #fbbf24); }
    .action-btn--cancel { border-color: var(--text-muted, #565b72); }
    .action-btn--disabled { opacity: 0.4; cursor: not-allowed; }
    .action-panel {
      margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.15);
      border-radius: 4px; border: 1px solid var(--surface-border, #262b3a);
    }
    .action-panel__title { font-size: 12px; font-weight: 600; margin-bottom: 8px; }
    .action-panel__warning {
      font-size: 11px; color: var(--status-disabled, #f87171);
      background: rgba(248,113,113,0.1); padding: 4px 8px; border-radius: 4px; margin-bottom: 8px;
    }
    .action-panel__guard {
      font-size: 11px; color: var(--status-exhausted, #fbbf24); margin-bottom: 8px;
    }
    .preview-table { width: 100%; font-size: 11px; margin-bottom: 10px; }
    .preview-table th { font-size: 10px; padding: 4px 6px; }
    .preview-table td { padding: 4px 6px; }
    .preview-key { font-family: var(--font-mono, monospace); color: var(--text-muted, #8b8fa4); }
    .preview-value { color: var(--text-primary, #e2e4ea); word-break: break-all; }
    .execute-confirm { margin-top: 10px; }
    .execute-confirm__prompt { font-size: 12px; margin-bottom: 6px; }
    .execute-confirm__input {
      width: 100%; padding: 6px 8px; background: var(--surface-bg, #0f1117);
      border: 1px solid var(--surface-border, #262b3a); border-radius: 4px;
      color: var(--text-primary, #e2e4ea); font-family: var(--font-mono, monospace);
      font-size: 12px; margin-bottom: 8px;
    }
    .execute-confirm__input::placeholder { color: var(--text-muted, #565b72); }
    .execute-confirm__actions { display: flex; gap: 8px; }
    .execute-confirm__blocker {
      font-size: 12px; color: var(--status-disabled, #f87171);
      background: rgba(248,113,113,0.1); padding: 8px; border-radius: 4px;
    }
    .execute-result { margin-top: 8px; padding: 8px; border-radius: 4px; font-size: 12px; }
    .execute-result--dispatched {
      background: rgba(52,211,153,0.1); border: 1px solid var(--status-available, #34d399);
      color: var(--status-available, #34d399);
    }
    .execute-result__note { font-size: 11px; color: var(--text-muted, #8b8fa4); margin-top: 4px; }
    .audit-table { font-size: 11px; }
    .tab-bar {
      display: flex; gap: 0; margin-bottom: 16px; border-bottom: 1px solid var(--surface-border, #262b3a);
    }
    .tab-btn {
      padding: 8px 16px; background: transparent; border: none; border-bottom: 2px solid transparent;
      color: var(--text-muted, #8b8fa4); font-size: 13px; font-weight: 500;
      cursor: pointer; transition: color 120ms ease, border-color 120ms ease;
    }
    .tab-btn:hover { color: var(--text-primary, #e2e4ea); }
    .tab-btn--active {
      color: var(--accent-blue, #60a5fa); border-bottom-color: var(--accent-blue, #60a5fa);
    }
    .tab-panel { display: none; }
    .tab-panel--active { display: block; }

    /* Planning Console */
    .planning-section { margin-bottom: 20px; }
    .planning-section h3 {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .04em; color: var(--text-muted, #8b8fa4); margin-bottom: 10px;
    }
    .planning-section h4 {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .04em; color: var(--text-muted, #565b72);
      margin-bottom: 8px; margin-top: 16px;
    }
    .planning-captured-at {
      font-family: var(--font-mono, monospace); font-size: 11px;
      color: var(--text-muted, #565b72); margin-bottom: 12px;
    }
    .planning-signals-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
    }
    .planning-signal-card {
      background: var(--surface-card, #161922); border: 1px solid var(--surface-border, #262b3a);
      border-radius: 6px; padding: 10px 12px;
      display: flex; flex-direction: column; gap: 4px;
      transition: background 120ms ease;
    }
    .planning-signal-card:hover { background: var(--surface-card-hover, #1c2030); }
    .planning-signal-label {
      font-size: 10px; color: var(--text-muted, #565b72);
      text-transform: uppercase; letter-spacing: .04em;
    }
    .planning-signal-value {
      font-family: var(--font-mono, monospace); font-size: 16px;
      font-weight: 700; color: var(--text-primary, #e2e4ea);
    }
    .planning-budget-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 8px; margin-bottom: 12px;
    }
    .planning-budget-card {
      background: var(--surface-card, #161922); border: 1px solid var(--surface-border, #262b3a);
      border-radius: 6px; padding: 8px 10px;
      display: flex; flex-direction: column; gap: 2px; text-align: center;
    }
    .planning-health-row {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px; background: var(--surface-card, #161922);
      border: 1px solid var(--surface-border, #262b3a);
      border-radius: 6px; margin-bottom: 12px;
    }
    .planning-health-label { font-size: 12px; font-weight: 600; color: var(--text-primary, #e2e4ea); }
    .planning-health-time { font-size: 11px; color: var(--text-muted, #565b72); margin-left: auto; }
    .planning-health-reason { font-size: 11px; color: var(--text-muted, #8b8fa4); width: 100%; }
    .planning-all-allowed {
      margin-top: 12px; padding: 10px 12px; border-radius: 6px;
      font-size: 12px; font-weight: 600; text-align: center;
    }
    .planning-all-allowed--ok {
      background: rgba(52,211,153,0.1); border: 1px solid var(--status-available, #34d399);
      color: var(--status-available, #34d399);
    }
    .planning-all-allowed--blocked {
      background: rgba(251,191,36,0.1); border: 1px solid var(--status-exhausted, #fbbf24);
      color: var(--status-exhausted, #fbbf24);
    }

    /* Server action form styles */
    .action-form { margin-top: 8px; padding: 8px; background: rgba(0,0,0,0.15); border-radius: 4px; }
    .action-form__field { margin-bottom: 8px; }
    .action-form__field:last-child { margin-bottom: 0; }
    .action-form__label {
      display: block; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: .04em;
      color: var(--text-muted, #8b8fa4); margin-bottom: 4px;
    }
    .action-form__select,
    .action-form__input {
      width: 100%; padding: 6px 8px; background: var(--surface-bg, #0f1117);
      border: 1px solid var(--surface-border, #262b3a); border-radius: 4px;
      color: var(--text-primary, #e2e4ea); font-family: var(--font-mono, monospace);
      font-size: 12px;
    }
    .action-form__textarea {
      width: 100%; padding: 6px 8px; background: var(--surface-bg, #0f1117);
      border: 1px solid var(--surface-border, #262b3a); border-radius: 4px;
      color: var(--text-primary, #e2e4ea); font-family: var(--font-mono, monospace);
      font-size: 12px; resize: vertical; min-height: 48px;
    }
    .action-form__select:focus,
    .action-form__input:focus,
    .action-form__textarea:focus {
      outline: none; border-color: var(--accent-blue, #60a5fa);
    }
    .action-form__select option {
      background: var(--surface-bg, #0f1117); color: var(--text-primary, #e2e4ea);
    }
    .action-card--server {
      border-left: 3px solid var(--accent-blue, #60a5fa);
    }
    .action-card__badges { display: flex; gap: 4px; align-items: center; }
    .server-action-result { margin-top: 8px; }
    .execute-result__payload {
      font-family: var(--font-mono, monospace); font-size: 11px;
      color: var(--text-secondary, #8b8fa4); white-space: pre-wrap;
      word-break: break-word; padding: 6px; margin-top: 6px;
      background: var(--surface-bg, #0f1117); border-radius: 4px;
      border: 1px solid var(--surface-border, #262b3a);
    }
    .audit-row--server { background: rgba(96,165,250,0.04); }
  `;
  document.head.append(style);
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

  // Planning data is optional — the planning loop may not have run yet
  let planningData;
  try {
    planningData = await fetchJSON(PLANNING_URL);
  } catch {
    planningData = null;
  }

  // Server action modules and audit are optional — server may not be running
  [cachedServerActions, cachedServerAudit] = await Promise.all([
    fetchServerActions(),
    fetchServerAudit(),
  ]);

  const policyMap = Object.fromEntries(
    (policy.providers ?? []).map(p => [p.id, p]),
  );

  // Build dashboard panel
  const dashboardChildren = [
    renderGlobalSummary(state.global ?? {}),
    el('h2', { textContent: 'Providers' }),
  ];

  for (const provider of state.providers ?? []) {
    dashboardChildren.push(renderProviderCard(provider, policyMap[provider.id]));
  }

  if (webuiState) {
    const pressureEl = renderPressureSection(webuiState.pressure);
    if (pressureEl) dashboardChildren.push(pressureEl);

    const queueEl = renderQueueSection(
      webuiState.queue,
      webuiState.queueEntries,
    );
    if (queueEl) dashboardChildren.push(queueEl);

    const workersEl = renderWorkersSection(
      webuiState.workers,
      webuiState.assignments,
    );
    if (workersEl) dashboardChildren.push(workersEl);
  }

  // Build operation console panel
  const allData = { state, policy, webuiState };
  const consoleEl = renderOperationConsole(allData);

  // Build planning console panel
  const planningEl = renderPlanningConsole(planningData);

  // Tab bar
  const dashboardPanel = el('div', { className: 'tab-panel tab-panel--active', id: 'tab-dashboard' }, dashboardChildren);
  const consolePanel = el('div', { className: 'tab-panel', id: 'tab-console' }, [consoleEl]);
  const planningPanel = el('div', { className: 'tab-panel', id: 'tab-planning' }, [planningEl]);

  const dashboardTab = el('button', {
    className: 'tab-btn tab-btn--active',
    textContent: 'Dashboard',
    onClick: () => switchTab('dashboard'),
  });
  const consoleTab = el('button', {
    className: 'tab-btn',
    textContent: 'Operation Console',
    onClick: () => switchTab('console'),
  });
  const planningTab = el('button', {
    className: 'tab-btn',
    textContent: 'Planning Console',
    onClick: () => switchTab('planning'),
  });

  const tabBar = el('div', { className: 'tab-bar' }, [dashboardTab, consoleTab, planningTab]);

  root.replaceChildren(tabBar, dashboardPanel, consolePanel, planningPanel);
}

function switchTab(tab) {
  const panels = document.querySelectorAll('.tab-panel');
  const tabs = document.querySelectorAll('.tab-btn');
  panels.forEach((p) => p.classList.remove('tab-panel--active'));
  tabs.forEach((t) => t.classList.remove('tab-btn--active'));

  const targetPanel = document.getElementById(`tab-${tab}`);
  if (targetPanel) targetPanel.classList.add('tab-panel--active');

  const tabIndex = tab === 'dashboard' ? 0 : tab === 'console' ? 1 : 2;
  if (tabs[tabIndex]) tabs[tabIndex].classList.add('tab-btn--active');
}

function boot() {
  const root = document.getElementById('provider-pool-root');
  if (!root) {
    console.error('[provider-pool] #provider-pool-root element not found');
    return;
  }
  injectConsoleStyles();
  refresh(root);
  setInterval(() => refresh(root), REFRESH_INTERVAL_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
