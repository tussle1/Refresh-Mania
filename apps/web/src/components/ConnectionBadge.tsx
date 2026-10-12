import type { ConnectionState } from '../app/AppContext';

const LABEL: Record<ConnectionState, string> = {
  checking: 'Checking…',
  offline: 'Offline',
  online: 'Online',
};

export function ConnectionBadge({ state, detail, onReconnect }: { state: ConnectionState; detail: string; onReconnect: () => void }) {
  return (
    <div className={`conn conn-${state}`} title={detail}>
      <span className="dot" aria-hidden="true" />
      <span className="conn-label">{LABEL[state]}</span>
      {state !== 'online' && state !== 'checking' && (
        <button className="link small" onClick={onReconnect} aria-label="Retry connection">
          Reconnect
        </button>
      )}
      <span className="sr-only">{detail}</span>
    </div>
  );
}
