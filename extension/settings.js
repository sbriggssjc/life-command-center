// ============================================================================
// LCC Assistant — Settings Page
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings
  const config = await chrome.storage.sync.get([
    'LCC_RAILWAY_URL',
    'LCC_API_KEY',
    'defaultTab',
    'showGov',
    'showDia',
  ]);

  // The Power Automate flow URL lives in chrome.storage.local (not .sync)
  // because it's device-specific (different per installation) and can be
  // large. background.js reads from .local.
  const localConfig = await chrome.storage.local.get(['lccIntakeFlowUrl']);

  document.getElementById('railwayUrl').value = config.LCC_RAILWAY_URL || '';
  document.getElementById('apiKey').value = config.LCC_API_KEY || '';
  document.getElementById('defaultTab').value = config.defaultTab || 'briefing';
  document.getElementById('showGov').checked = config.showGov !== false;
  document.getElementById('showDia').checked = config.showDia !== false;

  const flowField = document.getElementById('intakeFlowUrl');
  if (flowField) flowField.value = localConfig.lccIntakeFlowUrl || '';

  // Test connection
  document.getElementById('testConnection').addEventListener('click', async () => {
    const url = document.getElementById('railwayUrl').value.trim();
    const key = document.getElementById('apiKey').value.trim();

    if (!url) {
      showToast('Enter a Railway URL first', 'error');
      return;
    }

    const statusEl = document.getElementById('connectionStatus');
    const dot = document.getElementById('connDot');
    const text = document.getElementById('connText');

    statusEl.style.display = 'flex';
    dot.className = 'connection-dot checking';
    text.textContent = 'Testing connection...';

    // Save temporarily for the test
    await chrome.storage.sync.set({ LCC_RAILWAY_URL: url, LCC_API_KEY: key });

    try {
      const result = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' }, resolve);
      });

      if (result && result.ok) {
        dot.className = 'connection-dot online';
        const tools = result.data?.tools?.length || 0;
        text.textContent = `Connected — ${tools} tools available`;
        showToast('Connection successful', 'success');
      } else {
        dot.className = 'connection-dot offline';
        text.textContent = result?.error || 'Connection failed';
        showToast(result?.error || 'Connection failed', 'error');
      }
    } catch (err) {
      dot.className = 'connection-dot offline';
      text.textContent = `Error: ${err.message}`;
      showToast('Connection test failed', 'error');
    }
  });

  // Save settings
  document.getElementById('saveSettings').addEventListener('click', async () => {
    const settings = {
      LCC_RAILWAY_URL: document.getElementById('railwayUrl').value.trim(),
      LCC_API_KEY: document.getElementById('apiKey').value.trim(),
      defaultTab: document.getElementById('defaultTab').value,
      showGov: document.getElementById('showGov').checked,
      showDia: document.getElementById('showDia').checked,
    };

    await chrome.storage.sync.set(settings);

    // Save the flow URL separately to chrome.storage.local
    const flowUrl = document.getElementById('intakeFlowUrl')?.value.trim() || '';
    if (flowUrl) {
      await chrome.storage.local.set({ lccIntakeFlowUrl: flowUrl });
    } else {
      await chrome.storage.local.remove('lccIntakeFlowUrl');
    }

    showToast('Settings saved', 'success');
  });
});

function showToast(message, type) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => {
    toast.className = 'toast';
  }, 2500);
}
