import { cn } from '@/lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  href?: string;
}

export function Button({
  variant = 'primary',
  size = 'md',
  href,
  className,
  children,
  ...props
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center font-medium rounded-md transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    primary: 'bg-accent text-white hover:bg-accent-hover shadow-lg shadow-accent/20',
    secondary: 'bg-bg-secondary text-text-primary border border-border hover:bg-bg-hover hover:border-accent/30',
    ghost: 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
    danger: 'bg-danger text-white hover:bg-danger/90',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm gap-1.5',
    md: 'px-5 py-2.5 text-sm gap-2',
    lg: 'px-7 py-3 text-base gap-2.5',
  };

  if (href) {
    return (
      <a
        href={href}
        className={cn(base, variants[variant], sizes[size], className)}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  );
}
