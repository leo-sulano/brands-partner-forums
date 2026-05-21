// Requires SPREADSHEET_ID to be declared in Code.gs within the same GAS project.
// All .gs files in a GAS project share one global scope at runtime.
// ─── Configuration ───────────────────────────────────────────────────────────
var PROCESSED_LABEL = 'ag-cg-processed';
var BRAND_COL       = 'Brands';
var USERNAME_COL    = 'Account Name';
var AG_STATUS_COL   = 'AG Review Status';
var CG_STATUS_COL   = 'CG Review Status';
var ERROR_TAB_NAME  = 'Email Parse Errors';

// Maps normalized casino name → sheet tab name.
// Add new brands here when they are onboarded to AG/CG.
var CASINO_TAB_MAP = {
  'lucky7even':  'Rooster Partners',
  'fortuneplay': 'Rooster Partners',
  'roosterbet':  'Rooster Partners',
  'spinsup':     'Rooster Partners',
  'spinjo':      'Rooster Partners',
  'luckyvibe':   'Rooster Partners',
  'playmojo':    'Rooster Partners',
  'rocketspin':  'Rooster Partners',
  'rollero':     'Rooster Partners',
  'revolution':  'Revolution Casino',
  'midarion':    'Revolution Casino',
  'god of':      'Revolution Casino',
  'zodiacbet':   'Hanan',
  'pribet':      'Hanan',
  'emirbet':     'Hanan',
  'cryptoroyal': 'Hanan',
  'dachbet':     'Hanan',
  'winmega':     'Hanan',
  'olympusbet':  'Hanan',
  'realsin':     'Hanan',
  'lucknation':  'Hanan',
};

function normalizeCasinoName_(name) {
  return String(name).toLowerCase().trim().replace(/\s+casino\s*$/, '').trim();
}

function slugToTitle_(slug) {
  var clean = slug.replace(/-casino$/i, '');
  return clean.split('-').map(function(w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

function getOrCreateLabel_(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) label = GmailApp.createLabel(name);
  return label;
}

// ─── Tests ───────────────────────────────────────────────────────────────────
function testNormalize() {
  function assert_(cond, msg) {
    if (!cond) throw new Error('FAIL: ' + msg);
    Logger.log('PASS: ' + msg);
  }
  assert_(normalizeCasinoName_('Spinjo Casino')      === 'spinjo',    'strip " casino" suffix');
  assert_(normalizeCasinoName_('  EmirBet Casino  ') === 'emirbet',   'trim + strip');
  assert_(normalizeCasinoName_('Spinjo')             === 'spinjo',    'no suffix — passthrough');
  assert_(normalizeCasinoName_('PlayMojo Casino')    === 'playmojo',  'playmojo');

  assert_(slugToTitle_('emirbet-casino') === 'Emirbet',      'slug strips -casino suffix');
  assert_(slugToTitle_('spinjo-casino')  === 'Spinjo',       'spinjo slug');
  assert_(slugToTitle_('play-mojo')      === 'Play Mojo',    'hyphen becomes space');
  Logger.log('testNormalize: all passed');
}

function parseAgEmail_(subject, body) {
  // Subject: "Spinjo Casino Review Approved!" / "PlayMojo Casino Review Rejected"
  var m = subject.match(/^(.+?)\s+Review\s+(Approved|Rejected)/i);
  if (!m) return null;

  var casinoName = m[1].trim();
  var status     = /approved/i.test(m[2]) ? 'Published' : 'Refused';
  var userMatch  = body.match(/Hello\s+([\w.\-]+)\s*[,\.]/i);
  var username   = userMatch ? userMatch[1] : null;

  return { platform: 'AG', casinoName: casinoName, status: status, username: username };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
function testParseAgEmail() {
  function assert_(cond, msg) {
    if (!cond) throw new Error('FAIL: ' + msg);
    Logger.log('PASS: ' + msg);
  }

  var r1 = parseAgEmail_(
    'Spinjo Casino Review Approved!',
    'Hello Tanner12,\nYour Spinjo Casino review has just been approved!'
  );
  assert_(r1 !== null,                        'approved: not null');
  assert_(r1.platform === 'AG',               'approved: platform');
  assert_(r1.casinoName === 'Spinjo Casino',  'approved: casino name');
  assert_(r1.status === 'Published',          'approved: status');
  assert_(r1.username === 'Tanner12',         'approved: username');

  var r2 = parseAgEmail_(
    'PlayMojo Casino Review Rejected',
    'Hello Hakina74,\nYour review has been rejected due to following reasons:'
  );
  assert_(r2 !== null,                          'rejected: not null');
  assert_(r2.platform === 'AG',                 'rejected: platform');
  assert_(r2.status === 'Refused',              'rejected: status');
  assert_(r2.casinoName === 'PlayMojo Casino',  'rejected: casino name');
  assert_(r2.username === 'Hakina74',           'rejected: username');

  // Non-review AG email must return null
  var r3 = parseAgEmail_('No Deposit Bonus Inside', 'Hello User, claim your bonus!');
  assert_(r3 === null, 'promo email returns null');

  Logger.log('testParseAgEmail: all passed');
}

function parseCgEmail_(subject, htmlBody) {
  var isApproved = /approved/i.test(subject);
  var isRejected = /rejected/i.test(subject);
  if (!isApproved && !isRejected) return null;

  var status    = isApproved ? 'Published' : 'Refused';
  var userMatch = htmlBody.match(/Hello\s+([\w.\-]+)\s*[,\.]/i);
  var username  = userMatch ? userMatch[1] : null;
  var casinoName = null;

  if (isRejected) {
    // Body contains "(EmirBet Casino)"
    var nameMatch = htmlBody.match(/casino review \((.+?)\)/i);
    if (nameMatch) casinoName = nameMatch[1].trim();
  } else {
    // Approved: extract casino slug from the "Show review" link href
    var hrefMatch = htmlBody.match(/href=["']([^"']*casino\.guru[^"']+)["']/i);
    if (hrefMatch) {
      var url   = hrefMatch[1].replace(/[?#].*$/, '');
      var parts = url.split('/').filter(Boolean);
      // Walk path segments right-to-left; pick first non-reserved segment
      for (var i = parts.length - 1; i >= 0; i--) {
        var seg = parts[i];
        if (/^[a-z]/i.test(seg) && seg !== 'casino' && seg !== 'guru'
            && seg !== 'reviews' && seg.length > 2) {
          casinoName = slugToTitle_(seg);
          break;
        }
      }
    }
  }

  if (!casinoName) return null;
  return { platform: 'CG', casinoName: casinoName, status: status, username: username };
}

function parseEmail_(subject, body, htmlBody, from) {
  if (/noreply@askgamblers\.com/i.test(from)) return parseAgEmail_(subject, body);
  if (/no-reply@casino\.guru/i.test(from))    return parseCgEmail_(subject, htmlBody);
  return null;
}

// ─── Tests ───────────────────────────────────────────────────────────────────
function testParseCgEmail() {
  function assert_(cond, msg) {
    if (!cond) throw new Error('FAIL: ' + msg);
    Logger.log('PASS: ' + msg);
  }

  // Approved — casino name extracted from "Show review" href slug
  var approvedHtml = 'Hello Peytonn0. We have checked and approved your review. '
    + '<a href="https://casino.guru/casino/emirbet-casino/reviews/123">Show review</a>';
  var r1 = parseCgEmail_('Your review has been approved', approvedHtml);
  assert_(r1 !== null,               'cg approved: not null');
  assert_(r1.platform === 'CG',      'cg approved: platform');
  assert_(r1.status === 'Published', 'cg approved: status');
  assert_(r1.username === 'Peytonn0','cg approved: username');
  assert_(r1.casinoName === 'Emirbet','cg approved: casino name from slug');

  // Rejected — casino name extracted from body text "(EmirBet Casino)"
  var rejectedHtml = 'Hello Munuuu. We have checked your casino review (EmirBet Casino) '
    + 'and it has been rejected for now. REASON: OTHER REASON';
  var r2 = parseCgEmail_('Your review has been rejected', rejectedHtml);
  assert_(r2 !== null,                        'cg rejected: not null');
  assert_(r2.platform === 'CG',               'cg rejected: platform');
  assert_(r2.status === 'Refused',            'cg rejected: status');
  assert_(r2.casinoName === 'EmirBet Casino', 'cg rejected: casino name from body');
  assert_(r2.username === 'Munuuu',           'cg rejected: username');

  // Approved but no casino.guru link → returns null
  var noUrlHtml = 'Hello Peytonn0. We have checked and approved your review.';
  var r3 = parseCgEmail_('Your review has been approved', noUrlHtml);
  assert_(r3 === null, 'cg approved no url: returns null');

  // Unrelated CG email
  var r4 = parseCgEmail_('New comment reply...', 'Hello User, someone replied.');
  assert_(r4 === null, 'unrelated cg email: returns null');

  Logger.log('testParseCgEmail: all passed');
}

function findSheetRow_(ss, parsed) {
  var key = normalizeCasinoName_(parsed.casinoName);
  var tab = CASINO_TAB_MAP[key];
  if (!tab) return { error: 'unknown_tab' };

  var sheet = ss.getSheetByName(tab);
  if (!sheet) return { error: 'unknown_tab' };

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { error: 'no_matching_row' };

  var headers      = data[0].map(function(h) { return String(h).trim(); });
  var lowerHeaders = headers.map(function(h) { return h.toLowerCase(); });
  var brandIdx     = lowerHeaders.indexOf(BRAND_COL.toLowerCase());
  var userIdx      = lowerHeaders.indexOf(USERNAME_COL.toLowerCase());
  if (brandIdx === -1 || userIdx === -1) return { error: 'no_matching_row' };

  var normalizedCasino = key;
  var normalizedUser   = (parsed.username || '').toLowerCase().trim();

  for (var r = 1; r < data.length; r++) {
    var rowCasino = normalizeCasinoName_(String(data[r][brandIdx] || ''));
    var rowUser   = String(data[r][userIdx] || '').toLowerCase().trim();
    if (rowCasino === normalizedCasino && rowUser === normalizedUser) {
      return { sheet: sheet, rowIdx: r + 1, headers: headers };
    }
  }
  return { error: 'no_matching_row' };
}

function writeStatusToRow_(sheet, rowIdx, headers, platform, status) {
  var colName      = platform === 'AG' ? AG_STATUS_COL : CG_STATUS_COL;
  var lowerHeaders = headers.map(function(h) { return h.toLowerCase(); });
  var colIdx       = lowerHeaders.indexOf(colName.toLowerCase());
  if (colIdx === -1) return false;
  sheet.getRange(rowIdx, colIdx + 1).setValue(status);
  return true;
}

// ─── Tests ───────────────────────────────────────────────────────────────────
function testFindSheetRow() {
  function assert_(cond, msg) {
    if (!cond) throw new Error('FAIL: ' + msg);
    Logger.log('PASS: ' + msg);
  }

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // ── known-good row ──────────────────────────────────────────────────────────
  // Before running: ensure the Rooster Partners tab has at least one row where
  //   Brands = "Spinjo" and Account Name = <some username you know>.
  // Replace 'TestAgent1' with the actual username from your sheet.
  var knownUsername = 'TestAgent1'; // <-- update this before running
  var knownCasino   = 'Spinjo Casino'; // normalizes to "spinjo" → "Rooster Partners" tab

  var result = findSheetRow_(ss, { casinoName: knownCasino, username: knownUsername });
  assert_(!result.error, 'known row found (no error): ' + JSON.stringify(result));
  assert_(result.rowIdx >= 2, 'rowIdx is a valid sheet row (>=2)');
  assert_(result.headers.indexOf('AG Review Status') !== -1, 'AG status col in headers');

  // ── unknown casino ──────────────────────────────────────────────────────────
  var r2 = findSheetRow_(ss, { casinoName: 'ZZZUnknownCasino', username: 'anyone' });
  assert_(r2.error === 'unknown_tab', 'unknown casino → unknown_tab error');

  // ── wrong username ──────────────────────────────────────────────────────────
  var r3 = findSheetRow_(ss, { casinoName: knownCasino, username: 'zzz_no_such_user' });
  assert_(r3.error === 'no_matching_row', 'bad username → no_matching_row error');

  Logger.log('testFindSheetRow: all passed');
}

function logError_(ss, platform, subject, bodySnippet, reason) {
  var sheet = ss.getSheetByName(ERROR_TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ERROR_TAB_NAME);
    sheet.appendRow(['Timestamp', 'Platform', 'Subject', 'Body Snippet', 'Failure Reason']);
  }
  var snippet = bodySnippet ? String(bodySnippet).slice(0, 500) : '';
  sheet.appendRow([new Date().toISOString(), platform, subject, snippet, reason]);
}
