import {
  Download,
  FileDown,
  Printer,
} from 'lucide-react';
import type {
  RefObject,
} from 'react';
import type {
  ReportColumn,
} from './types';
import { downloadCsvFile, printReportElement } from '@/services/platform/webReportFiles';

type ReportActionsProps<Row> = {
  title: string;
  contentRef: RefObject<HTMLElement>;
  rows: Row[];
  columns: ReportColumn<Row>[];
  disabled?: boolean;
  primaryPdf?: boolean;
};

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function ReportActions<Row>({
  title,
  contentRef,
  rows,
  columns,
  disabled = false,
  primaryPdf = false,
}: ReportActionsProps<Row>) {
  const unavailable = disabled || rows.length === 0;

  function openPrint() {
    if (contentRef.current) printReportElement(contentRef.current, title);
  }

  function exportCsv() {
    const csv = [
      columns.map((column) => csvCell(column.label)).join(','),
      ...rows.map((row) => columns.map((column) => csvCell(column.csvValue?.(row))).join(',')),
    ].join('\n');
    downloadCsvFile(csv, `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'gridvision-report'}.csv`);
  }

  return <div className="flex flex-wrap gap-2" data-report-exclude>
    <button type="button" onClick={openPrint} disabled={unavailable} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"><Printer className="h-4 w-4" />Print</button>
    <button type="button" onClick={openPrint} disabled={unavailable} className={`inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${primaryPdf ? 'lg:border-blue-700 lg:bg-blue-700 lg:text-white lg:hover:bg-blue-800' : ''}`}>{primaryPdf ? <><Printer className="h-4 w-4 lg:hidden" /><FileDown className="hidden h-4 w-4 lg:block" /><span className="lg:hidden">Save as PDF</span><span className="hidden lg:inline">Download PDF</span></> : <><Printer className="h-4 w-4" />Save as PDF</>}</button>
    <button type="button" onClick={exportCsv} disabled={unavailable} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-4 w-4" />CSV</button>
  </div>;
}
