import type { ReactNode } from 'react';

export function BootScreen({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="boot" role="status">
      <div className="boot-card">
        <h1>{title}</h1>
        <p>{detail}</p>
        {action}
      </div>
    </div>
  );
}
