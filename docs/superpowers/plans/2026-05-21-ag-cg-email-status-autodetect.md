# AG/CG Email Status Auto-Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse AskGamblers and Casino Guru status notification emails from a central Gmail inbox and write `Published` or `Refused` back to the matching Google Sheet row automatically.

**Architecture:** All logic lives in a new `EmailParser.gs` file added to the existing Apps Script project. A time-based trigger fires `parseAgCgEmails()` every hour; it searches the Gmail inbox for unprocessed AG/CG emails, parses each one, finds the matching sheet row by casino name + username, writes the status, and labels the email `ag-cg-processed` to prevent re-processing. Failures are logged to an `"Email Parse Errors"` sheet tab.

**Tech Stack:** Google Apps Script (GAS) · GmailApp · SpreadsheetApp · time-based ScriptApp trigger

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/apps-script/EmailParser.gs` | **Create** | All email parsing, sheet matching, status writing, error logging |
| `supabase/apps-script/Code.gs` | **Modify** | Add `createEmailSyncTrigger()` installer |

> **Where to edit:** Open the Apps Script project at [script.google.com](https://script.google.com). The project is the same standalone script used for `Code.gs`. Add `EmailParser.gs` as a new file via **+ → Script** in the left sidebar.

---

## Task 1 — Configuration, normalization helpers, and Gmail label helper

**Files:**
- Create: `supabase/apps-script/EmailParser.gs`

- [ ] **Step 1.1 — Create `EmailParser.gs` and write the failing tests first**

  In the Apps Script editor, create a new script file named `EmailParser`. Paste this entire block (tests + stubs so tests fail predictably):

  ```javascript
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

  // ─── Helpers (stubs — will be implemented in Step 1.3) ───────────────────────
  function normalizeCasinoName_(name) { return null; }
  function slugToTitle_(slug)         { return null; }
  function getOrCreateLabel_(name)    { return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name); }

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
  ```

- [ ] **Step 1.2 — Run `testNormalize` to confirm tests fail**

  In the editor: select `testNormalize` from the function dropdown → **Run**.
  Expected: red error in the execution log — `FAIL: strip " casino" suffix` (because stubs return `null`).

- [ ] **Step 1.3 — Implement `normalizeCasinoName_` and `slugToTitle_`**

  Replace the two stub functions:

  ```javascript
  function normalizeCasinoName_(name) {
    return String(name).toLowerCase().trim().replace(/\s+casino\s*$/, '').trim();
  }

  function slugToTitle_(slug) {
    var clean = slug.replace(/-casino$/i, '');
    return clean.split('-').map(function(w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }
  ```

- [ ] **Step 1.4 — Run `testNormalize` again to confirm all tests pass**

  Expected execution log:
  ```
  PASS: strip " casino" suffix
  PASS: trim + strip
  PASS: no suffix — passthrough
  PASS: playmojo
  PASS: slug strips -casino suffix
  PASS: spinjo slug
  PASS: hyphen becomes space
  testNormalize: all passed
  ```

- [ ] **Step 1.5 — Commit**

  Save the Apps Script project (Ctrl+S), then commit the local file copy:
  ```bash
  git add supabase/apps-script/EmailParser.gs
  git commit -m "feat(email-parser): add config, CASINO_TAB_MAP, and normalization helpers"
  ```

---

## Task 2 — AskGamblers email parser

**Files:**
- Modify: `supabase/apps-script/EmailParser.gs`

- [ ] **Step 2.1 — Add the failing test and a stub for `parseAgEmail_`**

  Append to `EmailParser.gs`:

  ```javascript
  // ─── Stub ────────────────────────────────────────────────────────────────────
  function parseAgEmail_(subject, body) { return null; }

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
    assert_(r1 !== null,              'approved: not null');
    assert_(r1.platform === 'AG',     'approved: platform');
    assert_(r1.casinoName === 'Spinjo Casino', 'approved: casino name');
    assert_(r1.status === 'Published','approved: status');
    assert_(r1.username === 'Tanner12','approved: username');

    var r2 = parseAgEmail_(
      'PlayMojo Casino Review Rejected',
      'Hello Hakina74,\nYour review has been rejected due to following reasons:'
    );
    assert_(r2 !== null,               'rejected: not null');
    assert_(r2.status === 'Refused',   'rejected: status');
    assert_(r2.casinoName === 'PlayMojo Casino', 'rejected: casino name');
    assert_(r2.username === 'Hakina74','rejected: username');

    // Non-review AG email must return null
    var r3 = parseAgEmail_('No Deposit Bonus Inside', 'Hello User, claim your bonus!');
    assert_(r3 === null, 'promo email returns null');

    Logger.log('testParseAgEmail: all passed');
  }
  ```

- [ ] **Step 2.2 — Run `testParseAgEmail` to confirm it fails**

  Expected: `FAIL: approved: not null` (stub returns `null`).

- [ ] **Step 2.3 — Replace the `parseAgEmail_` stub with the real implementation**

  ```javascript
  function parseAgEmail_(subject, body) {
    // Subject: "Spinjo Casino Review Approved!" / "PlayMojo Casino Review Rejected"
    var m = subject.match(/^(.+?)\s+Review\s+(Approved|Rejected)/i);
    if (!m) return null;

    var casinoName = m[1].trim();
    var status     = /approved/i.test(m[2]) ? 'Published' : 'Refused';
    var userMatch  = body.match(/Hello\s+(\w+)\s*[,\.]/i);
    var username   = userMatch ? userMatch[1] : null;

    return { platform: 'AG', casinoName: casinoName, status: status, username: username };
  }
  ```

- [ ] **Step 2.4 — Run `testParseAgEmail` to confirm all tests pass**

  Expected:
  ```
  PASS: approved: not null
  PASS: approved: platform
  PASS: approved: casino name
  PASS: approved: status
  PASS: approved: username
  PASS: rejected: not null
  PASS: rejected: status
  PASS: rejected: casino name
  PASS: rejected: username
  PASS: promo email returns null
  testParseAgEmail: all passed
  ```

- [ ] **Step 2.5 — Commit**

  ```bash
  git add supabase/apps-script/EmailParser.gs
  git commit -m "feat(email-parser): add AskGamblers email parser with tests"
  ```

---

## Task 3 — Casino Guru email parser

**Files:**
- Modify: `supabase/apps-script/EmailParser.gs`

- [ ] **Step 3.1 — Add the failing test and a stub for `parseCgEmail_`**

  Append to `EmailParser.gs`:

  ```javascript
  // ─── Stub ────────────────────────────────────────────────────────────────────
  function parseCgEmail_(subject, htmlBody) { return null; }

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
    assert_(r1 !== null,              'cg approved: not null');
    assert_(r1.platform === 'CG',     'cg approved: platform');
    assert_(r1.status === 'Published','cg approved: status');
    assert_(r1.username === 'Peytonn0','cg approved: username');
    assert_(r1.casinoName === 'Emirbet','cg approved: casino name from slug');

    // Rejected — casino name extracted from body text "(EmirBet Casino)"
    var rejectedHtml = 'Hello Munuuu. We have checked your casino review (EmirBet Casino) '
      + 'and it has been rejected for now. REASON: OTHER REASON';
    var r2 = parseCgEmail_('Your review has been rejected', rejectedHtml);
    assert_(r2 !== null,              'cg rejected: not null');
    assert_(r2.status === 'Refused',  'cg rejected: status');
    assert_(r2.casinoName === 'EmirBet Casino', 'cg rejected: casino name from body');
    assert_(r2.username === 'Munuuu', 'cg rejected: username');

    // Approved but no casino.guru link → returns null (logged as no_review_url)
    var noUrlHtml = 'Hello Peytonn0. We have checked and approved your review.';
    var r3 = parseCgEmail_('Your review has been approved', noUrlHtml);
    assert_(r3 === null, 'cg approved no url: returns null');

    // Unrelated CG email
    var r4 = parseCgEmail_('New comment reply...', 'Hello User, someone replied.');
    assert_(r4 === null, 'unrelated cg email: returns null');

    Logger.log('testParseCgEmail: all passed');
  }
  ```

- [ ] **Step 3.2 — Run `testParseCgEmail` to confirm it fails**

  Expected: `FAIL: cg approved: not null`.

- [ ] **Step 3.3 — Replace the `parseCgEmail_` stub with the real implementation**

  ```javascript
  function parseCgEmail_(subject, htmlBody) {
    var isApproved = /approved/i.test(subject);
    var isRejected = /rejected/i.test(subject);
    if (!isApproved && !isRejected) return null;

    var status    = isApproved ? 'Published' : 'Refused';
    var userMatch = htmlBody.match(/Hello\s+(\w+)\s*[,\.]/i);
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
        // Walk path segments right-to-left; pick the first non-reserved segment
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
  ```

- [ ] **Step 3.4 — Run `testParseCgEmail` to confirm all tests pass**

  Expected:
  ```
  PASS: cg approved: not null
  PASS: cg approved: platform
  PASS: cg approved: status
  PASS: cg approved: username
  PASS: cg approved: casino name from slug
  PASS: cg rejected: not null
  PASS: cg rejected: status
  PASS: cg rejected: casino name from body
  PASS: cg rejected: username
  PASS: cg approved no url: returns null
  PASS: unrelated cg email: returns null
  testParseCgEmail: all passed
  ```

- [ ] **Step 3.5 — Add the `parseEmail_` router (no stub needed — it's trivial)**

  Append to `EmailParser.gs`:

  ```javascript
  function parseEmail_(subject, body, htmlBody, from) {
    if (/noreply@askgamblers\.com/i.test(from)) return parseAgEmail_(subject, body);
    if (/no-reply@casino\.guru/i.test(from))    return parseCgEmail_(subject, htmlBody);
    return null;
  }
  ```

- [ ] **Step 3.6 — Commit**

  ```bash
  git add supabase/apps-script/EmailParser.gs
  git commit -m "feat(email-parser): add Casino Guru email parser and parseEmail_ router"
  ```

---

## Task 4 — Sheet row matching and status writing

**Files:**
- Modify: `supabase/apps-script/EmailParser.gs`

- [ ] **Step 4.1 — Add the failing test and stubs**

  Append to `EmailParser.gs`:

  ```javascript
  // ─── Stubs ───────────────────────────────────────────────────────────────────
  function findSheetRow_(ss, parsed)                              { return { error: 'stub' }; }
  function writeStatusToRow_(sheet, rowIdx, headers, platform, status) { return false; }

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
    var knownUsername = 'TestAgent1'; // <-- update this
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
  ```

  > Before running `testFindSheetRow`, update `knownUsername` to match a real `Account Name` value in the Rooster Partners tab for Spinjo.

- [ ] **Step 4.2 — Run `testFindSheetRow` to confirm it fails**

  Expected: `FAIL: known row found (no error): {"error":"stub"}`.

- [ ] **Step 4.3 — Replace both stubs with the real implementations**

  ```javascript
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

    var normalizedCasino = normalizeCasinoName_(parsed.casinoName);
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
  ```

- [ ] **Step 4.4 — Update `knownUsername` in the test to a real Account Name value from the Rooster Partners tab, then run `testFindSheetRow`**

  Expected: all three assertions pass.

- [ ] **Step 4.5 — Commit**

  ```bash
  git add supabase/apps-script/EmailParser.gs
  git commit -m "feat(email-parser): add sheet row matching and status writing"
  ```

---

## Task 5 — Error logging

**Files:**
- Modify: `supabase/apps-script/EmailParser.gs`

- [ ] **Step 5.1 — Add `logError_` (no stub needed — side-effect only)**

  Append to `EmailParser.gs`:

  ```javascript
  function logError_(ss, platform, subject, bodySnippet, reason) {
    var sheet = ss.getSheetByName(ERROR_TAB_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(ERROR_TAB_NAME);
      sheet.appendRow(['Timestamp', 'Platform', 'Subject', 'Body Snippet', 'Failure Reason']);
    }
    sheet.appendRow([new Date().toISOString(), platform, subject, bodySnippet, reason]);
  }
  ```

- [ ] **Step 5.2 — Add a manual smoke test and run it**

  Append temporarily, run once, then delete after confirming the row appears in the sheet:

  ```javascript
  function testLogError() {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    logError_(ss, 'AG', 'Test Subject', 'body snippet here', 'no_casino_name');
    Logger.log('Check the "Email Parse Errors" tab — one row should have been appended.');
  }
  ```

  Run `testLogError`. Open the Sheet → verify an `"Email Parse Errors"` tab was created with one data row. Delete `testLogError` from the file after confirming.

- [ ] **Step 5.3 — Commit**

  ```bash
  git add supabase/apps-script/EmailParser.gs
  git commit -m "feat(email-parser): add error logging to Email Parse Errors tab"
  ```

---

## Task 6 — Main orchestrator `parseAgCgEmails`

**Files:**
- Modify: `supabase/apps-script/EmailParser.gs`

- [ ] **Step 6.1 — Append `parseAgCgEmails` to `EmailParser.gs`**

  ```javascript
  function parseAgCgEmails() {
    var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
    var label  = getOrCreateLabel_(PROCESSED_LABEL);
    var query  = '(from:noreply@askgamblers.com OR from:no-reply@casino.guru) -label:' + PROCESSED_LABEL;
    var threads = GmailApp.search(query, 0, 50); // max 50 threads per run

    for (var t = 0; t < threads.length; t++) {
      var messages  = threads[t].getMessages();
      var threadOk  = true;

      for (var m = 0; m < messages.length; m++) {
        var msg      = messages[m];
        var from     = msg.getFrom();
        if (!/noreply@askgamblers\.com|no-reply@casino\.guru/i.test(from)) continue;

        var subject  = msg.getSubject();
        var body     = msg.getPlainBody();
        var htmlBody = msg.getBody();
        var platform = /askgamblers/i.test(from) ? 'AG' : 'CG';
        var ok       = false;

        var parsed = parseEmail_(subject, body, htmlBody, from);

        if (!parsed) {
          // CG approved emails with no "Show review" URL get a specific reason
          var reason = (platform === 'CG' && /approved/i.test(subject))
            ? 'no_review_url'
            : 'parse_failed';
          logError_(ss, platform, subject, body.substring(0, 300), reason);
        } else if (!parsed.username) {
          logError_(ss, parsed.platform, subject, body.substring(0, 300), 'no_username');
        } else if (!parsed.casinoName) {
          logError_(ss, parsed.platform, subject, body.substring(0, 300), 'no_casino_name');
        } else {
          var match = findSheetRow_(ss, parsed);
          if (match.error) {
            logError_(ss, parsed.platform, subject, body.substring(0, 300), match.error);
          } else {
            ok = writeStatusToRow_(match.sheet, match.rowIdx, match.headers, parsed.platform, parsed.status);
            if (!ok) logError_(ss, parsed.platform, subject, body.substring(0, 300), 'column_not_found');
          }
        }

        if (!ok) threadOk = false;
      }

      if (threadOk) threads[t].addLabel(label);
    }
  }
  ```

- [ ] **Step 6.2 — Manually trigger a test run**

  In the Apps Script editor, select `parseAgCgEmails` from the function dropdown → **Run**.

  - If no AG/CG emails exist in the central Gmail yet: the function runs with zero results. Execution log should show no errors.
  - If emails exist: verify the matched rows in the Sheet are updated and the threads receive the `ag-cg-processed` label in Gmail.

- [ ] **Step 6.3 — Commit**

  ```bash
  git add supabase/apps-script/EmailParser.gs
  git commit -m "feat(email-parser): add parseAgCgEmails orchestrator"
  ```

---

## Task 7 — Trigger installer in `Code.gs`

**Files:**
- Modify: `supabase/apps-script/Code.gs`

- [ ] **Step 7.1 — Append `createEmailSyncTrigger` to `Code.gs`**

  Add this block at the end of `Code.gs`:

  ```javascript
  // ---------------------------------------------------------------------------
  // Email sync trigger: runs parseAgCgEmails() every hour.
  // Run createEmailSyncTrigger() once from the Apps Script editor to install.
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
  ```

- [ ] **Step 7.2 — Run `createEmailSyncTrigger` once from the editor**

  Select `createEmailSyncTrigger` → **Run**. Confirm in the execution log:
  ```
  Email sync trigger created: parseAgCgEmails runs every 1 hour.
  ```

  Verify in **Triggers** (left sidebar → clock icon) that a new time-based trigger for `parseAgCgEmails` appears.

- [ ] **Step 7.3 — Commit**

  ```bash
  git add supabase/apps-script/Code.gs
  git commit -m "feat(email-parser): add createEmailSyncTrigger to Code.gs"
  ```

---

## Task 8 — One-time manual setup: email forwarding rules

> This task is configuration in each agent email account — no code changes.

- [ ] **Step 8.1 — For each Outlook account**

  1. Open Outlook → Settings → Mail → Rules → **Add new rule**
  2. Condition: *From* contains `noreply@askgamblers.com`
  3. Action: **Forward to** `<central-gmail-address>`
  4. Repeat with condition *From* contains `no-reply@casino.guru`

- [ ] **Step 8.2 — For each ProtonMail account (paid plan required)**

  1. Open ProtonMail → Settings → Filters → **Add filter**
  2. Condition: Sender is `noreply@askgamblers.com`
  3. Action: **Forward to** `<central-gmail-address>`
  4. Repeat for `no-reply@casino.guru`

- [ ] **Step 8.3 — Send a test forward**

  From a test inbox, send an email to the central Gmail mimicking an AG approval:
  - From: `noreply@askgamblers.com` (use the actual forwarded one, or ask the agent to forward one manually)
  - Subject: `Spinjo Casino Review Approved!`
  - Body: `Hello TestAgent1,\nYour Spinjo Casino review has just been approved!`

  Verify it arrives in the central Gmail without the `ag-cg-processed` label.

- [ ] **Step 8.4 — Run `parseAgCgEmails` manually and verify the Sheet update**

  In the editor, run `parseAgCgEmails`. Check:
  1. The Rooster Partners tab row for Spinjo + TestAgent1 now shows `Published` in the `AG Review Status` column.
  2. The email thread in Gmail now has the `ag-cg-processed` label.
  3. Running `parseAgCgEmails` a second time makes no changes (idempotent).

---

## Task 9 — End-to-end verification

- [ ] **Step 9.1 — Verify `"Email Parse Errors"` tab logs bad emails correctly**

  Temporarily forward a non-review AG email (e.g. a promotional email) to the central Gmail and remove its `ag-cg-processed` label if present. Run `parseAgCgEmails`. Confirm a row appears in `"Email Parse Errors"` with reason `parse_failed` and the thread is NOT labeled.

- [ ] **Step 9.2 — Verify hourly trigger fires**

  Wait up to 1 hour after installing the trigger, or check **Executions** in the Apps Script dashboard to confirm `parseAgCgEmails` ran automatically with no errors.

- [ ] **Step 9.3 — Final commit and push**

  ```bash
  git push origin main
  ```
