'use client';

import { Sidebar, useAuth } from '@/components/dashboard/Sidebar';
import { ArrowLeft } from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-text-muted">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center gap-6 px-6 bg-bg-primary">
        <a
          href="/"
          className="absolute left-4 top-4 sm:left-6 sm:top-6 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer px-4 py-2 rounded-lg border border-border hover:bg-bg-hover"
        >
          <ArrowLeft size={14} />
          Back
        </a>
        <img src="/assets/breadicon.png?v=3" alt="" className="w-24 h-24 sm:w-32 sm:h-32 rounded-2xl shadow-2xl shadow-accent/20 animate-float object-cover" />
        <div className="text-center">
          <h2 className="text-xl font-bold mb-2">Login Required</h2>
          <p className="text-text-secondary text-sm mb-6">
            You need to login with Discord to access the dashboard.
          </p>
          <a
            href="/api/auth/discord"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-accent text-white font-semibold hover:bg-accent-hover transition-all shadow-lg shadow-accent/25"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286z"/>
            </svg>
            Login with Discord
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <Sidebar user={user} onLogout={logout} />
      <main className="md:ml-[260px] min-h-screen">
        <div className="p-5 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
