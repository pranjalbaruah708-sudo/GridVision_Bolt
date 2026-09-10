export type PrintableReportTable = {
  headers: string[];
  rows: Array<Array<string>>;
  alignments?: Array<'left' | 'right'>;
  columnWidths?: number[];
  density?: 'normal' | 'compact' | 'wide';
};

function escapeHtmlText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

export function openReportPrintWindow(title: string): Window | null {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return null;
  printWindow.document.write(`<!doctype html><html><head><title>${escapeHtmlText(title)}</title></head><body><p style="font-family:Arial,sans-serif;padding:24px">Preparing complete report...</p></body></html>`);
  printWindow.document.close();
  return printWindow;
}

export function printReportElement(content: HTMLElement, title: string, table?: PrintableReportTable, targetWindow?: Window | null): void {
  const printWindow = targetWindow ?? window.open('', '_blank');
  if (!printWindow) return;
  const clone = content.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-report-exclude], button, input, select, textarea').forEach((element) => element.remove());
  if (table) {
    const reportTable = clone.querySelector<HTMLTableElement>('[data-report-table]');
    if (reportTable) {
      reportTable.querySelector('colgroup')?.remove();
      if (table.columnWidths?.length === table.headers.length) {
        const columnGroup = document.createElement('colgroup');
        table.columnWidths.forEach((width) => {
          const column = document.createElement('col');
          column.style.width = `${width}%`;
          columnGroup.appendChild(column);
        });
        reportTable.prepend(columnGroup);
      }
      const head = reportTable.tHead ?? reportTable.createTHead();
      head.replaceChildren();
      const headingRow = head.insertRow();
      table.headers.forEach((header, index) => {
        const cell = document.createElement('th');
        cell.textContent = header;
        cell.style.textAlign = table.alignments?.[index] ?? 'left';
        headingRow.appendChild(cell);
      });
      const body = reportTable.tBodies[0] ?? reportTable.createTBody();
      body.replaceChildren();
      table.rows.forEach((row) => {
        const tableRow = body.insertRow();
        row.forEach((value, index) => {
          const cell = tableRow.insertCell();
          cell.textContent = value;
          cell.style.textAlign = table.alignments?.[index] ?? 'left';
        });
      });
    }
  }
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((element) => element.outerHTML).join('');
  const density = table?.density ?? 'normal';
  const landscape = Boolean(table && table.headers.length > 6);
  const bodyClass = `report-print report-print-${density}${landscape ? ' report-print-landscape' : ''}`;
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><head><title>${escapeHtmlText(title)}</title>${styles}<style>
    @page{size:${landscape ? 'landscape' : 'auto'};margin:6mm}
    html,body{margin:0!important;padding:0!important;width:100%!important;max-width:100%!important;background:#fff!important;color:#0f172a;font-family:Arial,sans-serif}
    body>main{box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-width:0!important;margin:0!important;padding:0!important}
    button,input,select,textarea,[data-report-exclude]{display:none!important}
    [data-report-table-container]{box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-width:0!important;overflow:visible!important}
    [data-report-table]{box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-width:0!important;border-collapse:collapse!important;table-layout:fixed!important}
    [data-report-table] thead{display:table-header-group!important;position:static!important}
    [data-report-table] tr{break-inside:avoid-page;page-break-inside:avoid}
    [data-report-table] th,[data-report-table] td{box-sizing:border-box!important;min-width:0!important;max-width:none!important;height:auto!important;border:1px solid #cbd5e1!important;padding:3px!important;line-height:1.2!important;white-space:normal!important;overflow:visible!important;overflow-wrap:anywhere!important;word-break:break-word!important;text-overflow:clip!important;vertical-align:top}
    [data-report-table] th{background:#f8fafc!important;font-weight:700!important}
    .report-print-normal [data-report-table]{font-size:8.5pt!important}
    .report-print-normal [data-report-table] th{font-size:8pt!important}
    .report-print-compact [data-report-table]{font-size:7.5pt!important}
    .report-print-compact [data-report-table] th{font-size:7pt!important}
    .report-print-wide [data-report-table]{font-size:6.5pt!important}
    .report-print-wide [data-report-table] th{font-size:6.25pt!important}
    .report-print-landscape svg,.report-print-landscape canvas{max-width:100%!important}
    @media print{html,body,body>main{width:100%!important;max-width:100%!important}[data-report-table-container]{overflow:visible!important}}
  </style></head><body class="${bodyClass}"><main>${clone.outerHTML}</main></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 250);
}

export function downloadCsvFile(contents: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
