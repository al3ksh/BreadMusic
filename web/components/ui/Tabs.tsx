'use client';

import { cn } from '@/lib/utils';

interface TabsProps {
  tabs: { id: string; label: string; icon?: React.ReactNode }[];
  active: string;
  onChange: (id: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px cursor-pointer',
            active === tab.id
              ? 'text-accent border-accent'
              : 'text-text-secondary border-transparent hover:text-text-primary',
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
