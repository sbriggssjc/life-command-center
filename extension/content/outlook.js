// ============================================================================
// LCC Assistant — Content Script: Outlook Web
// Detects email sender context and injects "LCC" button
// ============================================================================

(function () {
  'use strict';

  let lastDetectedEmail = null;

  const observer = new MutationObserver(() => {
    const emailPane =
      document.querySelector('[data-app-section="MessageReadingPane"]') ||
      document.querySelector('[role="main"] [data-app-section="ConversationReadingPane"]') ||
      document.querySelector('.ReadMsgContainer');

    if (!emailPane) return;

    // Extract sender email
    const senderEl =
      emailPane.querySelector('[data-testid="SenderEmail"]') ||
      emailPane.querySelector('.ms-Persona-secondaryText') ||
      emailPane.querySelector('[autoid="_pe_b"]');

    // Extract subject
    const subjectEl =
      emailPane.querySelector('[data-testid="subject"]') ||
      emailPane.querySelector('.allowTextSelection') ||
      emailPane.querySelector('[role="heading"]');

    // Extract body preview
    const bodyEl =
      emailPane.querySelector('[data-testid="UniqueMessageBody"]') ||
      emailPane.querySelector('.BodyFragment') ||
      emailPane.querySelector('[role="document"]');

    const email = senderEl?.textContent?.trim();
    if (!email || email === lastDetectedEmail) return;
    lastDetectedEmail = email;

    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain: 'outlook',
        entity_type: 'contact',
        email,
        name: extractSenderName(emailPane),
        subject: subjectEl?.textContent?.trim() || '',
        body_preview: bodyEl?.textContent?.substring(0, 200) || '',
      },
    });

    injectLccButton(emailPane, senderEl);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  function extractSenderName(pane) {
    const nameEl =
      pane.querySelector('[data-testid="SenderName"]') ||
      pane.querySelector('.ms-Persona-primaryText') ||
      pane.querySelector('[autoid="_pe_a"]');
    return nameEl?.textContent?.trim() || '';
  }

  function injectLccButton(pane, senderEl) {
    // Don't inject twice
    if (pane.querySelector('.lcc-inject-btn')) return;

    const target =
      senderEl?.parentElement ||
      pane.querySelector('.ms-Persona') ||
      pane.querySelector('[data-testid="SenderContainer"]');

    if (!target) return;

    const btn = document.createElement('button');
    btn.className = 'lcc-inject-btn';
    btn.textContent = 'LCC \u25B8';
    btn.title = 'Open LCC context for this sender';
    Object.assign(btn.style, {
      marginLeft: '8px',
      padding: '2px 8px',
      fontSize: '11px',
      fontWeight: '600',
      color: '#1F3864',
      background: '#EBF0FA',
      border: '1px solid #B8C9E8',
      borderRadius: '4px',
      cursor: 'pointer',
      verticalAlign: 'middle',
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
    });

    target.appendChild(btn);
  }
})();
