// AG/CG email-based review-status auto-detection.
//
// Relies on SHEET_ID (the Google Sheet id) being declared in Code.gs within the
// same Apps Script project — all .gs files in a GAS project share one global scope.
//
// Flow: an hourly trigger runs parseAgCgEmails(). It searches the script owner's
// Gmail for unprocessed AskGamblers / Casino Guru notification emails, parses each
// one (platform, casino, username, Published/Refused), finds the matching Sheet row
// by casino + username, writes the status, and labels the thread 'ag-cg-processed'
// so it is never processed twice. Failures are logged to the 'Email Parse Errors'
// tab and left unlabeled so they retry on the next run.
//
// See docs/superpowers/specs/2026-05-21-ag-cg-email-status-autodetect-design.md
// (incl. the 2026-05-29 addendum) for the design and the real-email findings.

// ─── Configuration ───────────────────────────────────────────────────────────
var PROCESSED_LABEL = 'ag-cg-processed';
var BRAND_COL       = 'Brands';
var USERNAME_COL    = 'Account Name';
var AG_STATUS_COL   = 'AG Review Status';
var CG_STATUS_COL   = 'CG Review Status';
var ERROR_TAB_NAME  = 'Email Parse Errors';

// Maps normalized casino name → sheet tab name.
// Keys are produced by normalizeCasinoName_ (lowercase, trimmed, trailing
// " casino" stripped). Add new brands here as they are onboarded to AG/CG.
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
  'silverplay':  'SilverPlay',
};

// ─── Normalization & label helpers ─────────────────────────────────────────────

// "Spinjo Casino" → "spinjo". Used for both parsed names and sheet cell values so
// they compare equal regardless of the " Casino" suffix.
function normalizeCasinoName_(name) {
  return String(name).toLowerCase().trim().replace(/\s+casino\s*$/, '').trim();
}

// Title-cases a hyphenated slug, dropping a trailing "-casino". Used by the CG
// approved path: "luckyvibe-casino" → "Luckyvibe".
function slugToTitle_(slug) {
  var clean = String(slug).replace(/-casino$/i, '');
  return clean.split('-').map(function(w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

// Canonical CG review slug → casino display name.
// "luckyvibe-casino-review" → "Luckyvibe"; "play-mojo-casino-review" → "Play Mojo".
function cgSlugToCasinoName_(slug) {
  var clean = String(slug).toLowerCase().replace(/-review\s*$/, '');
  return slugToTitle_(clean);
}

function getOrCreateLabel_(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) label = GmailApp.createLabel(name);
  return label;
}

// ─── AskGamblers parser ────────────────────────────────────────────────────────
// Subject:  "<Casino> Casino Review Approved!" / "<Casino> Casino Review Rejected"
// Greeting: approved → "Congratulations <user>,"   rejected → "Hello <user>,"
function parseAgEmail_(subject, body) {
  var m = subject.match(/^(.+?)\s+Review\s+(Approved|Rejected)/i);
  if (!m) return null;

  var casinoName = m[1].trim();
  var status     = /approved/i.test(m[2]) ? 'Published' : 'Refused';
  // Real AG emails greet with "Hello <user>," (rejected) OR "Congratulations <user>," (approved).
  var userMatch  = body.match(/(?:Hello|Congratulations)\s+([\w.\-]+)\s*[,\.]/i);
  var username   = userMatch ? userMatch[1] : null;

  return { platform: 'AG', casinoName: casinoName, status: status, username: username };
}

// ─── Casino Guru parser ────────────────────────────────────────────────────────
// Subject:  "Your review has been approved" / "...rejected"
// Greeting: "Hello <user>." (both)
// Rejected: casino name is in the body — "casino review (EmirBet Casino)".
// Approved: NO casino name anywhere — only a "Show review" link of the form
//   https://casino.guru/userReview/<id>/<n>  which must be resolved separately
//   (see resolveCgCasinoFromUrl_). The parser returns reviewUrl; casinoName stays
//   null until the orchestrator resolves it.
function parseCgEmail_(subject, htmlBody) {
  var isApproved = /approved/i.test(subject);
  var isRejected = /rejected/i.test(subject);
  if (!isApproved && !isRejected) return null;

  var status    = isApproved ? 'Published' : 'Refused';
  var userMatch = htmlBody.match(/Hello\s+([\w.\-]+)\s*[,\.]/i);
  var username  = userMatch ? userMatch[1] : null;

  if (isRejected) {
    var nameMatch = htmlBody.match(/casino review \((.+?)\)/i);
    var casinoName = nameMatch ? nameMatch[1].trim() : null;
    if (!casinoName) return null;
    return { platform: 'CG', casinoName: casinoName, status: status, username: username };
  }

  // Approved: capture the userReview link to resolve later.
  var hrefMatch = htmlBody.match(/href=["']([^"']*casino\.guru\/userReview\/[^"']+)["']/i);
  var reviewUrl = hrefMatch ? hrefMatch[1].replace(/&amp;/g, '&') : null;
  return { platform: 'CG', casinoName: null, status: status, username: username, reviewUrl: reviewUrl };
}

function parseEmail_(subject, body, htmlBody, from) {
  if (/noreply@askgamblers\.com/i.test(from)) return parseAgEmail_(subject, body);
  if (/no-reply@casino\.guru/i.test(from))    return parseCgEmail_(subject, htmlBody);
  return null;
}

// ─── CG approved: resolve casino name by following the review link ──────────────
// Fetches the userReview URL and reads the canonical "...-casino-review" slug.
// Returns a casino display name (e.g. "Luckyvibe") or null on any failure.
function resolveCgCasinoFromUrl_(reviewUrl) {
  if (!reviewUrl) return null;
  try {
    // First try without following redirects, in case it 3xx's straight to the slug.
    var resp = UrlFetchApp.fetch(reviewUrl, { followRedirects: false, muteHttpExceptions: true });
    var code = resp.getResponseCode();
    var finalUrl = null;

    if (code >= 300 && code < 400) {
      var headers = resp.getAllHeaders();
      finalUrl = headers['Location'] || headers['location'] || null;
    } else if (code >= 200 && code < 300) {
      // 200 — the canonical casino-review URL lives in the page's <link rel="canonical">.
      var html  = resp.getContentText();
      var canon = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
               || html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);
      if (canon) finalUrl = canon[1];
    }
    if (!finalUrl) return null;

    // Only accept a real "...-review" casino slug — never the literal "userReview" path.
    var m = finalUrl.match(/casino\.guru\/([a-z0-9\-]+?)-review(?:[\/?#]|$)/i);
    if (!m) return null;
    return cgSlugToCasinoName_(m[1]);
  } catch (e) {
    return null;
  }
}

// ─── Sheet row matching & status writing ───────────────────────────────────────
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

  var normalizedUser = (parsed.username || '').toLowerCase().trim();

  for (var r = 1; r < data.length; r++) {
    var rowCasino = normalizeCasinoName_(String(data[r][brandIdx] || ''));
    var rowUser   = String(data[r][userIdx] || '').toLowerCase().trim();
    if (rowCasino === key && rowUser === normalizedUser) {
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

// ─── Error logging ─────────────────────────────────────────────────────────────
function logError_(ss, platform, subject, bodySnippet, reason) {
  var sheet = ss.getSheetByName(ERROR_TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ERROR_TAB_NAME);
    sheet.appendRow(['Timestamp', 'Platform', 'Subject', 'Body Snippet', 'Failure Reason']);
  }
  var snippet = bodySnippet ? String(bodySnippet).slice(0, 300) : '';
  sheet.appendRow([new Date().toISOString(), platform, subject, snippet, reason]);
}

// ─── Orchestrator (hourly trigger target) ──────────────────────────────────────
// Error reasons: parse_failed, no_review_url, cg_resolve_failed, no_username,
// no_casino_name, unknown_tab, no_matching_row, column_not_found.
function parseAgCgEmails() {
  var ss      = SpreadsheetApp.openById(SHEET_ID);
  var label   = getOrCreateLabel_(PROCESSED_LABEL);
  var query   = '(from:noreply@askgamblers.com OR from:no-reply@casino.guru) -label:' + PROCESSED_LABEL;
  var threads = GmailApp.search(query, 0, 50); // cap at 50 threads per run

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    var threadOk = true;

    for (var i = 0; i < messages.length; i++) {
      var msg      = messages[i];
      var from     = msg.getFrom();
      if (!/noreply@askgamblers\.com|no-reply@casino\.guru/i.test(from)) continue;

      var subject  = msg.getSubject();
      var body     = msg.getPlainBody();
      var htmlBody = msg.getBody();
      var platform = /askgamblers/i.test(from) ? 'AG' : 'CG';
      var ok       = false;

      var parsed = parseEmail_(subject, body, htmlBody, from);

      if (!parsed) {
        var reason = (platform === 'CG' && /approved/i.test(subject)) ? 'no_review_url' : 'parse_failed';
        logError_(ss, platform, subject, body, reason);
      } else if (!parsed.username) {
        logError_(ss, parsed.platform, subject, body, 'no_username');
      } else {
        // CG approved: casino name is not in the email — resolve via the review link.
        if (parsed.platform === 'CG' && parsed.status === 'Published' && !parsed.casinoName) {
          if (!parsed.reviewUrl) {
            logError_(ss, parsed.platform, subject, body, 'no_review_url');
            if (!ok) threadOk = false;
            continue;
          }
          parsed.casinoName = resolveCgCasinoFromUrl_(parsed.reviewUrl);
          if (!parsed.casinoName) {
            logError_(ss, parsed.platform, subject, body, 'cg_resolve_failed');
            if (!ok) threadOk = false;
            continue;
          }
        }

        if (!parsed.casinoName) {
          logError_(ss, parsed.platform, subject, body, 'no_casino_name');
        } else {
          var match = findSheetRow_(ss, parsed);
          if (match.error) {
            logError_(ss, parsed.platform, subject, body, match.error);
          } else {
            ok = writeStatusToRow_(match.sheet, match.rowIdx, match.headers, parsed.platform, parsed.status);
            if (!ok) logError_(ss, parsed.platform, subject, body, 'column_not_found');
          }
        }
      }

      if (!ok) threadOk = false;
    }

    if (threadOk) threads[t].addLabel(label);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────
// Run these from the Apps Script editor (select function → Run). Pure-logic tests
// need no setup; testFindSheetRow and testResolveCgCasino hit the live sheet/network.

function _assert_(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  Logger.log('PASS: ' + msg);
}

function testNormalize() {
  _assert_(normalizeCasinoName_('Spinjo Casino')      === 'spinjo',   'strip " casino" suffix');
  _assert_(normalizeCasinoName_('  EmirBet Casino  ') === 'emirbet',  'trim + strip');
  _assert_(normalizeCasinoName_('Spinjo')             === 'spinjo',   'no suffix — passthrough');
  _assert_(normalizeCasinoName_('PlayMojo Casino')    === 'playmojo', 'playmojo');

  _assert_(cgSlugToCasinoName_('luckyvibe-casino-review') === 'Luckyvibe', 'cg slug → Luckyvibe');
  _assert_(cgSlugToCasinoName_('spinjo-casino-review')    === 'Spinjo',    'cg slug → Spinjo');
  _assert_(slugToTitle_('play-mojo') === 'Play Mojo', 'hyphen becomes space');
  Logger.log('testNormalize: all passed');
}

function testParseAgEmail() {
  // Approved — real format greets with "Congratulations <user>,"
  var r1 = parseAgEmail_(
    'Spinjo Casino Review Approved!',
    'Congratulations Tanner12,\nYour Spinjo Casino review has just been approved!'
  );
  _assert_(r1 !== null,                       'ag approved: not null');
  _assert_(r1.platform === 'AG',              'ag approved: platform');
  _assert_(r1.casinoName === 'Spinjo Casino', 'ag approved: casino from subject');
  _assert_(r1.status === 'Published',         'ag approved: status');
  _assert_(r1.username === 'Tanner12',        'ag approved: username from Congratulations');

  // Second real approved sample
  var r1b = parseAgEmail_(
    'Rollero Casino Review Approved!',
    'Congratulations Trym12,\nYour Rollero Casino review has just been approved!'
  );
  _assert_(r1b.casinoName === 'Rollero Casino', 'ag approved 2: casino');
  _assert_(r1b.username === 'Trym12',           'ag approved 2: username');

  // Rejected — greets with "Hello <user>,"
  var r2 = parseAgEmail_(
    'PlayMojo Casino Review Rejected',
    'Hello Hakina74,\nYour review has been rejected due to following reasons:'
  );
  _assert_(r2 !== null,                          'ag rejected: not null');
  _assert_(r2.status === 'Refused',              'ag rejected: status');
  _assert_(r2.casinoName === 'PlayMojo Casino',  'ag rejected: casino');
  _assert_(r2.username === 'Hakina74',           'ag rejected: username');

  // Non-review AG email must return null
  _assert_(parseAgEmail_('No Deposit Bonus Inside', 'Hello User, claim your bonus!') === null,
    'ag promo email returns null');

  Logger.log('testParseAgEmail: all passed');
}

function testParseCgEmail() {
  // Approved — casino name NOT present; parser returns the userReview link only.
  var approvedHtml = 'Hello Omaa0. We have checked and approved your review, and it is now '
    + 'visible to other visitors of our website. '
    + '<a href="https://casino.guru/userReview/130406/49">Show review</a>';
  var r1 = parseCgEmail_('Your review has been approved', approvedHtml);
  _assert_(r1 !== null,                'cg approved: not null');
  _assert_(r1.platform === 'CG',       'cg approved: platform');
  _assert_(r1.status === 'Published',  'cg approved: status');
  _assert_(r1.username === 'Omaa0',    'cg approved: username');
  _assert_(r1.casinoName === null,     'cg approved: casino name deferred (null)');
  _assert_(r1.reviewUrl === 'https://casino.guru/userReview/130406/49', 'cg approved: reviewUrl captured');

  // Rejected — casino name is in the body "(EmirBet Casino)"
  var rejectedHtml = 'Hello Munuuu. We have checked your casino review (EmirBet Casino) '
    + 'and it has been rejected for now. REASON: OTHER REASON';
  var r2 = parseCgEmail_('Your review has been rejected', rejectedHtml);
  _assert_(r2 !== null,                        'cg rejected: not null');
  _assert_(r2.status === 'Refused',            'cg rejected: status');
  _assert_(r2.casinoName === 'EmirBet Casino', 'cg rejected: casino from body');
  _assert_(r2.username === 'Munuuu',           'cg rejected: username');

  // Approved but no userReview link → reviewUrl null (orchestrator logs no_review_url)
  var r3 = parseCgEmail_('Your review has been approved', 'Hello Omaa0. Approved, no link.');
  _assert_(r3 !== null && r3.reviewUrl === null, 'cg approved no link: reviewUrl null');

  // Unrelated CG email
  _assert_(parseCgEmail_('New comment reply...', 'Hello User, someone replied.') === null,
    'cg unrelated email returns null');

  Logger.log('testParseCgEmail: all passed');
}

// Network test — confirms the userReview link resolves to a casino slug.
// Run manually; depends on casino.guru being reachable.
function testResolveCgCasino() {
  var name = resolveCgCasinoFromUrl_('https://casino.guru/userReview/130406/49');
  Logger.log('resolved: ' + name);
  _assert_(name === 'Luckyvibe', 'userReview/130406/49 resolves to Luckyvibe');
  Logger.log('testResolveCgCasino: passed');
}

// Live-sheet test — update knownUsername to a real Account Name for Spinjo first.
function testFindSheetRow() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var knownUsername = 'TestAgent1';      // <-- update to a real Account Name in Rooster Partners
  var knownCasino   = 'Spinjo Casino';   // normalizes to "spinjo" → Rooster Partners

  var result = findSheetRow_(ss, { casinoName: knownCasino, username: knownUsername });
  _assert_(!result.error, 'known row found: ' + JSON.stringify(result));
  _assert_(result.rowIdx >= 2, 'rowIdx valid (>=2)');
  _assert_(result.headers.indexOf('AG Review Status') !== -1, 'AG status col present');

  var r2 = findSheetRow_(ss, { casinoName: 'ZZZUnknownCasino', username: 'anyone' });
  _assert_(r2.error === 'unknown_tab', 'unknown casino → unknown_tab');

  var r3 = findSheetRow_(ss, { casinoName: knownCasino, username: 'zzz_no_such_user' });
  _assert_(r3.error === 'no_matching_row', 'bad username → no_matching_row');

  Logger.log('testFindSheetRow: all passed');
}
