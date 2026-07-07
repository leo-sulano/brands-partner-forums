import {
  LayoutDashboard, Handshake, RefreshCw, BarChart3, Bot, ScrollText, Users,
  type LucideIcon,
} from 'lucide-react';

type IconColor = 'blue' | 'violet' | 'emerald' | 'amber' | 'rose' | 'slate';

interface FeatureSection {
  title: string;
  icon: LucideIcon;
  iconColor: IconColor;
  blurb: string;
  bullets: string[];
  adminOnly?: boolean;
}

const ICON_COLOR_CLASSES: Record<IconColor, string> = {
  blue:    'bg-blue-50 text-blue-500',
  violet:  'bg-violet-50 text-violet-500',
  emerald: 'bg-emerald-50 text-emerald-500',
  amber:   'bg-amber-50 text-amber-500',
  rose:    'bg-rose-50 text-rose-500',
  slate:   'bg-slate-100 text-slate-500',
};

const INTRO =
  "This dashboard is the team's internal tool for tracking review-removal requests across Trustpilot, AskGamblers, Casino.Guru, and Wizard of Odds. It centralizes brand-by-brand entry tracking, automated status checks, and reporting in one place — plus an AI assistant that can answer questions over the data.";

const DATA_FLOW =
  "Entries used to live in a shared Google Sheet that synced into this dashboard. Today the dashboard is edited directly and is the live source of truth — the Sheet is no longer the operational record. Status changes (live vs. removed) come from the automated Check Status runs below, not manual edits.";

const FEATURES: FeatureSection[] = [
  {
    title: 'Overview',
    icon: LayoutDashboard,
    iconColor: 'blue',
    blurb: 'The landing page — a rollup of where every brand tab stands right now.',
    bullets: [
      'KPI cards per brand tab: live, removed, pending, and done counts',
      'Platform breakdown chart across Trustpilot, AskGamblers, Casino.Guru, and Wizard of Odds',
      'A feed of recent mentions for quick scanning',
    ],
  },
  {
    title: 'Brand Tabs',
    icon: Handshake,
    iconColor: 'violet',
    blurb: 'One tab per brand group — the core workspace for day-to-day tracking.',
    bullets: [
      'Browse every tracked account/entry for that brand group, filterable and sortable',
      'Add, edit, or delete entries directly — this is the live source of truth',
      'Trigger a Check Status run scoped to that tab',
    ],
  },
  {
    title: 'Check Status',
    icon: RefreshCw,
    iconColor: 'emerald',
    blurb: 'Automated detection of whether a review or profile is still live or has been removed.',
    bullets: [
      'Runs per platform (TP/AG/CG/WO) from the Check Status button on each brand tab',
      'Scoped by status, brand, agent, proxy, and country filters so you only re-check what changed',
      "Writes results back into the entry's status column automatically",
    ],
  },
  {
    title: 'Score Summary',
    icon: BarChart3,
    iconColor: 'amber',
    blurb: 'A rollup of published counts per brand, used for reporting.',
    bullets: [
      'Counts only Published entries by design (raw sheet totals run higher because they include Removed/Refused)',
    ],
  },
  {
    title: 'Ask AI',
    icon: Bot,
    iconColor: 'violet',
    blurb: "A chat assistant that can answer questions over the dashboard's data.",
    bullets: [
      "Read-only — it can look up and summarize entries, it can't edit anything",
      'Supports voice input where the browser allows it',
    ],
  },
  {
    title: 'Activity Log',
    icon: ScrollText,
    iconColor: 'slate',
    blurb: 'An audit trail of who changed what.',
    bullets: [
      'Tracks entry edits and admin actions (approvals, revokes, role changes)',
      'Edited or deleted entries can be restored from here',
    ],
  },
  {
    title: 'Admin Users',
    icon: Users,
    iconColor: 'rose',
    blurb: 'User approval and role management.',
    bullets: [
      'New signups need admin approval before they can access the dashboard',
      'Admins can promote/demote other admins and revoke access',
    ],
    adminOnly: true,
  },
];

export default function HowItWorks() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">How it works</h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{INTRO}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Where the data comes from
        </p>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{DATA_FLOW}</p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Features
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
              <div className="flex items-start gap-3">
                <div
                  className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${ICON_COLOR_CLASSES[f.iconColor]}`}
                >
                  <f.icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-slate-900">{f.title}</h2>
                    {f.adminOnly && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">
                        Admin
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{f.blurb}</p>
                  <ul className="mt-2 space-y-1">
                    {f.bullets.map((b) => (
                      <li key={b} className="text-sm text-slate-500 flex gap-2">
                        <span className="text-slate-300">&bull;</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
