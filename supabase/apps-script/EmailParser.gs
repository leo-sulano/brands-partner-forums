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
  var userMatch  = body.match(/Hello\s+(\w+)\s*[,\.]/i);
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
  assert_(r2.status === 'Refused',              'rejected: status');
  assert_(r2.casinoName === 'PlayMojo Casino',  'rejected: casino name');
  assert_(r2.username === 'Hakina74',           'rejected: username');

  // Non-review AG email must return null
  var r3 = parseAgEmail_('No Deposit Bonus Inside', 'Hello User, claim your bonus!');
  assert_(r3 === null, 'promo email returns null');

  Logger.log('testParseAgEmail: all passed');
}
