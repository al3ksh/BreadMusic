'use client';

import type { ReactNode } from 'react';

export function Spinner() {
  return <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-border/50 rounded-md ${className || ''}`} />;
}

export function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-bg-card rounded-lg border border-border overflow-hidden ${className || ''}`}>
      <div className="bg-bg-secondary px-4 py-3 border-b border-border sm:px-5 sm:py-3.5">
        <h3 className="text-[15px] font-medium flex items-center gap-2">{title}</h3>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

export function Row({ label, desc, children }: { label: string; desc?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-stretch justify-between gap-3 py-3 border-b border-border/50 last:border-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {desc && <p className="text-xs text-text-secondary mt-0.5">{desc}</p>}
      </div>
      <div className="w-full sm:w-auto sm:shrink-0">{children}</div>
    </div>
  );
}

export function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${checked ? 'bg-accent' : 'bg-border'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

export function CtrlBtn({ onClick, title, primary, badge, disabled, children }: {
  onClick: () => void;
  title: string;
  primary?: boolean;
  badge?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-all ${
        disabled
          ? 'opacity-35 cursor-not-allowed'
          : primary
            ? 'bg-accent text-white hover:bg-accent-hover shadow-lg shadow-accent/30 cursor-pointer'
            : 'bg-bg-hover text-text-secondary hover:bg-border hover:text-text-primary border border-border cursor-pointer'
      }`}
    >
      {children}
      {badge && (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent text-[9px] text-white flex items-center justify-center font-bold leading-none">
          {badge}
        </span>
      )}
    </button>
  );
}
