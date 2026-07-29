import { useState } from 'react';
import { Save, CheckCircle2 } from 'lucide-react';
import { api } from '@/services/api';
import { useApp } from '@/context/AppContext';
import { Screen, AppHeader, PageBody } from '@/components/ui/Page';

// The 11 parameter rows shown in the Operator Entry screenshot.
const PARAMETERS: { key: string; label: string; unit: string; type: 'number' | 'text' }[] = [
  { key: 'mw', label: 'MW (Load)', unit: 'MW', type: 'number' },
  { key: 'mvAr', label: 'MVAr (Reactive)', unit: 'MVAr', type: 'number' },
  { key: 'voltage', label: 'Voltage', unit: 'kV', type: 'number' },
  { key: 'current', label: 'Current', unit: 'A', type: 'number' },
  { key: 'pf', label: 'Power Factor', unit: '', type: 'number' },
  { key: 'frequency', label: 'Frequency', unit: 'Hz', type: 'number' },
  { key: 'temp', label: 'Transformer Temp', unit: '°C', type: 'number' },
  { key: 'oilLevel', label: 'Oil Level', unit: '%', type: 'number' },
  { key: 'tapPos', label: 'Tap Position', unit: '', type: 'number' },
  { key: 'weather', label: 'Weather', unit: '', type: 'text' },
  { key: 'remarks', label: 'Remarks', unit: '', type: 'text' },
];

export function OperatorEntryPage({ onBack }: { onBack: () => void }) {
  const { activeStationId, activeStation, activeFeeders } = useApp();
  const [feederId, setFeederId] = useState(activeFeeders[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, string>>({ weather: 'Clear', remarks: 'Normal' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    if (!activeStationId || !feederId) return;
    setSaving(true);
    setSaved(false);
    try {
      const now = new Date();
      await api.addLogEntry({
        station_id: activeStationId,
        feeder_id: feederId,
        entry_date: now.toISOString().slice(0, 10),
        entry_time: now.toTimeString().slice(0, 5),
        mw: Number(values.mw) || 0,
        voltage_kv: Number(values.voltage) || 0,
        current_a: Number(values.current) || 0,
        remarks: values.remarks || values.weather || 'Operator entry',
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <AppHeader title="Operator Entry" subtitle={activeStation?.name ?? 'Select station'} onBack={onBack} />
      <PageBody>
        {/* Feeder + date/time header card */}
        <div className="mb-3 rounded-2xl bg-white p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium uppercase text-gray-400">Feeder</span>
              <select
                value={feederId}
                onChange={(e) => setFeederId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-500"
              >
                {activeFeeders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium uppercase text-gray-400">Date / Time</span>
              <input
                type="text"
                readOnly
                value={new Date().toLocaleString()}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 outline-none"
              />
            </label>
          </div>
        </div>

        {/* Parameter rows */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-gray-800">Parameters</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {PARAMETERS.map((p) => (
              <div key={p.key} className="flex items-center gap-3 px-4 py-2.5">
                <label className="flex-1 text-sm text-gray-700">{p.label}</label>
                <div className="flex w-36 items-center gap-2">
                  <input
                    type={p.type}
                    inputMode={p.type === 'number' ? 'decimal' : 'text'}
                    value={values[p.key] ?? ''}
                    onChange={(e) => set(p.key, e.target.value)}
                    placeholder="—"
                    className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-right text-sm text-gray-900 outline-none focus:border-blue-500"
                  />
                  {p.unit && <span className="w-12 flex-shrink-0 text-[11px] text-gray-400">{p.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Save button */}
        <button
          onClick={save}
          disabled={saving || !feederId}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-sm font-bold text-white shadow-md transition hover:bg-blue-800 active:scale-[0.99] disabled:opacity-40"
        >
          {saving ? (
            'Saving…'
          ) : saved ? (
            <>
              <CheckCircle2 className="h-4 w-4" /> Entry Saved
            </>
          ) : (
            <>
              <Save className="h-4 w-4" /> Save Entry
            </>
          )}
        </button>

        {saved && (
          <p className="mt-2 text-center text-[11px] text-green-600">
            Entry recorded to log book and synced.
          </p>
        )}
      </PageBody>
    </Screen>
  );
}
