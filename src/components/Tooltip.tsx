import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  // Renders the trigger wrapper as a block element spanning the full width
  // of its parent instead of shrink-wrapping to content (the default,
  // appropriate for small icon/badge triggers). Needed for triggers that are
  // themselves block-level — a whole card, a table cell — where the default
  // inline-flex would shrink them to content width and break the layout.
  block?: boolean;
  // Fired alongside (not instead of) the tooltip's own show/hide — lets a
  // caller whose trigger IS the styled card (e.g. BreakdownDonutCard) track
  // hover for its own purposes, like a sibling-shrink effect, without a
  // second wrapper element that would duplicate the card's border/shadow.
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const VIEWPORT_MARGIN = 8;

// Shared positioning/portal engine behind both the default Tooltip component
// (which supplies its own trigger <span>, below) and useTooltip (for a
// caller whose trigger element is already interactive — has its own onClick,
// tabIndex, or focus-visible-driven styling — where wrapping it in a second
// focusable <span> would create a redundant tab stop, or move keyboard focus
// off the element whose CSS actually reacts to it. Such a caller spreads
// {...triggerProps} onto its own element instead and renders {portal} beside
// it — same visuals, same show/hide/reposition logic, no extra DOM wrapper.
function useTooltipEngine(content: ReactNode) {
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [shiftX, setShiftX] = useState(0);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const show = () => {
    if (!content) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.top - 8, left: rect.left + rect.width / 2 });
    setShiftX(0);
  };
  const hide = () => setAnchor(null);

  useLayoutEffect(() => {
    if (!anchor || !tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    if (rect.left < VIEWPORT_MARGIN) {
      setShiftX(VIEWPORT_MARGIN - rect.left);
    } else if (rect.right > window.innerWidth - VIEWPORT_MARGIN) {
      setShiftX(window.innerWidth - VIEWPORT_MARGIN - rect.right);
    }
  }, [anchor]);

  const portal = anchor && content ? createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      className="pointer-events-none fixed z-[9999] whitespace-nowrap rounded-md bg-[#17225a] px-2.5 py-1.5 text-[11px] font-medium text-white shadow-lg ring-1 ring-blue-400/40"
      style={{ top: anchor.top, left: anchor.left, transform: `translate(calc(-50% + ${shiftX}px), -100%)` }}
    >
      {content}
      <span
        className="absolute top-full border-4 border-transparent border-t-[#17225a]"
        style={{ left: `calc(50% - ${shiftX}px)`, transform: 'translateX(-50%)' }}
      />
    </div>,
    document.body,
  ) : null;

  return { triggerRef, show, hide, portal };
}

export function useTooltip(content: ReactNode) {
  const { triggerRef, show, hide, portal } = useTooltipEngine(content);
  return {
    triggerProps: {
      ref: (el: HTMLElement | null) => { triggerRef.current = el; },
      onMouseEnter: show,
      onMouseLeave: hide,
      onFocus: show,
      onBlur: hide,
    },
    portal,
  };
}

// Portal-rendered so the tooltip can never be clipped by an ancestor's
// overflow-hidden (e.g. KpiCard's rounded-corner clipping). Position is
// measured and re-clamped to the viewport after mount so a badge near the
// screen edge doesn't render its tooltip half off-screen.
export default function Tooltip({ content, children, className = '', block = false, onMouseEnter, onMouseLeave }: Props) {
  const { triggerRef, show, hide, portal } = useTooltipEngine(content);

  return (
    <>
      <span
        ref={(el) => { triggerRef.current = el; }}
        tabIndex={content ? 0 : undefined}
        onMouseEnter={() => { show(); onMouseEnter?.(); }}
        onMouseLeave={() => { hide(); onMouseLeave?.(); }}
        onFocus={show}
        onBlur={hide}
        className={`${block ? 'block w-full rounded' : 'inline-flex rounded-full'} outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 ${className}`}
      >
        {children}
      </span>
      {portal}
    </>
  );
}
