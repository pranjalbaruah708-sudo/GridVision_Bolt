import type {
  ReportFilterValues,
  ReportPeriod,
} from './types';

const IST_TIME_ZONE = 'Asia/Kolkata';

export function getTodayIstDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function getReportPeriodDates(period: ReportPeriod): Pick<ReportFilterValues, 'fromDate' | 'toDate'> {
  const today = getTodayIstDate();
  const dayCount = period === 'last-7-days'
    ? 7
    : period === 'last-15-days'
      ? 15
      : period === 'last-30-days'
        ? 30
        : period === 'last-3-months'
          ? 90
          : 1;
  return {
    fromDate: addDays(today, -(dayCount - 1)),
    toDate: today,
  };
}

export function getReportRangeIso(values: Pick<ReportFilterValues, 'fromDate' | 'toDate'>): { startIso: string; endIso: string } {
  const start = new Date(`${values.fromDate}T00:00:00+05:30`);
  const end = new Date(`${values.toDate}T00:00:00+05:30`);
  end.setTime(end.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function getReportPeriodLabel(values: Pick<ReportFilterValues, 'period' | 'fromDate' | 'toDate'>): string {
  if (values.period !== 'custom') {
    return values.period.replace(/-/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  }
  return `${values.fromDate} to ${values.toDate}`;
}

export function validateReportFilters(values: ReportFilterValues, options: { requireStation?: boolean; requireFeeder?: boolean }): string | null {
  if (!values.fromDate || !values.toDate) return 'Select both From and To dates.';
  if (values.fromDate > values.toDate) return 'From date cannot be after To date.';
  if (values.toDate > getTodayIstDate()) return 'Future dates cannot be selected.';
  const rangeDays = Math.floor((Date.parse(`${values.toDate}T00:00:00Z`) - Date.parse(`${values.fromDate}T00:00:00Z`)) / (24 * 60 * 60 * 1000)) + 1;
  if (rangeDays > 366) return 'Custom report ranges cannot exceed one year.';
  if (options.requireStation && !values.stationId) return 'Select a station.';
  if (options.requireFeeder && !values.feederId) return 'Select a feeder.';
  return null;
}
