function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return Array.from(document.querySelectorAll(selector));
}

const state = {
  config: null,
  resultRows: [],
  resultHeaders: [],
  runState: {
    running: false,
    manualAuthPending: false,
    outputDir: ''
  }
};

const DEFAULT_SORT_KEYS = [
  'confidence_score',
  'store_name',
  'country',
  'city',
  'query_language'
];

const fieldIds = [
  'queries',
  'search_languages',
  'auto_translate_queries',
  'max_pages_per_query',
  'top_results_limit_per_query',
  'max_results_per_site',
  'page_open_timeout_ms',
  'page_load_timeout_ms',
  'max_site_failures_before_skip',
  'output_dir',
  'country_hint',
  'language_hint',
  'headless',
  'manual_google_auth',
  'stop_on_google_block',
  'user_agent',
  'viewport_width',
  'viewport_height',
  'delay_min_ms',
  'delay_max_ms',
  'base_url',
  'api_key',
  'model_name',
  'enable_llm_review',
  'llm_timeout_ms'
];

function appendLog(text) {
  const consoleEl = $('#console');
  consoleEl.textContent += text;
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function setRunState(nextState) {
  state.runState = { ...state.runState, ...nextState };
  const running = Boolean(state.runState.running);
  const manualAuthPending = Boolean(state.runState.manualAuthPending);

  $('#btn-start').disabled = running;
  $('#btn-stop').disabled = !running;
  $('#btn-continue').disabled = !manualAuthPending;

  const pill = $('#run-status-pill');
  const text = $('#run-status-text');

  pill.className = 'status-pill';
  if (manualAuthPending) {
    pill.classList.add('warning');
    pill.textContent = 'Waiting';
    text.textContent = 'Google verification is waiting for operator confirmation.';
  } else if (running) {
    pill.classList.add('active');
    pill.textContent = 'Running';
    text.textContent = 'Collection is running. Logs and outputs will update in place.';
  } else {
    pill.textContent = 'Idle';
    text.textContent = 'Ready to configure a new collection run.';
  }
}

function getFormValue(id) {
  const el = document.getElementById(id);
  if (el.type === 'checkbox') {
    return el.checked;
  }
  return el.value;
}

function setFormValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'checkbox') {
    el.checked = Boolean(value);
    return;
  }
  el.value = value == null ? '' : value;
}

function collectConfig() {
  return {
    queries: getFormValue('queries'),
    search_languages: getFormValue('search_languages'),
    auto_translate_queries: getFormValue('auto_translate_queries'),
    max_pages_per_query: Number(getFormValue('max_pages_per_query')),
    top_results_limit_per_query: Number(getFormValue('top_results_limit_per_query')),
    max_results_per_site: Number(getFormValue('max_results_per_site')),
    page_open_timeout_ms: Number(getFormValue('page_open_timeout_ms')),
    page_load_timeout_ms: Number(getFormValue('page_load_timeout_ms')),
    max_site_failures_before_skip: Number(getFormValue('max_site_failures_before_skip')),
    output_dir: getFormValue('output_dir'),
    country_hint: getFormValue('country_hint'),
    language_hint: getFormValue('language_hint'),
    headless: getFormValue('headless'),
    manual_google_auth: getFormValue('manual_google_auth'),
    stop_on_google_block: getFormValue('stop_on_google_block'),
    user_agent: getFormValue('user_agent'),
    viewport_width: Number(getFormValue('viewport_width')),
    viewport_height: Number(getFormValue('viewport_height')),
    delay_min_ms: Number(getFormValue('delay_min_ms')),
    delay_max_ms: Number(getFormValue('delay_max_ms')),
    base_url: getFormValue('base_url'),
    api_key: getFormValue('api_key'),
    model_name: getFormValue('model_name'),
    enable_llm_review: getFormValue('enable_llm_review'),
    llm_timeout_ms: Number(getFormValue('llm_timeout_ms'))
  };
}

function applyConfig(config) {
  state.config = config;
  setFormValue('queries', Array.isArray(config.queries) ? config.queries.join('\n') : config.queries);
  setFormValue('search_languages', Array.isArray(config.search_languages) ? config.search_languages.join(',') : config.search_languages);
  fieldIds.forEach((id) => {
    if (id === 'queries' || id === 'search_languages') return;
    setFormValue(id, config[id]);
  });
  refreshMetrics();
}

function refreshMetrics() {
  $('#metric-result-cap').textContent = String(getFormValue('top_results_limit_per_query') || '0');
  $('#metric-timeout').textContent = `${Math.floor(Number(getFormValue('page_open_timeout_ms') || 0) / 1000)}s`;
  const languages = String(getFormValue('search_languages') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  $('#metric-languages').textContent = String(languages.length);
}

function renderSummary(summary) {
  const items = [
    { label: 'Expanded Queries', value: summary.expandedQueries || 0 },
    { label: 'Google Pages', value: summary.googlePagesVisited || 0 },
    { label: 'Successful Domains', value: summary.successfulDomains || 0 },
    { label: 'Failures', value: summary.failureCount || 0 },
    { label: 'Filtered', value: summary.filteredCount || 0 },
    { label: 'Google Blocked', value: summary.googleBlocked ? 'Yes' : 'No' }
  ];
  $('#summary-cards').innerHTML = items.map((item) => `
    <div class="summary-card">
      <span>${item.label}</span>
      <strong>${item.value}</strong>
    </div>
  `).join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseCsv(text) {
  const lines = String(text || '').trim().split('\n').filter(Boolean);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const parseLine = (line) => {
    const result = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const next = line[i + 1];
      if (quoted && ch === '"' && next === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((line) => parseLine(line));
  return { headers, rows };
}

function getVisibleRows() {
  const filterText = String(getFormValue('results-filter') || '').trim().toLowerCase();
  const sortKey = getFormValue('results-sort-key') || state.resultHeaders[0] || 'store_name';
  const sortDirection = getFormValue('results-sort-direction');

  let rows = state.resultRows.slice();
  if (filterText) {
    rows = rows.filter((row) => Object.values(row).some((value) => String(value || '').toLowerCase().includes(filterText)));
  }

  rows.sort((left, right) => {
    const a = left[sortKey] ?? '';
    const b = right[sortKey] ?? '';
    const numA = Number(a);
    const numB = Number(b);
    const compare = Number.isFinite(numA) && Number.isFinite(numB) && String(a).trim() !== '' && String(b).trim() !== ''
      ? numA - numB
      : String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
    return sortDirection === 'asc' ? compare : -compare;
  });
  return rows;
}

function syncSortKeyOptions() {
  const select = $('#results-sort-key');
  const current = select.value;
  const options = state.resultHeaders.length > 0 ? state.resultHeaders : DEFAULT_SORT_KEYS;
  select.innerHTML = options.map((header) => `<option value="${escapeHtml(header)}">${escapeHtml(header)}</option>`).join('');
  if (options.includes(current)) {
    select.value = current;
  } else if (options.includes('confidence_score')) {
    select.value = 'confidence_score';
  } else if (options.length > 0) {
    select.value = options[0];
  }
}

function renderResultsTable() {
  const table = $('#results-table');
  if (state.resultHeaders.length === 0) {
    table.innerHTML = '<tbody><tr><td>No CSV output yet.</td></tr></tbody>';
    return;
  }
  const rows = getVisibleRows();
  const thead = `
    <thead>
      <tr>${state.resultHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
    </thead>
  `;
  const tbody = `
    <tbody>
      ${rows.length === 0
        ? `<tr><td colspan="${state.resultHeaders.length}">No rows match the current filter.</td></tr>`
        : rows.map((row) => `<tr>${state.resultHeaders.map((header) => `<td>${escapeHtml(row[header] ?? '')}</td>`).join('')}</tr>`).join('')}
    </tbody>
  `;
  table.innerHTML = thead + tbody;
}

function renderJsonView(id, value) {
  $(id).textContent = JSON.stringify(value, null, 2);
}

async function refreshOutputs() {
  const outputDir = getFormValue('output_dir');
  const result = await window.trendfetchApi.loadResults(outputDir);
  if (!result.ok) {
    return;
  }
  const parsed = parseCsv(result.resultsCsv || '');
  state.resultHeaders = parsed.headers;
  state.resultRows = parsed.rows.map((row) => {
    const mapped = {};
    parsed.headers.forEach((header, index) => {
      mapped[header] = row[index] ?? '';
    });
    return mapped;
  });
  syncSortKeyOptions();
  renderSummary(result.summary || {});
  renderResultsTable();
  renderJsonView('#failures-view', result.failures || []);
  renderJsonView('#filtered-view', result.filtered || []);
  renderJsonView('#queries-view', result.expansions || []);
}

function bindTabs() {
  $$('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      $$('.tab').forEach((tab) => tab.classList.remove('active'));
      $$('.tab-view').forEach((view) => view.classList.remove('active'));
      button.classList.add('active');
      $(`#tab-${button.dataset.tab}`).classList.add('active');
    });
  });
}

function bindEvents() {
  fieldIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', refreshMetrics);
    el.addEventListener('change', refreshMetrics);
  });

  $('#btn-save-config').addEventListener('click', async () => {
    const response = await window.trendfetchApi.saveConfig(collectConfig());
    if (response.ok) {
      applyConfig(response.config);
      appendLog('[trendfetch-app] Configuration saved.\n');
    }
  });

  $('#btn-start').addEventListener('click', async () => {
    appendLog('[trendfetch-app] Starting run...\n');
    const response = await window.trendfetchApi.startRun(collectConfig());
    if (!response.ok) {
      appendLog(`[trendfetch-app] ${response.error}\n`);
    }
  });

  $('#btn-continue').addEventListener('click', async () => {
    const response = await window.trendfetchApi.continueManualAuth();
    if (!response.ok) {
      appendLog(`[trendfetch-app] ${response.error}\n`);
    } else {
      appendLog('[trendfetch-app] Manual auth confirmed. Continuing search.\n');
    }
  });

  $('#btn-stop').addEventListener('click', async () => {
    const response = await window.trendfetchApi.stopRun();
    if (!response.ok) {
      appendLog(`[trendfetch-app] ${response.error}\n`);
    } else {
      appendLog('[trendfetch-app] Stop signal sent.\n');
    }
  });

  $('#btn-clear-log').addEventListener('click', () => {
    $('#console').textContent = '';
  });

  $('#btn-refresh-output').addEventListener('click', refreshOutputs);
  $('#btn-open-output').addEventListener('click', async () => {
    await window.trendfetchApi.openFolder(getFormValue('output_dir'));
  });
  $('#btn-pick-folder').addEventListener('click', async () => {
    const result = await window.trendfetchApi.pickOutputDir();
    if (result.ok) {
      setFormValue('output_dir', result.path);
      refreshMetrics();
    }
  });
  $('#results-filter').addEventListener('input', renderResultsTable);
  $('#results-sort-key').addEventListener('change', renderResultsTable);
  $('#results-sort-direction').addEventListener('change', renderResultsTable);
  $('#btn-export-filtered').addEventListener('click', async () => {
    if (state.resultHeaders.length === 0) {
      appendLog('[trendfetch-app] No visible rows to export.\n');
      return;
    }
    const rows = getVisibleRows();
    if (rows.length === 0) {
      appendLog('[trendfetch-app] No visible rows to export.\n');
      return;
    }
    const lines = [
      state.resultHeaders.join(','),
      ...rows.map((row) => state.resultHeaders.map((header) => {
        const value = String(row[header] ?? '');
        return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
      }).join(','))
    ];
    const response = await window.trendfetchApi.exportCsv({
      outputDir: getFormValue('output_dir'),
      fileName: 'visible-results.csv',
      csvText: `${lines.join('\n')}\n`
    });
    if (response.ok) {
      appendLog(`[trendfetch-app] Exported visible CSV: ${response.filePath}\n`);
    }
  });

  window.trendfetchApi.onLog((payload) => appendLog(payload));
  window.trendfetchApi.onState((payload) => {
    setRunState(payload);
    if (!payload.running) {
      refreshOutputs();
    }
  });
}

async function boot() {
  bindTabs();
  bindEvents();
  const config = await window.trendfetchApi.getConfig();
  applyConfig(config);
  syncSortKeyOptions();
  const runState = await window.trendfetchApi.getRunState();
  setRunState(runState);
  await refreshOutputs();
}

boot();
