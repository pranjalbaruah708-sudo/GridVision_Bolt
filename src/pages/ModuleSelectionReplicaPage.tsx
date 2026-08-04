import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  ChevronRight,
  Home,
  LogOut,
  Menu,
  Settings,
  User,
} from 'lucide-react';

interface ModuleSelectionReplicaPageProps {
  username: string;
  role: string;
  permissions?: {
    manual?: boolean;
    scada?: boolean;
  };
  onSelectModule: (module: 'manual' | 'scada') => void;
}

export function ModuleSelectionReplicaPage({
  username,
  role,
  permissions,
  onSelectModule,
}: ModuleSelectionReplicaPageProps) {
  const canManual = permissions?.manual ?? true;
  const canScada = permissions?.scada ?? true;

  return (
    <div className="min-h-screen bg-[#f4f7fc] text-slate-800">
      <div className="rounded-b-[32px] bg-gradient-to-br from-[#1d4ed8] via-[#2563eb] to-[#10317a] px-4 pb-8 pt-3 shadow-[0_18px_45px_-20px_rgba(30,64,175,0.8)]">
        <div className="mb-4 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-100">
          <span>9:41</span>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-white" />
            <div className="h-1.5 w-1.5 rounded-full bg-white" />
            <div className="h-1.5 w-1.5 rounded-full bg-white" />
            <div className="h-3 w-6 rounded border border-white">
              <div className="h-full w-4 rounded bg-white" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src="https://i.pravatar.cc/100"
                alt="User"
                className="h-14 w-14 rounded-full border-2 border-white object-cover"
              />
              <div className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-white bg-emerald-500" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Welcome, {username}</h2>
              <p className="text-xs text-blue-100">{role}</p>
            </div>
          </div>

          <button className="relative" type="button">
            <Bell className="h-6 w-6 text-white" />
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              1
            </span>
          </button>
        </div>
      </div>

      <div className="px-4 -mt-5">
        <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_20px_45px_-20px_rgba(15,23,42,0.32)]">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-500">Available modules</p>
              <h3 className="text-2xl font-bold text-slate-900">Choose Module</h3>
            </div>
            <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              2 options
            </div>
          </div>

          <div
            onClick={() => canManual && onSelectModule('manual')}
            className={`mb-4 cursor-pointer rounded-2xl border p-5 shadow-sm transition ${
              canManual
                ? 'border-slate-200 bg-white active:scale-[0.98]'
                : 'border-slate-200 bg-slate-50 opacity-60'
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="mt-1 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50">
                <BookOpen className="h-6 w-6 text-[#2458e6]" strokeWidth={2} />
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-bold text-[#1d47c7]">Digital Log Books</h4>
                <p className="mt-2 text-sm font-medium text-slate-700">Manual Substation Operation</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Enter and manage log book entries with a clean and focused workflow.
                </p>
                <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-[#2458e6]">
                  Go to Module <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                </div>
              </div>
            </div>
          </div>

          <div
            onClick={() => canScada && onSelectModule('scada')}
            className={`cursor-pointer rounded-2xl border p-5 shadow-sm transition ${
              canScada
                ? 'border-emerald-200 bg-emerald-50 active:scale-[0.98]'
                : 'border-slate-200 bg-slate-50 opacity-60'
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="mt-1 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100">
                <Activity className="h-6 w-6 text-[#11875d]" strokeWidth={2} />
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-bold text-[#11875d]">SCADA Integration (Demo)</h4>
                <p className="mt-2 text-sm font-medium text-slate-700">Live Monitoring & Control</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Monitor incoming data and switch between live operational views.
                </p>
                <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-[#11875d]">
                  Go to Module <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <button className="flex w-full items-center justify-between border-b border-slate-200 px-5 py-4" type="button">
              <div className="flex items-center gap-4">
                <Bell className="h-5 w-5 text-slate-600" strokeWidth={2} />
                <span className="text-[15px] font-medium text-slate-700">Notifications</span>
              </div>
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold text-white">
                7
              </div>
            </button>

            <button className="flex w-full items-center gap-4 border-b border-slate-200 px-5 py-4" type="button">
              <User className="h-5 w-5 text-slate-600" strokeWidth={2} />
              <span className="text-[15px] font-medium text-slate-700">Profile</span>
            </button>

            <button className="flex w-full items-center gap-4 border-b border-slate-200 px-5 py-4" type="button">
              <Settings className="h-5 w-5 text-slate-600" strokeWidth={2} />
              <span className="text-[15px] font-medium text-slate-700">Settings</span>
            </button>

            <button className="flex w-full items-center gap-4 px-5 py-4" type="button">
              <LogOut className="h-5 w-5 text-red-500" strokeWidth={2} />
              <span className="text-[15px] font-medium text-slate-700">Logout</span>
            </button>
          </div>

          <div className="h-20" />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-lg items-center justify-around py-2">
          <button className="flex flex-col items-center" type="button">
            <Home className="h-6 w-6 text-[#2458e6]" strokeWidth={2.2} fill="#2458e6" />
            <span className="mt-1 text-[11px] font-semibold text-[#2458e6]">Home</span>
          </button>

          <button className="flex flex-col items-center" type="button">
            <AlertTriangle className="h-6 w-6 text-slate-500" strokeWidth={2} />
            <span className="mt-1 text-[11px] text-slate-500">Alerts</span>
          </button>

          <button className="flex flex-col items-center" type="button">
            <Menu className="h-6 w-6 text-slate-500" strokeWidth={2} />
            <span className="mt-1 text-[11px] text-slate-500">More</span>
          </button>
        </div>
      </div>
    </div>
  );
}
