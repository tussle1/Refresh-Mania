export function BootScreen({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="boot" role="status">
      <div className="boot-card">
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
    </div>
  );
}
