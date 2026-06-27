const readinessItems = [
  {
    label: "Workspace",
    value: "pnpm monorepo"
  },
  {
    label: "Runtime",
    value: "Node 22 / pnpm 9.15"
  },
  {
    label: "App Router",
    value: "enabled"
  }
];

export function WebConsoleInitView() {
  return (
    <main className="init-shell">
      <section className="init-panel" aria-labelledby="init-title">
        <div>
          <p className="init-label">GateLM</p>
          <h1 id="init-title">Web Console</h1>
          <p className="init-copy">
            Product experience and customer demo workspace for the v1.0.0
            gateway baseline.
          </p>
        </div>

        <dl className="readiness-grid" aria-label="Web console setup status">
          {readinessItems.map((item) => (
            <div className="readiness-item" key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
