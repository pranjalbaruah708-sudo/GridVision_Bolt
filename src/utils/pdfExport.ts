import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { svg2pdf } from 'svg2pdf.js';
import { persistPdfFile, type PdfFileResult } from '@/services/platform/pdfFile';

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = PAGE_HEIGHT - 16;

type PdfDocument = jsPDF & { lastAutoTable?: { finalY: number } };
export type PdfExportResult = PdfFileResult;
export type PdfTableExport = {
  headers: string[];
  rows: string[][];
  alignments?: Array<'left' | 'right'>;
  density?: 'normal' | 'compact' | 'wide';
};

function reportDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function generatedAt(): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date());
}

function safeFileName(title: string): string {
  const name = title.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'GridVision_Report';
  return `${name}_${reportDate()}.pdf`;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/â€”|—|â€“|–/g, '-')
    .replace(/Â·|â€¢|•|·/g, ' - ')
    .replace(/â€¦|…/g, '...')
    .replace(/Â°C/g, 'deg C')
    .replace(/\s+/g, ' ')
    .trim();
}

function controlLabel(control: HTMLInputElement | HTMLSelectElement): string {
  return control.getAttribute('aria-label') || control.getAttribute('name') || control.getAttribute('placeholder') || control.closest('label')?.querySelector('span')?.textContent || 'Filter';
}

function activeFilters(content: HTMLElement): string[] {
  const controls = Array.from(content.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')).flatMap((control) => {
    if (control.type === 'button' || control.type === 'submit' || control.type === 'checkbox' || control.type === 'radio') return [];
    const value = control instanceof HTMLSelectElement ? control.selectedOptions[0]?.textContent : control.value;
    const cleaned = cleanText(value);
    return cleaned ? [`${cleanText(controlLabel(control))}: ${cleaned}`] : [];
  });
  const declared = Array.from(content.querySelectorAll<HTMLElement>('[data-pdf-filter-value]')).flatMap((element) => {
    const value = cleanText(element.dataset.pdfFilterValue);
    return value ? [`${cleanText(element.dataset.pdfFilterLabel) || 'Filter'}: ${value}`] : [];
  });
  return Array.from(new Set([...controls, ...declared]));
}

async function savePdf(doc: jsPDF, fileName: string): Promise<PdfExportResult> {
  return persistPdfFile(fileName, doc.output('arraybuffer'), () => doc.save(fileName));
}

/** Creates a real PDF on native platforms, avoiding Android WebView print previews. */
export async function exportTableToPdf(title: string, table: PdfTableExport): Promise<PdfExportResult> {
  const doc = new jsPDF({ orientation: table.headers.length > 6 ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true }) as PdfDocument;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(cleanText(title), margin, margin + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${generatedAt()} IST`, margin, margin + 8);
  const fontSize = table.density === 'wide' ? 5.7 : table.density === 'compact' ? 6.7 : 7.5;
  autoTable(doc, {
    startY: margin + 13,
    head: [table.headers.map(cleanText)],
    body: table.rows.map((row) => row.map(cleanText)),
    margin: { left: margin, right: margin, bottom: 15 },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize, cellPadding: 1.5, overflow: 'linebreak' },
    headStyles: { fillColor: [13, 71, 161], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: Object.fromEntries(table.alignments?.map((alignment, index) => [index, { halign: alignment }]) ?? []),
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    didDrawPage: ({ pageNumber }) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text('GridVision', margin, pageHeight - 7);
      doc.text(`Page ${pageNumber}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
    },
  });
  return savePdf(doc, safeFileName(title));
}

function tableData(table: HTMLTableElement): { head: string[][]; body: string[][] } {
  const rows = Array.from(table.rows).map((row) => Array.from(row.cells).map((cell) => cleanText(cell.textContent)));
  const headerRows = table.tHead ? Array.from(table.tHead.rows).length : rows.length && table.rows[0]?.querySelector('th') ? 1 : 0;
  return { head: rows.slice(0, headerRows), body: rows.slice(headerRows) };
}

export async function exportElementToPdf(content: HTMLElement, title: string): Promise<PdfExportResult> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true }) as PdfDocument;
  let y = MARGIN;

  const addPage = () => { doc.addPage(); y = MARGIN; };
  const ensureSpace = (height: number) => { if (y + height > BOTTOM) addPage(); };
  const addText = (text: string, options: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {}) => {
    const cleaned = cleanText(text);
    if (!cleaned) return;
    const size = options.size ?? 9;
    doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...(options.color ?? [51, 65, 85]));
    const lines = doc.splitTextToSize(cleaned, CONTENT_WIDTH) as string[];
    const height = lines.length * size * 0.42 + (options.gap ?? 2);
    ensureSpace(height);
    doc.text(lines, MARGIN, y);
    y += height;
  };
  const addKpi = (label: string, value: string, detail?: string) => {
    ensureSpace(detail ? 23 : 18);
    doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240);
    doc.roundedRect(MARGIN, y, CONTENT_WIDTH, detail ? 20 : 15, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(71, 85, 105); doc.text(cleanText(label), MARGIN + 4, y + 6);
    doc.setFontSize(12); doc.setTextColor(15, 23, 42); doc.text(cleanText(value) || '-', PAGE_WIDTH - MARGIN - 4, y + 6, { align: 'right' });
    if (detail) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text(doc.splitTextToSize(cleanText(detail), CONTENT_WIDTH - 8), MARGIN + 4, y + 13); }
    y += (detail ? 20 : 15) + 3;
  };
  const addRow = (label: string, value: string, detail?: string) => {
    const wrappedDetail = detail ? doc.splitTextToSize(cleanText(detail), CONTENT_WIDTH - 12) as string[] : [];
    const height = Math.max(12, 10 + wrappedDetail.length * 3);
    ensureSpace(height + 1);
    doc.setDrawColor(226, 232, 240); doc.line(MARGIN, y + height, PAGE_WIDTH - MARGIN, y + height);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42); doc.text(cleanText(label), MARGIN, y + 4);
    doc.setFontSize(8); doc.setTextColor(30, 64, 175); doc.text(cleanText(value) || '-', PAGE_WIDTH - MARGIN, y + 4, { align: 'right' });
    if (wrappedDetail.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text(wrappedDetail, MARGIN, y + 9); }
    y += height + 1;
  };
  const addHeatmap = (serialized: string) => {
    type Cell = { date: string; hour: number; status: string };
    let cells: Cell[] = [];
    try { cells = JSON.parse(serialized) as Cell[]; } catch { return; }
    const dates = Array.from(new Set(cells.map((cell) => cell.date)));
    if (!dates.length) return;
    const labelWidth = 28;
    const cellWidth = (CONTENT_WIDTH - labelWidth) / 24;
    const rowHeight = 5;
    const addHourHeader = () => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(100, 116, 139);
      for (let hour = 0; hour < 24; hour += 1) doc.text(String(hour).padStart(2, '0'), MARGIN + labelWidth + hour * cellWidth + cellWidth / 2, y, { align: 'center' });
      y += 3;
    };
    ensureSpace(12 + rowHeight);
    addHourHeader();
    for (const date of dates) {
      if (y + rowHeight + 1 > BOTTOM) { addPage(); addHourHeader(); }
      doc.setFontSize(6); doc.setTextColor(71, 85, 105); doc.text(cleanText(date), MARGIN, y + 3.5);
      for (let hour = 0; hour < 24; hour += 1) {
        const status = cells.find((cell) => cell.date === date && cell.hour === hour)?.status;
        const color: [number, number, number] = status === 'FULL' ? [34, 197, 94] : status === 'PARTIAL' ? [250, 204, 21] : status === 'MISSING' ? [239, 68, 68] : [229, 231, 235];
        doc.setFillColor(...color); doc.rect(MARGIN + labelWidth + hour * cellWidth, y, cellWidth - 0.4, rowHeight - 0.4, 'F');
      }
      y += rowHeight;
    }
    y += 4;
  };

  doc.setFillColor(13, 71, 161);
  doc.rect(0, 0, PAGE_WIDTH, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(doc.splitTextToSize(title, CONTENT_WIDTH), MARGIN, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Report date: ${reportDate()} (IST)`, MARGIN, 24);
  y = 38;

  const filters = activeFilters(content);
  if (filters.length) {
    addText('Active filters', { size: 11, bold: true, color: [15, 23, 42] });
    filters.forEach((filter) => addText(filter, { size: 8, gap: 1 }));
    y += 2;
  }

  const ignored = 'nav, style, script, [data-export-exclude]';
  const process = async (element: Element): Promise<void> => {
    if (element.matches(ignored)) return;
    if (element instanceof HTMLElement && element.hidden) return;
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return;
    if (element instanceof HTMLElement && element.dataset.pdfKind === 'kpi') {
      addKpi(element.dataset.pdfLabel ?? '', element.dataset.pdfValue ?? '', element.dataset.pdfDetail);
      return;
    }
    if (element instanceof HTMLElement && element.dataset.pdfKind === 'row') {
      addRow(element.dataset.pdfLabel ?? '', element.dataset.pdfValue ?? '', element.dataset.pdfDetail);
      return;
    }
    if (element instanceof HTMLElement && element.dataset.pdfKind === 'heatmap') {
      addHeatmap(element.dataset.pdfHeatmap ?? '[]');
      return;
    }
    if (element instanceof HTMLTableElement) {
      const data = tableData(element);
      ensureSpace(24);
      autoTable(doc, { startY: y, head: data.head, body: data.body, margin: { left: MARGIN, right: MARGIN }, theme: 'grid', styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.8, overflow: 'linebreak' }, headStyles: { fillColor: [13, 71, 161], textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [241, 245, 249] }, rowPageBreak: 'avoid', showHead: 'everyPage' });
      y = (doc.lastAutoTable?.finalY ?? y) + 5;
      return;
    }
    if (element instanceof SVGSVGElement && (element.classList.contains('recharts-surface') || element.hasAttribute('data-pdf-chart') || element.getAttribute('role') === 'img')) {
      const bounds = element.getBoundingClientRect();
      if (bounds.width < 40 || bounds.height < 20) return;
      const width = CONTENT_WIDTH;
      const height = Math.min(92, Math.max(45, width * bounds.height / bounds.width));
      ensureSpace(height + 5);
      try { await svg2pdf(element, doc, { x: MARGIN, y, width, height, loadExternalStyleSheets: false, loadImages: false }); y += height + 5; }
      catch { addText('Chart could not be rendered in this export.', { size: 8, color: [180, 83, 9] }); }
      return;
    }
    if (/^H[1-6]$/.test(element.tagName)) { addText(element.textContent ?? '', { size: element.tagName === 'H1' ? 14 : element.tagName === 'H2' ? 12 : 10, bold: true, color: [15, 23, 42], gap: 3 }); return; }
    if (element.tagName === 'P') { addText(element.textContent ?? '', { size: 8.5, gap: 1.5 }); return; }
    const children = Array.from(element.children);
    if (!children.length && !element.matches('[aria-hidden="true"]')) { addText(element.textContent ?? '', { size: 8, gap: 1 }); return; }
    for (const child of children) await process(child);
  };

  for (const child of Array.from(content.children)) await process(child);
  addText(`Generated: ${generatedAt()} IST`, { size: 8, color: [100, 116, 139], gap: 1 });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(226, 232, 240);
    doc.line(MARGIN, PAGE_HEIGHT - 11, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
    doc.text('GridVision', MARGIN, PAGE_HEIGHT - 7);
    doc.text(`Page ${page} of ${pages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 7, { align: 'right' });
  }

  return savePdf(doc, safeFileName(title));
}
