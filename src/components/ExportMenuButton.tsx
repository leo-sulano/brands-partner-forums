import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { buildCsv, buildWorkbook, downloadFile } from '../lib/exportFile';

interface Props {
  headers: string[];
  getRows: () => string[][];
  filenameBase: string;
  disabled?: boolean;
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function ExportMenuButton({ headers, getRows, filenameBase, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Portaled to document.body (see below) so the menu floats above any
  // scroll container instead of being clipped by one — same pattern as
  // SelectDropdown.tsx, whose position-tracking comment explains this in
  // more detail.
  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) setMenuRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  function exportCsv() {
    const rows = getRows();
    downloadFile(`${filenameBase}-${todayStamp()}.csv`, buildCsv(headers, rows), 'text/csv;charset=utf-8;');
    setOpen(false);
  }

  function exportXlsx() {
    const rows = getRows();
    downloadFile(
      `${filenameBase}-${todayStamp()}.xlsx`,
      buildWorkbook(filenameBase, headers, rows),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download className="size-4" />
        Export
      </button>

      {open && menuRect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
          style={{ top: menuRect.top, left: menuRect.left, width: Math.max(menuRect.width, 190) }}
        >
          <button
            type="button"
            onClick={exportCsv}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-600 transition-colors hover:bg-blue-50"
          >
            <FileText className="size-3.5" />
            Export as CSV
          </button>
          <button
            type="button"
            onClick={exportXlsx}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-600 transition-colors hover:bg-blue-50"
          >
            <FileSpreadsheet className="size-3.5" />
            Export as Excel (.xlsx)
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
