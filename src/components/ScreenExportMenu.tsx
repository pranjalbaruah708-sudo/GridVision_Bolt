import { FileDown, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';

type DownloadPdfButtonProps = {
  contentRef: RefObject<HTMLElement>;
  title: string;
};

export default function DownloadPdfButton({ contentRef, title }: DownloadPdfButtonProps) {
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const notify = (value: string) => {
    setMessage(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3500);
  };

  const download = async () => {
    if (!contentRef.current || exporting) return;
    setExporting(true);
    try {
      const { exportElementToPdf } = await import('@/utils/pdfExport');
      const result = await exportElementToPdf(contentRef.current, title);
      notify(result.nativePath ? `PDF saved to Documents: ${result.fileName}` : `Downloaded ${result.fileName}`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not generate the PDF');
    } finally {
      setExporting(false);
    }
  };

  return <>
    <button type="button" onClick={() => void download()} disabled={exporting} data-export-exclude className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60 sm:px-3" aria-label="Download current report as PDF">
      {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
      <span>{exporting ? 'Generating…' : 'Download PDF'}</span>
    </button>
    {message && <div role="status" aria-live="polite" className="fixed bottom-24 left-1/2 z-[70] w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-center text-xs font-semibold text-white shadow-xl">{message}</div>}
  </>;
}
