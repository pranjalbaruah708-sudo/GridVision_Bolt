import {
  FileDown,
  MoreVertical,
  Printer,
  Share2,
} from 'lucide-react';
import {
  useState,
} from 'react';
import type {
  RefObject,
  ReactNode,
} from 'react';

type ScreenExportMenuProps = {
  contentRef: RefObject<HTMLElement>;
  title: string;
};

function safeFileName(
  value: string
): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'gridvision-report';
}

function printableClone(
  content: HTMLElement
): HTMLElement {
  const clone = content.cloneNode(true) as HTMLElement;

  clone.querySelectorAll(
    'button, input, select, textarea, [data-export-exclude]'
  ).forEach((element) => element.remove());

  return clone;
}

function openPrintView(
  content: HTMLElement,
  title: string
): void {
  const printWindow = window.open('', '_blank');

  if (!printWindow) {
    return;
  }

  const printable = printableClone(content);
  const pageStyles = Array.from(
    document.querySelectorAll('link[rel="stylesheet"], style')
  ).map((element) => element.outerHTML).join('');
  printWindow.document.write(`<!doctype html>
    <html><head><title>${title}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${pageStyles}
    <style>
      @page { margin: 14mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #0f172a; background: #fff; font-family: Arial, sans-serif; }
      button, input, select, textarea, nav, [data-export-exclude] { display: none !important; }
      svg { max-width: 100%; }
    </style></head><body><main>${printable.outerHTML}</main></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 250);
}

function pdfEscape(
  value: string
): string {
  return value
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapPdfText(
  value: string
): string[] {
  const lines: string[] = [];

  for (const paragraph of value.split(/\n+/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = '';

    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > 92 && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }

    if (line) {
      lines.push(line);
    }
  }

  return lines.length > 0 ? lines : ['No report content available.'];
}

function buildPdf(
  content: HTMLElement,
  title: string
): Blob {
  const reportText = `${title}\n\n${printableClone(content).innerText}`;
  const pages = wrapPdfText(reportText).reduce<string[][]>((result, line, index) => {
    const pageIndex = Math.floor(index / 48);
    (result[pageIndex] ??= []).push(line);
    return result;
  }, []);
  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);

  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[2] = '<< /Type /Catalog /Pages 1 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  pages.forEach((pageLines, index) => {
    const pageObjectId = pageObjectIds[index];
    const contentObjectId = pageObjectId + 1;
    const stream = [
      'BT',
      '/F1 10 Tf',
      '50 790 Td',
      '14 TL',
      ...pageLines.map((line) => `(${pdfEscape(line)}) Tj T*`),
      'ET',
    ].join('\n');
    objects[pageObjectId] = `<< /Type /Page /Parent 1 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [0 0 595 842] /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = pdf.length;
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 2 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: 'application/pdf' });
}

function downloadPdf(
  pdf: Blob,
  title: string
): void {
  const url = URL.createObjectURL(pdf);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileName(title)}.pdf`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ScreenExportMenu({
  contentRef,
  title,
}: ScreenExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  function withContent(
    action: (content: HTMLElement) => void
  ) {
    const content = contentRef.current;
    setIsOpen(false);

    if (content) {
      action(content);
    }
  }

  async function sharePdf(
    content: HTMLElement
  ) {
    const pdf = buildPdf(content, title);
    const file = new File([pdf], `${safeFileName(title)}.pdf`, {
      type: 'application/pdf',
    });

    try {
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title,
          files: [file],
        });
        return;
      }
    } catch {
      return;
    }

    downloadPdf(pdf, title);
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-label="Export or share report"
        aria-expanded={isOpen}
        className="rounded-full p-1 transition hover:bg-white/10 active:scale-95"
      >
        <MoreVertical size={24} />
      </button>

      {isOpen && (
        <div
          role="menu"
          style={{ position: 'absolute', top: 34, right: 0, zIndex: 30, minWidth: 156, padding: 6, borderRadius: 12, background: '#FFFFFF', boxShadow: '0 10px 24px rgba(15,23,42,.22)', border: '1px solid #E2E8F0' }}
        >
          <MenuAction icon={<Printer size={16} />} label="Print" onClick={() => withContent((content) => openPrintView(content, title))} />
          <MenuAction icon={<FileDown size={16} />} label="Save as PDF" onClick={() => withContent((content) => downloadPdf(buildPdf(content, title), title))} />
          <MenuAction icon={<Share2 size={16} />} label="Share" onClick={() => withContent((content) => { void sharePdf(content); })} />
        </div>
      )}
    </div>
  );
}

function MenuAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, border: 0, borderRadius: 8, padding: '9px 10px', background: 'transparent', color: '#1E293B', fontSize: 12, fontWeight: 700, textAlign: 'left', cursor: 'pointer' }}
    >
      {icon}
      {label}
    </button>
  );
}
