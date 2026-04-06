import { Music, Sliders, Gamepad2, Settings, Headphones, Users, Shuffle, Zap } from 'lucide-react';

const features = [
  {
    icon: <Music size={22} />,
    title: 'Music Playback',
    description: 'YouTube, SoundCloud, Spotify. Queue management, autoplay, and seamless playback.',
  },
  {
    icon: <Sliders size={22} />,
    title: 'Audio Filters',
    description: 'Bass boost, nightcore, vaporwave, karaoke, 8D audio, and more presets.',
  },
  {
    icon: <Gamepad2 size={22} />,
    title: 'Games & Economy',
    description: 'Blackjack, slots, roulette, coinflip. Earn bread, compete on leaderboards.',
  },
  {
    icon: <Headphones size={22} />,
    title: 'Web Player',
    description: 'Control playback, browse queue, and search tracks right from your browser.',
  },
  {
    icon: <Users size={22} />,
    title: 'Per-Server Config',
    description: 'DJ roles, volume limits, 24/7 mode, AFK timeouts — each server, your rules.',
  },
  {
    icon: <Shuffle size={22} />,
    title: 'Smart Queue',
    description: 'Drag tracks, remove ranges, skip to position, save queue between restarts.',
  },
  {
    icon: <Zap size={22} />,
    title: 'Vote to Skip',
    description: 'Configurable vote threshold so the group decides what plays next.',
  },
  {
    icon: <Settings size={22} />,
    title: 'Full Dashboard',
    description: 'Manage everything from the web. No need to touch Discord commands.',
  },
];

export function Features() {
  return (
    <section className="relative w-full py-24 px-4 sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-accent-soft/30 to-transparent pointer-events-none" />

      <div className="relative max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Packed with <span className="gradient-text">features</span>
          </h2>
          <p className="text-text-secondary max-w-lg mx-auto">
            Everything you need for the perfect music experience on your server.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {features.map((feature, i) => (
            <div
              key={feature.title}
              className="group relative p-6 rounded-lg bg-bg-card border border-border hover:border-accent/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              style={{
                animationDelay: `${i * 50}ms`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              }}
            >
              <div className="w-11 h-11 rounded-lg bg-accent/10 text-accent flex items-center justify-center mb-4 group-hover:bg-accent/20 transition-colors">
                {feature.icon}
              </div>
              <h3 className="text-base font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
