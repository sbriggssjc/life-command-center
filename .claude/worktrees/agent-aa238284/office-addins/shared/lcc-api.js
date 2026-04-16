// ============================================================================
// LCC API Client — Shared module for Office Add-ins
// Inline this class in each taskpane.html via <script> tag.
// Do NOT reference this file directly — Office WebView has no module system.
// ============================================================================

class LCCApi {
  constructor() {
    this.baseUrl = localStorage.getItem('lcc_railway_url') || '';
    this.apiKey = localStorage.getItem('lcc_api_key') || '';
  }

  async call(action, params = {}) {
    if (!this.baseUrl || !this.apiKey) throw new Error('LCC not configured');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-LCC-Surface': 'office_addin'
        },
        body: JSON.stringify({ copilot_action: action, params, surface: 'office_addin' }),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`LCC API error ${res.status}`);
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async assembleContext(packetType, params = {}) {
    if (!this.baseUrl || !this.apiKey) throw new Error('LCC not configured');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`${this.baseUrl}/api/context`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'assemble',
          packet_type: packetType,
          surface_hint: 'office_addin',
          ...params
        }),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`Context error ${res.status}`);
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  isConfigured() {
    return !!(this.baseUrl && this.apiKey);
  }

  saveConfig(url, key) {
    localStorage.setItem('lcc_railway_url', url.replace(/\/+$/, ''));
    localStorage.setItem('lcc_api_key', key);
    this.baseUrl = url.replace(/\/+$/, '');
    this.apiKey = key;
  }
}
