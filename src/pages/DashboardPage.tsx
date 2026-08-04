import { ArrowRight, Bell, ChevronDown } from 'lucide-react';
import { Screen, PageBody } from '@/components/ui/Page';
import { useApp } from '@/context/AppContext';
import type { Tab } from '@/components/BottomNav';

export function DashboardPage({ onNavigate, onBackToOptions }: { onNavigate: (t: Tab) => void; onBackToOptions: () => void }) {
  const { stations, activeStationId, setActiveStationId, activeStation } = useApp();

  return (
    <Screen dark>
      {/* Navy hero header */}
      <div className="px-4 pt-4 pb-8 bg-[#1a3361] text-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/10">
              <span className="text-lg font-bold">⚡</span>
            </div>
            <div>
              <h1 className="text-base font-bold leading-none">GridVision</h1>
              <p className="text-[10px] text-blue-200/80 mt-0.5">Sub-Station Monitoring</p>
            </div>
          </div>
          <button className="relative grid h-9 w-9 place-items-center rounded-lg bg-white/10">
            <Bell className="h-4 w-4" />
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 border-2 border-[#1a3361]" />
          </button>
        </div>

        {/* Station selector pill */}
        <button className="flex w-full items-center justify-between rounded-xl bg-white/10 px-4 py-2.5 text-sm">
          <span className="text-blue-50">{activeStation?.name ?? 'Select station'}</span>
          <ChevronDown className="h-4 w-4 text-blue-200" />
        </button>
      </div>

      {/* White body that lifts over the navy header */}
      <PageBody>
        <div className="-mt-6 space-y-4">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onBackToOptions();
            }}
            className="inline-block rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Back to Options
          </a>
          <div className="rounded-2xl bg-white p-5 shadow-lg">
            <h2 className="text-lg font-bold text-gray-900">Welcome to GridVision</h2>
            <p className="mt-1 text-sm text-gray-500 leading-relaxed">
              Your comprehensive sub-station monitoring and analytics platform. Monitor real-time
              data, analyze trends, and manage reports — all in one place.
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Stat label="Stations" value={stations.length} />
              <Stat label="Feeders" value={8} />
              <Stat label="Online" value="98%" accent="text-green-600" />
            </div>
          </div>

          {/* Quick access grid */}
          <div className="grid grid-cols-2 gap-3">
            <QuickCard
              title="Analytics"
              desc="View charts & trends"
              color="bg-blue-600"
              onClick={() => onNavigate('analytics')}
            />
            <QuickCard
              title="Alerts"
              desc="Active notifications"
              color="bg-amber-500"
              onClick={() => onNavigate('alerts')}
            />
            <QuickCard
              title="Reports"
              desc="Generate & export"
              color="bg-emerald-600"
              onClick={() => onNavigate('reports')}
            />
            <QuickCard
              title="More"
              desc="Settings & tools"
              color="bg-slate-700"
              onClick={() => onNavigate('more')}
            />
          </div>

          {/* Station quick switch */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Switch Station</h3>
            <div className="flex flex-wrap gap-2">
              {stations.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveStationId(s.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    activeStationId === s.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => onNavigate('analytics')}
            className="flex w-full items-center justify-center gap-1 text-sm font-medium text-blue-700"
          >
            Go to Analytics <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </PageBody>
    </Screen>
  );
}

function Stat({ label, value, accent = 'text-gray-900' }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 py-2">
      <p className={`text-lg font-bold ${accent}`}>{value}</p>
      <p className="text-[10px] text-gray-400">{label}</p>
    </div>
  );
}

function QuickCard({
  title,
  desc,
  color,
  onClick,
}: {
  title: string;
  desc: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl bg-white p-4 shadow-sm text-left transition active:scale-[0.98] hover:shadow-md"
    >
      <div className={`mb-2 inline-grid h-9 w-9 place-items-center rounded-xl ${color}`}>
        <ArrowRight className="h-4 w-4 text-white" />
      </div>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="text-[11px] text-gray-400">{desc}</p>
    </button>
  );
}
