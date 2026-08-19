import {
  ArrowLeft,
  CalendarDays,
  FileText,
  ClipboardList,
  BarChart3,
  Download,
  ChevronRight,
} from 'lucide-react';

type ReportsPageProps = {
  onOpenReport: () => void;
  onBack?: () => void;
};

export function ReportsPage({
  onOpenReport,
  onBack,
}: ReportsPageProps) {
  return (
    <div className="min-h-screen bg-slate-100">

      {/* =========================
          HEADER
      ========================== */}

      <div className="rounded-b-3xl bg-gradient-to-r from-blue-900 to-blue-700 px-5 pb-6 pt-5 shadow-lg">

        <div className="flex items-center justify-between text-white">

          {/* Back Button */}

          <button
            type="button"
            onClick={onBack}
            className="grid h-10 w-10 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
            aria-label="Back"
          >
            <ArrowLeft size={24} />
          </button>

          {/* Title */}

          <div className="text-center">
            <h1 className="text-2xl font-bold">
              Reports
            </h1>

            <p className="mt-1 text-xs text-blue-100/80">
              GridVision Reports
            </p>
          </div>

          {/* Calendar */}

          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
            aria-label="Calendar"
          >
            <CalendarDays size={22} />
          </button>

        </div>
      </div>


      {/* =========================
          BODY
      ========================== */}

      <div className="mx-auto w-full max-w-md px-4 py-5 pb-28">

        {/* Section Heading */}

        <div className="mb-4">
          <h2 className="text-base font-bold text-slate-800">
            Available Reports
          </h2>

          <p className="mt-1 text-xs text-slate-500">
            Select a report to view detailed information
          </p>
        </div>


        {/* =========================
            REPORT CARD 1
        ========================== */}

        <div className="mb-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">

          <div className="flex items-center gap-4">

            {/* Icon */}

            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50">
              <ClipboardList className="h-6 w-6 text-blue-700" />
            </div>


            {/* Content */}

            <div className="min-w-0 flex-1">

              <h3 className="text-sm font-bold text-slate-900">
                Log Book Report
              </h3>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                View daily station log book entries,
                operating parameters and recorded events.
              </p>

            </div>


            {/* Open Button */}

            <button
              type="button"
              onClick={onOpenReport}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-700 transition hover:bg-blue-100"
              aria-label="Open Log Book Report"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

          </div>

        </div>


        {/* =========================
            REPORT CARD 2
        ========================== */}

        <div className="mb-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">

          <div className="flex items-center gap-4">

            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50">
              <BarChart3 className="h-6 w-6 text-emerald-600" />
            </div>

            <div className="min-w-0 flex-1">

              <h3 className="text-sm font-bold text-slate-900">
                Performance Report
              </h3>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                View station and feeder performance
                and operational statistics.
              </p>

            </div>

            <button
              type="button"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 transition hover:bg-emerald-100"
              aria-label="Open Performance Report"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

          </div>

        </div>


        {/* =========================
            REPORT CARD 3
        ========================== */}

        <div className="mb-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">

          <div className="flex items-center gap-4">

            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-orange-50">
              <FileText className="h-6 w-6 text-orange-600" />
            </div>

            <div className="min-w-0 flex-1">

              <h3 className="text-sm font-bold text-slate-900">
                Interruption Report
              </h3>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                View interruption duration, frequency
                and causes for stations and feeders.
              </p>

            </div>

            <button
              type="button"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-orange-50 text-orange-600 transition hover:bg-orange-100"
              aria-label="Open Interruption Report"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

          </div>

        </div>


        {/* =========================
            REPORT CARD 4
        ========================== */}

        <div className="mb-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">

          <div className="flex items-center gap-4">

            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-50">
              <Download className="h-6 w-6 text-violet-600" />
            </div>

            <div className="min-w-0 flex-1">

              <h3 className="text-sm font-bold text-slate-900">
                Export Reports
              </h3>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                Download selected reports for
                further analysis and record keeping.
              </p>

            </div>

            <button
              type="button"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-600 transition hover:bg-violet-100"
              aria-label="Export Reports"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

          </div>

        </div>

      </div>
    </div>
  );
}

export default ReportsPage;