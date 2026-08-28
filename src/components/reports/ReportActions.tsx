import {
  Download,
  Printer,
} from 'lucide-react';
import type {
  RefObject,
} from 'react';
import type {
  ReportColumn,
} from './types';

type ReportActionsProps<Row> = {
  title: string;
  contentRef: RefObject<HTMLElement>;
  rows: Row[];
  columns: ReportColumn<Row>[];
  disabled?: boolean;
};

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function printReport(content: HTMLElement, title: string): void {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  const clone = content.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-report-exclude], button, input, select, textarea').forEach((element) => element.remove());
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((element) => element.outerHTML).join('');
  printWindow.document.write(`<!doctype html><html><head><title>${title}</title>${styles}<style>@page{margin:14mm}body{margin:0;background:#fff;color:#0f172a;font-family:Arial,sans-serif}button,input,select,textarea,[data-report-exclude]{display:none!important}table{width:100%;border-collapse:collapse}th,td{border:1px solid #e2e8f0;padding:6px;text-align:left}</style></head><body><main>${clone.outerHTML}</main></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 250);
}

export function ReportActions<Row>({
  title,
  contentRef,
  rows,
  columns,
  disabled = false,
}: ReportActionsProps<Row>) {
  const unavailable = disabled || rows.length === 0;

  function openPrint() {
    if (contentRef.current) printReport(contentRef.current, title);
  }

  function exportCsv() {
    const csv = [
      columns.map((column) => csvCell(column.label)).join(','),
      ...rows.map((row) => columns.map((column) => csvCell(column.csvValue?.(row))).join(',')),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'gridvision-report'}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="flex flex-wrap gap-2" data-report-exclude>
    <button type="button" onClick={openPrint} disabled={unavailable} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"><Printer className="h-4 w-4" />Print</button>
    <button type="button" onClick={openPrint} disabled={unavailable} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"><Printer className="h-4 w-4" />Save as PDF</button>
    <button type="button" onClick={exportCsv} disabled={unavailable} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-4 w-4" />CSV</button>
  </div>;
}
