-- supabase/migrations/20260819110000_add_brand_agent_assignments.sql
-- Brand -> Agent responsibility mapping
-- (docs/superpowers/specs/2026-08-19-brand-agent-responsibility-mapping-design.md):
--
-- Authoritative source of who owns which brand, per platform, sourced from
-- the "Files & responsibility mapping - Responsibilities" spreadsheet.
-- Schedule Planner's Agent resolution (src/lib/scheduler/scheduleUtils.ts,
-- resolveAgentForPlatform) checks this table FIRST -- a matching row, even
-- one with agent = null (the sheet's explicit "N/A"), is authoritative and
-- skips the older per-entry Agent-column heuristic (buildAgentIndex)
-- entirely for that exact (brand, platform). No row at all falls through to
-- that heuristic unchanged.
--
-- Five of 11 operational tabs (Revolution Casino, Trybet, SilverPlay, Hanan,
-- HazEmirates UAE) have no 'Agent' column in their entries' jsonb data at
-- all -- their source Google Sheets never had one -- so buildAgentIndex has
-- always resolved nothing for their brands. This table is the only way
-- those tabs' brands can ever get a real PMS assignee.
--
-- One-time seed only -- no admin UI exists to edit this table. Future
-- reassignments are made directly in the Supabase table editor, same as
-- removed_platform_brands and schedule_hidden_brands/
-- schedule_platform_restrictions.
--
-- TP Brand Injection and TP Affiliate are deliberately NOT seeded here --
-- the sheet has no agent data for either group ("BI TP"/"AFF TP" sections
-- list brand names only). Both tabs keep using their existing per-entry
-- Agent field unchanged.
--
-- Brand spellings below were verified against live entries.data via direct
-- Supabase REST query, not copied verbatim from the sheet -- one real
-- mismatch was caught this way: the sheet says "Trybet", the live brand
-- value is "Trybet.com". brand_key matching is lower+trim only (no
-- punctuation stripping), so the uncorrected spelling would have never
-- matched. Only platforms a tab actually tracks (getTabPlatforms) are
-- seeded; e.g. Trybet and SuprPlay Limited are TP-only tabs, so no ag/cg
-- rows exist for their brands even though the sheet marks those cells N/A.
--
-- Brands present in a tab's live entries but absent from this sheet
-- (Novadreams, Midasluck, Revolution1, and Hanan's flagged-removed
-- Pribet.com/RealSpin.com/WinMega.com) get no row -- they keep falling back
-- to the per-entry heuristic, unchanged from today.

create table public.brand_agent_assignments (
  id         uuid primary key default gen_random_uuid(),
  tab        text not null,
  brand      text not null,
  brand_key  text generated always as (lower(btrim(brand))) stored,
  platform   text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  agent      text,
  created_at timestamptz not null default now(),
  unique (tab, brand_key, platform)
);

alter table public.brand_agent_assignments enable row level security;

create policy "anyone can read brand_agent_assignments"
  on public.brand_agent_assignments for select using (true);
create policy "approved users can insert brand_agent_assignments"
  on public.brand_agent_assignments for insert with check (public.is_approved());
create policy "approved users can update brand_agent_assignments"
  on public.brand_agent_assignments for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete brand_agent_assignments"
  on public.brand_agent_assignments for delete using (public.is_approved());

-- Rooster Partners — all LAI across tp/ag/cg. Novadreams2 is explicit N/A
-- (agent = null) on all three platforms in the sheet -- authoritative,
-- overrides whatever its per-entry Agent column says.
insert into public.brand_agent_assignments (tab, brand, platform, agent) values
  ('Rooster Partners', 'Lucky7even', 'tp', 'LAI'),
  ('Rooster Partners', 'Lucky7even', 'ag', 'LAI'),
  ('Rooster Partners', 'Lucky7even', 'cg', 'LAI'),
  ('Rooster Partners', 'Rooster.bet', 'tp', 'LAI'),
  ('Rooster Partners', 'Rooster.bet', 'ag', 'LAI'),
  ('Rooster Partners', 'Rooster.bet', 'cg', 'LAI'),
  ('Rooster Partners', 'Spinjo', 'tp', 'LAI'),
  ('Rooster Partners', 'Spinjo', 'ag', 'LAI'),
  ('Rooster Partners', 'Spinjo', 'cg', 'LAI'),
  ('Rooster Partners', 'Fortuneplay', 'tp', 'LAI'),
  ('Rooster Partners', 'Fortuneplay', 'ag', 'LAI'),
  ('Rooster Partners', 'Fortuneplay', 'cg', 'LAI'),
  ('Rooster Partners', 'Spinsup', 'tp', 'LAI'),
  ('Rooster Partners', 'Spinsup', 'ag', 'LAI'),
  ('Rooster Partners', 'Spinsup', 'cg', 'LAI'),
  ('Rooster Partners', 'Rocketspin', 'tp', 'LAI'),
  ('Rooster Partners', 'Rocketspin', 'ag', 'LAI'),
  ('Rooster Partners', 'Rocketspin', 'cg', 'LAI'),
  ('Rooster Partners', 'Play Mojo', 'tp', 'LAI'),
  ('Rooster Partners', 'Play Mojo', 'ag', 'LAI'),
  ('Rooster Partners', 'Play Mojo', 'cg', 'LAI'),
  ('Rooster Partners', 'Luckyvibe', 'tp', 'LAI'),
  ('Rooster Partners', 'Luckyvibe', 'ag', 'LAI'),
  ('Rooster Partners', 'Luckyvibe', 'cg', 'LAI'),
  ('Rooster Partners', 'Novadreams2', 'tp', null),
  ('Rooster Partners', 'Novadreams2', 'ag', null),
  ('Rooster Partners', 'Novadreams2', 'cg', null),
  ('Rooster Partners', 'Rollero', 'tp', 'LAI'),
  ('Rooster Partners', 'Rollero', 'ag', 'LAI'),
  ('Rooster Partners', 'Rollero', 'cg', 'LAI');

-- Revolution Casino — Revolution Casino/Midarion all JEN; God Of Casino is
-- split: tp/cg explicit N/A (null), ag = JEN.
insert into public.brand_agent_assignments (tab, brand, platform, agent) values
  ('Revolution Casino', 'Revolution Casino', 'tp', 'JEN'),
  ('Revolution Casino', 'Revolution Casino', 'ag', 'JEN'),
  ('Revolution Casino', 'Revolution Casino', 'cg', 'JEN'),
  ('Revolution Casino', 'Midarion', 'tp', 'JEN'),
  ('Revolution Casino', 'Midarion', 'ag', 'JEN'),
  ('Revolution Casino', 'Midarion', 'cg', 'JEN'),
  ('Revolution Casino', 'God Of Casino', 'tp', null),
  ('Revolution Casino', 'God Of Casino', 'ag', 'JEN'),
  ('Revolution Casino', 'God Of Casino', 'cg', null);

-- Trybet — TP-only tab. Spelling corrected to the live "Trybet.com" (sheet
-- said "Trybet").
insert into public.brand_agent_assignments (tab, brand, platform, agent) values
  ('Trybet', 'Trybet.com', 'tp', 'JEN');

-- SilverPlay — tp explicit N/A (null), ag/cg = JEN.
insert into public.brand_agent_assignments (tab, brand, platform, agent) values
  ('SilverPlay', 'Silver Play', 'tp', null),
  ('SilverPlay', 'Silver Play', 'ag', 'JEN'),
  ('SilverPlay', 'Silver Play', 'cg', 'JEN');

-- SuprPlay Limited — TP-only tab, all JEN.
insert into public.brand_agent_assignments (tab, brand, platform, agent) values
  ('SuprPlay Limited', 'Duelz.com', 'tp', 'JEN'),
  ('SuprPlay Limited', 'Voodoo Dreams', 'tp', 'JEN'),
  ('SuprPlay Limited', 'NY Spins', 'tp', 'JEN');

-- Hanan — all ANN across tp/ag/cg. Pribet.com/RealSpin.com/WinMega.com
-- (flagged-removed brands) are not in the sheet and get no row here.
insert into public.brand_agent_assignments (tab, brand, platform, agent) values
  ('Hanan', 'ZodiacBet.com', 'tp', 'ANN'),
  ('Hanan', 'ZodiacBet.com', 'ag', 'ANN'),
  ('Hanan', 'ZodiacBet.com', 'cg', 'ANN'),
  ('Hanan', 'EmirBet.com', 'tp', 'ANN'),
  ('Hanan', 'EmirBet.com', 'ag', 'ANN'),
  ('Hanan', 'EmirBet.com', 'cg', 'ANN'),
  ('Hanan', 'Cryptoroyal.com', 'tp', 'ANN'),
  ('Hanan', 'Cryptoroyal.com', 'ag', 'ANN'),
  ('Hanan', 'Cryptoroyal.com', 'cg', 'ANN'),
  ('Hanan', 'DachBet.com', 'tp', 'ANN'),
  ('Hanan', 'DachBet.com', 'ag', 'ANN'),
  ('Hanan', 'DachBet.com', 'cg', 'ANN'),
  ('Hanan', 'OlympusBet.com', 'tp', 'ANN'),
  ('Hanan', 'OlympusBet.com', 'ag', 'ANN'),
  ('Hanan', 'OlympusBet.com', 'cg', 'ANN'),
  ('Hanan', 'LuckNation.com', 'tp', 'ANN'),
  ('Hanan', 'LuckNation.com', 'ag', 'ANN'),
  ('Hanan', 'LuckNation.com', 'cg', 'ANN');

-- Wizard of Odds — wo-only tab, all JEN. Spellings match this tab's own
-- live brand values exactly (RoosterBet/LuckyVibe/PlayMojo, distinct from
-- Rooster Partners' own Rooster.bet/Luckyvibe/Play Mojo spellings).
insert into public.brand_agent_assignments (tab, brand, platform, agent) values
  ('Wizard of Odds', 'RoosterBet', 'wo', 'JEN'),
  ('Wizard of Odds', 'Lucky7even', 'wo', 'JEN'),
  ('Wizard of Odds', 'Fortuneplay', 'wo', 'JEN'),
  ('Wizard of Odds', 'Rocketspin', 'wo', 'JEN'),
  ('Wizard of Odds', 'LuckyVibe', 'wo', 'JEN'),
  ('Wizard of Odds', 'PlayMojo', 'wo', 'JEN'),
  ('Wizard of Odds', 'Rollero', 'wo', 'JEN');
