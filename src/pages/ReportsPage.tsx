import { useState } from 'react';
import { FileText, ChevronRight, Download, Calendar, FileSpreadsheet, TrendingUp, AlertCircle } from 'lucide-react';
import { Screen, AppHeader, PageBody } from '@/components/ui/Page';

type ReportType = 'log-book' | 'peak-load' | 'interruptions' | 'reliability' | 'maintenance';

const REPORT_TYPES: { id: ReportType; title: string; desc: string; icon: typeof FileText; color: string }[] = [
  { id: 'log-book', title: 'Log Book Report', desc: 'Hourly readings with MW, voltage & current', icon: FileText, color: 'bg-blue-600' },
  { id: 'peak-load', title: 'Peak Load Report', desc: 'Maximum demand per feeder & period', icon: TrendingUp, color: 'bg-rose-500' },
  { id: 'interruptions', title: 'Interruption Report', desc: 'Supply interruptions with duration', icon: AlertCircle, color: 'bg-amber-500' },
  { id: 'reliability', title: 'Reliability Report', desc: 'CAIDI / CAIFI indices per month', icon: FileSpreadsheet, color: 'bg-violet-500' },
  { id: 'maintenance', title: 'Maintenance Report', desc: 'Scheduled work & completion status', icon: Calendar, color: 'bg-emerald-600' },
];

export function ReportsPage({ onOpenReport }: { onOpenReport: (type: ReportType) => void }) {
  const [selected, setSelected] = useState<ReportType>('log-book');
  const [from, setFrom] = useState('2024-05-01');
  const [to, setTo] = useState('2024-05-31');

  const generate = () => onOpenReport(selected);

  return (
    <Screen>
      <AppHeader title="Reports" subtitle="Generate & export station reports" />
      <PageBody>
        <div className="space-y-4">
          {/* Report type selector */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Select Report Type</h3>
            <div className="space-y-2">
              {REPORT_TYPES.map((r) => {
                const Icon = r.icon;
                const isSel = selected === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelected(r.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                      isSel ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg ${r.color}`}>
                      <Icon className="h-4 w-4 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-semibold ${isSel ? 'text-blue-700' : 'text-gray-900'}`}>{r.title}</p>
                      <p className="text-[11px] text-gray-500 truncate">{r.desc}</p>
                    </div>
                    <div className={`h-5 w-5 flex-shrink-0 rounded-full border-2 ${isSel ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`}>
                      {isSel && <div className="h-full w-full scale-[0.5] rounded-full bg-white" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date range */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Date Range</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium uppercase text-gray-400">From</span>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-500"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium uppercase text-gray-400">To</span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-500"
                />
              </label>
            </div>
          </div>

          {/* Generate */}
          <button
            onClick={generate}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-sm font-bold text-white shadow-md transition hover:bg-blue-800 active:scale-[0.99]"
          >
            <FileText className="h-4 w-4" />
            GENERATE REPORT
          </button>

          {/* Recent reports */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Recent Reports</h3>
            <div className="space-y-1">
              {['Log Book — May 2024', 'Peak Load — Apr 2024', 'Interruptions — May 2024'].map((name, i) => (
                <button
                  key={i}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2">
                    <Download className="h-4 w-4 text-gray-400" />
                    <span className="text-xs text-gray-700">{name}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </PageBody>
    </Screen>
  );
}
