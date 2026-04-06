export default function NotFoundPage() {
  return (
    <main className="min-h-screen bg-bg-primary px-6 py-16 flex items-center justify-center">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-bg-card p-8 text-center shadow-xl">
        <p className="text-xs uppercase tracking-wider text-text-muted">404</p>
        <h1 className="text-3xl font-bold mt-2 text-text-primary">Page not found</h1>
        <p className="text-sm text-text-secondary mt-3 leading-relaxed">
          The page you are trying to open does not exist or has been moved.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover transition-colors"
          >
            Go to home
          </a>
          <a
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            Open dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
