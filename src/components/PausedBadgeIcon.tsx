export default function PausedBadgeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#E5E7EB" stroke="#F59E0B" strokeWidth="3" />
      <rect x="8.5" y="7.5" width="2.8" height="9" rx="1" fill="#1F2937" />
      <rect x="12.7" y="7.5" width="2.8" height="9" rx="1" fill="#1F2937" />
    </svg>
  );
}
