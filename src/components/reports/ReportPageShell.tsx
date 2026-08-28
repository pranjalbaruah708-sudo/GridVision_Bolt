import type {
  ReactNode,
  RefObject,
} from 'react';
import {
  AppHeader,
  PageBody,
  Screen,
} from '@/components/ui/Page';

type ReportPageShellProps = {
  title: string;
  subtitle?: string;
  onBack: () => void;
  actions?: ReactNode;
  filters: ReactNode;
  contentRef: RefObject<HTMLDivElement>;
  children: ReactNode;
};

export function ReportPageShell({
  title,
  subtitle,
  onBack,
  actions,
  filters,
  contentRef,
  children,
}: ReportPageShellProps) {
  return (
    <Screen>
      <AppHeader title={title} subtitle={subtitle} onBack={onBack} right={actions} />
      <PageBody>
        <div className="space-y-4">
          {filters}
          <div ref={contentRef} className="rounded-2xl bg-white p-4 shadow-sm">
            {children}
          </div>
        </div>
      </PageBody>
    </Screen>
  );
}
