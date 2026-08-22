export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-bg-primary px-4 sm:px-6 py-10">
      <div className="max-w-3xl mx-auto rounded-xl border border-border bg-bg-card p-6 sm:p-8">
        <p className="text-xs uppercase tracking-wider text-text-muted">Legal</p>
        <h1 className="text-2xl font-bold mt-2 text-text-primary">Privacy Policy</h1>
        <p className="text-sm text-text-secondary mt-2">Last updated: 2026-08-17</p>

        <div className="mt-6 space-y-5 text-sm text-text-secondary leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-text-primary">Who operates Bread</h2>
            <p className="mt-2">
              Bread is an independently operated Discord bot and dashboard maintained by aleksh.
              For privacy requests, contact <span className="font-mono text-text-primary">aleksh8</span> on Discord.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary">Data we process</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>Discord OAuth data: user ID, username, display name, avatar, server list, server permissions, and OAuth tokens.</li>
              <li>Discord server, channel, role, and member identifiers needed for features and access control.</li>
              <li>Track, requester, queue, history, autoplay, and server music configuration data.</li>
              <li>Economy balances and cooldown timestamps associated with Discord user IDs.</li>
              <li>Uploaded audio files, original filenames, and technical metadata.</li>
              <li>Messages and attachments briefly fetched for live chat, plus Remote Control content sent to Discord.</li>
              <li>Direct messages sent to Bread, used only to return the automated help response.</li>
              <li>Request, error, and security logs that may include timestamps, routes, and IP addresses.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary">Why we process it</h2>
            <p className="mt-2">
              We process data to authenticate users, enforce permissions, provide the requested bot and dashboard
              features, maintain security, diagnose failures, and prevent abuse. Processing is necessary to provide
              the service and for the legitimate interests of operating and securing Bread.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary">Storage and retention</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>Dashboard sessions expire after 7 days and are removed on logout.</li>
              <li>Uploaded audio is deleted after approximately 24 hours without use.</li>
              <li>Detailed playback history is retained for up to 35 days, subject to per-server limits.</li>
              <li>Lyrics results are cached in memory for up to 6 hours.</li>
              <li>Live chat data is cached briefly in memory and is not stored as a permanent chat archive.</li>
              <li>
                Server settings, persistent queues, economy balances, and limited playback statistics remain
                until reset, deleted on request, or removed with the service data.
              </li>
              <li>Operational logs are kept only as long as reasonably needed for security and troubleshooting.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary">Third-party services</h2>
            <p className="mt-2">
              Bread communicates with Discord for authentication and bot functionality, LRCLIB for lyrics,
              Google Gemini for optional autoplay discovery and ranking, and configured providers such as YouTube,
              Spotify, SoundCloud, and Bandcamp for search and playback.
              For Gemini autoplay, Bread sends music metadata such as the title, artist and source context, not
              Discord IDs or usernames. These providers receive the requests and connection data needed to answer
              them and process data under their own privacy terms. Hosting and reverse-proxy providers may also
              process network and operational data.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary">Sharing and automated decisions</h2>
            <p className="mt-2">
              We do not sell personal data or use it for advertising. Data is shared only with providers needed
              to operate Bread, when an authorized server user invokes a feature, or when required by law. Gemini
              produces music suggestions and rankings only; it does not make decisions about users or access.
              Bread does not make decisions that produce legal or similarly significant effects.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary">Your choices and rights</h2>
            <p className="mt-2">
              You may log out to delete the current dashboard session and stop using the bot at any time.
              Depending on applicable law, you may request access, correction, deletion, restriction, or a copy
              of your personal data, and object to processing based on legitimate interests. Contact
              <span className="font-mono text-text-primary"> aleksh8</span> on Discord with your user ID and the
              relevant server ID. You may also complain to your local data protection authority.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary">Security and changes</h2>
            <p className="mt-2">
              Bread uses permission checks, protected session cookies, OAuth state validation, request origin checks,
              and restricted local storage. No system is completely secure. This policy may change when features or
              data practices change; the date above identifies the current version.
            </p>
          </section>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
          <a href="/cookies" className="underline text-text-secondary hover:text-text-primary transition-colors">Cookies Policy</a>
          <span className="text-text-muted">•</span>
          <a href="/terms" className="underline text-text-secondary hover:text-text-primary transition-colors">Terms of Use</a>
          <span className="text-text-muted">•</span>
          <a href="/" className="underline text-text-secondary hover:text-text-primary transition-colors">Back to home</a>
        </div>
      </div>
    </main>
  );
}
