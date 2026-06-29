// Brands Partner Forum — Multi-tab Sheet bridge
// Standalone script targeting Sheet id 1YufhZ3Wpq8vUdZhmTX96-3w4KrAQm8roXDJncXvf0wk.
//
// Endpoints:
//   doPost  { secret, op: 'upsert_row', tab, sheet_row_id, fields, sync_tag } → writes row
//   doPost  { secret, op: 'bulk_upsert_rows', rows: [...] } → writes multiple rows
//   doGet   ?secret=X&op=structure  → returns [{ name, headers }]
//   doGet   ?secret=X&op=dump       → returns [{ name, headers, rows }]
//
// Run once after install: backfillAllTabIds()

var OPERATIONAL_TABS = [
  'TP Brand Injection',
  'TP Affiliate',
  'Rooster Partners',
  'Revolution Casino',
  'Trybet',
  'SilverPlay',
  'SuprPlay Limited',
  'HazEmirates UAE',
  'Hanan',
  'Wizard of Odds'
];

var SHEET_ID = '1YufhZ3Wpq8vUdZhmTX96-3w4KrAQm8roXDJncXvf0wk';
// Secret is stored in Script Properties, never in source.
// Set it once: Apps Script editor -> Project Settings (gear) -> Script Properties
//   -> add  SHARED_SECRET = <the value, also set as APPS_SCRIPT_SECRET in Supabase>
var SHARED_SECRET = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');

var ID_COLUMN = 1; // column A, always

// Columns whose hyperlink URLs are extracted and stored as `<col>__href` virtual columns.
var HYPERLINK_COLS = ['URL PAGE'];

// Per-tab, last_sync_tag goes in (last data column + 1). Computed dynamically.

function backfillAllTabIds() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var totals = [];
  for (var i = 0; i < OPERATIONAL_TABS.length; i++) {
    var name = OPERATIONAL_TABS[i];
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      totals.push(name + ': NOT FOUND');
      continue;
    }
    var n = ensureIdColumn(sheet);
    ensureSyncTagColumn(sheet);
    totals.push(name + ': +' + n + ' UUIDs');
  }
  Logger.log(totals.join('\n'));
}

function ensureIdColumn(sheet) {
  var firstHeader = sheet.getRange(1, ID_COLUMN).getValue();
  if (firstHeader !== 'id') {
    sheet.insertColumnsBefore(ID_COLUMN, 1);
    sheet.getRange(1, ID_COLUMN).setValue('id');
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var range = sheet.getRange(2, ID_COLUMN, lastRow - 1, 1);
  var values = range.getValues();
  var changed = 0;
  for (var i = 0; i < values.length; i++) {
    if (!values[i][0]) {
      values[i][0] = Utilities.getUuid();
      changed++;
    }
  }
  range.setValues(values);
  return changed;
}

function ensureSyncTagColumn(sheet) {
  var col = syncTagColumnIndex(sheet);
  var header = sheet.getRange(1, col).getValue();
  if (header !== 'last_sync_tag') {
    sheet.getRange(1, col).setValue('last_sync_tag');
  }
}

function syncTagColumnIndex(sheet) {
  // last column with header content + 1. If already named 'last_sync_tag', use that column.
  var lastCol = sheet.getLastColumn();
  for (var c = 1; c <= lastCol; c++) {
    if (sheet.getRange(1, c).getValue() === 'last_sync_tag') return c;
  }
  return lastCol + 1;
}

function doGet(e) {
  var p = e.parameter || {};
  if (p.secret !== SHARED_SECRET) {
    return jsonResponse({ ok: false, error: 'unauthorized' });
  }
  var op = p.op;
  if (op === 'structure') return jsonResponse({ ok: true, tabs: collectStructures(false) });
  if (op === 'dump')      return jsonResponse({ ok: true, tabs: collectStructures(true) });
  return jsonResponse({ ok: false, error: 'unknown op: ' + op });
}

function collectStructures(includeRows) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var tz = ss.getSpreadsheetTimeZone();
  var out = [];
  for (var i = 0; i < OPERATIONAL_TABS.length; i++) {
    var name = OPERATIONAL_TABS[i];
    var sheet = ss.getSheetByName(name);
    if (!sheet) continue;
    var lastCol = sheet.getLastColumn();
    var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
    var tab = { name: name, headers: headers };
    if (includeRows) {
      var lastRow = sheet.getLastRow();
      var rawRows = lastRow >= 2
        ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
        : [];
      var rows = rawRows.map(function(row) {
        return row.map(function(cell) {
          if (cell instanceof Date) {
            if (isNaN(cell.getTime()) || cell.getFullYear() < 1900) return '';
            return Utilities.formatDate(cell, tz, 'dd/MM/yyyy');
          }
          return cell;
        });
      });

      var extraHeaders = [];
      var extraByRow = rows.map(function() { return []; });
      for (var h = 0; h < HYPERLINK_COLS.length; h++) {
        var colName = HYPERLINK_COLS[h];
        var colIdx = headers.indexOf(colName);
        if (colIdx >= 0 && lastRow >= 2) {
          var range = sheet.getRange(2, colIdx + 1, lastRow - 1, 1);
          var richVals = range.getRichTextValues();
          var formulas = range.getFormulas();
          extraHeaders.push(colName + '__href');
          for (var r = 0; r < richVals.length; r++) {
            var url = richVals[r][0] ? richVals[r][0].getLinkUrl() : '';
            if (!url) {
              var formula = formulas[r][0] || '';
              var match = formula.match(/=HYPERLINK\(\s*"([^"]+)"/i);
              if (match) url = match[1];
            }
            extraByRow[r].push(url || '');
          }
        }
      }

      tab.headers = extraHeaders.length > 0 ? headers.concat(extraHeaders) : headers;
      tab.rows = extraHeaders.length > 0
        ? rows.map(function(row, idx) { return row.concat(extraByRow[idx]); })
        : rows;
    }
    out.push(tab);
  }
  return out;
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) {
      return jsonResponse({ ok: false, error: 'unauthorized' });
    }
    if (body.op === 'dump') return jsonResponse({ ok: true, tabs: collectStructures(true) });
    if (body.op === 'upsert_row') return handleUpsertRow(body);
    if (body.op === 'bulk_upsert_rows') return jsonResponse(handleBulkUpsertRows(body));
    return jsonResponse({ ok: false, error: 'unknown op: ' + body.op });
  } catch (err) {
    // Hardened: handles null/string throws that would otherwise make err.message itself throw
    return jsonResponse({ ok: false, error: err ? (err.message || String(err)) : 'unknown error' });
  }
}

function handleUpsertRow(body) {
  var tabName = body.tab;
  var rowId = body.sheet_row_id;
  var fields = body.fields || {};
  var syncTag = body.sync_tag;
  // col_map: {fieldName: 1-based column index} — sent by the Edge Function so
  // column positions are derived from the dashboard (Supabase) data key order,
  // not from the sheet's header row. This prevents mismatches when sheet
  // headers are renamed or reordered.
  var colMap = body.col_map || {};
  var syncTagCol = body.sync_tag_col || 0;
  var useColMap = Object.keys(colMap).length > 0;

  if (!tabName || !rowId) {
    return jsonResponse({ ok: false, error: 'tab and sheet_row_id required' });
  }
  if (OPERATIONAL_TABS.indexOf(tabName) === -1) {
    return jsonResponse({ ok: false, error: 'tab not in OPERATIONAL_TABS: ' + tabName });
  }

  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(tabName);
  if (!sheet) return jsonResponse({ ok: false, error: 'sheet not found: ' + tabName });

  var rowIdx = findRowById(sheet, rowId);
  if (rowIdx === -1) {
    rowIdx = sheet.getLastRow() + 1;
    sheet.getRange(rowIdx, ID_COLUMN).setValue(rowId);
  }

  // Fall back to header-row lookup only when no col_map was provided (e.g.
  // callers that haven't been updated yet).
  var lastCol = 1;
  var headerToCol = {};
  if (!useColMap) {
    lastCol = Math.max(sheet.getLastColumn(), 1);
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    for (var i = 0; i < headers.length; i++) headerToCol[headers[i]] = i + 1;
  }

  var writeMap = {};
  for (var k in fields) {
    if (Object.prototype.hasOwnProperty.call(fields, k) && k !== 'id') {
      writeMap[k] = fields[k];
    }
  }
  if (syncTag) writeMap['last_sync_tag'] = syncTag;

  for (var key in writeMap) {
    if (!Object.prototype.hasOwnProperty.call(writeMap, key)) continue;
    var col;
    if (useColMap) {
      col = (key === 'last_sync_tag') ? syncTagCol : colMap[key];
      if (!col) continue; // field not in dashboard data — skip rather than appending
    } else {
      col = headerToCol[key];
      if (!col) {
        lastCol++;
        col = lastCol;
        sheet.getRange(1, col).setValue(key);
        headerToCol[key] = col;
      }
    }
    var v = writeMap[key];
    sheet.getRange(rowIdx, col).setValue(v == null ? '' : v);
  }

  return jsonResponse({ ok: true, row: rowIdx });
}

function findRowById(sheet, rowId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, ID_COLUMN, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === rowId) return i + 2;
  }
  return -1;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function installOnEditTrigger() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'onEdit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onEdit').forSpreadsheet(ss).onEdit().create();
  Logger.log('onEdit trigger installed.');
}

function onEdit(e) {
  var sheet = e.range.getSheet();
  if (OPERATIONAL_TABS.indexOf(sheet.getName()) === -1) return;

  var startRow = e.range.getRow();
  var numRows  = e.range.getNumRows();

  for (var r = startRow; r < startRow + numRows; r++) {
    if (r < 2) continue;
    var idCell = sheet.getRange(r, ID_COLUMN);
    if (!idCell.getValue()) {
      idCell.setValue(Utilities.getUuid());
    }
  }
  // syncToDashboard() removed — dashboard is now the source of truth.
  // Sheet edits no longer push data to Supabase automatically.
}

// Run this ONCE from the Apps Script editor after deploying to remove
// the existing 30-minute syncToDashboard cron trigger.
function deleteImportTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncToDashboard') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  Logger.log('Removed ' + removed + ' syncToDashboard trigger(s).');
}

function handleBulkUpsertRows(data) {
  var rows = data.rows;
  if (!rows || !rows.length) return { ok: true, updated: 0 };

  var updated = 0;
  var errors = [];

  for (var i = 0; i < rows.length; i++) {
    try {
      var result = handleUpsertRow(rows[i]);
      var content = JSON.parse(result.getContent());
      if (content.ok !== false) updated++;
      else errors.push(String(rows[i].sheet_row_id) + ': ' + (content.error || 'failed'));
    } catch (e) {
      errors.push(String(rows[i].sheet_row_id) + ': ' + (e ? (e.message || String(e)) : 'unknown'));
    }
  }

  return { ok: true, updated: updated, errors: errors };
}

// ---------------------------------------------------------------------------
// Email sync trigger: runs parseAgCgEmails() (in EmailParser.gs) every hour.
// Run createEmailSyncTrigger() once from the editor to install.
// Re-running is safe — it removes the old trigger first.
// ---------------------------------------------------------------------------
function createEmailSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'parseAgCgEmails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('parseAgCgEmails')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log('Email sync trigger created: parseAgCgEmails runs every 1 hour.');
}

