import { cn } from '@/lib/utils';

interface CardProps {
  className?: string;
  children: React.ReactNode;
}

export function Card({ className, children }: CardProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-bg-card', className)}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: CardProps) {
  return (
    <div className={cn('bg-bg-secondary px-5 py-3.5 border-b border-border', className)}>
      {children}
    </div>
  );
}

export function CardBody({ className, children }: CardProps) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

export function CardTitle({ className, children }: CardProps) {
  return <h3 className={cn('text-[15px] font-medium', className)}>{children}</h3>;
}
