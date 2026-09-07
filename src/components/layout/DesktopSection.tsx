import type { ReactNode } from 'react';

export type DesktopSectionSpacing = 'compact' | 'standard' | 'relaxed';

type DesktopSectionProps = {
  children: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  spacing?: DesktopSectionSpacing;
  className?: string;
};

const spacingClasses: Record<DesktopSectionSpacing, string> = {
  compact: 'lg:space-y-3',
  standard: 'lg:space-y-5',
  relaxed: 'lg:space-y-8',
};

/**
 * Groups related content with desktop-only vertical rhythm. The optional
 * heading row is rendered only when a title or action is explicitly supplied.
 */
export function DesktopSection({
  children,
  title,
  actions,
  spacing = 'standard',
  className = '',
}: DesktopSectionProps) {
  const hasHeading = title !== undefined || actions !== undefined;

  return (
    <section className={`contents lg:block ${spacingClasses[spacing]} ${className}`.trim()}>
      {hasHeading && (
        <div className="flex items-center justify-between gap-4">
          {title !== undefined && <h2 className="text-base font-bold text-slate-900 lg:text-lg">{title}</h2>}
          {actions !== undefined && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
