import { useEffect } from 'react';
import { useApp } from '../app/AppContext';

const ROWS: [string, string][] = [
  ['?', 'Show or hide this reference (outside gameplay)'],
  ['P', 'Title: open Play menu'],
  ['O', 'Title: open Options'],
  ['Enter / P', 'Play menu: Solo  ·  Song select: start the selected difficulty'],
  ['Esc', 'Go back one screen · pause during gameplay'],
  ['Up / Down', 'Song select: move between sets (expand a set with Enter)'],
  ['Left / Right', 'Song select: move between difficulties of the open set'],
  ['Ctrl+F or /', 'Song select: focus search (type `ar>9 creator=name` for field filters)'],
  ['M', 'Song select: toggle mods overlay'],
  ['F', 'Song select: favorite / unfavorite the open set'],
  ['Del', 'Song select: delete the selected set (asks for confirmation)'],
  ['Z / X', 'Gameplay: default hit keys (K1 / K2), change under Options › Input'],
  ['Mouse L / R', 'Gameplay: also hit (left / right button)'],
  ['R', 'Pause menu: restart the play'],
  ['Space', 'Replay: pause / resume playback'],
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  useApp();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="panel modal" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <table className="shortcuts">
          <tbody>
            {ROWS.map(([k, v]) => (
              <tr key={k}>
                <th scope="row">
                  <kbd>{k}</kbd>
                </th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Shortcuts are disabled while typing in a text field. Gameplay keys are never captured by menus.</p>
        <button className="primary" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </div>
  );
}
