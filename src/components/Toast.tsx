import { useEffect } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

interface Props {
  message: string;
  kind?: ToastKind;
  onClose: () => void;
  duration?: number;
}

const styles: Record<ToastKind, string> = {
  success: 'bg-emerald-600 text-white',
  error: 'bg-rose-600 text-white',
  info: 'bg-slate-800 text-white',
};

export default function Toast({ message, kind = 'info', onClose, duration = 3500 }: Props) {
  useEffect(() => {
    const id = setTimeout(onClose, duration);
    return () => clearTimeout(id);
  }, [onClose, duration]);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className={`rounded-md px-4 py-2 text-sm shadow-lg ${styles[kind]}`}>
        {message}
      </div>
    </div>
  );
}
