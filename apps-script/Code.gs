// Brands Partner Forum — Sheet bridge
// Bound to the Google Sheet at id 1YufhZ3Wpq8vUdZhmTX96-3w4KrAQm8roXDJncXvf0wk.
//
// Responsibilities (Phase 1):
//   - backfillIds(): one-shot, fills column A with UUIDs for all existing rows
//   - doPost():      receives row updates from the push-to-sheet Edge Function
//                    and writes them back into the sheet
//
// Phase 2 will add an onEdit() installable trigger and reverse-sync POST.

var SHEET_NAME = 'Sheet1'; // operator: change if the data tab is named differently
var ID_COLUMN = 1;         // column A
var SYNC_TAG_COLUMN = 35;  // column AI = column A (id) + 33 data columns + 1

var SHARED_SECRET = 'REPLACE_ME_WITH_APPS_SCRIPT_SHARED_SECRET';

// Order MUST match the DB column order used in push-to-sheet/index.ts ENTRY_FIELDS.
var ENTRY_FIELDS = [
  'agent', 'account', 'country', 'proxy_used', 'email', 'password',
  'account_name', 'account_surname',
  'process', 'details', 'brand',
  'status_date', 'score_added', 'trustpilot_date', 'profile_url', 'review_status',
  'redirection_search_engine', 'redirection_word', 'review_language',
  'register_from_google', 'leaving_review_after_email', 'sticky_ip_mobile',
  'photo_in_account', 'device', 'opening_via_useful', 'opening_via_register',
  'scrolling_hovering', 'smart_paste', 'mentioning_time_frames',
  'mentioning_amounts', 'mentioning_agent_name', 'review_length', 'native_language'
];

function backfillIds() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);

  // Idempotency: only insert/seed the id column if it's not already there.
  var firstHeader = sheet.getRange(1, ID_COLUMN).getValue();
  if (firstHeader !== 'id') {
    // Shift all existing data right by one column to make room for the id column.
    sheet.insertColumnsBefore(ID_COLUMN, 1);
    sheet.getRange(1, ID_COLUMN).setValue('id');
  }

  // Ensure the last_sync_tag header exists at SYNC_TAG_COLUMN.
  var syncHeader = sheet.getRange(1, SYNC_TAG_COLUMN).getValue();
  if (syncHeader !== 'last_sync_tag') {
    sheet.getRange(1, SYNC_TAG_COLUMN).setValue('last_sync_tag');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
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
  Logger.log('Backfilled %s UUIDs', changed);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
    }
    var op = body.op;
    if (op === 'upsert_row') return handleUpsertRow(body);
    return jsonResponse({ ok: false, error: 'unknown op: ' + op }, 400);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}

function handleUpsertRow(body) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  var rowId = body.sheet_row_id;
  var fields = body.fields || {};
  var syncTag = body.sync_tag;
  if (!rowId) return jsonResponse({ ok: false, error: 'sheet_row_id required' }, 400);

  var rowIdx = findRowById(sheet, rowId);
  if (rowIdx === -1) {
    rowIdx = sheet.getLastRow() + 1;
    sheet.getRange(rowIdx, ID_COLUMN).setValue(rowId);
  }

  for (var i = 0; i < ENTRY_FIELDS.length; i++) {
    var fieldName = ENTRY_FIELDS[i];
    if (Object.prototype.hasOwnProperty.call(fields, fieldName)) {
      var col = ID_COLUMN + 1 + i; // data starts in column B
      sheet.getRange(rowIdx, col).setValue(fields[fieldName] == null ? '' : fields[fieldName]);
    }
  }
  if (syncTag) {
    sheet.getRange(rowIdx, SYNC_TAG_COLUMN).setValue(syncTag);
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

function jsonResponse(obj, status) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}