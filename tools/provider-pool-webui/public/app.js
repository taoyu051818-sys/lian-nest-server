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

const STATE_URL = '/api/state';
const POLICY_URL = '/api/policy';
const WEBUI_STATE_URL = '/api/resources';
const PLANNING_URL = '/api/planning';
const HEALTH_URL = '/api/health';
const REFRESH_INTERVAL_MS = 30_000;

// Action API endpoints (relative to WebUI server origin)
const ACTIONS_LIST_URL = '/api/actions';
const ACTIONS_PREVIEW_URL = '/api/actions/preview';
const ACTIONS_EXECUTE_URL = '/api/actions/execute';
const SERVER_AUDIT_URL = '/api/audit';

// ── shell state ──────────────────────────────────────────────────────

let activeSection = 'dashboard';
let lastRefreshAt = null;

// Documentation links for action modules — maps action ID to relative doc path
const ACTION_DOC_LINKS = {
  'compile-tasks':       '../../../../docs/ai-native/webui-action-compile-tasks.md',
  'plan.next.batch':     '../../../../docs/ai-native/webui-action-plan-next-batch.md',
  'create-issues':       '../../../../docs/ai-native/webui-action-create-issues.md',
  'issue-state':         '../../../../docs/ai-native/webui-action-issue-state.md',
  'launch-batch':        '../../../../docs/ai-native/webui-action-launch-batch.md',
  'merge-prs':           '../../../../docs/ai-native/webui-action-merge-prs.md',
  'provider-rotation':   '../../../../docs/ai-native/webui-action-provider-rotation.md',
  'worker.control':      '../../../../docs/ai-native/webui-action-worker-control.md',
};

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

// ── resource pressure cards (CPU / Memory / Disk) ─────────────────────

function renderResourcePressureCards(resources) {
  if (!resources) return null;
  const utilization = resources.utilization;
  const concurrency = resources.concurrency;
  if (!utilization && !concurrency) return null;

  const container = el('div', { className: 'resource-pressure-section' });
  container.append(el('h2', { textContent: 'CPU / Memory / Disk Pressure' }));

  const grid = el('div', { className: 'resource-pressure-grid' });

  // CPU card — derived from concurrency utilization
  const cpuPct = utilization?.percentage ?? 0;
  const cpuLevel = utilization?.level ?? 'normal';
  grid.append(renderResourcePressureCard('CPU', cpuPct, cpuLevel, {
    active: concurrency?.currentActiveWorkers,
    max: concurrency?.globalMaxWorkers,
    headroom: concurrency?.headroom,
  }));

  // Memory card — derived from headroom ratio
  const memMax = concurrency?.globalMaxWorkers ?? 0;
  const memHeadroom = concurrency?.headroom ?? 0;
  const memPct = memMax > 0 ? Math.round(((memMax - memHeadroom) / memMax) * 100) : 0;
  const memLevel = memPct >= 90 ? 'critical' : memPct >= 70 ? 'elevated' : 'normal';
  grid.append(renderResourcePressureCard('Memory', memPct, memLevel, {
    headroom: memHeadroom,
    max: memMax,
  }));

  // Disk card — placeholder when no disk data available
  grid.append(renderResourcePressureCard('Disk', null, 'normal', { note: 'No disk metrics available' }));

  container.append(grid);
  return container;
}

function renderResourcePressureCard(name, pct, level, details) {
  const levelClass = level === 'critical' ? 'status-disabled'
    : level === 'elevated' ? 'status-exhausted'
    : 'status-available';
  const barClass = level === 'critical' ? 'bar-fill--red'
    : level === 'elevated' ? 'bar-fill--yellow'
    : 'bar-fill--green';

  const card = el('div', { className: 'resource-pressure-card' });
  card.append(el('div', { className: 'resource-pressure-card__header' }, [
    el('span', { className: 'resource-pressure-card__name', textContent: name }),
    el('span', { className: `resource-pressure-card__level ${levelClass}`, textContent: (level ?? '—').toUpperCase() }),
  ]));

  if (pct !== null) {
    card.append(el('div', { className: 'resource-pressure-card__bar' }, [
      el('div', { className: 'bar-track' }, [
        el('div', { className: `bar-fill ${barClass}`, style: `width:${Math.min(pct, 100)}%` }),
      ]),
      el('span', { className: 'resource-pressure-card__pct', textContent: `${pct}%` }),
    ]));
  }

  if (details) {
    const meta = el('div', { className: 'resource-pressure-card__meta' });
    if (details.active != null && details.max != null) {
      meta.append(el('span', { textContent: `Active: ${details.active} / ${details.max}` }));
    }
    if (details.headroom != null) {
      meta.append(el('span', { textContent: `Headroom: ${details.headroom}` }));
    }
    if (details.note) {
      meta.append(el('span', { className: 'resource-pressure-card__note', textContent: details.note }));
    }
    card.append(meta);
  }

  return card;
}

// ── command steward dashboard ─────────────────────────────────────────

function renderCommandStewardSection(allData, planningData) {
  const container = el('div', { className: 'command-steward-section' });
  container.append(el('h2', { textContent: 'Command Steward' }));

  // Steward status banner
  const stewardReady = planningData?.launchPlan?.allAllowed !== false;
  const statusBanner = el('div', {
    className: `command-steward__status ${stewardReady ? 'command-steward__status--clear' : 'command-steward__status--blocked'}`,
  }, [
    el('span', { className: 'command-steward__status-dot' }),
    el('span', { className: 'command-steward__status-text', textContent: stewardReady ? 'ALL CLEAR' : 'BLOCKED' }),
    el('span', { className: 'command-steward__status-detail', textContent: stewardReady
      ? 'All gates passed — commands may proceed'
      : 'One or more gates blocking command dispatch' }),
  ]);
  container.append(statusBanner);

  // Readiness grid — show which action categories are ready
  const readinessGrid = el('div', { className: 'command-steward__readiness-grid' });

  const categories = [
    { id: 'launch', label: 'Launch', icon: '▶' },
    { id: 'worker', label: 'Worker', icon: '⚙' },
    { id: 'provider', label: 'Provider', icon: '◈' },
    { id: 'merge', label: 'Merge', icon: '⊕' },
    { id: 'compile', label: 'Compile', icon: '▸' },
    { id: 'plan', label: 'Plan', icon: '◇' },
  ];

  const serverActionIds = (cachedServerActions || []).map(a => a.id);
  const hasLaunchAction = serverActionIds.includes('launch-batch');
  const hasWorkerAction = serverActionIds.includes('worker.control');
  const hasMergeAction = serverActionIds.includes('merge-prs');
  const hasCompileAction = serverActionIds.includes('compile-tasks');
  const hasPlanAction = serverActionIds.includes('plan.next.batch');

  const readinessMap = {
    launch: hasLaunchAction && stewardReady,
    worker: hasWorkerAction,
    provider: (allData.state?.providers || []).length > 0,
    merge: hasMergeAction && stewardReady,
    compile: hasCompileAction,
    plan: hasPlanAction,
  };

  for (const cat of categories) {
    const ready = readinessMap[cat.id] ?? false;
    readinessGrid.append(el('div', {
      className: `command-steward__readiness-card ${ready ? '' : 'command-steward__readiness-card--blocked'}`,
    }, [
      el('span', { className: 'command-steward__readiness-icon', textContent: cat.icon }),
      el('span', { className: 'command-steward__readiness-label', textContent: cat.label }),
      el('span', {
        className: `command-steward__readiness-status ${ready ? 'status-available' : 'status-disabled'}`,
        textContent: ready ? 'READY' : 'N/A',
      }),
    ]));
  }
  container.append(readinessGrid);

  // Steward decisions — from planning launch plan
  if (planningData?.launchPlan) {
    const plan = planningData.launchPlan;
    const selected = plan.selectedTasks || [];
    const rejected = plan.rejectedTasks || [];
    const locks = plan.locksAcquired || [];

    if (selected.length > 0 || rejected.length > 0) {
      const decisionsSection = el('div', { className: 'command-steward__decisions' });
      decisionsSection.append(el('h3', { textContent: 'Steward Decisions' }));

      const decisionsGrid = el('div', { className: 'command-steward__decisions-grid' }, [
        el('div', { className: 'command-steward__decision-card' }, [
          el('span', { className: 'command-steward__decision-value status-available', textContent: String(selected.length) }),
          el('span', { className: 'command-steward__decision-label', textContent: 'Cleared' }),
        ]),
        el('div', { className: 'command-steward__decision-card' }, [
          el('span', {
            className: `command-steward__decision-value ${rejected.length > 0 ? 'status-exhausted' : ''}`,
            textContent: String(rejected.length),
          }),
          el('span', { className: 'command-steward__decision-label', textContent: 'Rejected' }),
        ]),
        el('div', { className: 'command-steward__decision-card' }, [
          el('span', { className: 'command-steward__decision-value', textContent: String(locks.length) }),
          el('span', { className: 'command-steward__decision-label', textContent: 'Locks Held' }),
        ]),
      ]);
      decisionsSection.append(decisionsGrid);

      // Health indicator
      if (plan.mainHealth) {
        const mh = plan.mainHealth;
        decisionsSection.append(el('div', { className: 'command-steward__health' }, [
          el('span', { className: 'command-steward__health-label', textContent: 'Main Health' }),
          el('span', {
            className: `badge ${healthStateColor(mh.state)}`,
            textContent: (mh.state || '—').toUpperCase(),
          }),
          mh.reason ? el('span', { className: 'command-steward__health-reason', textContent: mh.reason }) : null,
        ].filter(Boolean)));
      }

      container.append(decisionsSection);
    }
  }

  return container;
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
const auditFilters = { actionId: '', status: '', limit: '' };

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

async function fetchServerAudit(filters) {
  try {
    const params = new URLSearchParams();
    if (filters?.actionId) params.set('actionId', filters.actionId);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.limit) params.set('limit', filters.limit);
    const qs = params.toString();
    const url = qs ? `${SERVER_AUDIT_URL}?${qs}` : SERVER_AUDIT_URL;
    const data = await fetchJSON(url);
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

const RISK_DESCRIPTIONS = {
  'provider.retry': 'Re-enabling this provider will allow new task assignments to be routed to it. If the underlying issue (quota, auth, rate limit) is not resolved, tasks may fail again.',
  'provider.clearCooldown': 'Clearing the cooldown removes the safety timer. If the provider is still rate-limited or quota-exhausted, immediate re-assignment may trigger another failure.',
  'provider.disable': 'Disabling this provider will immediately stop new task assignments. In-flight workers will drain but no new work will start until a human re-enables it.',
  'queue.retryBlocked': 'Retrying blocked tasks will re-queue them for dispatch. If the original blocker (exhaustion, conflict) is still active, these tasks will fail again.',
  'queue.clearStale': 'Stale entries will be permanently removed from the queue. This cannot be undone — tasks must be re-created from their source issues if needed.',
  'global.refreshState': 'Forces an immediate re-read of provider pool and worker state files. No data is mutated, but cached state will be replaced.',
  'global.exportAudit': 'Exports the current session audit log as a JSON download. Read-only operation with no side effects.',
};

function confirmationWarningBanner(action) {
  const riskLevel = action.riskLevel;
  const description = RISK_DESCRIPTIONS[action.id] || action.description;
  const warningClass = riskLevel === 'high' ? 'confirm-warning--high'
    : riskLevel === 'medium' ? 'confirm-warning--medium'
    : 'confirm-warning--low';

  return el('div', { className: `confirm-warning ${warningClass}` }, [
    el('div', { className: 'confirm-warning__header' }, [
      el('span', { className: 'confirm-warning__icon', textContent: riskLevel === 'high' ? '⚠' : '▶' }),
      el('span', { className: 'confirm-warning__title', textContent: `${action.label} — ${riskLevel.toUpperCase()} RISK` }),
    ]),
    el('p', { className: 'confirm-warning__body', textContent: description }),
    riskLevel === 'high' || action.humanRequired
      ? el('p', { className: 'confirm-warning__notice', textContent: 'This action cannot be auto-executed and requires explicit human confirmation.' })
      : null,
  ].filter(Boolean));
}

function showExecuteConfirm(action, contextData, allData, parentPanel) {
  const existing = parentPanel.querySelector('.execute-confirm');
  if (existing) existing.remove();

  const confirm = el('div', { className: 'execute-confirm' });

  // Risk-specific warning banner
  confirm.append(confirmationWarningBanner(action));

  if (action.riskLevel === 'high' || action.humanRequired) {
    confirm.append(el('div', { className: 'execute-confirm__blocker', textContent: 'This action requires human approval and cannot be auto-executed. Review the preview above, then type the confirmation phrase below.' }));
  }

  // Reason input for medium and high risk actions
  const needsReason = action.riskLevel === 'medium' || action.riskLevel === 'high';
  let reasonInput;
  if (needsReason) {
    const reasonWrap = el('div', { className: 'execute-confirm__reason-wrap' });
    reasonWrap.append(el('label', {
      className: 'execute-confirm__reason-label',
      textContent: `Reason for "${action.label}" (required):`,
    }));
    reasonInput = el('input', {
      className: 'execute-confirm__input execute-confirm__reason-input',
      type: 'text',
      placeholder: 'Describe why this action is needed…',
      autocomplete: 'off',
    });
    reasonWrap.append(reasonInput);
    confirm.append(reasonWrap);
  }

  confirm.append(el('p', {
    className: 'execute-confirm__prompt',
    textContent: `Type "${action.confirmPhrase}" to confirm execution of "${action.label}":`,
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

  function validateConfirm() {
    const phraseMatch = input.value.trim() === action.confirmPhrase;
    const reasonOk = !needsReason || (reasonInput && reasonInput.value.trim().length > 0);
    const enabled = phraseMatch && reasonOk;
    goBtn.disabled = !enabled;
    goBtn.className = `action-btn action-btn--execute ${enabled ? '' : 'action-btn--disabled'}`;
  }

  input.addEventListener('input', validateConfirm);
  if (reasonInput) reasonInput.addEventListener('input', validateConfirm);

  goBtn.addEventListener('click', () => {
    if (goBtn.disabled) return;
    executeAction(action, contextData, allData, confirm, reasonInput?.value?.trim());
  });

  btnRow.append(cancelBtn, goBtn);
  confirm.append(btnRow);
  parentPanel.append(confirm);
  (needsReason ? reasonInput : input).focus();
}

function executeAction(action, contextData, _allData, confirmEl, reason) {
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
    reason: reason || undefined,
  });

  // Replace confirm with result
  confirmEl.replaceChildren(
    el('div', { className: 'execute-result execute-result--dispatched' }, [
      el('p', { textContent: `Action "${action.label}" dispatched for guard validation` }),
      el('p', { className: 'execute-result__note', textContent: 'Server guard must approve before mutation is applied' }),
    ]),
  );
}

// ── doc links & risk prompts ──────────────────────────────────────────

function renderDocLink(actionId) {
  const docPath = ACTION_DOC_LINKS[actionId];
  if (!docPath) return null;
  return el('a', {
    className: 'action-card__doc-link',
    href: docPath,
    target: '_blank',
    rel: 'noopener',
    textContent: 'Docs',
  });
}

function renderRiskPrompt(actionMeta) {
  if (!actionMeta.dangerous) return null;
  return el('div', {
    className: 'action-card__risk-prompt',
    textContent: '⚠ HIGH RISK — This action mutates state. Review docs before executing.',
  });
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

  const badges = el('div', { className: 'action-card__badges' }, [
    riskBadge(actionMeta.dangerous ? 'high' : 'low'),
    el('span', {
      className: 'risk-badge',
      style: 'background:rgba(96,165,250,0.12);color:#60a5fa',
      textContent: 'MODULE',
    }),
  ]);

  const docLink = renderDocLink(actionMeta.id);
  if (docLink) badges.append(docLink);

  const header = el('div', { className: 'action-card__header' }, [
    el('span', { className: 'action-card__label', textContent: actionMeta.label }),
    badges,
  ]);
  card.append(header);

  if (actionMeta.description) {
    card.append(el('p', { className: 'action-card__desc', textContent: actionMeta.description }));
  }

  const riskPrompt = renderRiskPrompt(actionMeta);
  if (riskPrompt) card.append(riskPrompt);

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

// Schema-driven field type configs for server action modules.
const SCHEMA_FIELD_CONFIG = {
  targetIssue: { type: 'number', parse: (v) => (v !== '' ? Number(v) : undefined) },
  taskType: { type: 'select', options: ['operation', 'test', 'docs', 'bugfix', 'feature', 'refactor', 'execution', 'research', 'review'] },
  risk: { type: 'select', options: ['low', 'medium', 'high', 'critical'] },
  conflictGroup: { type: 'text' },
  allowedFiles: { type: 'textarea', parse: (v) => v.split('\n').map((s) => s.trim()).filter(Boolean) },
  validationCommands: { type: 'textarea', parse: (v) => v.split('\n').map((s) => s.trim()).filter(Boolean) },
  forbiddenFiles: { type: 'textarea', parse: (v) => v.split('\n').map((s) => s.trim()).filter(Boolean) },
  outputMode: { type: 'select', options: ['v1', 'v2'] },
  'rolePacket.actorRole': { type: 'text' },
};

function renderSchemaFields(actionMeta, form) {
  const fields = actionMeta.requiredFields;
  if (!Array.isArray(fields) || fields.length === 0) return;

  for (const fieldName of fields) {
    const config = SCHEMA_FIELD_CONFIG[fieldName];
    const fieldWrap = el('div', { className: 'action-form__field' });
    const label = fieldName.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^[a-z]/, (c) => c.toUpperCase());
    fieldWrap.append(el('label', { className: 'action-form__label', textContent: label }));

    if (config && config.type === 'select') {
      const select = el('select', { className: 'action-form__select', 'data-field': fieldName });
      select.append(el('option', { value: '', textContent: `— select ${label.toLowerCase()} —` }));
      for (const opt of config.options) {
        select.append(el('option', { value: opt, textContent: opt }));
      }
      fieldWrap.append(select);
    } else if (config && config.type === 'textarea') {
      fieldWrap.append(el('textarea', {
        className: 'action-form__textarea',
        'data-field': fieldName,
        placeholder: 'One entry per line',
        rows: '3',
      }));
    } else if (config && config.type === 'number') {
      fieldWrap.append(el('input', {
        className: 'action-form__input',
        'data-field': fieldName,
        type: 'number',
        min: '1',
        step: '1',
        placeholder: label,
      }));
    } else {
      fieldWrap.append(el('input', {
        className: 'action-form__input',
        'data-field': fieldName,
        type: 'text',
        autocomplete: 'off',
        placeholder: label,
      }));
    }
    form.append(fieldWrap);
  }
}

function buildPayloadForm(actionMeta, allData) {
  // Launch-batch gets a dedicated structured task-entry form
  if (actionMeta.id === 'launch-batch') {
    return buildLaunchBatchForm(allData);
  }

  // Worker-control gets a dedicated operation form
  if (actionMeta.id === 'worker.control') {
    const form = el('div', { className: 'action-form' });
    return buildWorkerControlForm(actionMeta, allData, form);
  }

  const form = el('div', { className: 'action-form' });
  const providers = allData.state?.providers || [];

  // Structured form for merge-prs action
  if (actionMeta.id === 'merge-prs') {
    const prWrap = el('div', { className: 'action-form__field' });
    prWrap.append(el('label', { className: 'action-form__label', textContent: 'PR Numbers' }));
    prWrap.append(el('input', {
      className: 'action-form__input',
      type: 'text',
      'data-field': 'prNumbers',
      placeholder: 'e.g. 760, 759, 758',
      autocomplete: 'off',
    }));
    form.append(prWrap);

    const repoWrap = el('div', { className: 'action-form__field' });
    repoWrap.append(el('label', { className: 'action-form__label', textContent: 'Repository (optional)' }));
    repoWrap.append(el('input', {
      className: 'action-form__input',
      type: 'text',
      'data-field': 'repo',
      placeholder: 'e.g. owner/repo (defaults to GH_REPO env)',
      autocomplete: 'off',
    }));
    form.append(repoWrap);
  } else {
    // Provider selector for provider-related actions
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
  }

  // Structured reason field for provider-rotation
  if (actionMeta.id === 'provider-rotation') {
    const reasonWrap = el('div', { className: 'action-form__field' });
    reasonWrap.append(el('label', { className: 'action-form__label', textContent: 'Reason (optional)' }));
    reasonWrap.append(el('input', {
      className: 'action-form__input',
      type: 'text',
      'data-field': 'reason',
      placeholder: 'e.g. credential rotation, quota reset',
      autocomplete: 'off',
    }));
    form.append(reasonWrap);
  }

  // Structured fields for create-issues gap form
  if (actionMeta.id === 'create-issues') {
    const fields = [
      { name: 'title', label: 'Issue Title', placeholder: 'e.g. feat(module): add feature X' },
      { name: 'gapKey', label: 'Gap Key', placeholder: 'e.g. auth-slice-2' },
      { name: 'labels', label: 'Labels', placeholder: 'e.g. wave21, gap-fill (comma-separated)' },
    ];
    for (const f of fields) {
      const wrap = el('div', { className: 'action-form__field' });
      wrap.append(el('label', { className: 'action-form__label', textContent: f.label }));
      wrap.append(el('input', {
        className: 'action-form__input',
        type: 'text',
        'data-field': f.name,
        placeholder: f.placeholder,
        autocomplete: 'off',
      }));
      form.append(wrap);
    }
  }

  // Schema-driven fields for server action modules (e.g. compile-tasks, plan.next.batch)
  renderSchemaFields(actionMeta, form);

  // Generic JSON payload editor for advanced params (always available as fallback)
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

// ── worker-control structured form ─────────────────────────────────────

function buildWorkerControlForm(_actionMeta, allData, form) {
  // Operation selector (list vs stop)
  const opWrap = el('div', { className: 'action-form__field' });
  opWrap.append(el('label', { className: 'action-form__label', textContent: 'Operation' }));
  const opSelect = el('select', { className: 'action-form__select', 'data-field': 'action' });
  opSelect.append(el('option', { value: 'list', textContent: 'List Workers' }));
  opSelect.append(el('option', { value: 'stop', textContent: 'Stop Workers' }));
  opWrap.append(opSelect);
  form.append(opWrap);

  // Stop-only fields container
  const stopFields = el('div', { className: 'action-form__stop-fields', style: 'display:none' });

  // Worker selector (checkboxes from active workers)
  const workers = getActiveWorkers(allData);
  const workerWrap = el('div', { className: 'action-form__field' });
  workerWrap.append(el('label', { className: 'action-form__label', textContent: 'Target Workers' }));

  if (workers.length > 0) {
    const checkboxList = el('div', { className: 'action-form__checkbox-list' });
    for (const w of workers) {
      const item = el('label', { className: 'action-form__checkbox-item' });
      const cb = el('input', { type: 'checkbox', value: w.workerId, 'data-field': 'workerId' });
      item.append(cb);
      item.append(el('span', { textContent: `${w.workerId} (${w.providerId})` }));
      checkboxList.append(item);
    }
    workerWrap.append(checkboxList);
  } else {
    workerWrap.append(el('p', { className: 'action-form__help', textContent: 'No active workers detected. Enter worker IDs manually below.' }));
    workerWrap.append(el('input', {
      className: 'action-form__input',
      type: 'text',
      'data-field': 'workerIdsManual',
      placeholder: 'provider-alpha-slot-0, provider-beta-slot-1',
      autocomplete: 'off',
    }));
  }
  stopFields.append(workerWrap);

  // Reason field
  const reasonWrap = el('div', { className: 'action-form__field' });
  reasonWrap.append(el('label', { className: 'action-form__label', textContent: 'Reason' }));
  reasonWrap.append(el('input', {
    className: 'action-form__input',
    type: 'text',
    'data-field': 'reason',
    placeholder: 'e.g. manual drain for maintenance',
    autocomplete: 'off',
  }));
  reasonWrap.append(el('p', { className: 'action-form__help', textContent: 'Required for stop. Recorded in audit log.' }));
  stopFields.append(reasonWrap);

  form.append(stopFields);

  // Toggle stop fields visibility based on operation
  opSelect.addEventListener('change', () => {
    stopFields.style.display = opSelect.value === 'stop' ? '' : 'none';
  });

  return form;
}

function getActiveWorkers(allData) {
  const workers = [];
  const webuiState = allData.webuiState;
  if (webuiState?.workers) {
    for (const w of webuiState.workers) {
      if (w.status === 'running') {
        workers.push({ workerId: w.workerId || w.id, providerId: w.providerId || w.provider });
      }
    }
  }
  if (workers.length === 0) {
    const state = allData.state;
    for (const p of state?.providers || []) {
      for (let i = 0; i < (p.currentConcurrency || 0); i++) {
        workers.push({ workerId: `${p.id}-slot-${i}`, providerId: p.id });
      }
    }
  }
  return workers;
}

// ── launch-batch structured form ─────────────────────────────────────

function buildLaunchBatchForm(allData) {
  const form = el('div', { className: 'action-form action-form--launch-batch' });

  const modeWrap = el('div', { className: 'action-form__field' });
  modeWrap.append(el('label', { className: 'action-form__label', textContent: 'Task Source' }));
  const modeSelect = el('select', { className: 'action-form__select', 'data-field': '_taskSource' });
  modeSelect.append(el('option', { value: 'queue', textContent: 'Use queued tasks (default)' }));
  modeSelect.append(el('option', { value: 'custom', textContent: 'Specify custom tasks' }));
  modeWrap.append(modeSelect);
  form.append(modeWrap);

  const tasksContainer = el('div', {
    className: 'action-form__tasks-container',
    'data-field': '_tasksContainer',
    style: 'display:none',
  });

  const entriesWrap = el('div', { className: 'action-form__task-entries' });
  entriesWrap.append(el('label', { className: 'action-form__label', textContent: 'Tasks' }));
  tasksContainer.append(entriesWrap);

  const addBtn = el('button', {
    className: 'action-btn action-btn--preview action-form__add-task-btn',
    textContent: '+ Add Task',
    type: 'button',
  });
  addBtn.addEventListener('click', () => {
    entriesWrap.append(buildTaskEntryRow());
  });
  tasksContainer.append(addBtn);

  form.append(tasksContainer);

  modeSelect.addEventListener('change', () => {
    tasksContainer.style.display = modeSelect.value === 'custom' ? '' : 'none';
  });

  return form;
}

function buildTaskEntryRow() {
  const row = el('div', { className: 'action-form__task-entry' });

  const removeBtn = el('button', {
    className: 'action-btn action-btn--cancel action-form__remove-task-btn',
    textContent: '×',
    type: 'button',
  });
  removeBtn.addEventListener('click', () => row.remove());
  row.append(removeBtn);

  row.append(formFieldInput('targetIssue', 'number', 'Issue #', '1'));
  row.append(formFieldInput('conflictGroup', 'text', 'Conflict Group', 'e.g. wave21-webui'));
  row.append(formFieldSelect('risk', ['low', 'medium', 'high', 'critical'], 'Risk'));
  row.append(formFieldSelect('taskType', ['operation', 'test', 'docs', 'bugfix', 'feature', 'refactor'], 'Task Type'));
  row.append(formFieldSelect('mainHealthPolicy', ['standard', 'recovery', 'none'], 'Health Policy'));
  row.append(formFieldInput('sharedLocks', 'text', 'Shared Locks', 'comma-separated'));

  return row;
}

function formFieldInput(fieldName, inputType, label, placeholder) {
  const wrap = el('div', { className: 'action-form__field action-form__field--inline' });
  wrap.append(el('label', { className: 'action-form__label', textContent: label }));
  wrap.append(el('input', {
    className: 'action-form__input',
    type: inputType,
    'data-task-field': fieldName,
    placeholder: placeholder || '',
    autocomplete: 'off',
  }));
  return wrap;
}

function formFieldSelect(fieldName, options, label) {
  const wrap = el('div', { className: 'action-form__field action-form__field--inline' });
  wrap.append(el('label', { className: 'action-form__label', textContent: label }));
  const select = el('select', { className: 'action-form__select', 'data-task-field': fieldName });
  select.append(el('option', { value: '', textContent: '—' }));
  for (const opt of options) {
    select.append(el('option', { value: opt, textContent: opt }));
  }
  wrap.append(select);
  return wrap;
}

function collectFormPayload(form) {
  const payload = {};

  // Helper to set nested values from dotted paths (e.g. "rolePacket.actorRole")
  function setNested(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  // Launch-batch structured form: collect task entries
  const taskSource = form.querySelector('[data-field="_taskSource"]');
  if (taskSource) {
    if (taskSource.value === 'queue') return payload;
    const tasks = [];
    for (const row of form.querySelectorAll('.action-form__task-entry')) {
      const task = {};
      for (const input of row.querySelectorAll('[data-task-field]')) {
        const key = input.dataset.taskField;
        let val = input.value;
        if (!val) continue;
        if (input.type === 'number') val = Number(val);
        if (key === 'sharedLocks') val = val.split(',').map(s => s.trim()).filter(Boolean);
        task[key] = val;
      }
      if (task.targetIssue) tasks.push(task);
    }
    if (tasks.length > 0) payload.tasks = tasks;
    return payload;
  }

  // Collect select fields
  for (const select of form.querySelectorAll('select[data-field]')) {
    if (select.value) setNested(payload, select.dataset.field, select.value);
  }

  // Collect checkbox inputs (e.g. worker IDs)
  const checkboxes = form.querySelectorAll('input[type="checkbox"][data-field]');
  if (checkboxes.length > 0) {
    const checkedValues = Array.from(checkboxes)
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
    if (checkedValues.length > 0) {
      const field = checkboxes[0].dataset.field;
      const key = field.endsWith('s') ? field : field + 's';
      payload[key] = checkedValues;
    }
  }

  // Collect text/number input fields
  for (const input of form.querySelectorAll('input[data-field]')) {
    if (input.type === 'checkbox') continue;
    if (input.value) {
      const field = input.dataset.field;
      // Handle comma-separated manual worker IDs
      if (field === 'workerIdsManual') {
        const ids = input.value.split(',').map((s) => s.trim()).filter(Boolean);
        if (ids.length > 0) payload.workerIds = ids;
      } else {
        setNested(payload, field, input.value);
      }
    }
  }

  // Parse prNumbers from comma-separated text into array of integers
  if (typeof payload.prNumbers === 'string' && payload.prNumbers.trim()) {
    const parsed = payload.prNumbers
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    payload.prNumbers = parsed.length > 0 ? parsed : undefined;
    if (payload.prNumbers === undefined) delete payload.prNumbers;
  }

  // Collect structured textarea fields (not the generic jsonPayload)
  for (const textarea of form.querySelectorAll('textarea[data-field]')) {
    if (textarea.dataset.field === 'jsonPayload') continue;
    const val = textarea.value.trim();
    if (!val) continue;
    const field = textarea.dataset.field;
    if (textarea.dataset.parse === 'csv-number') {
      const nums = val.split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !isNaN(n));
      if (nums.length > 0) setNested(payload, field, nums);
    } else {
      setNested(payload, field, val);
    }
  }

  // Merge JSON payload if provided
  const jsonTextarea = form.querySelector('textarea[data-field="jsonPayload"]');
  if (jsonTextarea && jsonTextarea.value.trim()) {
    try {
      const jsonPayload = JSON.parse(jsonTextarea.value.trim());
      Object.assign(payload, jsonPayload);
      // Re-apply prNumbers if it was set from structured input
      const prInput = form.querySelector('input[data-field="prNumbers"]');
      if (prInput && prInput.value.trim()) {
        const reParsed = prInput.value
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isInteger(n) && n > 0);
        if (reParsed.length > 0) payload.prNumbers = reParsed;
      }
    } catch {
      // ignore invalid JSON — server will handle it
    }
  }

  // Construct gaps array for create-issues from structured fields
  if (payload.title || payload.gapKey) {
    const gap = {};
    if (payload.title) gap.title = payload.title;
    if (payload.gapKey) gap.gapKey = payload.gapKey;
    if (payload.labels) gap.labels = payload.labels.split(',').map((s) => s.trim()).filter(Boolean);
    payload.gaps = [gap];
    delete payload.title;
    delete payload.gapKey;
    delete payload.labels;
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

    // Enhanced warning for dangerous server actions
    if (actionMeta.dangerous) {
      const serverWarningClass = 'confirm-warning--high';
      confirm.append(el('div', { className: `confirm-warning ${serverWarningClass}` }, [
        el('div', { className: 'confirm-warning__header' }, [
          el('span', { className: 'confirm-warning__icon', textContent: '⚠' }),
          el('span', { className: 'confirm-warning__title', textContent: `${actionMeta.label} — DANGEROUS` }),
        ]),
        el('p', { className: 'confirm-warning__body', textContent: actionMeta.description || 'This action performs a server-side mutation with real side effects. Review the preview carefully before confirming.' }),
        el('p', { className: 'confirm-warning__notice', textContent: 'Dangerous actions require explicit confirmation and pass through the full risk gate chain on the server.' }),
      ]));
    } else {
      confirm.append(el('p', {
        className: 'execute-confirm__prompt',
        textContent: `Type "EXECUTE" to run "${actionMeta.label}" on server:`,
      }));
    }

    // Reason input for dangerous server actions
    let reasonInput;
    if (actionMeta.dangerous) {
      const reasonWrap = el('div', { className: 'execute-confirm__reason-wrap' });
      reasonWrap.append(el('label', {
        className: 'execute-confirm__reason-label',
        textContent: `Reason for running "${actionMeta.label}" (required):`,
      }));
      reasonInput = el('input', {
        className: 'execute-confirm__input execute-confirm__reason-input',
        type: 'text',
        placeholder: 'Describe why this action is needed…',
        autocomplete: 'off',
      });
      reasonWrap.append(reasonInput);
      confirm.append(reasonWrap);
    }

    confirm.append(el('p', {
      className: 'execute-confirm__prompt',
      textContent: actionMeta.dangerous
        ? `Type "EXECUTE" to confirm "${actionMeta.label}" — this will mutate server state:`
        : `Type "EXECUTE" to run "${actionMeta.label}" on server:`,
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

    function validateServerConfirm() {
      const phraseMatch = input.value.trim() === 'EXECUTE';
      const reasonOk = !actionMeta.dangerous || (reasonInput && reasonInput.value.trim().length > 0);
      const enabled = phraseMatch && reasonOk;
      goBtn.disabled = !enabled;
      goBtn.className = `action-btn action-btn--execute ${enabled ? '' : 'action-btn--disabled'}`;
    }

    input.addEventListener('input', validateServerConfirm);
    if (reasonInput) reasonInput.addEventListener('input', validateServerConfirm);

    goBtn.addEventListener('click', async () => {
      if (goBtn.disabled) return;

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
          reason: reasonInput?.value?.trim() || undefined,
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
          reason: reasonInput?.value?.trim() || undefined,
        });
        confirm.replaceChildren(
          el('div', { className: 'action-panel__warning', textContent: `Execution error: ${err.message}` }),
        );
      }
    });

    btnRow.append(cancelBtn, goBtn);
    confirm.append(btnRow);
    panel.append(confirm);
    (actionMeta.dangerous && reasonInput ? reasonInput : input).focus();
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

  // Filter controls
  const filterBar = el('div', { className: 'audit-filters' });

  // Action filter — text input (or datalist if we know actionIds)
  const actionFilter = el('div', { className: 'audit-filter' });
  actionFilter.append(el('label', { className: 'audit-filter__label', textContent: 'Action' }));
  const actionInput = el('input', {
    className: 'audit-filter__input',
    type: 'text',
    placeholder: 'e.g. provider-rotation',
    value: auditFilters.actionId,
    autocomplete: 'off',
  });
  actionFilter.append(actionInput);
  filterBar.append(actionFilter);

  // Status filter
  const statusFilter = el('div', { className: 'audit-filter' });
  statusFilter.append(el('label', { className: 'audit-filter__label', textContent: 'Status' }));
  const statusSelect = el('select', { className: 'audit-filter__select' });
  statusSelect.append(el('option', { value: '', textContent: 'All' }));
  statusSelect.append(el('option', { value: 'success', textContent: 'Success' }));
  statusSelect.append(el('option', { value: 'error', textContent: 'Error' }));
  statusSelect.append(el('option', { value: 'blocked', textContent: 'Blocked' }));
  statusSelect.value = auditFilters.status;
  statusFilter.append(statusSelect);
  filterBar.append(statusFilter);

  // Limit filter
  const limitFilter = el('div', { className: 'audit-filter' });
  limitFilter.append(el('label', { className: 'audit-filter__label', textContent: 'Limit' }));
  const limitInput = el('input', {
    className: 'audit-filter__input',
    type: 'number',
    min: '1',
    max: '200',
    placeholder: 'All',
    value: auditFilters.limit,
    style: 'width:72px',
  });
  limitFilter.append(limitInput);
  filterBar.append(limitFilter);

  // Action buttons
  const btnGroup = el('div', { className: 'audit-filters__actions' });
  const applyBtn = el('button', {
    className: 'action-btn action-btn--preview',
    textContent: 'Apply',
    onClick: async () => {
      auditFilters.actionId = actionInput.value.trim();
      auditFilters.status = statusSelect.value;
      auditFilters.limit = limitInput.value.trim();
      cachedServerAudit = await fetchServerAudit(auditFilters);
      const parent = section.parentElement;
      if (parent) {
        const oldAudit = parent.querySelector('.console-audit');
        if (oldAudit) oldAudit.replaceWith(renderAuditSection());
      }
    },
  });
  const clearBtn = el('button', {
    className: 'action-btn',
    textContent: 'Clear',
    onClick: async () => {
      auditFilters.actionId = '';
      auditFilters.status = '';
      auditFilters.limit = '';
      cachedServerAudit = await fetchServerAudit();
      const parent = section.parentElement;
      if (parent) {
        const oldAudit = parent.querySelector('.console-audit');
        if (oldAudit) oldAudit.replaceWith(renderAuditSection());
      }
    },
  });
  btnGroup.append(applyBtn, clearBtn);
  filterBar.append(btnGroup);
  section.append(filterBar);

  // Active filter summary
  const hasFilters = auditFilters.actionId || auditFilters.status || auditFilters.limit;
  if (hasFilters) {
    const filterParts = [];
    if (auditFilters.actionId) filterParts.push(`action: ${auditFilters.actionId}`);
    if (auditFilters.status) filterParts.push(`status: ${auditFilters.status}`);
    if (auditFilters.limit) filterParts.push(`limit: ${auditFilters.limit}`);
    section.append(el('p', {
      className: 'audit-count',
      textContent: `Filters: ${filterParts.join(' | ')}`,
    }));
  }

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
      cachedServerAudit = await fetchServerAudit(auditFilters);
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

function renderLaunchPlanSummary(launchPlan) {
  if (!launchPlan) return null;
  const selected = launchPlan.selectedTasks || [];
  const rejected = launchPlan.rejectedTasks || [];
  const locks = launchPlan.locksAcquired || [];

  if (selected.length === 0 && rejected.length === 0 && locks.length === 0) return null;

  const container = el('div', { className: 'planning-section planning-launch-summary' });
  container.append(el('h3', { textContent: 'Launch Plan Summary' }));

  const grid = el('div', { className: 'planning-signals-grid' }, [
    el('div', { className: 'planning-signal-card' }, [
      el('span', { className: 'planning-signal-label', textContent: 'Selected' }),
      el('span', { className: 'planning-signal-value status-available', textContent: String(selected.length) }),
    ]),
    el('div', { className: 'planning-signal-card' }, [
      el('span', { className: 'planning-signal-label', textContent: 'Rejected' }),
      el('span', { className: `planning-signal-value ${rejected.length > 0 ? 'status-exhausted' : ''}`, textContent: String(rejected.length) }),
    ]),
    el('div', { className: 'planning-signal-card' }, [
      el('span', { className: 'planning-signal-label', textContent: 'Locks' }),
      el('span', { className: 'planning-signal-value', textContent: String(locks.length) }),
    ]),
    el('div', { className: 'planning-signal-card' }, [
      el('span', { className: 'planning-signal-label', textContent: 'Status' }),
      el('span', {
        className: `planning-signal-value ${launchPlan.allAllowed ? 'status-available' : 'status-exhausted'}`,
        textContent: launchPlan.allAllowed ? 'CLEAR' : 'BLOCKED',
      }),
    ]),
  ]);
  container.append(grid);

  // Main health indicator (compact)
  if (launchPlan.mainHealth) {
    const mh = launchPlan.mainHealth;
    container.append(el('div', { className: 'planning-health-row' }, [
      el('span', { className: 'planning-health-label', textContent: 'Health' }),
      el('span', {
        className: `badge ${healthStateColor(mh.state)}`,
        textContent: (mh.state || '—').toUpperCase(),
      }),
      mh.reason
        ? el('span', { className: 'planning-health-reason', textContent: mh.reason })
        : null,
    ].filter(Boolean)));
  }

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

  // Launch plan summary (compact selected/rejected overview)
  const summaryEl = renderLaunchPlanSummary(planningData.launchPlan);
  if (summaryEl) container.append(summaryEl);

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
    .action-card__doc-link {
      display: inline-flex; align-items: center; padding: 1px 6px;
      font-family: var(--font-mono, monospace); font-size: 10px; font-weight: 600;
      text-transform: uppercase; letter-spacing: .04em; border-radius: 3px;
      color: var(--accent-blue, #60a5fa); background: rgba(96,165,250,0.12);
      border: 1px solid rgba(96,165,250,0.25); text-decoration: none; cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .action-card__doc-link:hover { background: rgba(96,165,250,0.18); border-color: var(--accent-blue, #60a5fa); }
    .action-card__risk-prompt {
      font-size: 11px; color: var(--status-disabled, #f87171);
      background: rgba(248,113,113,0.1); padding: 6px 8px; border-radius: 4px;
      border: 1px solid rgba(248,113,113,0.25); margin-bottom: 8px; line-height: 1.4;
    }
    .server-action-result { margin-top: 8px; }
    .execute-result__payload {
      font-family: var(--font-mono, monospace); font-size: 11px;
      color: var(--text-secondary, #8b8fa4); white-space: pre-wrap;
      word-break: break-word; padding: 6px; margin-top: 6px;
      background: var(--surface-bg, #0f1117); border-radius: 4px;
      border: 1px solid var(--surface-border, #262b3a);
    }
    .audit-row--server { background: rgba(96,165,250,0.04); }

    /* Confirmation warning banner */
    .confirm-warning {
      padding: 10px 12px; border-radius: 6px; margin-bottom: 10px;
      border: 1px solid;
    }
    .confirm-warning--low {
      background: rgba(52,211,153,0.08); border-color: rgba(52,211,153,0.3);
    }
    .confirm-warning--medium {
      background: rgba(251,191,36,0.10); border-color: rgba(251,191,36,0.35);
    }
    .confirm-warning--high {
      background: rgba(248,113,113,0.10); border-color: rgba(248,113,113,0.35);
    }
    .confirm-warning__header {
      display: flex; align-items: center; gap: 6px; margin-bottom: 6px;
    }
    .confirm-warning__icon { font-size: 14px; }
    .confirm-warning--high .confirm-warning__icon { color: var(--status-disabled, #f87171); }
    .confirm-warning--medium .confirm-warning__icon { color: var(--status-exhausted, #fbbf24); }
    .confirm-warning--low .confirm-warning__icon { color: var(--status-available, #34d399); }
    .confirm-warning__title {
      font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
    }
    .confirm-warning--high .confirm-warning__title { color: var(--status-disabled, #f87171); }
    .confirm-warning--medium .confirm-warning__title { color: var(--status-exhausted, #fbbf24); }
    .confirm-warning--low .confirm-warning__title { color: var(--status-available, #34d399); }
    .confirm-warning__body {
      font-size: 11px; color: var(--text-secondary, #8b8fa4); line-height: 1.5; margin-bottom: 6px;
    }
    .confirm-warning__notice {
      font-size: 11px; font-weight: 600; color: var(--status-disabled, #f87171);
    }

    /* Reason input */
    .execute-confirm__reason-wrap { margin-bottom: 10px; }
    .execute-confirm__reason-label {
      display: block; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: .04em;
      color: var(--text-muted, #8b8fa4); margin-bottom: 4px;
    }
    .action-form__help {
      font-size: 10px; color: var(--text-muted, #565b72); margin-top: 4px;
    }
    .action-form__checkbox-list {
      display: flex; flex-direction: column; gap: 4px;
      max-height: 120px; overflow-y: auto; padding: 4px 0;
    }
    .action-form__checkbox-item {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; font-family: var(--font-mono, monospace);
      color: var(--text-primary, #e2e4ea); cursor: pointer;
    }
    .action-form__checkbox-item input[type="checkbox"] {
      accent-color: var(--accent-blue, #60a5fa);
    }
    .action-form__stop-fields {
      margin-top: 8px; padding-top: 8px;
      border-top: 1px dashed var(--surface-border, #262b3a);
    }
    .action-form__hint {
      font-size: 10px; color: var(--text-muted, #565b72); margin-top: 3px;
    }
    /* Launch-batch structured form */
    .action-form--launch-batch { padding: 10px; }
    .action-form__tasks-container { margin-top: 8px; }
    .action-form__task-entries { display: flex; flex-direction: column; gap: 8px; }
    .action-form__task-entry {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 6px; padding: 8px; background: rgba(0,0,0,0.1);
      border: 1px solid var(--surface-border, #262b3a); border-radius: 4px;
      position: relative;
    }
    .action-form__field--inline { margin-bottom: 0; }
    .action-form__field--inline .action-form__label { margin-bottom: 2px; font-size: 10px; }
    .action-form__field--inline .action-form__input,
    .action-form__field--inline .action-form__select { font-size: 11px; padding: 4px 6px; }
    .action-form__add-task-btn {
      margin-top: 6px; font-size: 11px; padding: 3px 10px;
    }
    .action-form__remove-task-btn {
      position: absolute; top: 4px; right: 4px;
      padding: 0 6px; font-size: 14px; line-height: 1;
      border: none; background: transparent;
      color: var(--status-disabled, #f87171); cursor: pointer;
    }
    .action-form__remove-task-btn:hover { background: rgba(248,113,113,0.15); border-radius: 3px; }
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

  // Health data for status strip
  let healthData;
  try {
    healthData = await fetchJSON(HEALTH_URL);
  } catch {
    healthData = null;
  }

  lastRefreshAt = new Date().toISOString();

  // Update status strip
  const statusStrip = document.getElementById('status-strip');
  if (statusStrip) {
    const newStrip = renderStatusStrip(healthData, state);
    statusStrip.replaceChildren(...newStrip.childNodes);
  }

  // Update nav rail (to refresh badges if needed)
  const navRail = document.querySelector('.nav-rail');
  if (navRail) {
    const newRail = renderNavRail();
    navRail.replaceChildren(...newRail.childNodes);
  }

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

  // Resource pressure cards (CPU / Memory / Disk)
  const resourcePressureEl = renderResourcePressureCards(webuiState);
  if (resourcePressureEl) dashboardChildren.push(resourcePressureEl);

  // Command Steward section
  const allDataForSteward = { state, policy, webuiState };
  const stewardEl = renderCommandStewardSection(allDataForSteward, planningData);
  if (stewardEl) dashboardChildren.push(stewardEl);

  // Build operation console panel
  const allData = { state, policy, webuiState };
  const consoleEl = renderOperationConsole(allData);

  // Build planning console panel
  const planningEl = renderPlanningConsole(planningData);

  // Build audit panel (standalone section)
  const auditEl = renderAuditSection();
  const auditPanel = el('div', { className: 'console-section' }, [
    el('h2', { textContent: 'Audit Log' }),
    auditEl,
  ]);

  // Section panels
  const dashboardPanel = el('div', {
    className: `section-panel ${activeSection === 'dashboard' ? 'section-panel--active' : ''}`,
    'data-section': 'dashboard',
  }, dashboardChildren);
  const consolePanel = el('div', {
    className: `section-panel ${activeSection === 'console' ? 'section-panel--active' : ''}`,
    'data-section': 'console',
  }, [consoleEl]);
  const planningPanel = el('div', {
    className: `section-panel ${activeSection === 'planning' ? 'section-panel--active' : ''}`,
    'data-section': 'planning',
  }, [planningEl]);
  const auditSectionPanel = el('div', {
    className: `section-panel ${activeSection === 'audit' ? 'section-panel--active' : ''}`,
    'data-section': 'audit',
  }, [auditPanel]);

  root.replaceChildren(dashboardPanel, consolePanel, planningPanel, auditSectionPanel);
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

// ── shell rendering ──────────────────────────────────────────────────

const NAV_SECTIONS = [
  { id: 'dashboard', icon: '■', label: 'Dash' },
  { id: 'console', icon: '⚙', label: 'Ops' },
  { id: 'planning', icon: '▶', label: 'Plan' },
  { id: 'audit', icon: '‖', label: 'Audit' },
];

function renderNavRail() {
  const rail = el('nav', { className: 'nav-rail' });
  rail.append(el('div', { className: 'nav-rail__brand', textContent: 'LP' }));
  rail.append(el('div', { className: 'nav-rail__sep' }));

  for (const section of NAV_SECTIONS) {
    const item = el('button', {
      className: `nav-rail__item ${activeSection === section.id ? 'nav-rail__item--active' : ''}`,
      'data-section': section.id,
      title: section.label,
      onClick: () => switchSection(section.id),
    }, [
      el('span', { className: 'nav-rail__icon', textContent: section.icon }),
      el('span', { className: 'nav-rail__label', textContent: section.label }),
    ]);
    rail.append(item);
  }

  return rail;
}

function renderStatusStrip(healthData, stateData) {
  const strip = el('div', { className: 'status-strip' });
  strip.append(el('span', { className: 'status-strip__title', textContent: 'LIAN Control Console' }));

  // Health indicator
  const healthState = healthData?.status || 'unknown';
  const dotClass = healthState === 'ok'
    ? 'status-strip__health-dot--green'
    : healthState === 'degraded'
      ? 'status-strip__health-dot--yellow'
      : 'status-strip__health-dot--red';
  strip.append(el('span', { className: 'status-strip__health' }, [
    el('span', { className: `status-strip__health-dot ${dotClass}` }),
    el('span', { textContent: healthState.toUpperCase() }),
  ]));

  // Provider counts
  const global = stateData?.global;
  if (global) {
    strip.append(el('span', { className: 'status-strip__chip' }, [
      el('span', { textContent: `${global.availableProviders ?? 0} avail` }),
    ]));
    strip.append(el('span', { className: 'status-strip__chip' }, [
      el('span', { textContent: `${global.totalActiveWorkers ?? 0} workers` }),
    ]));
    if ((global.exhaustedProviders ?? 0) > 0) {
      strip.append(el('span', {
        className: 'status-strip__chip',
        style: 'color:var(--status-exhausted);border-color:var(--status-exhausted)',
        textContent: `${global.exhaustedProviders} exhausted`,
      }));
    }
  }

  // Localhost binding
  strip.append(el('span', {
    className: 'status-strip__chip',
    textContent: '127.0.0.1',
  }));

  // Last refresh
  if (lastRefreshAt) {
    strip.append(el('span', {
      className: 'status-strip__ts',
      textContent: formatTimestamp(lastRefreshAt),
    }));
  }

  return strip;
}

function switchSection(sectionId) {
  activeSection = sectionId;
  // Update nav rail active state
  document.querySelectorAll('.nav-rail__item').forEach((item) => {
    item.classList.toggle('nav-rail__item--active', item.dataset.section === sectionId);
  });
  // Update panels
  document.querySelectorAll('.section-panel').forEach((panel) => {
    panel.classList.toggle('section-panel--active', panel.dataset.section === sectionId);
  });
}

function boot() {
  const root = document.getElementById('provider-pool-root');
  if (!root) {
    console.error('[provider-pool] #provider-pool-root element not found');
    return;
  }
  injectConsoleStyles();
  initShell(root);
  refresh(root);
  setInterval(() => refresh(root), REFRESH_INTERVAL_MS);
}

function initShell(root) {
  const shell = root.closest('.app-shell');
  if (!shell) return;

  // Insert nav rail before main
  const navRail = renderNavRail();
  shell.insertBefore(navRail, root);

  // Insert status strip before main (after nav in DOM order, but grid handles layout)
  const statusStrip = el('div', { className: 'status-strip', id: 'status-strip' });
  statusStrip.append(el('span', { className: 'status-strip__title', textContent: 'LIAN Control Console' }));
  shell.insertBefore(statusStrip, root);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
