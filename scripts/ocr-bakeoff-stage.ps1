# OCR1 — stage the bake-off inputs from the synced OneDrive PROPERTIES folder.
# Copies each sample document to bakeoff/<id>/source.pdf. Paths are the
# lcc_cre_property_documents.source_url values (SharePoint server-relative),
# re-rooted onto the local OneDrive sync. Read 2026-09-02 from LCC Opps.
#
# Usage (from the repo root):
#   .\scripts\ocr-bakeoff-stage.ps1
#   .\scripts\ocr-bakeoff-stage.ps1 -Root "D:\some\other\PROPERTIES"
#
# bakeoff/ is git-ignored — it holds client lease text.

param(
  [string]$Root = "$env:USERPROFILE\OneDrive - NorthMarq Capital, LLC\Team Briggs - Documents\PROPERTIES",
  [string]$Out  = "bakeoff"
)

$docs = @(
  # ---- arm A: DocAI baseline exists (method=ocr, ocr_tier=cloud_cheap) ----
  @{ id = 336; arm = 'A'; pp = 30; path = "T\T-Mobile\Cordova, TN\Rec'd\Cordova, TN Executed Ground Lease 11.2.15.pdf" },
  @{ id = 431; arm = 'A'; pp = 26; path = "K\Kid City\Savannah, GA\Rec'd\KS 20210427 Lease Amended and Restated Lease Executed.pdf" },
  @{ id = 425; arm = 'A'; pp = 26; path = "K\KinderCare\Littleton, CO\Rec'd\KLC lease 3-30-2000 - Dec 5, 2014, 11-04 AM.pdf" },
  @{ id = 327; arm = 'A'; pp = 25; path = "C\Carl's Jr\Phoenix, AZ\Rec'd\Lease.pdf" },
  @{ id = 255; arm = 'A'; pp = 25; path = "C\Chesterbrook Academy\Champaign, IL\Rec'd\Chesterbrook - Champaign, IL (Lease).pdf" },
  @{ id = 386; arm = 'A'; pp = 20; path = "P\Pyramid Healthcare\Concord, NC\Rec'd\North Carolina Concord Final PSA (Executed).pdf" },
  @{ id = 343; arm = 'A'; pp = 16; path = "T\Tutor Time\Bloomingdale, IL\PSA\RSG - Bloomingdale - PSA - CC signed.pdf" },
  @{ id = 299; arm = 'A'; pp = 16; path = "C\CHI Memorial Healthcare\Harrison, TN\Rec'd\Lease Agreement for 6800 Harrison Park Drive, Harrison TN (1).pdf" },
  @{ id = 436; arm = 'A'; pp = 16; path = "K\Kohl's\Monroe, LA (1)\Estoppel\Monroe Estoppel(Version=1) 12.21.21.pdf" },
  @{ id = 228; arm = 'A'; pp = 15; path = "C\CARBO\Newcomerstown, OH\PSA\CARBO Newcomerstown PSA - EXECUTED.PDF" },
  # ---- arm B: over the DocAI cap, NO baseline — graded on consumer-field coherence ----
  @{ id = 319; arm = 'B'; pp = 141; path = "C\CVS pharmacy\Folsom, CA\DD\Lease.PDF" },
  @{ id = 320; arm = 'B'; pp = 118; path = "C\CVS pharmacy\Bethany Beach, DE\Rec'd\Bethany Beach Ground Lease.pdf" },
  @{ id = 200; arm = 'B'; pp = 63;  path = "Portfolio\Rite Aid Portfolio of 12 - PA & TN\Rec'd\Geistown, PA\091297 HPT Geistown Ground Lease Saylor Bros.pdf" },
  @{ id = 407; arm = 'B'; pp = 59;  path = "P\Perkins Family Rest\Sedalia, MO\Rec'd\Title and Docs 06 478.pdf" },   # a title/docs bundle, not a bare lease
  @{ id = 140; arm = 'B'; pp = 59;  path = "Portfolio\Plasma Portfolio\Plasma Portfolio-DD\LFB Plasma - Florence, SC\LFB Plasma Lease - Florence, SC.pdf" }
)

$ok = 0; $missing = @()
foreach ($d in $docs) {
  $src = Join-Path $Root $d.path
  $dir = Join-Path $Out "$($d.id)"
  if (-not (Test-Path $src)) { $missing += "$($d.id)  $src"; continue }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Copy-Item -LiteralPath $src -Destination (Join-Path $dir 'source.pdf') -Force
  "arm=$($d.arm) id=$($d.id) pages=$($d.pp)`n$($d.path)" | Set-Content (Join-Path $dir 'META.txt')
  $ok++
}
Write-Host "staged $ok of $($docs.Count) into $Out\<id>\source.pdf"
if ($missing.Count) { Write-Host "MISSING (cloud-only? open once in Explorer to sync):"; $missing | ForEach-Object { Write-Host "  $_" } }
