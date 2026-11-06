import { initShell, promptSecurityPin } from './components/shell.js';
import { escapeHtml } from './utils.js';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSettingsPage);
} else {
  initSettingsPage();
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast-notification');
  if (!toast) return;
  toast.textContent = message;
  toast.style.borderColor = isError ? '#ef4444' : 'var(--action)';
  toast.style.color = isError ? '#ef4444' : 'var(--text-1)';
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}

async function loadProfile() {
  try {
    const res = await fetch('/api/settings/profile', { credentials: 'include' });
    if (!res.ok) throw new Error('Could not load profile');
    const data = await res.json();

    const emailEl = document.getElementById('val-user-email');
    if (emailEl) emailEl.textContent = data.email || 'vyzntechnologies@gmail.com';

    const businessEl = document.getElementById('val-user-business');
    if (businessEl) businessEl.textContent = data.business_name || 'Society / Premises';

    const businessTypeEl = document.getElementById('val-user-business-type');
    if (businessTypeEl) {
      const typeMap = {
        'society': '🏢 Housing Society / CHS',
        'gated_community': '🏡 Gated Community',
        'commercial_complex': '🏬 Commercial Complex',
        'retail': '🛍️ Retail Shop',
        'supermarket': '🛒 Grocery / Supermarket',
        'jewellery': '💎 Jewellery & Gold',
        'godown': '📦 Warehouse / Godown',
        'restaurant': '🍽️ Restaurant / Cafe',
        'other': '🏢 Premises'
      };
      businessTypeEl.textContent = typeMap[data.business_type] || data.business_type || 'Housing Society';
    }

    const roleEl = document.getElementById('val-user-role');
    if (roleEl) {
      if (data.role === 'admin') {
        roleEl.textContent = 'Administrator';
      } else if (data.business_type === 'society' || !data.business_type) {
        roleEl.textContent = 'Society Admin / Premises Manager';
      } else {
        roleEl.textContent = 'Premises / Property Owner';
      }
    }

    const idEl = document.getElementById('val-user-id');
    if (idEl) idEl.textContent = data.id || 'usr_primary';

    const phoneInput = document.getElementById('input-phone-number');
    const phoneBadge = document.getElementById('phone-status-badge');
    if (data.phone_e164) {
      if (phoneInput) phoneInput.value = data.phone_e164;
      if (phoneBadge) {
        phoneBadge.textContent = 'Verified (+91)';
        phoneBadge.className = 'settings-badge success';
      }
    } else {
      if (phoneBadge) {
        phoneBadge.textContent = 'Not Set';
        phoneBadge.className = 'settings-badge info';
      }
    }

    const diskEl = document.getElementById('val-disk-free');
    if (diskEl) diskEl.textContent = `${data.disk_free_pct || 85}% free`;
  } catch (err) {
    console.warn('Failed to load profile details:', err);
  }
}

function initThemeControls() {
  const currentTheme = localStorage.getItem('vyzn_theme') || 'dark';
  const group = document.getElementById('theme-segmented-group');
  if (!group) return;

  const updateActive = (t) => {
    group.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.getAttribute('data-theme-val') === t);
    });
  };

  updateActive(currentTheme);

  group.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-theme-val');
      if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', theme);
      }
      localStorage.setItem('vyzn_theme', theme);
      updateActive(theme);
      showToast(`Theme updated to ${theme}`);
    });
  });
}

function initPhoneControls() {
  const btnSave = document.getElementById('btn-save-phone');
  const input = document.getElementById('input-phone-number');
  const feedback = document.getElementById('phone-feedback');

  if (!btnSave || !input) return;

  btnSave.addEventListener('click', async () => {
    const raw = input.value.trim();
    if (!raw) {
      if (feedback) {
        feedback.textContent = 'Please enter a valid phone number.';
        feedback.style.color = '#ef4444';
        feedback.style.display = 'block';
      }
      return;
    }

    btnSave.disabled = true;
    btnSave.textContent = 'Saving…';
    if (feedback) feedback.style.display = 'none';

    try {
      const res = await fetch('/api/settings/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone: raw })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to update phone number');

      input.value = data.phone_e164;
      const phoneBadge = document.getElementById('phone-status-badge');
      if (phoneBadge) {
        phoneBadge.textContent = 'Verified (+91)';
        phoneBadge.className = 'settings-badge success';
      }

      if (feedback) {
        feedback.textContent = `Phone number saved: ${data.phone_e164}`;
        feedback.style.color = '#10b981';
        feedback.style.display = 'block';
      }
      showToast('Phone number updated successfully.');
    } catch (err) {
      if (feedback) {
        feedback.textContent = err.message;
        feedback.style.color = '#ef4444';
        feedback.style.display = 'block';
      }
      showToast(err.message, true);
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = 'Save Number';
    }
  });

  const btnPhoneConnectTg = document.getElementById('btn-phone-card-connect-tg');
  if (btnPhoneConnectTg) {
    btnPhoneConnectTg.addEventListener('click', () => {
      const tgCard = document.getElementById('card-telegram-title');
      if (tgCard) tgCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const tgBtn = document.getElementById('btn-connect-telegram');
      if (tgBtn && tgBtn.offsetParent !== null) {
        tgBtn.click();
      }
    });
  }
}

function initSecurityPinControls() {
  const btnUpdate = document.getElementById('btn-update-pin');
  const inputCurrent = document.getElementById('input-current-pin');
  const inputNew = document.getElementById('input-new-pin');
  const feedback = document.getElementById('pin-feedback');

  if (!btnUpdate || !inputNew) return;

  btnUpdate.addEventListener('click', async () => {
    const currentPin = inputCurrent ? inputCurrent.value.trim() : '';
    const newPin = inputNew.value.trim();

    if (!newPin || newPin.length < 4 || newPin.length > 8) {
      if (feedback) {
        feedback.textContent = 'New PIN must be 4 to 8 digits (6 digits recommended).';
        feedback.style.color = '#ef4444';
        feedback.style.display = 'block';
      }
      return;
    }

    btnUpdate.disabled = true;
    btnUpdate.textContent = 'Updating…';
    if (feedback) feedback.style.display = 'none';

    try {
      const res = await fetch('/api/settings/security-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          current_pin: currentPin || undefined,
          new_pin: newPin
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to update Security PIN');

      if (feedback) {
        feedback.textContent = 'Security PIN successfully updated.';
        feedback.style.color = '#10b981';
        feedback.style.display = 'block';
      }
      if (inputCurrent) inputCurrent.value = '';
      inputNew.value = '';
      showToast('Security PIN successfully updated.');
    } catch (err) {
      if (feedback) {
        feedback.textContent = err.message;
        feedback.style.color = '#ef4444';
        feedback.style.display = 'block';
      }
      showToast(err.message, true);
    } finally {
      btnUpdate.disabled = false;
      btnUpdate.textContent = 'Update Security PIN';
    }
  });
}

let tgPollInterval = null;
let currentTgToken = null;

// ==============================================================================
// CONNECT TELEGRAM ACTION (FOR NON-PROGRAMMERS)
// ------------------------------------------------------------------------------
// When you click 'Connect VYZN Telegram':
// 1. We ask the server to create a secure 10-minute linking code.
// 2. We open the official Telegram Bot (@Vyzn_security_alert_bot) in a new browser tab.
// 3. When you tap 'Start' on Telegram, your account is instantly linked!
// 4. All camera alerts and threat photos will automatically go to your Telegram.
// ==============================================================================
async function triggerConnectTelegram(btnElement) {
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = 'Opening Telegram…';
  }
  const feedback = document.getElementById('tg-feedback');
  if (feedback) feedback.style.display = 'none';

  try {
    const res = await fetch('/api/telegram/link', {
      method: 'POST',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to generate connection link');

    currentTgToken = data.token;
    const drawer = document.getElementById('tg-connect-drawer');
    const openLink = document.getElementById('tg-open-deep-link');
    if (openLink) openLink.href = data.deepLink;
    if (drawer) drawer.style.display = 'block';

    // Scroll to drawer so user sees instructions
    const tgCard = document.getElementById('card-telegram-title');
    if (tgCard) tgCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Open Telegram Bot in new window/tab
    window.open(data.deepLink, '_blank', 'noopener');
    showToast('Telegram opening… Tap Start in the bot to connect.');

    startTgPolling();
  } catch (err) {
    showToast(err.message, true);
    if (feedback) {
      feedback.textContent = err.message;
      feedback.style.color = '#ef4444';
      feedback.style.display = 'block';
    }
  } finally {
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = 'Connect VYZN Telegram';
    }
  }
}

async function initTelegramControls() {
  const btnConnect = document.getElementById('btn-connect-telegram');
  const btnDisconnect = document.getElementById('btn-disconnect-telegram');
  const btnToggleAlerts = document.getElementById('btn-toggle-tg-alerts');
  const btnTestAlert = document.getElementById('btn-test-tg-alert');
  const btnSimulate = document.getElementById('tg-test-simulate-btn');
  const feedback = document.getElementById('tg-feedback');

  const btnPhoneConnect = document.getElementById('btn-phone-card-connect-tg');
  const btnSaveToken = document.getElementById('btn-save-tg-bot-token');
  const inputToken = document.getElementById('input-tg-bot-token');
  const tokenFeedback = document.getElementById('tg-token-feedback');

  await refreshTelegramStatus();

  // Load existing Bot Token status if configured
  try {
    const cfgRes = await fetch('/api/telegram/config', { credentials: 'include' });
    if (cfgRes.ok) {
      const cfgData = await cfgRes.json();
      if (cfgData.is_token_set && inputToken) {
        inputToken.placeholder = `Token active (${cfgData.bot_token_masked})`;
      }
    }
  } catch (e) {}

  // Save BotFather token handler
  if (btnSaveToken && inputToken) {
    btnSaveToken.addEventListener('click', async () => {
      const tokVal = inputToken.value.trim();
      if (!tokVal) {
        if (tokenFeedback) {
          tokenFeedback.textContent = 'Please enter a valid bot token from @BotFather.';
          tokenFeedback.style.color = '#ef4444';
          tokenFeedback.style.display = 'block';
        }
        return;
      }
      btnSaveToken.disabled = true;
      btnSaveToken.textContent = 'Saving…';
      try {
        const res = await fetch('/api/telegram/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ bot_token: tokVal, bot_username: 'Vyzn_security_alert_bot' })
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.detail || 'Failed to save bot token');
        if (tokenFeedback) {
          tokenFeedback.textContent = 'Bot token saved and poller activated successfully!';
          tokenFeedback.style.color = '#10b981';
          tokenFeedback.style.display = 'block';
        }
        inputToken.value = '';
        inputToken.placeholder = 'Token configured and active';
        showToast('Telegram bot token saved and activated.');
        await refreshTelegramStatus();
      } catch (err) {
        if (tokenFeedback) {
          tokenFeedback.textContent = err.message;
          tokenFeedback.style.color = '#ef4444';
          tokenFeedback.style.display = 'block';
        }
        showToast(err.message, true);
      } finally {
        btnSaveToken.disabled = false;
        btnSaveToken.textContent = 'Save Token';
      }
    });
  }

  // Connect from Phone card
  if (btnPhoneConnect) {
    btnPhoneConnect.addEventListener('click', () => {
      triggerConnectTelegram(btnPhoneConnect);
    });
  }

  // Connect from Telegram card
  if (btnConnect) {
    btnConnect.addEventListener('click', () => {
      triggerConnectTelegram(btnConnect);
    });
  }

  if (btnSimulate) {
    btnSimulate.addEventListener('click', async () => {
      if (!currentTgToken) {
        showToast('Click Connect VYZN Telegram first to generate a link.', true);
        return;
      }
      btnSimulate.disabled = true;
      try {
        const res = await fetch('/api/telegram/simulate-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token: currentTgToken, username: 'demo_user' })
        });
        const d = await res.json();
        if (d.status === 'connected') {
          showToast('Simulated Telegram link confirmed!');
          await refreshTelegramStatus();
        }
      } catch (e) {
        showToast('Simulation failed', true);
      } finally {
        btnSimulate.disabled = false;
      }
    });
  }

  if (btnDisconnect) {
    btnDisconnect.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to disconnect Telegram notifications?')) return;
      btnDisconnect.disabled = true;
      try {
        const res = await fetch('/api/telegram/disconnect', {
          method: 'POST',
          credentials: 'include'
        });
        if (!res.ok) throw new Error('Failed to disconnect');
        showToast('Telegram disconnected successfully.');
        await refreshTelegramStatus();
      } catch (err) {
        showToast(err.message, true);
      } finally {
        btnDisconnect.disabled = false;
      }
    });
  }

  if (btnToggleAlerts) {
    btnToggleAlerts.addEventListener('click', async () => {
      const isCurrentlyEnabled = btnToggleAlerts.getAttribute('data-enabled') === 'true';
      const nextState = !isCurrentlyEnabled;
      btnToggleAlerts.disabled = true;
      try {
        const res = await fetch('/api/telegram/toggle-alerts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ enabled: nextState })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to toggle alerts');
        showToast(nextState ? 'Alerts unmuted.' : 'Alerts muted.');
        await refreshTelegramStatus();
      } catch (err) {
        showToast(err.message, true);
      } finally {
        btnToggleAlerts.disabled = false;
      }
    });
  }

  if (btnTestAlert) {
    btnTestAlert.addEventListener('click', async () => {
      btnTestAlert.disabled = true;
      btnTestAlert.textContent = 'Sending…';
      try {
        const res = await fetch('/api/telegram/test', {
          method: 'POST',
          credentials: 'include'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to deliver test alert');
        showToast(`Test alert delivered in ${data.latencyMs || 800}ms! Check Telegram.`);
      } catch (err) {
        showToast(err.message, true);
      } finally {
        btnTestAlert.disabled = false;
        btnTestAlert.textContent = 'Send Test Alert';
      }
    });
  }
}

function startTgPolling() {
  if (tgPollInterval) clearInterval(tgPollInterval);
  tgPollInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/telegram/status', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === 'connected') {
        clearInterval(tgPollInterval);
        tgPollInterval = null;
        showToast('Telegram successfully connected!');
        await refreshTelegramStatus();
      }
    } catch (e) {}
  }, 2500);
}

async function refreshTelegramStatus() {
  try {
    const res = await fetch('/api/telegram/status', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();

    const badge = document.getElementById('tg-status-badge');
    const disconnectedView = document.getElementById('tg-disconnected-view');
    const connectedView = document.getElementById('tg-connected-view');
    const usernameEl = document.getElementById('val-tg-username');
    const toggleBtn = document.getElementById('btn-toggle-tg-alerts');
    const sublabel = document.getElementById('lbl-tg-alert-sublabel');

    if (data.status === 'connected') {
      if (badge) {
        badge.textContent = 'Connected';
        badge.className = 'settings-badge success';
      }
      if (disconnectedView) disconnectedView.style.display = 'none';
      if (connectedView) connectedView.style.display = 'block';
      const drawer = document.getElementById('tg-connect-drawer');
      if (drawer) drawer.style.display = 'none';

      if (usernameEl) {
        const u = data.telegram_username ? `@${data.telegram_username}` : `Chat ID: ${data.telegram_chat_id || 'Active'}`;
        usernameEl.textContent = u;
      }

      const alertsEnabled = data.telegram_alerts_enabled !== false;
      if (toggleBtn) {
        toggleBtn.setAttribute('data-enabled', alertsEnabled ? 'true' : 'false');
        toggleBtn.textContent = alertsEnabled ? 'Mute Alerts' : 'Unmute Alerts';
      }
      if (sublabel) {
        sublabel.textContent = alertsEnabled
          ? 'Active: Real-time photo alerts are delivered to your chat'
          : 'Muted: Threat notifications are temporarily paused';
        sublabel.style.color = alertsEnabled ? 'var(--text-3)' : '#f59e0b';
      }
    } else {
      if (badge) {
        badge.textContent = 'Disconnected';
        badge.className = 'settings-badge info';
      }
      if (disconnectedView) disconnectedView.style.display = 'block';
      if (connectedView) connectedView.style.display = 'none';
    }
  } catch (err) {
    console.warn('Failed to refresh telegram status:', err);
  }
}

// ==============================================================================
// BUSINESS HOURS CONFIGURATION CONTROLS
// ------------------------------------------------------------------------------
// In simple terms: lets users configure and save opening and closing hours.
// ==============================================================================

async function initBusinessHoursControls() {
  const cbEnabled = document.getElementById('cb-bh-enabled');
  const inputStart = document.getElementById('input-bh-start');
  const inputEnd = document.getElementById('input-bh-end');
  const btnSave = document.getElementById('btn-save-bh');
  const badge = document.getElementById('bh-status-badge');
  const feedback = document.getElementById('bh-feedback');

  // Load current business hours from backend
  try {
    const res = await fetch('/api/settings/business-hours', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (cbEnabled) cbEnabled.checked = data.enabled !== false;
      if (inputStart && data.start_time) inputStart.value = data.start_time;
      if (inputEnd && data.end_time) inputEnd.value = data.end_time;
      if (badge) {
        badge.textContent = data.enabled ? 'Active' : 'Disabled';
        badge.className = data.enabled ? 'settings-badge success' : 'settings-badge info';
      }
    }
  } catch (err) {
    console.warn('Failed to load business hours:', err);
  }

  // Handle saving new business hours
  if (btnSave) {
    btnSave.onclick = async () => {
      btnSave.disabled = true;
      btnSave.textContent = 'Saving…';
      if (feedback) feedback.style.display = 'none';

      const enabled = cbEnabled ? cbEnabled.checked : true;
      const startTime = inputStart ? inputStart.value : '09:00';
      const endTime = inputEnd ? inputEnd.value : '21:00';

      try {
        const res = await fetch('/api/settings/business-hours', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            enabled: enabled,
            start_time: startTime,
            end_time: endTime
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || 'Failed to update business hours.');
        }

        if (badge) {
          badge.textContent = enabled ? 'Active' : 'Disabled';
          badge.className = enabled ? 'settings-badge success' : 'settings-badge info';
        }

        showToast('Business hours saved successfully!');
        if (feedback) {
          feedback.style.color = '#10b981';
          feedback.textContent = `✓ Business hours updated (${startTime} – ${endTime})`;
          feedback.style.display = 'block';
        }
      } catch (err) {
        showToast(err.message, true);
        if (feedback) {
          feedback.style.color = '#ef4444';
          feedback.textContent = err.message;
          feedback.style.display = 'block';
        }
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = 'Save Business Hours';
      }
    };
  }
}

// ==============================================================================
// STORAGE SPACE FOLDER CONTROLS
// ------------------------------------------------------------------------------
// In simple terms: lets users configure their storage directory, view free space,
// and make sure camera footage & clips are safeguarded from deletion on errors.
// ==============================================================================

let edgeBaseUrl = null;

async function checkEdgeServer() {
  if (edgeBaseUrl !== null) return edgeBaseUrl;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.port === '8000') {
    edgeBaseUrl = '';
    return edgeBaseUrl;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch('http://127.0.0.1:8000/api/status', {
      method: 'GET',
      mode: 'cors',
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      edgeBaseUrl = 'http://127.0.0.1:8000';
      return edgeBaseUrl;
    }
  } catch (e) {}
  edgeBaseUrl = '';
  return edgeBaseUrl;
}

async function initStorageControls() {
  const inputFolder = document.getElementById('input-storage-folder');
  const btnSave = document.getElementById('btn-save-storage');
  const valPath = document.getElementById('val-storage-path');
  const valFree = document.getElementById('val-disk-free');
  const valClips = document.getElementById('val-clips-stored');
  const badge = document.getElementById('storage-status-badge');
  const feedback = document.getElementById('storage-feedback');

  // Load storage details from edge daemon or cloud server
  async function refreshStorageInfo() {
    try {
      const edge = await checkEdgeServer();
      let data = null;
      if (edge) {
        try {
          const edgeRes = await fetch(`${edge}/api/settings/storage`, { mode: 'cors' });
          if (edgeRes.ok) {
            data = await edgeRes.json();
          }
        } catch (e) {
          console.warn('Edge storage info fetch failed:', e);
        }
      }
      if (!data) {
        const res = await fetch('/api/settings/storage', { credentials: 'include' });
        if (res.ok) {
          data = await res.json();
        }
      }
      if (data) {
        const localSavedDir = localStorage.getItem('vyzn_storage_folder');
        const activeDir = localSavedDir || data.storage_dir || 'C:\\VyznFootage';
        if (inputFolder) {
          inputFolder.value = activeDir;
        }
        if (valPath) {
          valPath.textContent = activeDir;
        }
        if (valFree) {
          const used = data.disk_used_gb || 0;
          const total = data.disk_total_gb || 0;
          const freeGb = (total >= used && total > 0) ? (total - used).toFixed(1) : 0;
          const freePct = data.disk_free_pct !== undefined ? data.disk_free_pct : (total > 0 ? Math.round((freeGb / total) * 100) : 0);
          valFree.textContent = total > 0
            ? `${freePct}% free (${freeGb} GB free of ${total.toFixed(1)} GB)`
            : 'Available';
        }
        if (valClips) {
          let realCount = data.clips_count || 0;
          try {
            const cRes = await fetch('/api/clips', { credentials: 'include' });
            if (cRes.ok) {
              const cData = await cRes.json();
              if (Array.isArray(cData)) realCount = cData.length;
              else if (Array.isArray(cData.clips)) realCount = cData.clips.length;
            }
          } catch (_) {}
          valClips.textContent = `${realCount} clips (Safe & Preserved)`;
        }
        if (badge) {
          const isWritable = data.is_writable !== false;
          badge.textContent = isWritable ? 'Active & Writable' : 'Read-Only Warning';
          badge.className = isWritable ? 'settings-badge success' : 'settings-badge info';
        }
      }
    } catch (err) {
      console.warn('Failed to load storage info:', err);
    }
  }

  await refreshStorageInfo();

  if (btnSave) {
    btnSave.onclick = async () => {
      const dirVal = inputFolder ? inputFolder.value.trim() : '';
      if (!dirVal) {
        if (feedback) {
          feedback.style.color = '#ef4444';
          feedback.textContent = 'Please specify a valid folder path.';
          feedback.style.display = 'block';
        }
        return;
      }

      btnSave.disabled = true;
      btnSave.textContent = 'Verifying & Saving…';
      if (feedback) feedback.style.display = 'none';

      try {
        if (window.showDirectoryPicker) {
          try {
            const handle = await window.showDirectoryPicker();
            if (handle && handle.name) {
              const currentVal = inputFolder ? inputFolder.value.trim() : '';
              let targetPath = `C:\\${handle.name}`;
              if (currentVal && (currentVal.startsWith('D:') || currentVal.startsWith('E:'))) {
                targetPath = `${currentVal.substring(0, 2)}\\${handle.name}`;
              }
              if (inputFolder) inputFolder.value = targetPath;
              try { localStorage.setItem('vyzn_storage_folder', targetPath); } catch (_) {}
              showToast(`Storage folder set to: ${targetPath}`);
              if (btnSave) btnSave.click();
              return;
            }
          } catch (pickerErr) {
            if (pickerErr.name === 'AbortError') return;
          }
        }

        const edge = await checkEdgeServer();
        if (edge) {
          try {
            await fetch(`${edge}/api/settings/storage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              mode: 'cors',
              body: JSON.stringify({ storage_dir: dirVal })
            });
          } catch (e) {
            console.warn('Edge storage save failed:', e);
          }
        }

        const res = await fetch('/api/settings/storage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ storage_dir: dirVal })
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || 'Failed to update storage folder.');
        }

        try { localStorage.setItem('vyzn_storage_folder', dirVal); } catch (_) {}
        showToast('Storage folder updated successfully!');
        if (feedback) {
          feedback.style.color = '#10b981';
          feedback.textContent = '✓ Storage space folder saved and active. All footage will be kept safe here.';
          feedback.style.display = 'block';
        }
        await refreshStorageInfo();
      } catch (err) {
        showToast(err.message, true);
        if (feedback) {
          feedback.style.color = '#ef4444';
          feedback.textContent = err.message;
          feedback.style.display = 'block';
        }
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = 'Save Storage Folder';
      }
    };
  }

  // Quick preset chips listeners
  document.querySelectorAll('.btn-preset-path').forEach(btn => {
    btn.onclick = () => {
      const p = btn.getAttribute('data-path');
      if (p && inputFolder) {
        inputFolder.value = p;
        showToast(`Selected preset: ${p}`);
        if (btnSave) btnSave.click();
      }
    };
  });

  // Opens native Windows file explorer folder selection dialog via local edge server or prompts for path
  const btnBrowse = document.getElementById('btn-browse-folder');
  const inputDirPicker = document.getElementById('input-folder-picker');


  if (btnBrowse) {
    btnBrowse.onclick = async () => {
      btnBrowse.disabled = true;
      btnBrowse.textContent = '📁 Opening Explorer…';

      try {
        if (window.showDirectoryPicker) {
          try {
            const handle = await window.showDirectoryPicker();
            if (handle && handle.name) {
              const currentVal = inputFolder ? inputFolder.value.trim() : '';
              let targetPath = `C:\\${handle.name}`;
              if (currentVal && (currentVal.startsWith('D:') || currentVal.startsWith('E:'))) {
                targetPath = `${currentVal.substring(0, 2)}\\${handle.name}`;
              }
              if (inputFolder) inputFolder.value = targetPath;
              try { localStorage.setItem('vyzn_storage_folder', targetPath); } catch (_) {}
              showToast(`Storage folder set to: ${targetPath}`);
              if (btnSave) btnSave.click();
              return;
            }
          } catch (pickerErr) {
            if (pickerErr.name === 'AbortError') return;
          }
        }

        const edge = await checkEdgeServer();
        if (edge) {
          try {
            const res = await fetch(`${edge}/api/settings/browse-folder`, { method: 'POST', mode: 'cors' });
            const data = await res.json();
            if (data.ok && data.selected_path) {
              if (inputFolder) inputFolder.value = data.selected_path;
              showToast(`Selected folder: ${data.selected_path}`);
              if (btnSave) btnSave.click();
              return;
            } else if (data.cancelled) {
              return;
            }
          } catch (e) {
            console.warn('Edge browse-folder error:', e);
          }
        }

        const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.port === '8000';
        if (isLocalHost) {
          try {
            const res = await fetch('/api/settings/browse-folder', { method: 'POST' });
            const data = await res.json();
            if (data.ok && data.selected_path) {
              if (inputFolder) inputFolder.value = data.selected_path;
              showToast(`Selected folder: ${data.selected_path}`);
              if (btnSave) btnSave.click();
              return;
            } else if (data.cancelled) {
              return;
            }
          } catch (e) {
            console.warn('Local browse-folder error:', e);
          }
        }

        // On cloud or fallback: prompt user for exact folder path
        const currentVal = inputFolder ? inputFolder.value : (localStorage.getItem('vyzn_storage_folder') || 'C:\\VyznFootage');
        const enteredVal = window.prompt('Choose local folder path for saving clips and footage (e.g. C:\\VyznFootage or D:\\Recordings):', currentVal);
        if (enteredVal && enteredVal.trim()) {
          const cleaned = enteredVal.trim();
          if (inputFolder) inputFolder.value = cleaned;
          try { localStorage.setItem('vyzn_storage_folder', cleaned); } catch (_) {}
          showToast(`Storage path set to: ${cleaned}`);
          if (btnSave) btnSave.click();
          return;
        }
      } catch (err) {
        console.error('Folder picker error:', err);
      } finally {
        btnBrowse.disabled = false;
        btnBrowse.textContent = '📁 Choose Folder';
      }
    };
  }

  if (inputDirPicker) {
    inputDirPicker.onchange = (e) => {
      if (e.target.files && e.target.files.length > 0) {
        const file = e.target.files[0];
        const relPath = file.webkitRelativePath || '';
        const folderName = relPath.split('/')[0] || relPath.split('\\')[0] || '';
        if (folderName) {
          const currentDir = inputFolder.value.trim() || 'C:\\Vyzn testing data';
          const sep = currentDir.includes('\\') ? '\\' : '/';
          const baseParent = currentDir.includes(sep) ? currentDir.substring(0, currentDir.lastIndexOf(sep)) : 'C:';
          inputFolder.value = `${baseParent}${sep}${folderName}`;
          showToast(`Selected folder: ${folderName}`);
          if (btnSave) btnSave.click();
        }
      }
    };
  }

  // Purges all past clips cleanly with Security PIN verification
  const btnPurgeAll = document.getElementById('btn-purge-all-clips');
  if (btnPurgeAll) {
    btnPurgeAll.onclick = async () => {
      const pin = await promptSecurityPin({
        title: 'Delete All Previous Clips',
        description: 'Permanently purge all historical clips, recordings, and media from disk and database. This cannot be undone.',
        confirmText: 'Delete All Clips',
        isDanger: true
      });
      if (!pin) return;

      btnPurgeAll.disabled = true;
      btnPurgeAll.textContent = 'Purging clips…';
      try {
        if (window.showDirectoryPicker) {
          try {
            const handle = await window.showDirectoryPicker();
            if (handle && handle.name) {
              const currentVal = inputFolder ? inputFolder.value.trim() : '';
              let targetPath = `C:\\${handle.name}`;
              if (currentVal && (currentVal.startsWith('D:') || currentVal.startsWith('E:'))) {
                targetPath = `${currentVal.substring(0, 2)}\\${handle.name}`;
              }
              if (inputFolder) inputFolder.value = targetPath;
              try { localStorage.setItem('vyzn_storage_folder', targetPath); } catch (_) {}
              showToast(`Storage folder set to: ${targetPath}`);
              if (btnSave) btnSave.click();
              return;
            }
          } catch (pickerErr) {
            if (pickerErr.name === 'AbortError') return;
          }
        }

        const edge = await checkEdgeServer();
        if (edge) {
          try {
            await fetch(`${edge}/api/clips/purge-all`, {
              method: 'POST',
              headers: { 'X-Security-Pin': pin },
              mode: 'cors'
            });
          } catch (e) {
            console.warn('Edge purge failed:', e);
          }
        }
        const res = await fetch('/api/clips/purge-all', {
          method: 'POST',
          headers: { 'X-Security-Pin': pin },
          credentials: 'include'
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          showToast(data.message || 'All previous clips purged successfully.');
          await refreshStorageInfo();
        } else {
          showToast(data.detail || 'Failed to purge clips. Check Security PIN.', true);
        }
      } catch (err) {
        showToast('Error while purging clips.', true);
      } finally {
        btnPurgeAll.disabled = false;
        btnPurgeAll.textContent = '🗑️ Delete All Previous Clips';
      }
    };
  }
}





export async function initSettingsPage() {
  await initI18n();
  initShell({ activePage: 'settings' });
  await initAccountDetails();
  initThemeControls();
  await initPhoneControls();
  await initSecurityControls();
  await initTelegramControls();
  await initBusinessHoursControls();
  await initStorageControls();
  await loadCameraPlanQuota();
  await loadCameraPlanOrders();
  initCameraPlanWizard();
}


// ============================================================================
// Camera Plan & Quota Management
// ============================================================================

let currentPlanOrderId = null;
let planCountdownInterval = null;
let planStatusPollInterval = null;
const PRICE_PER_CAMERA_INR = 2499;

async function loadCameraPlanQuota() {
  try {
    const res = await fetch('/billing/quota', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    const purchasedEl = document.getElementById('val-quota-purchased');
    const usedEl = document.getElementById('val-quota-used');
    const availEl = document.getElementById('val-quota-available');

    if (purchasedEl) purchasedEl.textContent = data.purchased;
    if (usedEl) usedEl.textContent = data.used;
    if (availEl) {
      availEl.textContent = data.available;
      if (data.available === 0) {
        availEl.style.color = '#ef4444';
      } else {
        availEl.style.color = '#10b981';
      }
    }
  } catch (err) {
    console.error('Error loading camera quota:', err);
  }
}

async function loadCameraPlanOrders() {
  const tbody = document.getElementById('plan-orders-table-body');
  if (!tbody) return;
  try {
    const res = await fetch('/billing/quota-orders', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch plan orders');
    const orders = await res.json();
    if (!orders || orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding: 16px 10px; text-align: center; color: var(--text-muted);">No camera plan orders yet.</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(ord => {
      const dt = ord.created_at ? new Date(ord.created_at).toLocaleDateString() : '--';
      const amt = (ord.amount_paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
      const utr = ord.utr ? `<code style="color: #38bdf8;">${escapeHtml(ord.utr)}</code>` : '<span style="color: #64748b;">Pending</span>';
      
      let badgeStyle = 'background: #334155; color: #cbd5e1;';
      let statusLabel = ord.status;
      if (ord.status === 'paid') {
        badgeStyle = 'background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid #10b981;';
        statusLabel = 'Approved';
      } else if (ord.status === 'submitted') {
        badgeStyle = 'background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid #f59e0b;';
        statusLabel = 'Verifying';
      } else if (ord.status === 'awaiting_payment') {
        badgeStyle = 'background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid #38bdf8;';
        statusLabel = 'Awaiting Pay';
      } else if (ord.status === 'rejected') {
        badgeStyle = 'background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid #ef4444;';
        statusLabel = 'Rejected';
      } else if (ord.status === 'expired') {
        badgeStyle = 'background: #1e293b; color: #64748b;';
        statusLabel = 'Expired';
      }

      return `
        <tr style="border-bottom: 1px solid var(--border-subtle);">
          <td style="padding: 10px;"><strong style="color: #f8fafc;">${escapeHtml(ord.order_code)}</strong></td>
          <td style="padding: 10px; color: var(--text-2);">${dt}</td>
          <td style="padding: 10px; color: var(--text-1);">+${ord.quantity}</td>
          <td style="padding: 10px; color: #f8fafc; font-weight: 600;">${amt}</td>
          <td style="padding: 10px;">${utr}</td>
          <td style="padding: 10px;">
            <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; ${badgeStyle}">
              ${statusLabel}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading camera plan orders:', err);
    tbody.innerHTML = '<tr><td colspan="6" style="padding: 16px 10px; text-align: center; color: #ef4444;">Could not load order history.</td></tr>';
  }
}

function initCameraPlanWizard() {
  const btnOpen = document.getElementById('btn-add-camera-plan');
  const wizard = document.getElementById('plan-wizard-container');
  const btnClose = document.getElementById('btn-close-plan-wizard');
  const btnDone = document.getElementById('btn-plan-done');

  const step1 = document.getElementById('plan-step-1');
  const step2 = document.getElementById('plan-step-2');
  const step3 = document.getElementById('plan-step-3');

  const qtyInput = document.getElementById('input-plan-qty');
  const qtyMinus = document.getElementById('btn-plan-qty-minus');
  const qtyPlus = document.getElementById('btn-plan-qty-plus');
  const calcTotal = document.getElementById('plan-calculated-total');
  const btnProceed = document.getElementById('btn-proceed-to-pay');

  const utrInput = document.getElementById('plan-input-utr');
  const btnSubmitUtr = document.getElementById('btn-submit-plan-utr');
  const utrErrMsg = document.getElementById('plan-utr-err-msg');

  if (!btnOpen || !wizard) return;

  function updateQtyTotal() {
    let q = parseInt(qtyInput.value) || 1;
    if (q < 1) q = 1;
    if (q > 20) q = 20;
    qtyInput.value = q;
    const total = (q * PRICE_PER_CAMERA_INR).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
    calcTotal.textContent = total;
  }

  if (qtyMinus) {
    qtyMinus.addEventListener('click', () => {
      let q = parseInt(qtyInput.value) || 1;
      if (q > 1) {
        qtyInput.value = q - 1;
        updateQtyTotal();
      }
    });
  }

  if (qtyPlus) {
    qtyPlus.addEventListener('click', () => {
      let q = parseInt(qtyInput.value) || 1;
      if (q < 20) {
        qtyInput.value = q + 1;
        updateQtyTotal();
      }
    });
  }

  if (qtyInput) {
    qtyInput.addEventListener('change', updateQtyTotal);
    qtyInput.addEventListener('keyup', updateQtyTotal);
  }

  btnOpen.addEventListener('click', () => {
    wizard.style.display = 'block';
    step1.style.display = 'block';
    step2.style.display = 'none';
    step3.style.display = 'none';
    document.getElementById('plan-wizard-title').textContent = 'Step 1: Select Camera Quantity';
    updateQtyTotal();
  });

  const closeWizard = () => {
    wizard.style.display = 'none';
    clearInterval(planCountdownInterval);
    clearInterval(planStatusPollInterval);
    loadCameraPlanQuota();
    loadCameraPlanOrders();
  };

  if (btnClose) btnClose.addEventListener('click', closeWizard);
  if (btnDone) btnDone.addEventListener('click', closeWizard);

  if (btnProceed) {
    btnProceed.addEventListener('click', async () => {
      const quantity = parseInt(qtyInput.value) || 1;
      btnProceed.disabled = true;
      btnProceed.textContent = 'Generating UPI QR...';
      try {
        const res = await fetch('/billing/quota-orders', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity })
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.detail?.error || data.detail || 'Could not create order', true);
          btnProceed.disabled = false;
          btnProceed.textContent = 'Proceed to Payment →';
          return;
        }

        currentPlanOrderId = data.id;
        document.getElementById('plan-display-order-code').textContent = data.order_code;
        const totalStr = (data.amount_paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
        document.getElementById('plan-display-amount').textContent = totalStr;

        const qrImg = document.getElementById('plan-qr-image');
        if (qrImg) qrImg.src = data.qr;

        const upiLinkBtn = document.getElementById('plan-upi-direct-btn');
        if (upiLinkBtn) upiLinkBtn.href = data.upi_link;

        // Start expiry countdown
        startCountdown(new Date(data.expires_at).getTime());

        // Switch to Step 2
        step1.style.display = 'none';
        step2.style.display = 'block';
        document.getElementById('plan-wizard-title').textContent = 'Step 2: Scan & Pay via UPI';
      } catch (err) {
        showToast('Error creating order. Please try again.', true);
      } finally {
        btnProceed.disabled = false;
        btnProceed.textContent = 'Proceed to Payment →';
      }
    });
  }

  function startCountdown(expiryMs) {
    clearInterval(planCountdownInterval);
    const countdownEl = document.getElementById('plan-expiry-countdown');
    const updateTimer = () => {
      const diff = expiryMs - Date.now();
      if (diff <= 0) {
        clearInterval(planCountdownInterval);
        if (countdownEl) countdownEl.textContent = '00:00 (Expired)';
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (countdownEl) countdownEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };
    updateTimer();
    planCountdownInterval = setInterval(updateTimer, 1000);
  }

  if (btnSubmitUtr) {
    btnSubmitUtr.addEventListener('click', async () => {
      const utr = (utrInput.value || '').trim();
      if (utrErrMsg) utrErrMsg.style.display = 'none';

      if (!/^\d{12}$/.test(utr)) {
        if (utrErrMsg) {
          utrErrMsg.textContent = 'Please enter a valid 12-digit UPI reference number (UTR).';
          utrErrMsg.style.display = 'block';
        }
        return;
      }

      btnSubmitUtr.disabled = true;
      btnSubmitUtr.textContent = 'Submitting Reference...';

      try {
        const res = await fetch(`/billing/quota-orders/${currentPlanOrderId}/submit-utr`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ utr })
        });
        const data = await res.json();
        if (!res.ok) {
          const msg = data.detail || 'Failed to submit UTR.';
          if (utrErrMsg) {
            utrErrMsg.textContent = msg;
            utrErrMsg.style.display = 'block';
          }
          btnSubmitUtr.disabled = false;
          btnSubmitUtr.textContent = 'Submit Payment for Verification';
          return;
        }

        // Switch to Step 3
        step2.style.display = 'none';
        step3.style.display = 'block';
        document.getElementById('plan-wizard-title').textContent = 'Step 3: Manual Verification';

        const statusHeading = document.getElementById('plan-status-heading');
        const statusDesc = document.getElementById('plan-status-desc');
        const statusIcon = document.getElementById('plan-status-icon');

        statusIcon.textContent = '⏳';
        statusHeading.textContent = 'Payment Submitted for Verification';
        statusDesc.innerHTML = `Order <strong>${data.order?.order_code || ''}</strong> with UTR <code>${escapeHtml(utr)}</code> has been submitted to the admin.<br><br><em>Payments are verified manually.</em> Your camera quota will automatically activate as soon as the reference is confirmed on our bank statement.`;

        // Start polling for approval
        startPollingApproval(currentPlanOrderId);
      } catch (err) {
        if (utrErrMsg) {
          utrErrMsg.textContent = 'Connection error. Please try again.';
          utrErrMsg.style.display = 'block';
        }
      } finally {
        btnSubmitUtr.disabled = false;
        btnSubmitUtr.textContent = 'Submit Payment for Verification';
      }
    });
  }

  function startPollingApproval(orderId) {
    clearInterval(planStatusPollInterval);
    planStatusPollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/billing/quota-orders/${orderId}`, { credentials: 'include' });
        if (!res.ok) return;
        const ord = await res.json();
        if (ord.status === 'paid') {
          clearInterval(planStatusPollInterval);
          const statusIcon = document.getElementById('plan-status-icon');
          const statusHeading = document.getElementById('plan-status-heading');
          const statusDesc = document.getElementById('plan-status-desc');
          const statusActions = document.getElementById('plan-status-actions');

          statusIcon.textContent = '✅';
          statusHeading.textContent = 'Payment Approved & Quota Added!';
          statusHeading.style.color = '#10b981';
          statusDesc.innerHTML = `Success! <strong>+${ord.quantity} camera slot(s)</strong> have been added to your quota. You can now connect your new cameras.`;
          statusActions.innerHTML = `
            <a href="/cameras/new" class="btn btn-primary" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600;">
              Add Camera Now &rarr;
            </a>
          `;
          loadCameraPlanQuota();
          loadCameraPlanOrders();
        } else if (ord.status === 'rejected') {
          clearInterval(planStatusPollInterval);
          const statusIcon = document.getElementById('plan-status-icon');
          const statusHeading = document.getElementById('plan-status-heading');
          const statusDesc = document.getElementById('plan-status-desc');

          statusIcon.textContent = '❌';
          statusHeading.textContent = 'Payment Rejected';
          statusHeading.style.color = '#ef4444';
          statusDesc.innerHTML = `Verification rejected: ${escapeHtml(ord.reject_reason || 'UTR could not be matched with bank statement')}. Please check your transaction details or create a new order.`;
          loadCameraPlanOrders();
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 4000);
  }
}
