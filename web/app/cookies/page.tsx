export default function CookiesPage() {
  return (
    <main className="min-h-screen bg-bg-primary px-4 sm:px-6 py-10">
      <div className="max-w-3xl mx-auto rounded-xl border border-border bg-bg-card p-6 sm:p-8">
        <p className="text-xs uppercase tracking-wider text-text-muted">Legal</p>
        <h1 className="text-2xl font-bold mt-2 text-text-primary">Cookies Policy</h1>
        <p className="text-sm text-text-secondary mt-2">Last updated: 2026-04-06</p>

        <div className="mt-6 space-y-5 text-sm text-text-secondary leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-text-primary">What we use cookies for</h2>
            <p className="mt-2">
              Bread uses essential cookies only to keep you logged in and secure the dashboard session.
              We do not use advertising cookies or third-party marketing trackers.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary">Essential cookie</h2>
            <p className="mt-2">
              Cookie name: <span className="font-mono text-text-primary">bread.sid</span>.
              This session cookie is created by the API server (`express-session`) and is required for Discord authentication and access to protected dashboard routes.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary">Storage outside cookies</h2>
            <p className="mt-2">
              We may use browser local storage for UI preferences, such as hiding cookie notices.
              This does not contain Discord OAuth secrets.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary">How to control cookies</h2>
            <p className="mt-2">
              You can clear browser cookies at any time in browser settings.
              Removing essential cookies will sign you out from the dashboard.
            </p>
          </section>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
          <a href="/terms" className="underline text-text-secondary hover:text-text-primary transition-colors">
            Read Terms of Use
          </a>
          <span className="text-text-muted">•</span>
          <a href="/" className="underline text-text-secondary hover:text-text-primary transition-colors">
            Back to home
          </a>
        </div>
      </div>
    </main>
  );
}
