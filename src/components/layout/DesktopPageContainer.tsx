import type { ReactNode } from 'react';

export type DesktopPageWidth = 'standard' | 'wide' | 'full';

type DesktopPageContainerProps = {
  children: ReactNode;
  width?: DesktopPageWidth;
  className?: string;
};

const widthClasses: Record<DesktopPageWidth, string> = {
  standard: 'lg:max-w-5xl',
  wide: 'lg:max-w-7xl',
  full: 'lg:max-w-none',
};

/**
 * An opt-in desktop content boundary. `contents` keeps the wrapper from
 * participating in mobile layout; width and gutters begin at `lg`.
 */
export function DesktopPageContainer({
  children,
  width = 'standard',
  className = '',
}: DesktopPageContainerProps) {
  return (
    <div
      className={`contents lg:mx-auto lg:block lg:w-full lg:px-6 xl:px-8 ${widthClasses[width]} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
