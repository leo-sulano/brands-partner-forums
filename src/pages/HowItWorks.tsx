import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, Handshake, BarChart3, Bot, ScrollText, Users, X, CalendarDays,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import BrandTabsModal from '../components/BrandTabsModal';

type IconColor = 'blue' | 'violet' | 'emerald' | 'amber' | 'rose' | 'slate';

interface FeatureSection {
  title: string;
  icon: LucideIcon;
  iconColor: IconColor;
  blurb: string;
  bullets: string[];
  adminOnly?: boolean;
  href?: string;
}

const ICON_COLOR_CLASSES: Record<IconColor, string> = {
  blue:    'bg-blue-50 text-blue-500',
  violet:  'bg-blue-50 text-blue-500',
  emerald: 'bg-emerald-50 text-emerald-500',
  amber:   'bg-amber-50 text-amber-500',
  rose:    'bg-rose-50 text-rose-500',
  slate:   'bg-slate-100 text-slate-500',
};

const INTRO =
  "This dashboard is the team's internal tool for tracking review-removal requests across Trustpilot, AskGamblers, Casino.Guru, and Wizard of Odds. It centralizes brand by brand entry tracking, automated status checks, and reporting in one place, plus an AI assistant that can answer questions over the data.";

const DATA_FLOW =
  "Entries are created and edited directly in the dashboard, which is the single source of truth for all data. Status changes (live vs. removed) come from the automated Check Status runs, not manual edits.";

const GETTING_STARTED_STEPS = [
  'Log in with your approved account.',
  'Open a brand tab from the sidebar.',
  'Click "Add Review Account" to create a new entry.',
  'Click an entry\'s account name to open Edit Entry and update it.',
  'Click "Check Status" to run an automated check against the tracked platforms.',
  'Watch the status column and the toast confirm once the check completes.',
];

const FEATURES: FeatureSection[] = [
  {
    title: 'Overview',
    icon: LayoutDashboard,
    iconColor: 'blue',
    blurb: 'The landing page, a rollup of where every brand tab stands right now.',
    bullets: [
      'KPI cards per brand tab: live, removed, pending, and done counts',
      'Platform breakdown chart across Trustpilot, AskGamblers, Casino.Guru, and Wizard of Odds',
      'A feed of recent mentions for quick scanning',
    ],
    href: '/',
  },
  {
    title: 'Brand Tabs',
    icon: Handshake,
    iconColor: 'violet',
    blurb: 'One tab per brand group, the core workspace for day-to-day tracking.',
    bullets: [
      'Browse every tracked account/entry for that brand group, filterable and sortable',
      'Add, edit, or delete entries directly, this is the live source of truth',
      'Any approved user can create or delete a Brand Tab from the sidebar, no code change needed',
      "Edit Entry includes an AI-powered Review Removal Assessment for removed reviews, see below",
    ],
  },
  {
    title: 'Score Summary',
    icon: BarChart3,
    iconColor: 'amber',
    blurb: 'A star-rating rollup per brand across Trustpilot, AskGamblers, Casino.Guru, and Wizard of Odds — Published reviews only.',
    bullets: [
      'Switch platforms to see that platform\'s star distribution per brand (1–5 stars for Trustpilot/Casino.Guru/Wizard of Odds, 1–10 for AskGamblers)',
      'Each brand gets a weighted average and a Rating label (Excellent, Great, Average, Poor, Bad)',
      'Counts only Published entries by design (raw sheet totals run higher because they include Removed/Refused)',
    ],
    href: '/score-summary',
  },
  {
    title: 'Ask AI',
    icon: Bot,
    iconColor: 'violet',
    blurb: "A chat assistant that can answer questions over the dashboard's data.",
    bullets: [
      "Read-only, it can look up entries, score summaries, schedules, and pauses, it can't edit anything",
      'Can also summarize saved Review Removal Assessments across brands or agents',
      'Supports voice input where the browser allows it',
    ],
    href: '/ask-ai',
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
    href: '/log',
  },
  {
    title: 'Schedule Planner',
    icon: CalendarDays,
    iconColor: 'emerald',
    blurb: 'An intelligent per-tab weekly grid that auto-generates and tracks each brand\'s TP/AG/CG/WO posting schedule.',
    bullets: [
      'Auto-generates each brand\'s weekly posting pattern per platform, click a day to cycle it active/paused, and auto-pauses (then resumes) a brand+platform whose recent success rate drops too low',
      'Day cells show real evidence over the plan — confirmed, removed, pending, and done overlays — plus a color-coded Success Rate column per brand',
      'A Schedule Status column lets you bulk-pause or resume a whole platform\'s weekdays at once, instead of clicking through each day',
      'Two-way sync with the team\'s PMS: activating a chip creates a linked task, a PMS due-date edit reflects back on the calendar, and marking a day\'s real status moves the task to a matching PMS column',
    ],
    href: '/schedule-planner',
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
    href: '/admin/users',
  },
];

export default function HowItWorks() {
  const { isAdmin } = useAuth();
  const [showBrandTabsModal, setShowBrandTabsModal] = useState(false);
  const [showGifLightbox, setShowGifLightbox] = useState(false);

  useEffect(() => {
    if (!showGifLightbox) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowGifLightbox(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showGifLightbox]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600 leading-relaxed">{INTRO}</p>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Where the data comes from
        </p>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{DATA_FLOW}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Getting Started
        </p>
        <div className="grid gap-5 lg:grid-cols-2 lg:items-center">
          <button
            type="button"
            onClick={() => setShowGifLightbox(true)}
            className="cursor-pointer"
          >
            <img
              src="/getting-started.gif"
              alt="Walkthrough: logging in, adding an entry, editing it, and running Check Status"
              className="w-full rounded-lg border border-slate-200 transition-opacity hover:opacity-90"
            />
          </button>
          <ol className="space-y-2">
            {GETTING_STARTED_STEPS.map((step, i) => (
              <li key={step} className="flex gap-3 text-sm text-slate-600">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-600">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Check Status
        </p>
        <p className="text-sm text-slate-600 leading-relaxed">
          Runs an automated checker against Trustpilot, AskGamblers, Casino.Guru, and Wizard of Odds to detect whether each entry is still live or has been removed.
        </p>
        <ul className="mt-3 space-y-1">
          <li className="text-sm text-slate-500 flex gap-2">
            <span className="text-slate-300">&bull;</span>
            <span>Per-tab button; multi-platform tabs let you check all platforms at once or just one</span>
          </li>
          <li className="text-sm text-slate-500 flex gap-2">
            <span className="text-slate-300">&bull;</span>
            <span>Scoped to whatever filters are active — status, brand, agent, proxy, country, or date range — so you can re-check just a subset, or leave everything blank to check every entry on the tab</span>
          </li>
          <li className="text-sm text-slate-500 flex gap-2">
            <span className="text-slate-300">&bull;</span>
            <span>Updates the status column and shows a toast summary once the run completes</span>
          </li>
        </ul>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
          AI Review Removal Assessment
        </p>
        <p className="text-sm text-slate-600 leading-relaxed">
          When a review has been removed, Edit Entry's "Analyze Review" button explains why using real evidence gathered from the rest of that brand's entries, not just a guess.
        </p>
        <ul className="mt-3 space-y-1">
          <li className="text-sm text-slate-500 flex gap-2">
            <span className="text-slate-300">&bull;</span>
            <span>Weighs deterministic evidence first — matching proxy/country patterns, this brand's history on the platform, cross-platform corroboration, and duplicate review text — before naming a Root Cause</span>
          </li>
          <li className="text-sm text-slate-500 flex gap-2">
            <span className="text-slate-300">&bull;</span>
            <span>Shows Evidence For and Evidence Against side by side, plus a "For Next Time" block with concrete actions for agents</span>
          </li>
          <li className="text-sm text-slate-500 flex gap-2">
            <span className="text-slate-300">&bull;</span>
            <span>Cached per platform, so analyzing one platform's review never overwrites another platform's saved result on the same entry</span>
          </li>
        </ul>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Features
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const clickable = Boolean(f.href) && (!f.adminOnly || isAdmin);
            const opensModal = f.title === 'Brand Tabs';
            const cardClass = `rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5 transition-shadow ${(clickable || opensModal) ? 'hover:shadow-md hover:border-blue-300 cursor-pointer' : ''}`;
            const content = (
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
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
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
            );
            if (clickable) {
              return (
                <Link key={f.title} to={f.href!} className={cardClass}>
                  {content}
                </Link>
              );
            }
            if (opensModal) {
              return (
                <button
                  key={f.title}
                  type="button"
                  onClick={() => setShowBrandTabsModal(true)}
                  className={`${cardClass} w-full text-left`}
                >
                  {content}
                </button>
              );
            }
            return (
              <div key={f.title} className={cardClass}>
                {content}
              </div>
            );
          })}
        </div>
      </div>

      {showBrandTabsModal && <BrandTabsModal onClose={() => setShowBrandTabsModal(false)} />}

      {showGifLightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowGifLightbox(false)} />
          <div className="relative">
            <img
              src="/getting-started.gif"
              alt="Walkthrough: logging in, adding an entry, editing it, and running Check Status"
              className="max-w-4xl max-h-[85vh] w-full rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setShowGifLightbox(false)}
              className="absolute -top-3 -right-3 rounded-lg bg-white p-1.5 text-slate-400 shadow-md hover:bg-blue-50 hover:text-slate-600 transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
