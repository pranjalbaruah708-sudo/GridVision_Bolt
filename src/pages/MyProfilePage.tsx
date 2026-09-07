import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Bell, CheckCircle2, KeyRound, Loader2, Mail, MonitorSmartphone, Pencil, ShieldCheck, UserRound } from 'lucide-react';
import { api, type MyProfile, type NotificationDevice } from '@/services/api';
import { supabase } from '@/services/supabase';
import { useSettings } from '@/hooks/useSettings';
import { getRoleLabel, type AppRole } from '@/security/permissions';
import { AppHeader, PageBody, Screen } from '@/components/ui/Page';
import { DesktopPageHeading } from '@/components/layout/DesktopPageHeading';

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'GV';
}

function formatDate(value: string | null) {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

export function MyProfilePage({ user, role, onBack }: { user: User; role: AppRole; onBack: () => void }) {
  const { settings, requestNotificationPermission, disableNotifications } = useSettings();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [devices, setDevices] = useState<NotificationDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceBusyId, setDeviceBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const [nextProfile, nextDevices] = await Promise.all([api.getMyProfile(), api.getMyNotificationDevices()]);
      setProfile(nextProfile); setDevices(nextDevices); setFullName(nextProfile.full_name); setPhone(nextProfile.phone ?? '');
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not load your profile.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const passwordStrength = useMemo(() => newPassword.length >= 12 ? 'Strong' : newPassword.length >= 8 ? 'Good' : newPassword ? 'Use at least 8 characters' : '', [newPassword]);
  const displayName = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';

  const saveProfile = async () => {
    const name = fullName.trim();
    if (!name) { setProfileError('Full name is required.'); return; }
    setSavingProfile(true); setProfileError(null); setProfileMessage(null);
    try {
      const saved = await api.updateMyProfile({ fullName: name, phone: phone.trim() || null });
      setProfile((current) => current ? { ...current, full_name: saved.full_name, phone: saved.phone } : current);
      setProfileMessage('Profile details saved.');
    } catch (cause) { setProfileError(cause instanceof Error ? cause.message : 'Could not save profile details.'); }
    finally { setSavingProfile(false); }
  };

  const changePassword = async () => {
    setPasswordError(null); setPasswordMessage(null);
    if (!user.email) { setPasswordError('This account does not have an email address for password verification.'); return; }
    if (!currentPassword) { setPasswordError('Enter your current password.'); return; }
    if (newPassword.length < 8) { setPasswordError('New password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('New password confirmation does not match.'); return; }
    setSavingPassword(true);
    try {
      const verify = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
      if (verify.error) throw new Error('Current password is incorrect.');
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setPasswordMessage('Password changed successfully.');
    } catch (cause) { setPasswordError(cause instanceof Error ? cause.message : 'Could not change password.'); }
    finally { setSavingPassword(false); }
  };

  const updateNotifications = async () => {
    setDeviceError(null);
    try {
      if (settings.notificationsEnabled) { await disableNotifications(); await load(); return; }
      const permission = await requestNotificationPermission();
      if (permission !== 'granted') setDeviceError('Notification permission was not granted.');
      else await load();
    } catch (cause) {
      setDeviceError(cause instanceof Error ? cause.message : 'Could not update notifications on this device.');
    }
  };

  const deactivateDevice = async (id: string) => {
    setDeviceBusyId(id); setDeviceError(null);
    try { await api.deactivateMyNotificationDevice(id); setDevices((items) => items.map((device) => device.id === id ? { ...device, is_active: false } : device)); }
    catch (cause) { setDeviceError(cause instanceof Error ? cause.message : 'Could not deactivate this device.'); }
    finally { setDeviceBusyId(null); }
  };

  return <Screen showStatusBar={false}>
    <AppHeader title="My Profile" onBack={onBack} prominent className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] shadow-md lg:hidden" />
    <DesktopPageHeading title="My Profile" subtitle="Account, access and device preferences" />
    <PageBody>
      {loading && !profile ? <div className="grid min-h-60 place-items-center rounded-2xl bg-white"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div> : loadError && !profile ? <EmptyMessage message={loadError} onRetry={() => void load()} /> : <div className="space-y-4">
        <section className="rounded-2xl bg-white p-4 shadow-sm"><div className="flex items-center gap-3">{user.user_metadata?.avatar_url ? <img src={user.user_metadata.avatar_url as string} alt="Profile" className="h-16 w-16 rounded-full object-cover" /> : <span className="grid h-16 w-16 place-items-center rounded-full bg-blue-700 text-lg font-bold text-white">{initials(displayName)}</span>}<div className="min-w-0 flex-1"><h2 className="truncate text-lg font-bold text-slate-900">{displayName}</h2><p className="mt-0.5 text-sm text-blue-700">{getRoleLabel(profile?.account_role as AppRole ?? role)}</p><span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${profile?.account_active === false ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}><CheckCircle2 className="h-3.5 w-3.5" />{profile?.account_active === false ? 'Inactive' : 'Active'}</span></div></div></section>

        <Section title="Personal details" icon={<UserRound className="h-4 w-4 text-blue-600" />}><Label label="Full name"><input value={fullName} onChange={(event) => setFullName(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" autoComplete="name" /></Label><Label label="Phone"><input value={phone} onChange={(event) => setPhone(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" autoComplete="tel" inputMode="tel" /></Label>{profileError && <ErrorText>{profileError}</ErrorText>}{profileMessage && <SuccessText>{profileMessage}</SuccessText>}<button type="button" onClick={() => void saveProfile()} disabled={savingProfile} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"><Pencil className="h-4 w-4" />{savingProfile ? 'Saving…' : 'Save changes'}</button></Section>

        <Section title="Account details" icon={<ShieldCheck className="h-4 w-4 text-slate-600" />}><ReadOnly label="Email" value={user.email ?? 'Not available'} icon={<Mail className="h-4 w-4" />} /><p className="-mt-1 text-[11px] text-slate-500">Email is managed by your verified Supabase Auth account.</p><ReadOnly label="Employee code" value={profile?.employee_code || 'Not assigned'} /><ReadOnly label="Role" value={getRoleLabel(profile?.account_role as AppRole ?? role)} /><ReadOnly label="Assigned office" value={profile?.assigned_offices.length ? profile.assigned_offices.join(', ') : 'Not assigned'} /><ReadOnly label="Accessible stations" value={profile?.accessible_stations.length ? profile.accessible_stations.join(', ') : 'No station access'} /></Section>

        <Section title="Change password" icon={<KeyRound className="h-4 w-4 text-blue-600" />}><Label label="Current password"><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" autoComplete="current-password" /></Label><Label label="New password"><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" autoComplete="new-password" /></Label>{passwordStrength && <p className={`-mt-2 text-xs ${newPassword.length >= 8 ? 'text-emerald-700' : 'text-amber-700'}`}>{passwordStrength}</p>}<Label label="Confirm new password"><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" autoComplete="new-password" /></Label>{passwordError && <ErrorText>{passwordError}</ErrorText>}{passwordMessage && <SuccessText>{passwordMessage}</SuccessText>}<button type="button" onClick={() => void changePassword()} disabled={savingPassword} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"><KeyRound className="h-4 w-4" />{savingPassword ? 'Changing…' : 'Change password'}</button></Section>

        <Section title="Notifications" icon={<Bell className="h-4 w-4 text-amber-600" />}><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">Push notifications</p><p className="text-xs text-slate-500">{settings.notificationsEnabled ? 'Enabled on this device' : 'Disabled on this device'}</p></div><button type="button" role="switch" aria-checked={settings.notificationsEnabled} onClick={() => void updateNotifications()} className={`relative h-6 w-11 rounded-full transition ${settings.notificationsEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${settings.notificationsEnabled ? 'left-[22px]' : 'left-0.5'}`} /></button></div>{deviceError && <ErrorText>{deviceError}</ErrorText>}<div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100">{devices.length === 0 ? <p className="px-3 py-3 text-xs text-slate-500">No registered notification devices.</p> : devices.map((device) => <div key={device.id} className="flex items-center gap-3 p-3"><MonitorSmartphone className="h-4 w-4 text-slate-500" /><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-800">{device.platform ? `${device.platform[0].toUpperCase()}${device.platform.slice(1)} device` : 'Notification device'}</p><p className="text-[11px] text-slate-500">Last updated {formatDate(device.updated_at)}</p></div><span className={`text-[11px] font-semibold ${device.is_active ? 'text-emerald-700' : 'text-slate-400'}`}>{device.is_active ? 'Active' : 'Inactive'}</span>{device.is_active && <button type="button" disabled={deviceBusyId === device.id} onClick={() => void deactivateDevice(device.id)} className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">{deviceBusyId === device.id ? '…' : 'Deactivate'}</button>}</div>)}</div></Section>
      </div>}
    </PageBody>
  </Screen>;
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) { return <section className="rounded-2xl bg-white p-4 shadow-sm"><h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">{icon}{title}</h2><div className="space-y-3">{children}</div></section>; }
function Label({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs font-semibold text-slate-600"><span className="mb-1 block">{label}</span>{children}</label>; }
function ReadOnly({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) { return <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-0"><span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">{icon}{label}</span><span className="text-right text-sm font-medium text-slate-800">{value}</span></div>; }
function ErrorText({ children }: { children: React.ReactNode }) { return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{children}</p>; }
function SuccessText({ children }: { children: React.ReactNode }) { return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{children}</p>; }
function EmptyMessage({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="rounded-2xl bg-white p-5 text-center shadow-sm"><p className="text-sm text-red-700">{message}</p><button type="button" onClick={onRetry} className="mt-3 text-sm font-semibold text-blue-700">Retry</button></div>; }
