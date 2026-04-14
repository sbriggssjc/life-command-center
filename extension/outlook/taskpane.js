/* global Office */

const LCC_BASE_URL = "https://life-command-center.vercel.app";
const SETTINGS_KEY_API = "lcc_api_key";
const SETTINGS_KEY_WS = "lcc_workspace_id";

Office.onReady(function (info) {
  if (info.host === Office.HostType.Outlook) {
    loadSettings();
    showEmailPreview();
    document.getElementById("sendBtn").disabled = false;
    document.getElementById("sendBtn").addEventListener("click", sendToLCC);
    document.getElementById("apiKey").addEventListener("change", saveSettings);
    document.getElementById("workspaceId").addEventListener("change", saveSettings);
  }
});

function loadSettings() {
  var settings = Office.context.roamingSettings;
  var apiKey = settings.get(SETTINGS_KEY_API);
  var wsId = settings.get(SETTINGS_KEY_WS);
  if (apiKey) document.getElementById("apiKey").value = apiKey;
  if (wsId) document.getElementById("workspaceId").value = wsId;
}

function saveSettings() {
  var settings = Office.context.roamingSettings;
  settings.set(SETTINGS_KEY_API, document.getElementById("apiKey").value);
  settings.set(SETTINGS_KEY_WS, document.getElementById("workspaceId").value);
  settings.saveAsync();
}

function showEmailPreview() {
  var item = Office.context.mailbox.item;
  if (!item) return;

  document.getElementById("previewFrom").textContent = item.from.emailAddress;
  document.getElementById("previewSubject").textContent = item.subject;
  document.getElementById("previewAttachments").textContent =
    item.attachments.length > 0
      ? item.attachments.length + " file(s)"
      : "None";
  document.getElementById("emailPreview").style.display = "block";
}

function showStatus(text, type) {
  var el = document.getElementById("status");
  el.textContent = text;
  el.className = type || "info";
}

async function sendToLCC() {
  var apiKey = document.getElementById("apiKey").value.trim();
  var workspaceId = document.getElementById("workspaceId").value.trim();

  if (!apiKey || !workspaceId) {
    showStatus("Please enter your API Key and Workspace ID.", "error");
    return;
  }

  var btn = document.getElementById("sendBtn");
  btn.disabled = true;
  showStatus("Sending...", "info");

  try {
    var item = Office.context.mailbox.item;

    var message = {
      message_id: item.internetMessageId,
      subject: item.subject,
      from: item.from.emailAddress,
      received: item.dateTimeCreated.toISOString(),
      body_preview: null,
      has_attachments: item.attachments.length > 0,
    };

    // Get body preview
    message.body_preview = await new Promise(function (resolve) {
      item.body.getAsync(
        Office.CoercionType.Text,
        {},
        function (result) {
          if (result.status === Office.AsyncResultStatus.Succeeded) {
            resolve(result.value.substring(0, 500));
          } else {
            resolve(null);
          }
        }
      );
    });

    // Get attachments (base64)
    var attachments = [];
    for (var i = 0; i < item.attachments.length; i++) {
      var att = item.attachments[i];
      if (att.isInline) continue;
      var content = await new Promise(function (resolve) {
        item.getAttachmentContentAsync(att.id, {}, function (result) {
          if (result.status === Office.AsyncResultStatus.Succeeded) {
            resolve({
              file_name: att.name,
              file_type: att.contentType,
              inline_data: result.value.content,
              format: result.value.format,
            });
          } else {
            resolve(null);
          }
        });
      });
      if (content) attachments.push(content);
    }
    message.attachments = attachments;

    // POST to LCC intake
    var response = await fetch(
      LCC_BASE_URL + "/api/intake?_route=outlook-message",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LCC-Key": apiKey,
          "X-LCC-Workspace": workspaceId,
        },
        body: JSON.stringify(message),
      }
    );

    if (!response.ok) {
      throw new Error("Server returned " + response.status);
    }

    var result = await response.json();

    if (result.match && result.match.status === "matched") {
      showStatus(
        "Matched to " + result.match.address + " \u2014 " + result.match.tenant,
        "success"
      );
    } else {
      showStatus("Saved for review in LCC", "warning");
    }
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
}
