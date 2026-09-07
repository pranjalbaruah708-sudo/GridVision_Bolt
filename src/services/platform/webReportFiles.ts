export function printReportElement(content: HTMLElement, title: string): void {
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

export function downloadCsvFile(contents: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
