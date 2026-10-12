export interface Toast {
  id: string;
  message: string;
  kind: 'info' | 'success' | 'warn' | 'error';
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast toast-${t.kind}`} onClick={() => onDismiss(t.id)}>
          {t.message}
        </button>
      ))}
    </div>
  );
}
