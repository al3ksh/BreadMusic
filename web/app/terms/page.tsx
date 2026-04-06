export default function TermsPage() {
  return (
    <main className="min-h-screen bg-bg-primary px-4 sm:px-6 py-10">
      <div className="max-w-3xl mx-auto rounded-xl border border-border bg-bg-card p-6 sm:p-8">
        <p className="text-xs uppercase tracking-wider text-text-muted">Legal</p>
        <h1 className="text-2xl font-bold mt-2 text-text-primary">Terms of Use</h1>
        <p className="text-sm text-text-secondary mt-2">Last updated: 2026-04-06</p>

        <div className="mt-6 space-y-5 text-sm text-text-secondary leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-text-primary">Service scope</h2>
            <p className="mt-2">
              Bread is a Discord music bot with a web dashboard for server administrators.
              Features are provided "as is" and may change over time.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary">Account and permissions</h2>
            <p className="mt-2">
              Dashboard access uses Discord OAuth and requires server permissions (for example, Manage Guild) where applicable.
              You are responsible for actions performed from your Discord account.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary">Acceptable use</h2>
            <p className="mt-2">
              You agree not to abuse the service, bypass platform rules, or use Bread for malicious activity.
              You are responsible for content you request to play in Discord servers.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary">Availability and liability</h2>
            <p className="mt-2">
              We do not guarantee uninterrupted availability.
              To the maximum extent permitted by law, Bread maintainers are not liable for downtime, data loss, or indirect damages related to use of the bot.
            </p>
          </section>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
          <a href="/cookies" className="underline text-text-secondary hover:text-text-primary transition-colors">
            Read Cookies Policy
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
