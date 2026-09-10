import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import {
  Bell,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  MonitorSmartphone,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

import {
  api,
  type MyProfile,
  type NotificationDevice,
} from '@/services/api';
import { supabase } from '@/services/supabase';
import {
  isAuthConnectivityError,
  isAuthRateLimitError,
  isInvalidCredentialsError,
} from '@/services/authErrors';
import { useSettings } from '@/hooks/useSettings';
import {
  getRoleLabel,
  type AppRole,
} from '@/security/permissions';
import {
  AppHeader,
  PageBody,
  Screen,
} from '@/components/ui/Page';
import { DesktopPageHeading } from '@/components/layout/DesktopPageHeading';

function initials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'GV'
  );
}

function formatDate(value: string | null) {
  if (!value) return 'Not available';

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

export function MyProfilePage({
  user,
  role,
  onBack,
}: {
  user: User;
  role: AppRole;
  onBack: () => void;
}) {
  const {
    settings,
    requestNotificationPermission,
    disableNotifications,
  } = useSettings();

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

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceBusyId, setDeviceBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const [nextProfile, nextDevices] = await Promise.all([
        api.getMyProfile(),
        api.getMyNotificationDevices(),
      ]);

      setProfile(nextProfile);
      setDevices(nextDevices);
      setFullName(nextProfile.full_name);
      setPhone(nextProfile.phone ?? '');
    } catch (cause) {
      setLoadError(
        cause instanceof Error
          ? cause.message
          : 'Could not load your profile.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const passwordStrength = useMemo(() => {
    if (newPassword.length >= 12) return 'Strong';
    if (newPassword.length >= 8) return 'Good';
    if (newPassword) return 'Use at least 8 characters';
    return '';
  }, [newPassword]);

  const displayName =
    profile?.full_name ||
    user.user_metadata?.full_name ||
    user.email?.split('@')[0] ||
    'User';

  const displayRole = getRoleLabel(
    (profile?.account_role as AppRole) ?? role,
  );

  const saveProfile = async () => {
    const name = fullName.trim();

    if (!name) {
      setProfileError('Full name is required.');
      return;
    }

    setSavingProfile(true);
    setProfileError(null);
    setProfileMessage(null);

    try {
      const saved = await api.updateMyProfile({
        fullName: name,
        phone: phone.trim() || null,
      });

      setProfile((current) =>
        current
          ? {
              ...current,
              full_name: saved.full_name,
              phone: saved.phone,
            }
          : current,
      );

      setProfileMessage('Profile details saved.');
    } catch (cause) {
      setProfileError(
        cause instanceof Error
          ? cause.message
          : 'Could not save profile details.',
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    setPasswordError(null);
    setPasswordMessage(null);

    if (!user.email) {
      setPasswordError(
        'This account does not have an email address for password verification.',
      );
      return;
    }

    if (!currentPassword) {
      setPasswordError('Enter your current password.');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New password confirmation does not match.');
      return;
    }

    setSavingPassword(true);

    try {
      const verify = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (verify.error) {
        if (isAuthRateLimitError(verify.error)) {
          setPasswordError('Too many verification attempts. Please wait a while and try again.');
        } else if (isInvalidCredentialsError(verify.error)) {
          setPasswordError('Current password is incorrect.');
        } else if (isAuthConnectivityError(verify.error)) {
          setPasswordError('We could not verify your current password. Please check your connection and try again.');
        } else {
          setPasswordError('We could not verify your current password right now. Please try again.');
        }
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        setPasswordError('We could not change your password right now. Please try again.');
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      setPasswordMessage('Password changed successfully.');
    } catch {
      setPasswordError('We could not change your password right now. Please try again.');
    } finally {
      setSavingPassword(false);
    }
  };

  const updateNotifications = async () => {
    setDeviceError(null);

    try {
      if (settings.notificationsEnabled) {
        await disableNotifications();
        await load();
        return;
      }

      const permission = await requestNotificationPermission();

      if (permission !== 'granted') {
        setDeviceError('Notification permission was not granted.');
      } else {
        await load();
      }
    } catch (cause) {
      setDeviceError(
        cause instanceof Error
          ? cause.message
          : 'Could not update notifications on this device.',
      );
    }
  };

  const deactivateDevice = async (id: string) => {
    setDeviceBusyId(id);
    setDeviceError(null);

    try {
      await api.deactivateMyNotificationDevice(id);

      setDevices((items) =>
        items.map((device) =>
          device.id === id
            ? {
                ...device,
                is_active: false,
              }
            : device,
        ),
      );
    } catch (cause) {
      setDeviceError(
        cause instanceof Error
          ? cause.message
          : 'Could not deactivate this device.',
      );
    } finally {
      setDeviceBusyId(null);
    }
  };

  return (
    <Screen showStatusBar={false}>
      <AppHeader
        title="My Profile"
        onBack={onBack}
        prominent
        className="rounded-b-[22px] bg-gradient-to-br from-[#0D47A1] to-[#1565C0] shadow-md lg:hidden"
      />

      <DesktopPageHeading
        title="My Profile"
        subtitle="Manage your personal details, account security and devices"
      />

      <PageBody className="lg:max-w-7xl lg:px-6 lg:py-6 lg:pb-10 xl:px-8">
        {loading && !profile ? (
          <div className="grid min-h-60 place-items-center rounded-2xl border border-slate-200 bg-white">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        ) : loadError && !profile ? (
          <EmptyMessage
            message={loadError}
            onRetry={() => void load()}
          />
        ) : (
          <div className="space-y-4 lg:space-y-5">
            {/* =========================================================
                PROFILE SUMMARY
               ========================================================= */}
            <ProfileSummary
              user={user}
              profile={profile}
              displayName={displayName}
              displayRole={displayRole}
            />

            {/* =========================================================
                DESKTOP / MOBILE CONTENT GRID
               ========================================================= */}
            <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
              {/* Personal Details */}
              <Section
                title="Personal details"
                desktopTitle="Personal Details"
                subtitle="Update your personal information"
                icon={<UserRound className="h-5 w-5 text-blue-600" />}
              >
                <div className="space-y-4">
                  <Label label="Full name" required>
                    <input
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      className={inputClass}
                      autoComplete="name"
                    />
                  </Label>

                  <Label label="Phone">
                    <input
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      className={inputClass}
                      autoComplete="tel"
                      inputMode="tel"
                    />
                  </Label>

                  <div className="space-y-3 border-t border-slate-100 pt-4 lg:flex lg:min-h-[44px] lg:items-center lg:justify-between lg:gap-4 lg:space-y-0">
                    <div className="min-w-0 flex-1">
                      {profileError && (
                        <ErrorText>{profileError}</ErrorText>
                      )}

                      {profileMessage && (
                        <SuccessText>{profileMessage}</SuccessText>
                      )}
                    </div>

                    <ActionButton
                      onClick={() => void saveProfile()}
                      disabled={savingProfile}
                      icon={<Save className="h-4 w-4" />}
                      label={
                        savingProfile
                          ? 'Saving…'
                          : 'Save Changes'
                      }
                    />
                  </div>
                </div>
              </Section>

              {/* Account & Access */}
              <Section
                title="Account details"
                desktopTitle="Account & Access"
                subtitle="Your account and organisational access details"
                icon={<ShieldCheck className="h-5 w-5 text-blue-600" />}
              >
                <div className="divide-y divide-slate-100">
                  <ReadOnly
                    label="Email"
                    value={user.email ?? 'Not available'}
                    icon={<Mail className="h-4 w-4" />}
                    note="Managed by your verified GridVision account"
                  />

                  <ReadOnly
                    label="Employee Code"
                    value={profile?.employee_code || 'Not assigned'}
                  />

                  <ReadOnly
                    label="Role"
                    value={displayRole}
                  />

                  <ReadOnly
                    label="Assigned Office"
                    value={
                      profile?.assigned_offices.length
                        ? profile.assigned_offices.join(', ')
                        : 'Not assigned'
                    }
                  />

                  <ReadOnly
                    label="Accessible Stations"
                    value={
                      profile?.accessible_stations.length
                        ? profile.accessible_stations.join(', ')
                        : 'No station access'
                    }
                  />
                </div>
              </Section>

              {/* Security */}
              <Section
                title="Change password"
                desktopTitle="Security"
                subtitle="Change your account password"
                icon={<KeyRound className="h-5 w-5 text-blue-600" />}
              >
                <div className="space-y-4">
                  <PasswordField
                    label="Current Password"
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    visible={showCurrentPassword}
                    onToggle={() =>
                      setShowCurrentPassword((current) => !current)
                    }
                    autoComplete="current-password"
                    required
                  />

                  <div>
                    <PasswordField
                      label="New Password"
                      value={newPassword}
                      onChange={setNewPassword}
                      visible={showNewPassword}
                      onToggle={() =>
                        setShowNewPassword((current) => !current)
                      }
                      autoComplete="new-password"
                      required
                    />

                    {passwordStrength && (
                      <div className="mt-2">
                        <PasswordStrength
                          value={newPassword}
                          label={passwordStrength}
                        />
                      </div>
                    )}
                  </div>

                  <PasswordField
                    label="Confirm New Password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    visible={showConfirmPassword}
                    onToggle={() =>
                      setShowConfirmPassword((current) => !current)
                    }
                    autoComplete="new-password"
                    required
                  />

                  {passwordError && (
                    <ErrorText>{passwordError}</ErrorText>
                  )}

                  {passwordMessage && (
                    <SuccessText>{passwordMessage}</SuccessText>
                  )}

                  <div className="flex justify-end border-t border-slate-100 pt-4">
                    <ActionButton
                      onClick={() => void changePassword()}
                      disabled={savingPassword}
                      icon={<KeyRound className="h-4 w-4" />}
                      label={
                        savingPassword
                          ? 'Changing…'
                          : 'Change Password'
                      }
                    />
                  </div>
                </div>
              </Section>

              {/* Notifications */}
              <Section
                title="Notifications"
                desktopTitle="Notifications & Devices"
                subtitle="Manage push notifications and your registered devices"
                icon={<Bell className="h-5 w-5 text-blue-600" />}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800">
                        Push Notifications
                      </p>

                      <p className="mt-0.5 text-xs leading-5 text-slate-500">
                        Receive GridVision operational alerts on this device
                      </p>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-label="Push notifications"
                      aria-checked={settings.notificationsEnabled}
                      onClick={() => void updateNotifications()}
                      className={`relative h-7 w-12 shrink-0 rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                        settings.notificationsEnabled
                          ? 'bg-blue-600'
                          : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-all ${
                          settings.notificationsEnabled
                            ? 'left-[22px]'
                            : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>

                  {deviceError && (
                    <ErrorText>{deviceError}</ErrorText>
                  )}

                  <div>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                      Registered Devices
                    </p>

                    {devices.length === 0 ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-center">
                        <MonitorSmartphone className="mx-auto h-6 w-6 text-slate-400" />
                        <p className="mt-2 text-sm font-medium text-slate-700">
                          No registered notification devices
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {devices.map((device) => (
                          <DeviceRow
                            key={device.id}
                            device={device}
                            busy={deviceBusyId === device.id}
                            onDeactivate={deactivateDevice}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Section>
            </div>
          </div>
        )}
      </PageBody>
    </Screen>
  );
}

/* ================================================================
   PROFILE SUMMARY
   ================================================================ */

function ProfileSummary({
  user,
  profile,
  displayName,
  displayRole,
}: {
  user: User;
  profile: MyProfile | null;
  displayName: string;
  displayRole: string;
}) {
  const active = profile?.account_active !== false;

  const assignedOffice =
    profile?.assigned_offices.length
      ? profile.assigned_offices.join(', ')
      : 'Not assigned';

  const stationCount = profile?.accessible_stations.length ?? 0;

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm lg:border lg:border-slate-200 lg:px-7 lg:py-6 lg:shadow-[0_2px_8px_rgba(15,23,42,0.05)]">
      {/* Mobile */}
      <div className="flex items-center gap-3 lg:hidden">
        <ProfileAvatar
          user={user}
          displayName={displayName}
          mobile
        />

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold text-slate-900">
            {displayName}
          </h2>

          <p className="mt-0.5 text-sm font-medium text-blue-700">
            {displayRole}
          </p>

          <span
            className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${
              active
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden lg:grid lg:grid-cols-[100px_minmax(230px,0.95fr)_1px_minmax(380px,1.35fr)_140px] lg:items-center lg:gap-7">
        <ProfileAvatar
          user={user}
          displayName={displayName}
        />

        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight text-blue-950">
            {displayName}
          </h2>

          <p className="mt-1 truncate text-sm text-slate-600">
            {user.email ?? 'Email not available'}
          </p>

          <div className="mt-3 flex items-center gap-3 text-xs">
            <span className="text-slate-500">
              Employee Code
            </span>

            <span className="font-semibold text-slate-800">
              {profile?.employee_code || 'Not assigned'}
            </span>
          </div>
        </div>

        <div className="h-24 w-px bg-slate-200" />

        <dl className="grid grid-cols-[125px_minmax(0,1fr)] gap-x-5 gap-y-2.5 text-sm">
          <dt className="text-slate-500">
            Role
          </dt>

          <dd className="min-w-0 font-semibold text-slate-800">
            {displayRole}
          </dd>

          <dt className="text-slate-500">
            Assigned Office
          </dt>

          <dd
            className="min-w-0 truncate font-semibold text-slate-800"
            title={assignedOffice}
          >
            {assignedOffice}
          </dd>

          <dt className="text-slate-500">
            Accessible Stations
          </dt>

          <dd className="font-semibold text-slate-800">
            {stationCount}{' '}
            {stationCount === 1 ? 'Station' : 'Stations'}
          </dd>
        </dl>

        <div className="justify-self-end text-center">
          <span
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold ${
              active
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            <span
              className={`h-3 w-3 rounded-full ${
                active ? 'bg-emerald-600' : 'bg-red-600'
              }`}
            />

            {active ? 'Active' : 'Inactive'}
          </span>

          <p className="mt-2 text-[11px] text-slate-500">
            Account status
          </p>
        </div>
      </div>
    </section>
  );
}

function ProfileAvatar({
  user,
  displayName,
  mobile = false,
}: {
  user: User;
  displayName: string;
  mobile?: boolean;
}) {
  if (user.user_metadata?.avatar_url) {
    return (
      <img
        src={user.user_metadata.avatar_url as string}
        alt={`${displayName} profile`}
        className={
          mobile
            ? 'h-16 w-16 rounded-full object-cover'
            : 'h-20 w-20 rounded-full object-cover ring-4 ring-blue-50'
        }
      />
    );
  }

  return (
    <span
      className={
        mobile
          ? 'grid h-16 w-16 place-items-center rounded-full bg-blue-700 text-lg font-bold text-white'
          : 'grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-blue-100 to-blue-200 text-2xl font-bold text-blue-900 ring-4 ring-blue-50'
      }
    >
      {initials(displayName)}
    </span>
  );
}

/* ================================================================
   SECTION
   ================================================================ */

function Section({
  title,
  desktopTitle,
  subtitle,
  icon,
  children,
}: {
  title: string;
  desktopTitle?: string;
  subtitle?: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm lg:min-h-full lg:border lg:border-slate-200 lg:p-5 lg:shadow-[0_2px_8px_rgba(15,23,42,0.04)] xl:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-50 lg:h-10 lg:w-10">
          {icon}
        </span>

        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-800 lg:text-base lg:text-blue-950">
            <span className="lg:hidden">
              {title}
            </span>

            <span className="hidden lg:inline">
              {desktopTitle ?? title}
            </span>
          </h2>

          {subtitle && (
            <p className="mt-0.5 hidden text-xs leading-5 text-slate-500 lg:block">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {children}
    </section>
  );
}

/* ================================================================
   FORM CONTROLS
   ================================================================ */

function Label({
  label,
  children,
  required = false,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-600">
      <span className="mb-1.5 block">
        {label}

        {required && (
          <span
            className="ml-1 text-red-500"
            aria-hidden="true"
          >
            *
          </span>
        )}
      </span>

      {children}
    </label>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  onToggle,
  autoComplete,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoComplete: string;
  required?: boolean;
}) {
  return (
    <Label
      label={label}
      required={required}
    >
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass} pr-11`}
          autoComplete={autoComplete}
        />

        <button
          type="button"
          onClick={onToggle}
          aria-label={
            visible
              ? `Hide ${label.toLowerCase()}`
              : `Show ${label.toLowerCase()}`
          }
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-xl text-slate-400 transition hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
    </Label>
  );
}

function PasswordStrength({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const score =
    value.length >= 12
      ? 3
      : value.length >= 8
        ? 2
        : 1;

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1">
        {[1, 2, 3].map((index) => (
          <span
            key={index}
            className={`h-1 flex-1 rounded-full ${
              index <= score
                ? score >= 2
                  ? 'bg-emerald-500'
                  : 'bg-amber-400'
                : 'bg-slate-200'
            }`}
          />
        ))}
      </div>

      <span
        className={`text-[11px] font-medium ${
          value.length >= 8
            ? 'text-emerald-700'
            : 'text-amber-700'
        }`}
      >
        {label}
      </span>
    </div>
  );
}

/* ================================================================
   READ-ONLY ACCOUNT ROW
   ================================================================ */

function ReadOnly({
  label,
  value,
  icon,
  note,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  note?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 lg:grid lg:grid-cols-[155px_minmax(0,1fr)] lg:gap-5">
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500 lg:text-sm">
        {icon}
        {label}
      </span>

      <div className="min-w-0 text-right lg:text-left">
        <p className="break-words text-sm font-medium text-slate-800">
          {value}
        </p>

        {note && (
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-500 lg:justify-start">
            <ShieldCheck className="h-3 w-3" />
            {note}
          </p>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   DEVICE ROW
   ================================================================ */

function DeviceRow({
  device,
  busy,
  onDeactivate,
}: {
  device: NotificationDevice;
  busy: boolean;
  onDeactivate: (id: string) => Promise<void>;
}) {
  const platformName = device.platform
    ? `${device.platform[0].toUpperCase()}${device.platform.slice(1)} device`
    : 'Notification device';

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-slate-300">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">
        <MonitorSmartphone className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-slate-800">
            {platformName}
          </p>

          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              device.is_active
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-500'
            }`}
          >
            {device.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>

        <p className="mt-0.5 text-[11px] text-slate-500">
          Last updated {formatDate(device.updated_at)}
        </p>
      </div>

      {device.is_active && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDeactivate(device.id)}
          className="shrink-0 rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '…' : 'Deactivate'}
        </button>
      )}
    </div>
  );
}

/* ================================================================
   ACTION / MESSAGE COMPONENTS
   ================================================================ */

function ActionButton({
  onClick,
  disabled,
  icon,
  label,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
    >
      {icon}
      {label}
    </button>
  );
}

function ErrorText({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <p
      role="alert"
      className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
    >
      {children}
    </p>
  );
}

function SuccessText({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      {children}
    </p>
  );
}

function EmptyMessage({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-2xl bg-white p-6 text-center shadow-sm lg:border lg:border-slate-200">
      <p
        role="alert"
        className="text-sm text-red-700"
      >
        {message}
      </p>

      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
      >
        Retry
      </button>
    </div>
  );
}
