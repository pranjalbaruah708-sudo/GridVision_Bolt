import type {
  ReportSummaryCard,
} from './types';

const TONE_CLASSES: Record<NonNullable<ReportSummaryCard['tone']>, string> = {
  blue: 'text-blue-700 bg-blue-50',
  green: 'text-emerald-700 bg-emerald-50',
  orange: 'text-orange-700 bg-orange-50',
  red: 'text-red-700 bg-red-50',
  slate: 'text-slate-700 bg-slate-100',
};

export function ReportSummaryCards({ cards }: { cards: ReportSummaryCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const tone = card.tone ?? 'blue';
        return <div key={card.label} className={`rounded-xl p-3 ${TONE_CLASSES[tone]}`}>
          <p className="text-[10px] font-bold uppercase tracking-wide opacity-75">{card.label}</p>
          <p className="mt-1 text-lg font-extrabold">{card.value}</p>
          {card.detail && <p className="mt-1 text-[11px] opacity-80">{card.detail}</p>}
        </div>;
      })}
    </section>
  );
}
