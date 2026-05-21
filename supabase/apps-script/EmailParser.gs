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
