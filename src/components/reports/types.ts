import type {
  ReactNode,
} from 'react';
import type {
  Feeder,
  Station,
} from '@/types';

export type ReportPeriod =
  | 'today'
  | 'last-7-days'
  | 'last-15-days'
  | 'last-30-days'
  | 'last-3-months'
  | 'custom';

export type ReportFilterValues = {
  stationId: string;
  feederId: string;
  period: ReportPeriod;
  fromDate: string;
  toDate: string;
  grouping?: string;
  status?: string;
  cause?: string;
  threshold?: string;
  parameter?: string;
  comparisonMetric?: string;
};

export type ReportFilterOptions = {
  stations: Station[];
  feeders: Feeder[];
  feederApplicable?: boolean;
  groupingOptions?: Array<{ value: string; label: string }>;
  statusOptions?: Array<{ value: string; label: string }>;
  causeOptions?: Array<{ value: string; label: string }>;
  thresholdApplicable?: boolean;
  parameterOptions?: Array<{ value: string; label: string }>;
  comparisonMetricOptions?: Array<{ value: string; label: string }>;
  requireStation?: boolean;
  requireFeeder?: boolean;
};

export type ReportSummaryCard = {
  label: string;
  value: string;
  detail?: string;
  tone?: 'blue' | 'green' | 'orange' | 'red' | 'slate';
};

export type ReportColumn<Row> = {
  id: string;
  label: string;
  value: (row: Row) => ReactNode;
  csvValue?: (row: Row) => string | number | null | undefined;
  align?: 'left' | 'right';
  className?: string;
};

export type ReportPreviewMeta = {
  title: string;
  stationScope: string;
  feederScope?: string;
  periodLabel: string;
  generatedAt: Date;
  appliedFilters: string[];
};

export type ReportResource<Row> = {
  rows: Row[];
  loading: boolean;
  error: string | null;
  generatedAt: Date | null;
};
