/**
 * Provider Pool WebUI — client script skeleton.
 *
 * Renders provider/resource/worker JSON snapshots from the sanitized
 * state and policy files. No secrets are ever loaded or displayed.
 *
 * Expected data sources (relative to the HTML page):
 *   ../../../../.github/ai-state/provider-pool.json
 *   ../../../../.github/ai-policy/provider-pool-policy.json
 */

const STATE_URL = '../../../../.github/ai-state/provider-pool.json';
const POLICY_URL = '../../../../.github/ai-policy/provider-pool-policy.json';
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

// ── main app ─────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function refresh(root) {
  let state, policy;
  try {
    [state, policy] = await Promise.all([fetchJSON(STATE_URL), fetchJSON(POLICY_URL)]);
  } catch (err) {
    root.replaceChildren(renderError(err.message));
    return;
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
