import { ReactNode, useState } from 'react';
import { Screen, PageBody } from '@/components/ui/Page';
import {
  Menu,
  Bell,
  ChevronDown,
  Calendar,
  Home,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Activity,
  Circle,
  CircleDot,
} from 'lucide-react';

const STATIONS = ['All Stations', 'Station A', 'Station B'];

export function DashboardLogbookPage() {
  const [selectedStation, setSelectedStation] = useState(STATIONS[0]);
  const [selectedDate, setSelectedDate] = useState('30 Jul 2026');

  return (
    <Screen>
      <div className="bg-[#163b83] text-white pb-5">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 pt-4">
          <button className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-white">
            <Menu className="h-5 w-5" />
          </button>
          <div className="text-center">
            <h1 className="text-base font-semibold">GridVision</h1>
            <p className="text-[11px] text-slate-200">Sub-Station Monitoring System</p>
          </div>
          <button className="relative grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-white">
            <Bell className="h-5 w-5" />
            <span className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              7
            </span>
          </button>
        </div>

        <div className="mx-auto mt-4 flex max-w-md items-center justify-between gap-3 px-4">
          <button
            type="button"
            className="flex-1 items-center justify-between rounded-2xl bg-white px-4 py-3 text-left text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 sm:flex"
            onClick={() => setSelectedStation(STATIONS[(STATIONS.indexOf(selectedStation) + 1) % STATIONS.length])}
          >
            <span>{selectedStation}</span>
            <ChevronDown className="ml-3 hidden h-4 w-4 text-slate-500 sm:inline" />
          </button>

          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
          >
            <Calendar className="h-4 w-4 text-slate-500" />
            {selectedDate}
          </button>
        </div>
      </div>

      <PageBody>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Executive Summary</h2>

      {/*  <div className="grid gap-3 sm:grid-cols-2">*/}
        <div className="grid grid-cols-2 gap-3">
          <MetricCard icon={<Home className="h-5 w-5 text-slate-600" />} label="Total Stations" value="35" />
          <MetricCard icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />} label="Online Stations" value="34" tone="green" />
          <MetricCard icon={<AlertTriangle className="h-5 w-5 text-red-500" />} label="Active Alarms" value="7" tone="red" />
          <MetricCard icon={<Zap className="h-5 w-5 text-blue-600" />} label="Peak Load Today" value="1,425 MW" tone="blue" />
          <MetricCard icon={<Activity className="h-5 w-5 text-orange-500" />} label="Today’s Interruptions" value="5" tone="orange" />
          <MetricCard icon={<CircleDot className="h-5 w-5 text-violet-500" />} label="Overloaded Feeders" value="3" tone="violet" />
        </div>

        <div className="mt-5 space-y-4">
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Peak Load Trend (MW)</h3>
                <p className="text-[11px] text-slate-500">Today</p>
              </div>
              <button className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-700">
                Today
                <ChevronDown className="h-4 w-4 text-slate-500" />
              </button>
            </div>

            <div className="mt-4 rounded-3xl bg-slate-50 px-4 py-5">
              <div className="relative h-52 overflow-hidden">
                <svg viewBox="0 0 340 160" className="h-full w-full">
                  <defs>
                    <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M20 120 C70 110 90 80 120 70 C150 60 180 70 210 80 C240 95 260 80 290 85 C320 90 330 75 340 70"
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                  <path d="M20 120 L20 72 C40 82 60 82 80 78 C100 74 120 72 140 77 C160 82 180 90 200 96 C220 102 240 105 260 96 C280 87 300 82 320 75 L340 70 L340 160 L20 160 Z" fill="url(#chartGradient)" />
                  <g stroke="#cbd5e1" strokeWidth="1">
                    {[20, 60, 100, 140, 180, 220, 260, 300, 340].map((x) => (
                      <line key={x} x1={x} y1="20" x2={x} y2="145" />
                    ))}
                  </g>
                </svg>
              </div>
              <div className="mt-4 grid grid-cols-6 gap-2 text-[11px] text-slate-500">
                {['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'].map((label) => (
                  <div key={label} className="text-center">
                    {label}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-end gap-2 text-sm font-semibold text-slate-900">
                <span>1,425 MW</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Voltage Status</h3>
                <p className="text-[11px] text-slate-500">Normal (0.95 - 1.05 p.u.)</p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="relative mx-auto h-44 w-44">
                <svg viewBox="0 0 120 120" className="h-full w-full">
                  <circle cx="60" cy="60" r="40" fill="#e2e8f0" />
                  <circle cx="60" cy="60" r="40" fill="none" stroke="#34d399" strokeWidth="16" strokeDasharray="251.2" strokeDashoffset="20" strokeLinecap="round" transform="rotate(-90 60 60)" />
                  <circle cx="60" cy="60" r="40" fill="none" stroke="#fbbf24" strokeWidth="16" strokeDasharray="75.36 175.84" strokeLinecap="round" transform="rotate(-90 60 60)" />
                  <circle cx="60" cy="60" r="40" fill="none" stroke="#f87171" strokeWidth="16" strokeDasharray="16.75 234.45" strokeLinecap="round" transform="rotate(-90 60 60)" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-semibold text-slate-900">92%</span>
                </div>
              </div>
              <div className="space-y-3">
                <StatusRow color="bg-emerald-500" title="Normal" label="92%" subtitle="(0.95 - 1.05 p.u.)" />
                <StatusRow color="bg-orange-500" title="Low" label="6%" subtitle="(< 0.95 p.u.)" />
                <StatusRow color="bg-red-500" title="High" label="2%" subtitle="(> 1.05 p.u.)" />
              </div>
            </div>
          </div>
        </div>
      </PageBody>
    </Screen>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone = 'slate',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'slate' | 'green' | 'red' | 'blue' | 'orange' | 'violet';
}) {
  const toneClasses: Record<string, string> = {
    slate: 'text-slate-900',
    green: 'text-emerald-600',
    red: 'text-red-600',
    blue: 'text-sky-600',
    orange: 'text-orange-600',
    violet: 'text-violet-600',
  };

  return (
    <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-4">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
          {icon}
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
          <p className={`mt-2 text-2xl font-semibold ${toneClasses[tone]}`}>{value}</p>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ color, title, label, subtitle }: { color: string; title: string; label: string; subtitle: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={`inline-flex h-3.5 w-3.5 rounded-full ${color}`} />
        <div>
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="text-[11px] text-slate-500">{subtitle}</p>
        </div>
      </div>
      <p className="text-sm font-semibold text-slate-900">{label}</p>
    </div>
  );
}
