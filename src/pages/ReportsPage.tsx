import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  LucideIcon,
} from 'lucide-react';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BellRing,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Gauge,
  Search,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
  Zap,
  ChevronRight,
} from 'lucide-react';

import {
  api,
  type AppRole,
} from '@/services/api';

export type ReportType =
  | 'daily-log-book'
  | 'interruption'
  | 'load-energy'
  | 'data-completeness'
  | 'parameter-exceptions'
  | 'station-performance'
  | 'feeder-performance'
  | 'executive-summary'
  | 'operator-activity'
  | 'notification-delivery';

type ReportGroup =
  | 'Quick Reports'
  | 'Operational Reports'
  | 'Performance Reports'
  | 'Administration';

type ReportDefinition = {
  type: ReportType;
  group: ReportGroup;
  title: string;
  description: string;
  icon: LucideIcon;
  tone: string;
  adminOnly?: boolean;
  implemented?: boolean;
};

const REPORT_GROUPS: ReportGroup[] = [
  'Quick Reports',
  'Operational Reports',
  'Performance Reports',
  'Administration',
];

const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    type: 'daily-log-book',
    group: 'Quick Reports',
    title: 'Daily Log Book',
    description: 'Review daily station logbook entries and operating readings.',
    icon: ClipboardList,
    tone: 'bg-blue-50 text-blue-700',
    implemented: true,
  },
  {
    type: 'interruption',
    group: 'Quick Reports',
    title: 'Interruption',
    description: 'Review interruption events, duration and restoration details.',
    icon: Activity,
    tone: 'bg-orange-50 text-orange-600',
    implemented: true,
  },
  {
    type: 'load-energy',
    group: 'Quick Reports',
    title: 'Load & Energy',
    description: 'Summarise load, demand and energy observations.',
    icon: Zap,
    tone: 'bg-violet-50 text-violet-600',
    implemented: true,
  },
  {
    type: 'data-completeness',
    group: 'Operational Reports',
    title: 'Data Completeness',
    description: 'Review feeder-hour reporting completeness and gaps.',
    icon: ClipboardCheck,
    tone: 'bg-emerald-50 text-emerald-600',
    implemented: true,
  },
  {
    type: 'parameter-exceptions',
    group: 'Operational Reports',
    title: 'Parameter Exceptions',
    description: 'Review parameter observations requiring attention.',
    icon: ShieldCheck,
    tone: 'bg-amber-50 text-amber-600',
    implemented: true,
  },
  {
    type: 'station-performance',
    group: 'Performance Reports',
    title: 'Station Performance',
    description: 'Compare operational performance across stations.',
    icon: BarChart3,
    tone: 'bg-cyan-50 text-cyan-700',
    implemented: true,
  },
  {
    type: 'feeder-performance',
    group: 'Performance Reports',
    title: 'Feeder Performance',
    description: 'Compare feeder-level load and data quality performance.',
    icon: Gauge,
    tone: 'bg-indigo-50 text-indigo-700',
    implemented: true,
  },
  {
    type: 'executive-summary',
    group: 'Performance Reports',
    title: 'Executive Summary',
    description: 'Compact management summary of utility operations.',
    icon: FileText,
    tone: 'bg-slate-100 text-slate-700',
    implemented: true,
  },
  {
    type: 'operator-activity',
    group: 'Administration',
    title: 'Operator Activity',
    description: 'Review logbook and operational activity by operator.',
    icon: UserRoundCheck,
    tone: 'bg-rose-50 text-rose-600',
    adminOnly: true,
    implemented: true,
  },
  {
    type: 'notification-delivery',
    group: 'Administration',
    title: 'Notification Delivery',
    description: 'Review notification delivery and recipient status.',
    icon: BellRing,
    tone: 'bg-fuchsia-50 text-fuchsia-600',
    adminOnly: true,
    implemented: true,
  },
];

type ReportsPageProps = {
  onOpenReport: (reportType: ReportType) => void;
  onBack?: () => void;
};

export function ReportsPage({
  onOpenReport,
  onBack,
}: ReportsPageProps) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<AppRole | null>(null);

  useEffect(() => {
    let cancelled = false;

    void api.getMyRole()
      .then((currentRole) => {
        if (!cancelled) {
          setRole(currentRole);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load report catalogue role:', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const groupedReports = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const visible = REPORT_DEFINITIONS.filter((report) =>
      (!report.adminOnly || role === 'ADMIN') &&
      (!normalizedSearch || report.title.toLowerCase().includes(normalizedSearch))
    );

    return REPORT_GROUPS.map((group) => ({
      group,
      reports: visible.filter((report) => report.group === group),
    })).filter((item) => item.reports.length > 0);
  }, [role, search]);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="rounded-b-3xl bg-gradient-to-r from-blue-900 to-blue-700 px-5 pb-6 pt-5 shadow-lg">
        <div className="flex items-center justify-between text-white">
          <button
            type="button"
            onClick={onBack}
            className="grid h-10 w-10 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
            aria-label="Back"
          >
            <ArrowLeft size={24} />
          </button>

          <div className="text-center">
            <h1 className="text-2xl font-bold">Reports</h1>
            <p className="mt-1 text-xs text-blue-100/80">GridVision Reports</p>
          </div>

          <div className="h-10 w-10" aria-hidden="true" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-5 pb-28">
        <div className="mb-4">
          <h2 className="text-base font-bold text-slate-800">Report Catalogue</h2>
          <p className="mt-1 text-xs text-slate-500">Select an available report. Export options appear inside generated reports.</p>
        </div>

        <label className="mb-5 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search reports"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            aria-label="Search reports"
          />
        </label>

        <div className="space-y-5">
          {groupedReports.map(({ group, reports }) => (
            <section key={group}>
              <h3 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{group}</h3>
              <div className="space-y-2">
                {reports.map((report) => (
                  <ReportRow
                    key={report.type}
                    report={report}
                    onOpenReport={onOpenReport}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        {groupedReports.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm font-medium text-slate-500">
            No reports match “{search.trim()}”.
          </div>
        )}
      </main>
    </div>
  );
}

function ReportRow({
  report,
  onOpenReport,
}: {
  report: ReportDefinition;
  onOpenReport: (reportType: ReportType) => void;
}) {
  const Icon = report.icon;
  const content = (
    <>
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${report.tone}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-bold text-slate-900">{report.title}</h4>
        <p className="mt-1 text-xs leading-5 text-slate-500">{report.description}</p>
      </div>
    </>
  );

  if (!report.implemented) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80 opacity-85">
        {content}
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">Coming soon</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpenReport(report.type)}
      className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/80 transition hover:bg-slate-50 active:scale-[0.99]"
      aria-label={`Open ${report.title}`}
    >
      {content}
      <ChevronRight className="h-5 w-5 shrink-0 text-blue-700" />
    </button>
  );
}

export default ReportsPage;
