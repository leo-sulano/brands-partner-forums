/// <reference path="./vite-env-shim.d.ts" />
import { createClient } from '@supabase/supabase-js';
import { OPERATIONAL_TABS } from '../../../src/lib/tabs.ts';
import { fetchRawEntriesByTab } from '../../../src/lib/queries.ts';
import { recalculatePauses, ensureWeekGenerated } from '../../../src/lib/scheduler/schedulerService.ts';

// Spike: proves Deno can resolve this repo's src/lib modules (relative .ts
// extensions from Task 4 + the @supabase/supabase-js bare specifier via this
// directory's deno.json import map) before Task 6 builds out the real
// orchestration logic. Each import is referenced so an "unused import" error
// can't mask a real resolution failure.
console.log(typeof createClient, OPERATIONAL_TABS.length, typeof fetchRawEntriesByTab, typeof recalculatePauses, typeof ensureWeekGenerated);

Deno.serve(() => new Response('ok'));
