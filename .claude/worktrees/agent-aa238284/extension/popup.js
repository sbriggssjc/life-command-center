// ============================================================================
// LCC Assistant — Popup (fallback launcher when side panel unavailable)
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Check connection
  try {
    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' }, resolve);
    });

    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');

    if (result && result.ok) {
      dot.className = 'status-dot online';
      text.textContent = 'Connected to LCC';
    } else {
      dot.className = 'status-dot offline';
      text.textContent = result?.error || 'Not connected';
    }
  } catch {
    document.getElementById('statusDot').className = 'status-dot offline';
    document.getElementById('statusText').textContent = 'Extension error';
  }

  // Open Side Panel
  document.getElementById('openPanel').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
        // Side panel not supported, open in new tab
        chrome.tabs.create({ url: 'sidepanel.html' });
      });
    }
    window.close();
  });

  // Morning Briefing — open side panel on briefing tab
  document.getElementById('openBriefing').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.storage.session.set({ openTab: 'briefing' });
      chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
        chrome.tabs.create({ url: 'sidepanel.html' });
      });
    }
    window.close();
  });

  // Search — open side panel on search tab
  document.getElementById('openSearch').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.storage.session.set({ openTab: 'search' });
      chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
        chrome.tabs.create({ url: 'sidepanel.html' });
      });
    }
    window.close();
  });

  // Settings
  document.getElementById('openSettings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'settings.html' });
    window.close();
  });
});
