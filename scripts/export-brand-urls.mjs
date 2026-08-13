import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Extracts a top-level `const NAME = { ... }` object literal's flat quoted
// string-to-string entries by brace-balancing from the first `{` after the
// declaration. Not a general TS parser — only works because every entry in
// BRAND_TP_URLS/BRAND_AG_URLS/BRAND_CG_URLS/TAB_DISPLAY_NAMES is a plain
// 'key': 'value' pair; comment lines between entries are simply skipped
// since they never match the key:value regex.
export function extractFlatObject(source, constName) {
  const declIdx = source.indexOf(`const ${constName}`);
  if (declIdx === -1) throw new Error(`const ${constName} not found`);
  const braceStart = source.indexOf('{', declIdx);
  let depth = 1;
  let i = braceStart + 1;
  while (depth > 0) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    i++;
  }
  const body = source.slice(braceStart + 1, i - 1);
  const entries = {};
  for (const m of body.matchAll(/'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g)) {
    entries[m[1]] = m[2];
  }
  return entries;
}

// TAB_BRAND_URLS nests one flat object per tab name. Finds each top-level
// `'Tab Name': {` block by brace-balancing, then runs the same flat-entry
// regex extractFlatObject uses against each block's own body.
export function extractNestedObject(source, constName) {
  const declIdx = source.indexOf(`const ${constName}`);
  if (declIdx === -1) throw new Error(`const ${constName} not found`);
  const braceStart = source.indexOf('{', declIdx);
  let depth = 1;
  let i = braceStart + 1;
  const outerStart = i;
  while (depth > 0) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    i++;
  }
  const outerBody = source.slice(outerStart, i - 1);
  const result = {};
  const tabRe = /'([^']+)':\s*\{/g;
  let match;
  while ((match = tabRe.exec(outerBody))) {
    const tabName = match[1];
    const innerBraceStart = match.index + match[0].length - 1;
    let innerDepth = 1;
    let j = innerBraceStart + 1;
    while (innerDepth > 0) {
      if (outerBody[j] === '{') innerDepth++;
      if (outerBody[j] === '}') innerDepth--;
      j++;
    }
    const innerBody = outerBody.slice(innerBraceStart + 1, j - 1);
    const entries = {};
    for (const m of innerBody.matchAll(/'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g)) {
      entries[m[1]] = m[2];
    }
    result[tabName] = entries;
    tabRe.lastIndex = j;
  }
  return result;
}

export function buildBrandUrlMaps({ tabConfigsSource, tabsSource }) {
  return {
    brand_tp_urls: extractFlatObject(tabConfigsSource, 'BRAND_TP_URLS'),
    brand_ag_urls: extractFlatObject(tabConfigsSource, 'BRAND_AG_URLS'),
    brand_cg_urls: extractFlatObject(tabConfigsSource, 'BRAND_CG_URLS'),
    tab_brand_urls: extractNestedObject(tabConfigsSource, 'TAB_BRAND_URLS'),
    tab_display_names: extractFlatObject(tabsSource, 'TAB_DISPLAY_NAMES'),
  };
}

function main() {
  const tabConfigsSource = readFileSync(
    path.join(__dirname, '../src/lib/tab-configs.ts'),
    'utf8',
  );
  const tabsSource = readFileSync(path.join(__dirname, '../src/lib/tabs.ts'), 'utf8');
  const maps = buildBrandUrlMaps({ tabConfigsSource, tabsSource });
  const outPath = path.join(__dirname, 'brand_urls.generated.json');
  writeFileSync(outPath, JSON.stringify(maps, null, 2) + '\n');
  console.log(`Wrote ${outPath}`);
}

// Run main() if this script is being executed directly (not imported)
if (process.argv[1]?.endsWith('export-brand-urls.mjs')) {
  main();
}
