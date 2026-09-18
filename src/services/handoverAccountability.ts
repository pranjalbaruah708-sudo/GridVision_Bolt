import { supabase } from './supabase';

export interface HandoverAccountability {
  id: string;
  status: string;
  outgoing_shift_name: string;
  incoming_shift_name: string;
  outgoing_in_charge_name: string | null;
  incoming_in_charge_name: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  accepted_by_name: string | null;
  accepted_at: string | null;
}

export async function getHandoverAccountability(ids: string[]): Promise<Map<string, HandoverAccountability>> {
  if (!ids.length) return new Map();
  const { data, error } = await supabase.rpc('get_shift_handover_accountability', { p_ids: [...new Set(ids)] });
  if (error) throw error;
  return new Map((data as HandoverAccountability[] ?? []).map(row => [row.id, row]));
}
