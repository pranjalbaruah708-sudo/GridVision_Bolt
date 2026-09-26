import {
  Download,
  FileDown,
  Printer,
} from 'lucide-react';
import type {
  RefObject,
} from 'react';
import { useState } from 'react';
import type {
  ReportColumn,
} from './types';
import { downloadCsvFile, openReportPrintWindow, printReportElement } from '@/services/platform/webReportFiles';
import { isNativeApp } from '@/services/platform/runtime';
import { exportTableToPdf } from '@/utils/pdfExport';

const LARGE_PRINT_ROW_COUNT = 1000;

type ReportActionsProps<Row> = {
  title: string;
  contentRef: RefObject<HTMLElement>;
  rows: Row[];
  columns: ReportColumn<Row>[];
  disabled?: boolean;
  primaryPdf?: boolean;
  showPdfLabel?: boolean;
  totalRows?: number;
  loadAllRows?: () => Promise<Row[]>;
};

export async function loadAllReportRows<Row>(
  totalRows: number,
  fetchPage: (page: number, pageSize: number) => Promise<{ rows: Row[]; total: number }>,
): Promise<Row[]> {
  if (totalRows <= 0) return [];
  const pageSize = 200;
  const rows: Row[] = [];
  for (let page = 0; rows.length < totalRows; page += 1) {
    const result = await fetchPage(page, pageSize);
    rows.push(...result.rows);
    if (result.rows.length === 0 || rows.length >= result.total) break;
  }
  if (rows.length !== totalRows) {
    throw new Error(`The report changed while it was being exported (expected ${totalRows} records, received ${rows.length}). Please generate it again.`);
  }
  return rows;
}

function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  // Spreadsheet applications can execute cells beginning with formula control
  // characters. Preserve numeric values, but neutralize untrusted text fields.
  const text = typeof value === 'string' && /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replace(/"/g, '""')}"`;
}

function printableColumnWidths<Row>(rows: Row[], columns: ReportColumn<Row>[]): number[] {
  const sampleLimit = Math.min(rows.length, 500);
  const weights = columns.map((column) => {
    let longest = column.label.length;
    for (let index = 0; index < sampleLimit; index += 1) {
      const value = column.csvValue?.(rows[index]);
      if (value !== null && value !== undefined) longest = Math.max(longest, String(value).length);
    }

    const id = column.id.toLowerCase();
    if (column.align === 'right') return Math.max(5, Math.min(10, longest * 0.55));
    if (/remarks|message|details|description/.test(id)) return Math.max(14, Math.min(26, longest * 0.65));
    if (/time|date|created|updated|start|end|etr/.test(id)) return Math.max(11, Math.min(17, longest * 0.7));
    if (/station|feeder|operator|entity|source/.test(id)) return Math.max(10, Math.min(18, longest * 0.7));
    if (/status|state|breach|weather|cause/.test(id)) return Math.max(7, Math.min(13, longest * 0.65));
    return Math.max(7, Math.min(15, longest * 0.65));
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => Number(((weight / totalWeight) * 100).toFixed(3)));
}

export function ReportActions<Row>({
  title,
  contentRef,
  rows,
  columns,
  disabled = false,
  primaryPdf = false,
  showPdfLabel = false,
  totalRows = rows.length,
  loadAllRows,
}: ReportActionsProps<Row>) {
  const [exporting, setExporting] = useState(false);
  const unavailable = disabled || exporting || totalRows === 0;

  async function resolveRows(): Promise<Row[]> {
    if (!loadAllRows || totalRows === rows.length) return rows;
    return loadAllRows();
  }

  function reportCell(row: Row, column: ReportColumn<Row>): string {
    const value = column.csvValue?.(row);
    return value === null || value === undefined ? '' : String(value);
  }

  async function openPrint() {
    if (!contentRef.current || unavailable) return;
    if (totalRows > LARGE_PRINT_ROW_COUNT && !window.confirm(`This report contains ${totalRows.toLocaleString('en-IN')} records and may create a very large PDF. Continue?`)) return;
    if (isNativeApp()) {
      setExporting(true);
      try {
        const allRows = await resolveRows();
        await exportTableToPdf(title, {
          headers: columns.map((column) => column.label),
          rows: allRows.map((row) => columns.map((column) => reportCell(row, column))),
          alignments: columns.map((column) => column.align ?? 'left'),
          density: columns.length >= 12 ? 'wide' : columns.length >= 7 ? 'compact' : 'normal',
        });
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'The report PDF could not be prepared.');
      } finally {
        setExporting(false);
      }
      return;
    }
    const targetWindow = openReportPrintWindow(title);
    if (!targetWindow) {
      window.alert('The print window was blocked. Allow pop-ups for GridVision and try again.');
      return;
    }
    setExporting(true);
    try {
      const allRows = await resolveRows();
      if (!contentRef.current) throw new Error('The report is no longer available.');
      printReportElement(contentRef.current, title, {
        headers: columns.map((column) => column.label),
        rows: allRows.map((row) => columns.map((column) => reportCell(row, column))),
        alignments: columns.map((column) => column.align ?? 'left'),
        columnWidths: printableColumnWidths(allRows, columns),
        density: columns.length >= 12 ? 'wide' : columns.length >= 7 ? 'compact' : 'normal',
      }, targetWindow);
    } catch (error) {
      targetWindow.close();
      window.alert(error instanceof Error ? error.message : 'The complete report could not be prepared.');
    } finally {
      setExporting(false);
    }
  }

  async function exportCsv() {
    if (unavailable) return;
    setExporting(true);
    try {
      const allRows = await resolveRows();
      const csv = [
        columns.map((column) => csvCell(column.label)).join(','),
        ...allRows.map((row) => columns.map((column) => csvCell(column.csvValue?.(row))).join(',')),
      ].join('\n');
      await downloadCsvFile(csv, `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'gridvision-report'}.csv`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'The complete CSV could not be prepared.');
    } finally {
      setExporting(false);
    }
  }

  return <div className="flex flex-wrap gap-2" data-report-exclude>
    {!isNativeApp() && <button type="button" onClick={() => void openPrint()} disabled={unavailable} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"><Printer className="h-4 w-4" />{exporting ? 'Preparing...' : 'Print'}</button>}
    <button type="button" onClick={() => void openPrint()} disabled={unavailable} aria-label={exporting ? 'Preparing complete report' : 'Save report as PDF'} title="Save as PDF" className={`inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${showPdfLabel ? 'lg:w-9 lg:px-0' : 'w-9 px-0'} ${primaryPdf ? 'lg:border-blue-700 lg:bg-blue-700 lg:text-white lg:hover:bg-blue-800' : ''}`}><FileDown className="h-4 w-4" />{showPdfLabel && <span className="lg:hidden">{exporting ? 'Preparing...' : 'PDF'}</span>}</button>
    <button type="button" onClick={() => void exportCsv()} disabled={unavailable} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-4 w-4" />{exporting ? 'Preparing...' : 'CSV'}</button>
  </div>;
}
