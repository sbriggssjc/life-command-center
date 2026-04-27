#!/usr/bin/env node
// ============================================================================
// recover-stalled-intakes.mjs — bulk re-promote OM intakes whose AI
//   extraction completed but whose promotion failed.
//
// Reads each intake_id from STALLED_INTAKE_IDS, POSTs to
// /api/intake?_route=promote, and prints success/failure per row.
//
// Why this works: the extractor already wrote the snapshot to
// staged_intake_extractions and the matcher already wrote the property
// match into staged_intake_items.raw_payload.extraction_result. The
// promote endpoint pulls from those two tables and re-runs the full
// sidebar pipeline (entity link → domain DB writes) without making any
// new AI calls or re-parsing PDFs. So this is FREE in API tokens and
// fast: ~2-5 seconds per intake.
//
// Generated 2026-04-27 from the audit of the past 14 days. Pulls all
// intake_ids that:
//   - status IN (review_required, queued, failed)
//   - have a non-null extraction_snapshot
//   - have asking_price + tenant_name in the snapshot (looks like a listing)
//   - matcher already returned status='matched'
//
// Usage:
//   LCC_API_KEY=<your-key> LCC_BASE_URL=https://your-app.up.railway.app \
//     node scripts/recover-stalled-intakes.mjs
//
//   # Dry run — print what would be sent without calling the endpoint:
//   DRY_RUN=1 node scripts/recover-stalled-intakes.mjs
//
//   # Throttle: ms between requests (default 250)
//   THROTTLE_MS=500 node scripts/recover-stalled-intakes.mjs
//
//   # Limit: only process the first N (handy for spot-checking)
//   LIMIT=5 node scripts/recover-stalled-intakes.mjs
// ============================================================================

const STALLED_INTAKE_IDS = [
  "98cd52ce-c64f-4c82-934c-c41ba032577a", "643720b4-dbe8-4ff0-b7bd-755319294a7f",
  "f96880c8-fb02-4e4f-b3fd-caab8fd6e594", "60922231-5c10-411b-845d-f671101d0c4e",
  "54ca9775-dd1e-4e83-bbab-65c2da1cae39", "0695d3f8-a075-439a-b615-454bc48a9338",
  "aa2403e9-4d06-4a7f-ac1c-6560777a0143", "c693170d-b9a1-4864-a7b3-04e56ccead61",
  "2067e431-50a3-4b17-b5ba-f9e1da88b90e", "7d916ae4-84db-4118-9d99-ca91384362fa",
  "7b03b95d-55a3-4ec8-9a4a-8d1ffef1cb01", "8483cb22-6918-4494-b396-9b2b1aae34ed",
  "75b85c67-2f9e-402a-83d9-d87ccaa3ff83", "281777ac-061a-471c-8a58-5388670f0864",
  "40095179-d545-4106-8428-9e502e46cd91", "4c5c39ea-5533-45ac-b17b-212af1c7607c",
  "83e3c21b-6f8f-46b8-b16b-fb44886fc876", "96365d7b-1c42-4b4c-90b6-328575447185",
  "e3fc24b6-4500-45cf-9300-b7faa9a25717", "316c1cca-0c42-40f4-9eab-1374fec749f6",
  "59770598-29ac-4104-ad23-e831091af6ef", "622d667f-d5a8-4b8c-96eb-c8ec8d28bb72",
  "381c544f-e420-4af5-9e88-abe564daffa8", "e78b9590-2b2d-461f-a1d9-ecea693fae00",
  "3ae2e8f6-d1a6-45a0-b5f4-64f02b3b5c14", "abd8b61e-4dac-4193-a7af-883861b82b25",
  "ecccb8f2-56be-4749-a109-c1b8200bcf8c", "73046be2-4726-42f4-81b7-1b7cfb85b4f0",
  "a659a378-89d2-453f-a67a-ca66e0d7cdaa", "b7682cd5-3d2c-46e4-a494-0bdf387f19f9",
  "8c4afc65-3e9e-4695-83d0-275b5c19c2c7", "ac338fa4-a618-458e-8250-5284a316e71a",
  "298ecbe8-c020-4bef-8197-d42397cfb864", "b9696185-60e9-44c0-9126-547447914614",
  "57890f5f-1476-4c45-a823-33e3bd997659", "edfcb6bc-2263-41a1-9208-2ec3ca9c9ccc",
  "d0c61204-8ab2-47d7-90b9-130e0a7e2d4a", "523a245d-9aa2-4d8c-8d0c-d5e228133a0c",
  "eb24d714-aa11-41b2-8978-5bddc9bf66b8", "0b1ca9d8-e402-4659-8a48-c7f14f203755",
  "2953c102-57c0-43e7-af6f-f2201affd17e", "73144fa1-dbbf-449e-91c0-211938c203b2",
  "2e6a3cf0-56e1-4402-ab4e-eaff63473233", "8a753e2f-2d5b-4d2e-bb62-70b652e26037",
  "5dca20f4-374c-4ebc-97cb-1333ca5cecec", "3fbb28bb-b50c-4b2e-8c4d-6e1280a3c987",
  "0e1ad990-5fe7-46a4-b8ab-4f29cb806195", "7160aaed-e7c5-4e28-ace9-979b4e63c3f6",
  "3afd313c-0871-44a3-a5d1-4ce2f25b83c1", "50f6af74-ffbb-412e-ae9c-611e33703a41",
  "41ae55b7-bacc-4c00-9e11-aace5a6b7afb", "87436950-4d92-4e95-92cd-f10c6d0684bb",
  "86c9eae4-6d30-4054-87f4-70f7274e9571", "fd313ba3-2b7d-4957-a413-b929f13c82e4",
  "f6dabcee-68d1-4ed9-bb3d-2f37a833a7ef", "d811640a-db04-43b1-b038-36aecc6040ca",
  "a433e3ae-0fbf-47e0-a7b1-4866dd8be129", "a8186cd4-ceed-44c9-95f6-dfe4bdbf957c",
  "7c4ea06e-6cb1-4c89-9e30-ac34c092315f", "2f51d6d1-1be5-446d-a177-32585d3d1f65",
  "b202fa2d-9fab-461b-9165-ede6a103ad09", "f5575ab7-41ea-4858-8f77-116525f2f1ae",
  "87be3f9c-321c-41dc-9d44-00fb8781b9b3", "e94c1db3-822d-4575-97db-c9c72c74e753",
  "7d59854e-a208-431c-905d-dd86811bf920", "6c5cc283-1511-40f7-ba46-4c934b4d16fb",
  "141530dc-6b9e-4cab-b185-e93c9dd7754f", "24f17574-556e-4801-bd78-a94b90b2adbf",
  "65e0125b-82d3-4863-923e-089c8fbb7afb", "d7ef4053-e42e-4b17-9500-8297967e0c17",
  "79e6d67d-be85-499f-88ac-8d1bcc41ce14", "d39377d8-f1b4-4c91-9f2b-5bb81c963d0a",
  "771a6b0a-df5d-4b5e-9e47-4a8f3b8969d3", "099f9f7a-aa72-4469-9148-d9fdbbca01bc",
  "136471da-950d-4184-a750-365553dd1a79", "87301b99-0668-4125-a614-606427d40ec5",
  "2d96a8ed-fc33-4bb9-9cd3-54d88bc00e9c", "eac53825-b382-4d6b-bbd1-8ff2b2f3ccfd",
  "215cd8fe-0aff-4cc2-98c9-ea8d7bf66597", "48d29ca8-7218-4e5c-8cdd-9c89215e9637",
  "3bc1aab4-d017-43ff-8bb1-1c407684760a", "13f584d5-f937-4f68-9d3b-2725c1bc00ea",
  "3649f39c-d52e-4a6b-9486-34364fb520f5", "c0ba7791-8c34-4c10-9126-1d07a036ef6e",
  "58e9242b-c621-4d11-9014-6d27e0ce786f", "d2f1d75d-9889-4903-95fa-f062c8a46384",
  "300e8e44-accc-422d-86be-81fb36a32b59", "efa5f93a-aee7-47db-9c54-0f47823ed869",
  "44f508a3-fd63-426f-8bd0-1a7d9c53cc8b", "90c86a42-5c82-4c1a-8771-d9000e9b544d",
  "0d5eebf8-5b61-49e9-97f1-3a04e1f3e8f7", "b9ce1742-85a4-4f49-8f6d-67ee1e5dc637",
  "2df833c4-83ae-436f-9287-e1088912a3a6", "1522ef10-4150-4776-998b-1f107e13abc3",
  "3e9507ab-c8d1-4516-91cd-9c0bbda2d66d", "bb3ee258-4348-4edf-ba78-e56324d221ac",
  "1fc5b444-83e7-45d1-89ff-166049255751", "b48f9336-78c0-4f9a-a16e-dc665311be25",
  "ed7bd99d-8d3b-4490-9ab7-263bb05113c2", "50ef3b73-ae63-4a37-88fa-2acab652e783",
  "7eb6bb9e-e644-4d5e-b17b-6c246dbc8ae9", "e563cc9b-3ab1-4ef3-a669-c1865685fa6f",
  "d55b3997-c424-4819-a102-87cdf689c628", "65ef081c-f8b2-423c-b747-d5b8c0989c77",
  "3ab1248e-bf2a-4014-a0a4-5b14de689371", "055adf1f-a786-4e85-8bf2-e60d6415c6c6",
  "78020de5-02cb-4607-b46d-6233b0bf1f57", "f7213b41-4292-4391-8201-089ed5c6ef03",
  "09e5503c-b6ee-441f-a968-bfaad746ccf3", "71f9d338-e302-4a26-a58b-be719dadb892",
  "64c4c5e5-afec-4b8e-9382-739f51aefaeb", "f5ffe852-f820-4b9b-b4da-4b0417f415c3",
  "553c6fb4-dce9-47e6-97fa-ed7e358ab9c6", "dc2c99f6-2e49-40b1-9677-2b46c9f132b2",
  "04d703e9-87b1-434d-a017-6225a4cb05f7", "b01e3dc0-0b2b-4dfe-8324-5c629aa82c72",
  "579f4924-2ee4-4386-a2ac-67b19810e5aa", "bbf68516-6c46-41b0-90d7-4bef770886e7",
  "5133224a-5254-45c4-b74f-0bed013a527a", "44ae6619-b114-450b-aa67-d0f5017d89a7",
  "812c1cb8-500a-40ef-aff1-afe9926d2c56", "6fee5d94-8aff-4974-a1ee-fd282db05e9e",
  "28f64019-093b-4a3a-8616-8bf1c6b05584", "24c05aac-5438-444e-b7ef-9dbe1df203b0",
  "7be6ad7e-c526-4189-a365-6d4681f303a5", "8a359f0b-ad90-4c4d-9e0c-f92991c06c18",
  "b3c745f1-2e23-42a5-972b-d378139d2730", "233d53e4-d3e7-435f-ac9c-182d5a53c9f6",
  "5cd0cd92-88a6-4b45-a03d-12e3dc8bd0ac", "f987ec2d-a4b4-4e38-80b1-160078022116",
  "ccc1e7ff-4d45-458f-b9cc-ff02dcc27e72", "5f4c3482-f0e1-462c-bed7-92e2075846a9",
  "3c16daa3-49f1-4523-b34b-5bafafcd9f67", "9bed6d94-696f-415d-8d16-18e2fe8970c5",
  "99a4ae4f-8d6a-4c3c-bdd5-ebdbbe8f4ae2", "61ac6b7e-e250-4ebe-84cf-4aeac91fb793",
  "4ea575f2-a91c-4d6c-becd-aabc4ee5c973", "2de0e9ee-149c-4bda-b611-254312338a1a",
  "f4fb27c7-8b0f-4af4-9c28-dbd2c4ac2000", "26de840f-933c-47f4-a853-0b64e6b142c1",
  "bb041bc0-e850-455b-8078-a6323a61e5b2", "33450ae4-ed23-4576-9dff-719219ec79da",
  "aa2da33c-e9df-46ba-8a9e-2c62155ae232", "aecfced2-eb3a-459a-b4f2-646200403f69",
  "7a73ee99-e46f-4465-b86d-5368005385ed", "10b35b27-1428-499d-800b-82d28f21a4f0",
  "14ad93c9-765f-475f-9781-718e0212b788", "a343b3a7-e6e7-44c5-9f74-dc08ab6681f5",
  "e058a67d-981f-47ea-8f9e-2c2d7678fbd2", "eedc5293-a97d-450e-80bf-684271fac965",
  "4e8b1051-b7f8-421b-93bd-c7dfd8840b03", "c92043f0-d5f1-4e24-9d37-a3e7a18a2f9b",
  "469cd37b-10f8-45be-8a68-7912ba0ea1d7", "5614eb8e-4c57-4ce7-a4c2-e977ef49e05d",
  "2328ba6b-b3d4-4a64-afe5-ecbf29bc07e7", "1aad4904-028a-47ef-a9bb-2ee12bcc2acf",
  "244687c3-551a-4aa6-af4e-329fab2760b5", "7383aaf5-a802-4182-b49a-466aa5173c28",
  "0e8f87ce-d559-4298-944f-d9203674b2d1", "1f911749-4b9e-4050-b8fd-13761d657b4c",
  "40fc806a-e172-45d7-955d-4c2d4f9d601e", "8036f9bb-a65c-478e-815c-26f027e093ac",
  "6b033c68-154d-4d0d-8969-8f74fecad93d", "bc318e6d-db2a-4519-8e47-65079e1e96c4",
  "cdc3e1d1-f3a3-4aa5-8885-b47f7403d7aa", "c70e6aca-1377-40e6-9fb8-0af12fe1d9f1",
  "ec1e8fe5-ce04-4ba3-94e0-26332ab91095", "6ec776bf-c8a4-44f4-a70a-abdfd74d68ed",
  "f5741af9-aee8-4b80-a21b-1fc94a819ffe", "339583b8-eed6-4334-816d-bcd5c0e34d84",
  "63bebaa8-9507-4192-98d9-a44354389a8a", "9b0ad9b6-9102-467c-8f7d-7bfcee061ddb",
  "c570f90c-679c-492b-8655-97b2df82484d", "81779db7-7858-4333-966c-0b60021cb5f6",
  "da55fd0a-c983-4d45-95d5-f2285ee7a973", "f302ca92-47b1-486f-bec5-ce0c346ea5f7",
  "237077c7-e19c-4b34-9552-aa0b90cfb90f", "bb875c9b-f086-4eae-8815-1c690c1fe2a1",
  "34a726cd-75fd-4949-b6ef-69dc708d1936", "fd3ab94c-8f14-4ee0-a90c-5d644a09d473",
  "adc51ee5-4bdb-42c8-89ed-494ec604f747", "c0b7c786-6d0d-4be2-84a2-f7c782c257c4",
  "8ce94b48-df11-42eb-8214-92f2ee0b6ce1", "4fdf8e4f-7a2e-4f13-92bb-749300b290ca",
  "b9018b18-43c1-48ff-98cc-97b38102a21e", "e54b35e5-431a-4b75-9b66-308290ce9d38",
  "f4b00be4-1e34-40ca-96d8-d80fd883218c", "d8daceb7-758e-455f-b179-df3284ade1b2",
  "09dadc6f-d14f-48c2-b4cf-7e0a3d586a27", "eea2e944-5393-4956-8588-de29d79232e1",
  "929fbfa0-1415-4ba8-bb90-d565faf0b0d3", "ce4eee0b-480e-4ba6-b7e5-0b3d79b237e8",
  "50d094b3-7d95-43a8-8bc9-e0b61125c76d", "a31f6194-b81e-440c-9bd1-662a24019ce3",
  "182a7f7d-b9c4-4c8d-9512-c2aba1f80cea", "13a23325-8c23-4763-9cc7-aa8d061d4de1",
  "5247165a-c743-4c39-bd93-6ca512fa2a17", "b0298a97-240c-4368-974b-b302685b685e",
  "44bcb55c-c036-431a-97ed-d7a0dd7238c5", "088e9f27-944e-409c-b8dd-6da07796801f",
  "c04f4e4e-16a8-4060-8bb4-01b37a67759e", "d2e74284-a542-41ce-96ec-fa2ea0cc89f6",
  "d8714bd7-6967-4ad8-acb3-c6a2403d0c97", "fd34152f-53e1-4bf6-a6e7-01d23a94e338",
  "b41d6b14-8237-4b8a-b2ee-f056123f26eb", "222e287f-2af7-46ce-963a-643f9e872f1b",
  "153bfc9e-b24c-4868-94ea-c9410fd4cf4b", "2d37e7f1-ab13-4cca-958e-16c9aeba39ae",
  "4f198497-8b2c-48f7-bf6e-15a3bd73218d", "6b2a19ed-b27e-49d6-bcec-3983ad3a7bdd",
  "b0426fff-9c63-473f-9894-bf87dded427f", "73db9d05-9a43-4048-8f34-5e3e4342f999",
  "abc24e37-d77c-4a36-833d-c396783ea466", "00b53ff9-c635-43c7-9204-779566fe9ede",
  "1712267d-0c8c-4356-bc7b-93699c00de1f", "867f2cad-b949-458c-bf1c-03b9363ebad7",
  "fb3966c0-8b43-4c0e-8a4b-071f08cd56ae", "5bf7bc35-2aad-4a1b-84ba-1337bdc1eb24",
  "1d89d06b-f2b5-40c3-b4f9-e76270bdf59e", "2efebaac-b650-4887-a333-6b2c32625b76",
  "8a867ff7-92fc-4eb8-918d-b9551aa6ab1f", "1a7be15b-073c-48af-b939-676fc88a4195",
  "19ba1422-1b21-49f8-812b-6d976f968940", "941e60d1-3885-459b-9074-42581c558d0e",
  "3d2a8f90-6fe8-4f1f-99af-5c09010e12f9", "c0605bcf-256b-409e-bcfa-54f782db572d",
  "bc41ccfe-abaa-46b4-95a7-4c9667961400", "472e315d-a26c-47d7-b6e9-c66766963d94",
  "f7eb573f-b920-4a89-8cf4-cdbc02f11efc", "5e501952-c5b6-4db4-a6e8-cc2e94018f7b",
];

// ── Config from env ─────────────────────────────────────────────────────────
const API_KEY     = process.env.LCC_API_KEY;
let   BASE_URL    = (process.env.LCC_BASE_URL || '').replace(/\/+$/, '');
if (BASE_URL && !/^https?:\/\//.test(BASE_URL)) BASE_URL = 'https://' + BASE_URL;
const WORKSPACE_ID = process.env.LCC_WORKSPACE_ID
                   || process.env.LCC_DEFAULT_WORKSPACE_ID
                   || 'a0000000-0000-0000-0000-000000000001'; // Briggs CRE
const DRY_RUN     = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const THROTTLE_MS = Number(process.env.THROTTLE_MS || 250);
const LIMIT       = Number(process.env.LIMIT || 0);

if (!DRY_RUN) {
  if (!API_KEY)  { console.error('Missing LCC_API_KEY env var.');  process.exit(1); }
  if (!BASE_URL) { console.error('Missing LCC_BASE_URL env var.'); process.exit(1); }
}

const ids = LIMIT > 0 ? STALLED_INTAKE_IDS.slice(0, LIMIT) : STALLED_INTAKE_IDS;
console.log(`Recovering ${ids.length} stalled intakes${DRY_RUN ? ' (DRY RUN)' : ''}…`);
if (!DRY_RUN) console.log(`Endpoint: ${BASE_URL}/api/intake?_route=promote`);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ok = 0, fail = 0, skipped = 0;
const failures = [];

for (let i = 0; i < ids.length; i++) {
  const id = ids[i];
  const tag = `[${String(i + 1).padStart(3)}/${ids.length}] ${id}`;
  if (DRY_RUN) { console.log(`${tag}  (would POST)`); skipped++; continue; }

  try {
    const res = await fetch(`${BASE_URL}/api/intake?_route=promote`, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-LCC-Key':       API_KEY,
        'X-LCC-Workspace': WORKSPACE_ID,
      },
      body: JSON.stringify({ intake_id: id }),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }

    if (res.ok && body?.propagated !== false) {
      ok++;
      const summary = `domain=${body.domain || '?'} property_id=${body.domain_property_id || '?'}`;
      console.log(`${tag}  OK  ${summary}`);
    } else {
      fail++;
      const why = body?.error || body?.pipeline_summary?.reason || `HTTP ${res.status}`;
      console.log(`${tag}  FAIL  ${why}`);
      failures.push({ intake_id: id, status: res.status, error: why, body });
    }
  } catch (err) {
    fail++;
    console.log(`${tag}  ERROR ${err.message}`);
    failures.push({ intake_id: id, error: err.message });
  }

  if (i < ids.length - 1) await sleep(THROTTLE_MS);
}

console.log('\n─── Summary ───');
console.log(`Promoted: ${ok}`);
console.log(`Failed:   ${fail}`);
console.log(`Skipped:  ${skipped}`);
if (failures.length) {
  console.log('\nFirst 10 failures:');
  failures.slice(0, 10).forEach(f => console.log('  ' + JSON.stringify(f)));
}
process.exit(fail === 0 ? 0 : 1);
(f => console.log('  ' + JSON.stringify(f)));
}
process.exit(fail === 0 ? 0 : 1);
ailed:   ${fail}`);
console.log(`Skipped:  ${skipped}`);
if (failures.length) {
  console.log('\nFirst 10 failures:');
  failures.slice(0, 10).forEach(f => console.log('  ' + JSON.stringify(f)));
}
process.exit(fail === 0 ? 0 : 1);
