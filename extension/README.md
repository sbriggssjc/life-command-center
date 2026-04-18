# LCC Assistant — Browser Extension

A Chrome/Edge Manifest V3 browser extension that gives you persistent Life Command Center context in a sidebar while browsing any web app. This is the zero-admin, zero-IT-approval alternative to Microsoft Copilot — install it in Edge in 60 seconds.

## Installation

1. Download or clone this repository
2. Open Edge or Chrome → `edge://extensions` (or `chrome://extensions`)
3. Enable **Developer mode** (toggle in top-right)
4. Click **"Load unpacked"** → select the `extension/` folder
5. Click the LCC puzzle-piece icon in the toolbar → **Settings** (gear icon)
6. Enter your **Railway URL** and **LCC API Key**
7. Click **"Test connection"** — you should see a green checkmark
8. Press **Ctrl+Shift+L** (or Cmd+Shift+L on Mac) to open the side panel

## Features

### Side Panel (4 Tabs)

- **Briefing** — Daily strategic/important/urgent priorities from LCC
- **Search** — Find properties, contacts, and organizations across all domains
- **Context** — Auto-detected page context or entity detail view
- **Chat** — Conversational interface to LCC (pipeline, contacts, deals, inbox)

### Domain-Specific Context Detection

| Site | Auto-Detects | Injected Button |
|------|-------------|-----------------|
| **Outlook Web** | Email sender name/email, subject, body preview | "LCC >" next to sender |
| **CoStar** | Property address, asking price, cap rate | "LCC Context >" in property header |
| **Salesforce** | Contact/Account/Lead record name, email, company | — |
| **All other sites** | — (Search and Chat always available) | — |

### Keyboard Shortcut

**Ctrl+Shift+L** (Cmd+Shift+L on Mac) opens the side panel from any tab.

### Badge Indicators

The extension icon shows a domain badge on supported sites:
- **OL** — Outlook Web
- **CS** — CoStar
- **SF** — Salesforce
- **LN** — LoopNet
- **CX** — Crexi

## Architecture

```
┌─────────────────────────────────────────────┐
│  Browser Tab                                │
│  ┌─────────────┐    ┌────────────────────┐  │
│  │ Content      │───▶│ Background.js      │  │
│  │ Script       │    │ (Service Worker)   │  │
│  │ outlook.js   │    │                    │  │
│  │ costar.js    │    │ - API proxy        │  │
│  │ salesforce.js│    │ - Context store    │  │
│  └─────────────┘    │ - Badge updates    │  │
│                     └────────┬───────────┘  │
│  ┌─────────────────┐        │              │
│  │ Side Panel       │◀───────┘              │
│  │ sidepanel.html   │                      │
│  │ sidepanel.js     │──── fetch via ────▶ Railway/MCP
│  │                  │     background.js     │
│  └─────────────────┘                       │
└─────────────────────────────────────────────┘
```

All LCC API calls are proxied through `background.js` to avoid CORS issues. Content scripts and the side panel communicate via `chrome.runtime.sendMessage`.

## Settings

| Setting | Description |
|---------|-------------|
| Railway URL | Your LCC MCP/API server URL (e.g., `https://your-app.up.railway.app`) |
| API Key | Bearer token for authentication |
| Default Tab | Which tab opens first in the side panel |
| Domain Visibility | Show/hide Government and Dialysis domain items |

## Security

- API key is stored in `chrome.storage.sync` (encrypted by Chrome, synced across devices)
- All API calls use Bearer token authentication
- No credentials are ever hardcoded in the extension
- Content scripts only read DOM elements — they never modify external page data
- The extension works offline gracefully with clear status indicators

## Files

```
extension/
├── manifest.json          Manifest V3 configuration
├── background.js          Service worker (API proxy, context, badges)
├── sidepanel.html         Side panel UI
├── sidepanel.js           Side panel logic (4 tabs)
├── popup.html             Fallback popup launcher
├── popup.js               Popup logic
├── settings.html          Settings page
├── settings.js            Settings logic
├── content/
│   ├── outlook.js         Outlook Web content script
│   ├── costar.js          CoStar content script
│   └── salesforce.js      Salesforce content script
├── icons/
│   ├── icon16.png         16px icon
│   ├── icon32.png         32px icon
│   ├── icon48.png         48px icon
│   └── icon128.png        128px icon
└── README.md              This file
```
