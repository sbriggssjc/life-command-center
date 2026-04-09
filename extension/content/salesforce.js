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

    // Detect property/asset records (standard or custom objects)
    const isPropertyRecord = /property|asset|listing|parcel|building|real_estate/i.test(objectType);
    const entityType = isPropertyRecord ? 'property' : (entityTypeMap[objectType] || 'contact');

    const data = {
      domain: 'salesforce',
      entity_type: entityType,
      sf_object_type: objectType,
      sf_record_id: recordId,
      name,
      email: email || null,
      company: company || null,
      title: title || null,
      phone: phone || null,
      page_url: url,
    };

    // For property-like records, extract additional CRE fields
    if (isPropertyRecord || objectType === 'Opportunity') {
      data.address = extractField('Address') || extractField('Property_Address__c') ||
        extractField('Street') || extractField('Site_Address__c') || null;
      data.city = extractField('City') || extractField('Property_City__c') || null;
      data.state = extractField('State') || extractField('Property_State__c') || null;
      data.asking_price = extractField('Price') || extractField('Asking_Price__c') ||
        extractField('Amount') || extractField('List_Price__c') || null;
      data.property_type = extractField('Property_Type__c') || extractField('Asset_Type__c') ||
        extractField('Type') || null;
      data.square_footage = extractField('Square_Footage__c') || extractField('Building_Size__c') ||
        extractField('Size__c') || null;
      data.cap_rate = extractField('Cap_Rate__c') || null;
      data.noi = extractField('NOI__c') || extractField('Net_Operating_Income__c') || null;
      data.year_built = extractField('Year_Built__c') || null;
      data.owner_name = extractField('Owner') || extractField('Owner_Name__c') || null;

      // If we found an address, use it as the name for the property tab
      if (data.address && isPropertyRecord) {
        data.name = data.address;
      }
    }

    chrome.runtime.sendMessage({ type: 'CONTEXT_DETECTED', data });
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
