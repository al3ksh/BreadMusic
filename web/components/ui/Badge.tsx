import { cn } from '@/lib/utils';

interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'danger';
  className?: string;
  children: React.ReactNode;
}

export function Badge({ variant = 'default', className, children }: BadgeProps) {
  const variants = {
    default: 'bg-bg-hover text-text-secondary',
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/15 text-warning',
    danger: 'bg-danger/15 text-danger',
  };

  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', variants[variant], className)}>
      {children}
    </span>
  );
}
