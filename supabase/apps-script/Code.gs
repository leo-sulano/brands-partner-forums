// Apps Script Web App — Brands Partner Forum Dashboard Bridge
//
// Setup (standalone script):
//   1. Go to script.google.com → your standalone script
//   2. Paste this file, replacing the default Code.gs
//   3. Set SHARED_SECRET below (any string — must match APPS_SCRIPT_SECRET in Supabase)
//   4. Set SPREADSHEET_ID below (the ID from your Google Sheet URL)
//   5. Deploy → New deployment → Web App
//      - Execute as: Me
//      - Who has access: Anyone
//   6. Copy the Web App URL → set as APPS_SCRIPT_URL in Supabase Edge Function secrets

var SHARED_SECRET = 'replace-with-your-secret';
var SPREADSHEET_ID = '1YufhZ3Wpq8vUdZhmTX96-3w4KrAQm8roXDJncXvf0wk';

function doGet(e) {
  if (e.parameter.secret !== SHARED_SECRET) {
    return json({ ok: false, error: 'Unauthorized' });
  }
  if (e.parameter.op === 'dump') {
    return dumpAllTabs();
  }
  return json({ ok: false, error: 'Unknown op: ' + e.parameter.op });
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (payload.secret !== SHARED_SECRET) {
      return json({ ok: false, error: 'Unauthorized' });
    }
    if (payload.op === 'dump') {
      return dumpAllTabs();
    }
    if (payload.op === 'upsert_row') {
      return upsertRow(payload.tab, payload.sheet_row_id, payload.fields);
    }
    return json({ ok: false, error: 'Unknown op' });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

// Returns all non-hidden tabs with their headers and data rows.
// Injects a synthetic 'id' column (1-based row index) if the tab has no 'id' column.
function dumpAllTabs() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var tabs = [];

  ss.getSheets().forEach(function(sheet) {
    if (sheet.isSheetHidden()) return;

    var all = sheet.getDataRange().getValues();
    if (all.length < 2) return; // header-only or empty — skip

    var rawHeaders = all[0].map(function(h) { return String(h).trim(); });
    var hasId = rawHeaders.indexOf('id') !== -1;
    var headers = hasId ? rawHeaders : ['id'].concat(rawHeaders);

    var rows = [];
    for (var r = 1; r < all.length; r++) {
      var vals = all[r].map(function(v) { return v === '' ? null : String(v); });
      if (vals.every(function(v) { return v === null; })) continue; // skip blank rows
      rows.push(hasId ? vals : [String(r)].concat(vals));
    }

    tabs.push({ name: sheet.getName(), headers: headers, rows: rows });
  });

  return json({ ok: true, tabs: tabs });
}

// Writes field values back to the matching row in the given tab.
function upsertRow(tabName, sheetRowId, fields) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return json({ ok: false, error: 'Tab not found: ' + tabName });

  var all = sheet.getDataRange().getValues();
  var headers = all[0].map(function(h) { return String(h).trim(); });
  var hasId = headers.indexOf('id') !== -1;

  var targetRow = -1;
  if (hasId) {
    var idCol = headers.indexOf('id');
    for (var r = 1; r < all.length; r++) {
      if (String(all[r][idCol]) === String(sheetRowId)) { targetRow = r + 1; break; }
    }
  } else {
    var idx = parseInt(sheetRowId, 10);
    if (!isNaN(idx) && idx >= 1 && idx < all.length) targetRow = idx + 1;
  }

  if (targetRow === -1) return json({ ok: false, error: 'Row not found: ' + sheetRowId });

  Object.keys(fields).forEach(function(key) {
    var col = headers.indexOf(key);
    if (col !== -1) sheet.getRange(targetRow, col + 1).setValue(fields[key] || '');
  });

  return json({ ok: true });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Auto-sync: Sheet → Supabase
// Run createSyncTrigger() once from the Apps Script editor to install the
// onChange trigger. After that, any edit to the Sheet triggers a full sync.
// ---------------------------------------------------------------------------

var IMPORT_TABS_URL = 'https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/import-tabs';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyeG51cG1oZmlkdWR1dnZsdW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MzkwNzQsImV4cCI6MjA5NDQxNTA3NH0.tXC1El3aCTskejT7rVkSGYqP80nG_Jw-7MDFFQiFGnU';

function onSheetChange(e) {
  syncToSupabase();
}

function syncToSupabase() {
  UrlFetchApp.fetch(IMPORT_TABS_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
    payload: '{}',
    muteHttpExceptions: true,
  });
}

// Run this once from the editor (Run → createSyncTrigger) to install the trigger.
// Re-running it is safe — it removes any existing onSheetChange triggers first.
function createSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'onSheetChange') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onSheetChange')
    .forSpreadsheet(SpreadsheetApp.openById(SPREADSHEET_ID))
    .onChange()
    .create();
}
