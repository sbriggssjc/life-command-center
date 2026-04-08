// ============================================================================
// LCC Assistant — Content Script: Salesforce
// Detects contact and account record pages
// ============================================================================

(function () {
  'use strict';

  let lastDetectedRecord = null;

  const observer = new MutationObserver(() => {
    // Salesforce Lightning record pages have /lightning/r/{Object}/{Id}/view
    const url = window.location.href;
    const recordMatch = url.match(/\/lightning\/r\/(\w+)\/(\w+)\/view/);
    if (!recordMatch) return;

    const objectType = recordMatch[1]; // Contact, Account, Lead, Opportunity, etc.
    const recordId = recordMatch[2];

    if (recordId === lastDetectedRecord) return;
    lastDetectedRecord = recordId;

    // Extract record name from page
    const nameEl =
      document.querySelector('.slds-page-header__title') ||
      document.querySelector('[data-aura-class="forceOutputLookup"] a') ||
      document.querySelector('h1 [class*="uiOutputText"]') ||
      document.querySelector('lightning-formatted-name') ||
      document.querySelector('.entityNameTitle');

    const name = nameEl?.textContent?.trim();
    if (!name) return;

    // Try to extract email and company from detail fields
    const email = extractField('Email') || extractField('email');
    const company = extractField('Company') || extractField('Account') || extractField('AccountName');
    const title = extractField('Title');
    const phone = extractField('Phone');

    // Map Salesforce object types to LCC entity types
    const entityTypeMap = {
      Contact: 'contact',
      Lead: 'contact',
      Account: 'organization',
      Opportunity: 'deal',
    };

    chrome.runtime.sendMessage({
      type: 'CONTEXT_DETECTED',
      data: {
        domain: 'salesforce',
        entity_type: entityTypeMap[objectType] || 'contact',
        sf_object_type: objectType,
        sf_record_id: recordId,
        name,
        email: email || null,
        company: company || null,
        title: title || null,
        phone: phone || null,
        page_url: url,
      },
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });

  function extractField(fieldName) {
    // Salesforce Lightning uses various patterns for field display
    const selectors = [
      `[data-target-selection-name="sfdc:RecordField.${fieldName}"] lightning-formatted-text`,
      `[data-target-selection-name="sfdc:RecordField.${fieldName}"] lightning-formatted-email`,
      `[data-target-selection-name="sfdc:RecordField.${fieldName}"] lightning-formatted-phone`,
      `[data-field-id="${fieldName}"] .slds-form-element__static`,
      `[data-field-id="${fieldName}"] lightning-formatted-text`,
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) return el.textContent.trim();
    }

    // Fallback: find label text and get adjacent value
    const labels = document.querySelectorAll('.slds-form-element__label, .test-id__field-label');
    for (const label of labels) {
      if (label.textContent?.trim().toLowerCase() === fieldName.toLowerCase()) {
        const container = label.closest('.slds-form-element');
        if (container) {
          const value = container.querySelector('.slds-form-element__static, lightning-formatted-text, lightning-formatted-email');
          if (value?.textContent?.trim()) return value.textContent.trim();
        }
      }
    }

    return null;
  }
})();
