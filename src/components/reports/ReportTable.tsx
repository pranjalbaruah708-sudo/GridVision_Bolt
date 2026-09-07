import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  ReportColumn,
} from './types';

type ReportTableProps<Row> = {
  rows: Row[];
  columns: ReportColumn<Row>[];
  rowKey: (row: Row, index: number) => string;
  pageSize?: number;
  pagination?: {
    page: number;
    pageSize: number;
    totalRows: number;
    onPageChange: (page: number) => void;
  };
  desktop?: boolean;
};

export function ReportTable<Row>({
  rows,
  columns,
  rowKey,
  pageSize = 25,
  pagination,
  desktop = false,
}: ReportTableProps<Row>) {
  const [page, setPage] = useState(0);
  const localTotalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = useMemo(
    () => pagination ? rows : rows.slice(page * pageSize, (page + 1) * pageSize),
    [page, pageSize, pagination, rows]
  );
  const currentPage = pagination?.page ?? page;
  const totalPages = pagination
    ? Math.max(1, Math.ceil(pagination.totalRows / pagination.pageSize))
    : localTotalPages;

  useEffect(() => {
    if (!pagination) setPage((current) => Math.min(current, totalPages - 1));
  }, [pagination, totalPages]);

  const changePage = (nextPage: number) => {
    if (pagination) pagination.onPageChange(nextPage);
    else setPage(nextPage);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className={`w-full min-w-[560px] text-left text-xs ${desktop ? 'lg:min-w-[1480px]' : ''}`}>
          <thead className={`bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 ${desktop ? 'lg:sticky lg:top-0 lg:z-10' : ''}`}>
            <tr>
              {columns.map((column) => <th key={column.id} className={`px-3 py-2.5 font-bold ${desktop ? 'lg:whitespace-nowrap lg:px-4 lg:py-3' : ''} ${column.align === 'right' ? 'text-right' : 'text-left'} ${column.className ?? ''}`}>{column.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.map((row, index) => <tr key={rowKey(row, (pagination ? currentPage * pagination.pageSize : page * pageSize) + index)} className="hover:bg-blue-50/40">
              {columns.map((column) => <td key={column.id} className={`px-3 py-2.5 text-slate-700 ${desktop ? 'lg:px-4 lg:py-3' : ''} ${column.align === 'right' ? 'text-right' : 'text-left'} ${column.className ?? ''}`}>{column.value(row)}</td>)}
            </tr>)}
          </tbody>
        </table>
      </div>

      {(pagination ? pagination.totalRows > pagination.pageSize : rows.length > pageSize) && <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2" data-report-exclude>
        <p className="text-[11px] text-slate-500">Page {currentPage + 1} of {totalPages}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => changePage(Math.max(0, currentPage - 1))} disabled={currentPage === 0} className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 disabled:opacity-40">Previous</button>
          <button type="button" onClick={() => changePage(Math.min(totalPages - 1, currentPage + 1))} disabled={currentPage >= totalPages - 1} className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 disabled:opacity-40">Next</button>
        </div>
      </div>}
    </section>
  );
}
