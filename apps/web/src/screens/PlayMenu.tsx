import { useEffect } from 'react';
import { useApp } from '../app/AppContext';

export function PlayMenu() {
  const { go, back, updateSettings, connection, connectionDetail, settings } = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') back();
      if (e.key.toLowerCase() === 's') choose('solo');
      if (e.key.toLowerCase() === 'm') choose('multiplayer');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  const choose = (mode: 'solo' | 'multiplayer') => {
    if (mode === 'solo') {
      void updateSettings({ selectedMode: 'solo' });
      go({ name: 'select' });
    } else {
      void updateSettings({ selectedMode: 'multiplayer' });
    }
  };

  const mpAvailable = connection === 'online';

  return (
    <section className="play-menu" aria-labelledby="play-title">
      <h1 id="play-title">Play</h1>
      <div className="play-cards">
        <button className="card play-card" onClick={() => choose('solo')} aria-keyshortcuts="S">
          <span className="card-kicker">S</span>
          <span className="card-title">Solo</span>
          <span className="card-body">
            Choose a beatmap from your local library and play osu!standard. Scores and replays are saved on this device.
          </span>
          {settings.selectedMode === 'solo' && <span className="chip">Last used</span>}
        </button>
        <button className="card play-card" onClick={() => choose('multiplayer')} disabled={!mpAvailable} aria-keyshortcuts="M" aria-describedby="mp-note">
          <span className="card-kicker">M</span>
          <span className="card-title">Multiplayer</span>
          <span className="card-body">Real-time rooms over WebSockets, with a server-authoritative match.</span>
          {!mpAvailable && <span className="chip warn">Unavailable offline</span>}
        </button>
        <button className="card play-card" onClick={back} aria-keyshortcuts="Escape">
          <span className="card-kicker">Esc</span>
          <span className="card-title">Back</span>
          <span className="card-body">Return to the title screen.</span>
        </button>
      </div>
      <p id="mp-note" className="note">
        {mpAvailable
          ? 'Connected to the server. Multiplayer rooms are listed in the lobby.'
          : `Multiplayer is off. ${connectionDetail} Solo play works without an account or a connection.`}
      </p>
    </section>
  );
}
