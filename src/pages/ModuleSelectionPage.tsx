import {
  Bell,
  ChevronRight,
  BookOpen,
  Activity,
  User,
  Settings,
  LogOut,
  Home,
  AlertTriangle,
  Menu,
} from "lucide-react";

interface ModuleSelectionPageProps {
  onSelectModule: (module: "manual" | "scada") => void;
}

export function ModuleSelectionPage({
  onSelectModule,
}: ModuleSelectionPageProps) {
  return (
    <div className="min-h-screen bg-[#f6f8fc]">

      {/* Status/Header */}

      <div className="rounded-b-[32px] bg-blue-700 px-4 pt-3 pb-8 shadow-lg">

        {/* Fake Status Bar */}

        <div className="mb-4 flex items-center justify-between text-xs font-semibold text-white">

          <span>9:41</span>

          <div className="flex items-center gap-2">

            <div className="h-1.5 w-1.5 rounded-full bg-white" />

            <div className="h-1.5 w-1.5 rounded-full bg-white" />

            <div className="h-1.5 w-1.5 rounded-full bg-white" />

            <div className="h-3 w-6 rounded border border-white">
              <div className="h-full w-4 rounded bg-white"></div>
            </div>

          </div>

        </div>

        {/* User Header */}

        <div className="flex items-center justify-between">

          <div className="flex items-center gap-3">

            <div className="relative">

              <img
                src="https://i.pravatar.cc/100"
                alt="User"
                className="h-14 w-14 rounded-full border-2 border-white object-cover"
              />

              <div className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-white bg-green-500"></div>

            </div>

            <div>

              <h2 className="text-base font-bold text-white">
                Welcome, Pranjal Baruah
              </h2>

              <p className="text-xs text-blue-100">
                GM (SCADA & IT)
              </p>

            </div>

          </div>

          <button className="relative">

            <Bell className="h-6 w-6 text-white" />

            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              1
            </span>

          </button>

        </div>

      </div>
      

      {/* Content */}

      {/* Main Card */}

    <div className="px-4 -mt-5">

    <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_40px_-12px_rgba(15,23,42,0.18)]">
        <h3 className="mb-4 text-xl font-bold text-slate-800">
          Choose Module
        </h3>
                {/* ================================
            DIGITAL LOG BOOKS CARD
        ================================= */}

        <div
          onClick={() => onSelectModule("manual")}
          className="mb-5 cursor-pointer rounded-2xl border border-[#dfe5ef] bg-white p-5 shadow-sm transition active:scale-[0.98]"
        >
          <div className="flex items-start gap-4">

            <div className="mt-1 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50">

              <BookOpen
                className="h-6 w-6 text-[#2458e6]"
                strokeWidth={2}
              />

            </div>

            <div className="flex-1">

              <h2 className="text-xl font-bold text-[#1d47c7]">
                Digital Log Books
              </h2>

              <p className="mt-3 text-sm font-medium text-slate-700">
                Manual Substation Operation
              </p>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Enter and manage log book entries
              </p>

              <button
                className="mt-6 flex items-center gap-2 text-base font-semibold text-[#2458e6]"
              >
                Go to Module

                <ChevronRight
                  className="h-5 w-5"
                  strokeWidth={2.5}
                />
              </button>

            </div>

          </div>

        </div>
                {/* ================================
            SCADA INTEGRATION CARD
        ================================= */}

        <div
          onClick={() => onSelectModule("scada")}
          className="mb-5 cursor-pointer rounded-2xl border border-[#dcefe5] bg-[#f7fdf9] p-5 shadow-sm transition active:scale-[0.98]"
        >
          <div className="flex items-start gap-4">

            <div className="mt-1 flex h-11 w-11 items-center justify-center rounded-xl bg-green-50">

              <Activity
                className="h-6 w-6 text-[#11875d]"
                strokeWidth={2}
              />

            </div>

            <div className="flex-1">

              <h2 className="text-xl font-bold text-[#11875d]">
                SCADA Integration (Demo)
              </h2>

              <p className="mt-3 text-sm font-medium text-slate-700">
                Live Monitoring & Control
              </p>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Real-time data from SCADA system
              </p>

              <button
                className="mt-6 flex items-center gap-2 text-base font-semibold text-[#11875d]"
              >
                Go to Module

                <ChevronRight
                  className="h-5 w-5"
                  strokeWidth={2.5}
                />
              </button>

            </div>

          </div>

        </div>

        {/* ================================
            MENU LIST
        ================================= */}

        <div className="overflow-hidden rounded-2xl border border-[#dfe5ef] bg-white shadow-sm">

          {/* Notifications */}

          <button className="flex w-full items-center justify-between border-b border-slate-200 px-5 py-4">

            <div className="flex items-center gap-4">

              <Bell
                className="h-5 w-5 text-slate-600"
                strokeWidth={2}
              />

              <span className="text-[15px] font-medium text-slate-700">
                Notifications
              </span>

            </div>

            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold text-white">
              7
            </div>

          </button>

          {/* Profile */}

          <button className="flex w-full items-center gap-4 border-b border-slate-200 px-5 py-4">

            <User
              className="h-5 w-5 text-slate-600"
              strokeWidth={2}
            />

            <span className="text-[15px] font-medium text-slate-700">
              Profile
            </span>

          </button>

          {/* Settings */}

          <button className="flex w-full items-center gap-4 border-b border-slate-200 px-5 py-4">

            <Settings
              className="h-5 w-5 text-slate-600"
              strokeWidth={2}
            />

            <span className="text-[15px] font-medium text-slate-700">
              Settings
            </span>

          </button>

          {/* Logout */}

          <button className="flex w-full items-center gap-4 px-5 py-4">

            <LogOut
              className="h-5 w-5 text-red-500"
              strokeWidth={2}
            />

            <span className="text-[15px] font-medium text-slate-700">
              Logout
            </span>

          </button>

        </div>
                {/* Bottom Spacing */}

        <div className="h-20" />

      </div>

      {/* ====================================
          Bottom Navigation
      ===================================== */}

      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white">

        <div className="mx-auto flex max-w-lg items-center justify-around py-2">

          {/* Home */}

          <button className="flex flex-col items-center">

            <Home
              className="h-6 w-6 text-[#2458e6]"
              strokeWidth={2.2}
              fill="#2458e6"
            />

            <span className="mt-1 text-[11px] font-semibold text-[#2458e6]">
              Home
            </span>

          </button>

          {/* Alerts */}

          <button className="flex flex-col items-center">

            <AlertTriangle
              className="h-6 w-6 text-slate-500"
              strokeWidth={2}
            />

            <span className="mt-1 text-[11px] text-slate-500">
              Alerts
            </span>

          </button>

          {/* More */}

          <button className="flex flex-col items-center">

            <Menu
              className="h-6 w-6 text-slate-500"
              strokeWidth={2}
            />

            <span className="mt-1 text-[11px] text-slate-500">
              More
            </span>

          </button>

        </div>

      </div>

            {/* Bottom Spacing */}

        <div className="h-24" />

      </div>

    </div>
  );
}