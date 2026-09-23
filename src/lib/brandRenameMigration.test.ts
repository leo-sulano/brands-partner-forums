import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BRAND_COLS } from './tab-configs';

// rename_brand/set_brand_links resolve an entry's brand key from a SQL copy
// of BRAND_COLS. If the two lists drift, a rename silently misses (or
// clobbers) the wrong jsonb key — so pin them together.
describe('rename_brand migration', () => {
  it('embeds the same BRAND_COLS list, in the same order, as tab-configs.ts', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20260923120000_add_rename_brand_functions.sql'),
      'utf8',
    );
    const m = sql.match(/-- BRAND_COLS-SYNC\s*\n\s*array\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const sqlCols = [...m![1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
    expect(sqlCols).toEqual(BRAND_COLS);
  });
});
