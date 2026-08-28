import {
  ReportHeader,
} from './ReportHeader';
import {
  ReportSummaryCards,
} from './ReportSummaryCards';
import {
  ReportTable,
} from './ReportTable';
import {
  ReportEmptyState,
  ReportErrorState,
  ReportLoadingState,
} from './ReportStates';
import type {
  ReportColumn,
  ReportPreviewMeta,
  ReportResource,
  ReportSummaryCard,
} from './types';

type ReportPreviewProps<Row> = {
  meta: ReportPreviewMeta;
  summaryCards: ReportSummaryCard[];
  resource: ReportResource<Row>;
  columns: ReportColumn<Row>[];
  rowKey: (row: Row, index: number) => string;
  onRetry?: () => void;
  pageSize?: number;
  pagination?: {
    page: number;
    pageSize: number;
    totalRows: number;
    onPageChange: (page: number) => void;
  };
};

export function ReportPreview<Row>({
  meta,
  summaryCards,
  resource,
  columns,
  rowKey,
  onRetry,
  pageSize,
  pagination,
}: ReportPreviewProps<Row>) {
  const hasRows = resource.rows.length > 0;

  if (resource.loading && !hasRows) return <ReportLoadingState />;
  if (resource.error && !hasRows) return <ReportErrorState message={resource.error} onRetry={onRetry} />;
  return (
    <div className={`space-y-4 transition-opacity ${resource.loading ? 'opacity-75' : ''}`} aria-busy={resource.loading}>
      <ReportHeader meta={meta} />
      <ReportSummaryCards cards={summaryCards} />
      {resource.error && <div className="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"><span>Could not refresh. Showing the last valid report.</span>{onRetry && <button type="button" onClick={onRetry} className="shrink-0 underline">Retry</button>}</div>}
      {hasRows
        ? <ReportTable rows={resource.rows} columns={columns} rowKey={rowKey} pageSize={pageSize} pagination={pagination} />
        : <ReportEmptyState />}
    </div>
  );
}
