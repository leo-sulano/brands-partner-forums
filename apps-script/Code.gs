// Brands Partner Forum — Multi-tab Sheet bridge
// Standalone script targeting Sheet id 1YufhZ3Wpq8vUdZhmTX96-3w4KrAQm8roXDJncXvf0wk.
//
// Endpoints:
//   doPost  { secret, op: 'upsert_row', tab, sheet_row_id, fields, sync_tag } → writes row
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
  'SuprPlay Limited'
];

var SHEET_ID = '1YufhZ3Wpq8vUdZhmTX96-3w4KrAQm8roXDJncXvf0wk';
var SHARED_SECRET = 'JkoNDP4JMdpjHRvOtU6HyZKo_TrXDYp2qH9oL7aiJRE';

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
      var rows = lastRow >= 2
        ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
        : [];

      // Extract hyperlinks for HYPERLINK_COLS and append as <col>__href virtual columns.
      var extraHeaders = [];
      var extraByRow = rows.map(function() { return []; });
      for (var h = 0; h < HYPERLINK_COLS.length; h++) {
        var colName = HYPERLINK_COLS[h];
        var colIdx = headers.indexOf(colName);
        if (colIdx >= 0 && lastRow >= 2) {
          var richVals = sheet.getRange(2, colIdx + 1, lastRow - 1, 1).getRichTextValues();
          extraHeaders.push(colName + '__href');
          for (var r = 0; r < richVals.length; r++) {
            var url = richVals[r][0] ? richVals[r][0].getLinkUrl() : '';
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
    if (body.op === 'upsert_row') return handleUpsertRow(body);
    return jsonResponse({ ok: false, error: 'unknown op: ' + body.op });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function handleUpsertRow(body) {
  var tabName = body.tab;
  var rowId = body.sheet_row_id;
  var fields = body.fields || {};
  var syncTag = body.sync_tag;
  if (!tabName || !rowId) {
    return jsonResponse({ ok: false, error: 'tab and sheet_row_id required' });
  }
  if (OPERATIONAL_TABS.indexOf(tabName) === -1) {
    return jsonResponse({ ok: false, error: 'tab not in OPERATIONAL_TABS: ' + tabName });
  }
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(tabName);
  if (!sheet) return jsonResponse({ ok: false, error: 'sheet not found: ' + tabName });

  // Locate the row by id (column A). Create a new row at the bottom if not found.
  var rowIdx = findRowById(sheet, rowId);
  if (rowIdx === -1) {
    rowIdx = sheet.getLastRow() + 1;
    sheet.getRange(rowIdx, ID_COLUMN).setValue(rowId);
  }

  // Read row 1 to map header → column index.
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var headerToCol = {};
  for (var i = 0; i < headers.length; i++) headerToCol[headers[i]] = i + 1;

  for (var key in fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
    if (key === 'id' || key === 'last_sync_tag') continue; // never overwrite bookkeeping
    var col = headerToCol[key];
    if (!col) {
      // Unknown header — append it after current last column.
      lastCol++;
      col = lastCol;
      sheet.getRange(1, col).setValue(key);
      headers.push(key);
      headerToCol[key] = col;
    }
    var v = fields[key];
    sheet.getRange(rowIdx, col).setValue(v == null ? '' : v);
  }

  if (syncTag) {
    sheet.getRange(rowIdx, syncTagColumnIndex(sheet)).setValue(syncTag);
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
