import {
  useMemo,
  type ReactNode,
} from 'react';
import {
  CalendarDays,
  Filter,
} from 'lucide-react';
import {
  getReportPeriodDates,
  getTodayIstDate,
  validateReportFilters,
} from './reportDates';
import type {
  ReportFilterOptions,
  ReportFilterValues,
  ReportPeriod,
} from './types';

const PERIOD_OPTIONS: Array<{ value: ReportPeriod; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'last-7-days', label: 'Last 7 Days' },
  { value: 'last-15-days', label: 'Last 15 Days' },
  { value: 'last-30-days', label: 'Last 30 Days' },
  { value: 'last-3-months', label: 'Last 3 Months' },
  { value: 'custom', label: 'Custom' },
];

const INPUT_CLASS = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

type ReportFiltersProps = {
  values: ReportFilterValues;
  options: ReportFilterOptions;
  generating?: boolean;
  onChange: (values: ReportFilterValues) => void;
  onGenerate: () => void;
  desktopLayout?: boolean;
  futureOnly?: boolean;
};

export function ReportFilters({
  values,
  options,
  generating = false,
  onChange,
  onGenerate,
  desktopLayout = false,
  futureOnly = false,
}: ReportFiltersProps) {
  const feeders = useMemo(
    () => options.feeders.filter((feeder) => !values.stationId || feeder.station_id === values.stationId),
    [options.feeders, values.stationId]
  );
  const validationError = validateReportFilters(values, { ...options, futureOnly });

  function updatePeriod(period: ReportPeriod) {
    if (period === 'custom') {
      onChange({ ...values, period, operatorId: '' });
      return;
    }
    onChange({ ...values, period, ...getReportPeriodDates(period), operatorId: '' });
  }

  function updateDate(key: 'fromDate' | 'toDate', value: string) {
    onChange({ ...values, period: 'custom', [key]: value, operatorId: '' });
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80" data-report-exclude>
      <div className="mb-3 flex items-center gap-2">
        <Filter className="h-4 w-4 text-blue-700" />
        <h2 className="text-sm font-bold text-slate-800">Report Filters</h2>
      </div>

      <div className={`grid gap-3 sm:grid-cols-2 ${desktopLayout ? 'lg:grid-cols-3 xl:grid-cols-5' : ''}`}>
        <Field label="Station scope">
          <select value={values.stationId} onChange={(event) => onChange({ ...values, stationId: event.target.value, feederId: '', operatorId: '' })} className={INPUT_CLASS}>
            {!options.requireStation && <option value="">All accessible stations</option>}
            {options.stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
          </select>
        </Field>

        {options.feederApplicable && (
          <Field label="Feeder scope">
            <select value={values.feederId} onChange={(event) => onChange({ ...values, feederId: event.target.value })} className={INPUT_CLASS}>
              {!options.requireFeeder && <option value="">All applicable feeders</option>}
              {feeders.map((feeder) => <option key={feeder.id} value={feeder.id}>{feeder.name}</option>)}
            </select>
          </Field>
        )}

        <Field label="Period">
          <select value={values.period} onChange={(event) => updatePeriod(event.target.value as ReportPeriod)} className={INPUT_CLASS}>
            {PERIOD_OPTIONS.filter((period) => !futureOnly || period.value === 'today' || period.value === 'custom').map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
          </select>
        </Field>

        <Field label="From">
          <input type="date" value={values.fromDate} min={futureOnly ? getTodayIstDate() : undefined} max={futureOnly ? (values.toDate || undefined) : (values.toDate || getTodayIstDate())} onChange={(event) => updateDate('fromDate', event.target.value)} className={INPUT_CLASS} />
        </Field>

        <Field label="To">
          <input type="date" value={values.toDate} min={futureOnly ? (values.fromDate || getTodayIstDate()) : values.fromDate} max={futureOnly ? undefined : getTodayIstDate()} onChange={(event) => updateDate('toDate', event.target.value)} className={INPUT_CLASS} />
        </Field>

        {options.groupingOptions && options.groupingOptions.length > 0 && (
          <Field label="Grouping">
            <select value={values.grouping ?? ''} onChange={(event) => onChange({ ...values, grouping: event.target.value })} className={INPUT_CLASS}>
              <option value="">No grouping</option>
              {options.groupingOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
        )}

        {options.statusOptions && options.statusOptions.length > 0 && (
          <Field label="Status">
            <select value={values.status ?? ''} onChange={(event) => onChange({ ...values, status: event.target.value })} className={INPUT_CLASS}>
              <option value="">All statuses</option>
              {options.statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
        )}

        {options.causeOptions && options.causeOptions.length > 0 && (
          <Field label="Cause">
            <select value={values.cause ?? ''} onChange={(event) => onChange({ ...values, cause: event.target.value })} className={INPUT_CLASS}>
              <option value="">All causes</option>
              {options.causeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
        )}

        {options.thresholdApplicable && (
          <Field label="Below completeness (%)">
            <input type="number" min="0" max="100" step="1" value={values.threshold ?? '90'} onChange={(event) => onChange({ ...values, threshold: event.target.value })} className={INPUT_CLASS} />
          </Field>
        )}

        {options.parameterOptions && options.parameterOptions.length > 0 && (
          <Field label="Parameter">
            <select value={values.parameter ?? ''} onChange={(event) => onChange({ ...values, parameter: event.target.value })} className={INPUT_CLASS}>
              <option value="">All configured parameters</option>
              {options.parameterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
        )}

        {options.operatorOptions && (
          <Field label={options.operatorOptions.length === 0 ? 'Operator (generate report to load options)' : 'Operator'}>
            <select value={values.operatorId ?? ''} onChange={(event) => onChange({ ...values, operatorId: event.target.value })} className={INPUT_CLASS}>
              <option value="">All operators</option>
              {options.operatorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
        )}

        {options.comparisonMetricOptions && options.comparisonMetricOptions.length > 0 && (
          <Field label="Comparison metric">
            <select value={values.comparisonMetric ?? options.comparisonMetricOptions[0]?.value ?? ''} onChange={(event) => onChange({ ...values, comparisonMetric: event.target.value })} className={INPUT_CLASS}>
              {options.comparisonMetricOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
        )}
      </div>

      {validationError && <p className="mt-3 text-xs font-medium text-red-600">{validationError}</p>}

      <button type="button" onClick={onGenerate} disabled={Boolean(validationError) || generating} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60" aria-busy={generating}>
        <CalendarDays className="h-4 w-4" />
        {generating ? 'Generating…' : 'Generate Report'}
      </button>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1.5 text-[11px] font-bold text-slate-600"><span>{label}</span>{children}</label>;
}
