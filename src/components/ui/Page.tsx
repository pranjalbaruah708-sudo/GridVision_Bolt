import type { ReactNode } from 'react';
import { ArrowLeft, Wifi, WifiOff, UploadCloud } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

// Top app status bar shown on every screen — white background, navy accents
export function StatusBar() {
  const { online, pending } = useOnlineStatus();
  return (
    <div className="flex items-center justify-between px-4 py-1.5 text-[10px] text-gray-400 bg-white">
      <span className="font-semibold text-gray-600">9:41</span>
      <div className="flex items-center gap-2">
        {pending > 0 && (
          <span className="flex items-center gap-1 text-amber-600">
            <UploadCloud className="h-3 w-3" />
            {pending}
          </span>
        )}
        {online ? (
          <Wifi className="h-3.5 w-3.5 text-gray-500" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 text-amber-500" />
        )}
        <span>100%</span>
      </div>
    </div>
  );
}

export function AppHeader({
  title,
  subtitle,
  onBack,
  right,
  dark = true,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  dark?: boolean;
}) {
  return (
    <header
      className={`sticky top-0 z-20 px-4 py-3 ${
        dark ? 'bg-[#1a3361] text-white' : 'bg-white text-gray-900 border-b border-gray-200'
      }`}
    >
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className={`grid h-8 w-8 place-items-center rounded-full transition active:scale-95 ${
              dark ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-bold leading-tight truncate">{title}</h1>
          {subtitle && (
            <p className={`text-[11px] truncate ${dark ? 'text-blue-100/80' : 'text-gray-500'}`}>
              {subtitle}
            </p>
          )}
        </div>
        {right}
      </div>
    </header>
  );
}

export function Screen({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <div className={`min-h-screen ${dark ? 'bg-[#1a3361]' : 'bg-[#f0f2f7]'}`}>
      <StatusBar />
      {children}
    </div>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-md px-4 py-4 pb-28">{children}</div>;
}
