import type { ReactNode } from 'react';

export type DesktopGridColumns = '2' | '3' | '4';

type ResponsiveCardGridProps = {
  children: ReactNode;
  columns?: DesktopGridColumns;
  className?: string;
};

const desktopColumnClasses: Record<DesktopGridColumns, string> = {
  '2': 'lg:grid-cols-2',
  '3': 'lg:grid-cols-3',
  '4': 'lg:grid-cols-4',
};

/** A one-column mobile card list that opts into a configurable desktop grid. */
export function ResponsiveCardGrid({
  children,
  columns = '3',
  className = '',
}: ResponsiveCardGridProps) {
  return (
    <div className={`grid grid-cols-1 gap-4 ${desktopColumnClasses[columns]} ${className}`.trim()}>
      {children}
    </div>
  );
}
