// HAVOC Demo Application Client Logic
document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isFixedMode = urlParams.get('mode') === 'fixed';

  // Update mode UI
  const modeBanner = document.getElementById('mode-banner');
  const modeLabel = document.getElementById('mode-label');
  const modeToggleBtn = document.getElementById('mode-toggle-btn');
  const tableContainer = document.getElementById('table-container');

  if (isFixedMode) {
    modeBanner.className = 'mode-banner fixed';
    modeLabel.textContent = 'FIXED (All 6 Flaws Resolved)';
    modeToggleBtn.textContent = 'Switch to BROKEN Mode';
    modeToggleBtn.href = '?mode=broken';
    tableContainer.className = 'fixed-responsive-table-wrapper';
  } else {
    modeBanner.className = 'mode-banner broken';
    modeLabel.textContent = 'BROKEN (6 Flaws Active)';
    modeToggleBtn.textContent = 'Switch to FIXED Mode';
    modeToggleBtn.href = '?mode=fixed';
    tableContainer.className = 'broken-fixed-table-wrapper';
  }

  // =========================================================================
  // FLAW A (API FAILURE / MISSING ERROR RECOVERY):
  // =========================================================================
  const itemsLoading = document.getElementById('items-loading');
  const itemsErrorAlert = document.getElementById('items-error-alert');
  const itemsErrorMsg = document.getElementById('items-error-msg');
  const itemsList = document.getElementById('items-list');
  const btnReloadItems = document.getElementById('btn-reload-items');
  const btnTriggerFail = document.getElementById('btn-trigger-fail');
  const btnRetryItems = document.getElementById('btn-retry-items');

  function renderItems(items) {
    itemsList.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'item-row';
      const badgeClass = item.status === 'ACTIVE' ? 'badge-active' : 'badge-maintenance';
      row.innerHTML = `
        <div>
          <strong>${item.title}</strong>
          <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 0.5rem;">(${item.code})</span>
        </div>
        <span class="badge ${badgeClass}">${item.status}</span>
      `;
      itemsList.appendChild(row);
    }
  }

  function loadItems(shouldFail = false) {
    itemsLoading.style.display = 'block';
    itemsErrorAlert.style.display = 'none';

    const url = `/api/items${shouldFail ? '?fail=true' : ''}`;

    if (!isFixedMode) {
      // BROKEN VARIANT:
      // Does not catch errors, does not clear spinner on failure, no error state displayed.
      fetch(url)
        .then((res) => {
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          return res.json();
        })
        .then((data) => {
          renderItems(data.items);
          itemsLoading.style.display = 'none';
        });
      // Deliberate bug: Missing .catch() — on HTTP 500 or chaos network drop, spinner never clears!
    } else {
      // FIXED VARIANT:
      // Properly catches error, clears loading spinner, and renders actionable error alert.
      fetch(url)
        .then(async (res) => {
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${res.status}`);
          }
          return res.json();
        })
        .then((data) => {
          renderItems(data.items);
        })
        .catch((err) => {
          itemsErrorAlert.style.display = 'flex';
          itemsErrorMsg.textContent = `Service unavailable: ${err.message}`;
          itemsList.innerHTML = '';
        })
        .finally(() => {
          itemsLoading.style.display = 'none';
        });
    }
  }

  btnReloadItems.addEventListener('click', () => loadItems(false));
  btnTriggerFail.addEventListener('click', () => loadItems(true));
  btnRetryItems.addEventListener('click', () => loadItems(false));

  // Initial load
  loadItems(false);

  // =========================================================================
  // FLAW B (API LATENCY / UNRESPONSIVE UI):
  // =========================================================================
  const btnLoadSummary = document.getElementById('btn-load-summary');
  const summaryLoading = document.getElementById('summary-loading');
  const summaryContent = document.getElementById('summary-content');

  btnLoadSummary.addEventListener('click', () => {
    if (!isFixedMode) {
      // BROKEN VARIANT:
      // Shows NO loading indicator during slow 2.5s request. UI looks frozen.
      fetch('/api/slow-endpoint')
        .then((res) => res.json())
        .then((data) => {
          summaryContent.innerHTML = `
            <strong>Aggregation Ready:</strong> ${data.activeServices} Active Services | 
            Avg Latency: ${data.avgLatencyMs}ms | Reliability: ${(data.reliabilityScore * 100).toFixed(1)}%
          `;
        });
    } else {
      // FIXED VARIANT:
      // Shows immediate spinner/loading state so user knows work is in progress.
      summaryLoading.style.display = 'block';
      btnLoadSummary.disabled = true;

      fetch('/api/slow-endpoint')
        .then((res) => res.json())
        .then((data) => {
          summaryContent.innerHTML = `
            <strong>Aggregation Ready:</strong> ${data.activeServices} Active Services | 
            Avg Latency: ${data.avgLatencyMs}ms | Reliability: ${(data.reliabilityScore * 100).toFixed(1)}%
          `;
        })
        .catch(() => {
          summaryContent.textContent = 'Failed to load summary stats.';
        })
        .finally(() => {
          summaryLoading.style.display = 'none';
          btnLoadSummary.disabled = false;
        });
    }
  });

  // =========================================================================
  // FLAW C (FORM / INPUT STRESS):
  // =========================================================================
  const tagInput = document.getElementById('tag-input');
  const btnApplyTag = document.getElementById('btn-apply-tag');
  const tagOutput = document.getElementById('tag-output');

  function applyTag() {
    const rawValue = tagInput.value;
    if (!rawValue) return;

    if (!isFixedMode) {
      // BROKEN VARIANT:
      // Naively splits on '-' and accesses index 1 without checking length.
      // On long inputs, edge chars, or non-hyphenated strings, throws TypeError.
      const parts = rawValue.split('-');
      const category = parts[0].trim().toUpperCase();
      const serviceName = parts[1].trim().toLowerCase(); // Throws TypeError if no '-' present!
      tagOutput.innerHTML = `Registered: <strong>[${category}]</strong> :: <em>${serviceName}</em>`;
    } else {
      // FIXED VARIANT:
      // Validates string length and safely handles missing separators.
      const safeValue = (rawValue || '').slice(0, 100);
      const parts = safeValue.split('-');
      const category = (parts[0] || 'GENERAL').trim().toUpperCase();
      const serviceName = (parts.length > 1 ? parts.slice(1).join('-') : parts[0] || 'UNNAMED').trim();
      tagOutput.textContent = `Registered: [${category}] :: ${serviceName}`;
    }
  }

  btnApplyTag.addEventListener('click', applyTag);
  tagInput.addEventListener('blur', applyTag);
  tagInput.addEventListener('change', applyTag);

  // =========================================================================
  // FLAW D (REALISTIC RUNTIME ERROR):
  // =========================================================================
  const btnInspectProfile = document.getElementById('btn-inspect-profile');
  const profileStatus = document.getElementById('profile-status');

  // Simulated anonymous session without populated user record
  window.sessionContext = {
    sessionId: 'sess_anon_987654',
    user: null, // User is not authenticated yet in this session
  };

  btnInspectProfile.addEventListener('click', () => {
    if (!isFixedMode) {
      // BROKEN VARIANT:
      // Unsafely accesses property on null `sessionContext.user` without null check.
      const themePreference = window.sessionContext.user.preferences.theme;
      profileStatus.textContent = `Active Theme: ${themePreference}`;
    } else {
      // FIXED VARIANT:
      // Uses optional chaining with a fallback value.
      const themePreference = window.sessionContext?.user?.preferences?.theme || 'System Default (Dark)';
      profileStatus.textContent = `Session: ${window.sessionContext.sessionId} | Active Theme: ${themePreference}`;
    }
  });
});
