import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

const VIEWPORT_MARGIN = 8;

// Portal-rendered so the tooltip can never be clipped by an ancestor's
// overflow-hidden (e.g. KpiCard's rounded-corner clipping). Position is
// measured and re-clamped to the viewport after mount so a badge near the
// screen edge doesn't render its tooltip half off-screen.
export default function Tooltip({ content, children, className = '' }: Props) {
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [shiftX, setShiftX] = useState(0);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const show = () => {
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

  return (
    <>
      <span
        ref={triggerRef}
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={`inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 ${className}`}
      >
        {children}
      </span>
      {anchor && createPortal(
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
      )}
    </>
  );
}
