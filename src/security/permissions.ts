import type { Route } from '@/hooks/useRouter';

export const APP_ROLES = ['OPERATOR', 'FIELD_OFFICER', 'ADMIN', 'SUPER_ADMIN'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const CAPABILITIES = [
  'view_operational_tools',
  'create_parameter_entry',
  'create_interruption_entry',
  'view_administration',
  'view_organisation_structure',
  'manage_scoped_feeders',
  'view_scoped_users',
  'manage_scoped_configuration',
  'view_scoped_audit',
  'manage_all_feeders',
  'manage_users',
  'manage_normal_roles',
  'manage_system_configuration',
  'view_all_audit',
  'manage_offices',
  'manage_office_hierarchy',
  'manage_stations',
  'manage_station_office_mappings',
  'grant_or_revoke_super_admin',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<AppRole, readonly Capability[]> = {
  OPERATOR: ['view_operational_tools', 'create_parameter_entry', 'create_interruption_entry'],
  FIELD_OFFICER: [
    'view_administration', 'view_organisation_structure', 'manage_scoped_feeders',
    'view_scoped_users', 'manage_scoped_configuration', 'view_scoped_audit',
  ],
  ADMIN: [
    'view_administration', 'view_organisation_structure', 'manage_all_feeders', 'manage_users',
    'manage_normal_roles', 'manage_system_configuration', 'view_all_audit',
  ],
  SUPER_ADMIN: [
    'view_administration', 'view_organisation_structure', 'manage_all_feeders', 'manage_users',
    'manage_normal_roles', 'manage_system_configuration', 'view_all_audit', 'manage_offices',
    'manage_office_hierarchy', 'manage_stations', 'manage_station_office_mappings',
    'grant_or_revoke_super_admin',
  ],
};

export function hasCapability(role: AppRole | null | undefined, capability: Capability): boolean {
  return role ? ROLE_CAPABILITIES[role].includes(capability) : false;
}

/** Shutdown initiation is an operational action for operators and officers only. */
export function canInitiateShutdown(role: AppRole | null | undefined): boolean {
  return role === 'OPERATOR' || role === 'FIELD_OFFICER';
}

/** Approval remains available to officers and administrative supervisors. */
export function canApproveShutdown(role: AppRole | null | undefined): boolean {
  return role === 'FIELD_OFFICER' || role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export function getRoleLabel(role: AppRole | null | undefined): string {
  if (role === 'FIELD_OFFICER') return 'Officer';
  if (role === 'SUPER_ADMIN') return 'Super Admin';
  if (role === 'ADMIN') return 'Administrator';
  if (role === 'OPERATOR') return 'Operator';
  return 'User';
}

export function canAccessRoute(role: AppRole | null | undefined, route: Pick<Route, 'tab' | 'sub'>): boolean {
  if (!role) return false;

  if (route.tab === 'more' && (route.sub === 'operator-entry' || route.sub === 'station-condition')) {
    return hasCapability(role, 'create_parameter_entry');
  }

  if (route.tab === 'more' && route.sub === 'interruption-entry') {
    return hasCapability(role, 'create_interruption_entry');
  }

  if (route.tab === 'reports' && (route.sub === 'operator-activity-report' || route.sub === 'notification-delivery-report')) {
    return hasCapability(role, 'view_all_audit');
  }

  if (route.tab === 'more' && route.sub === 'organisation-structure') {
    return hasCapability(role, 'view_organisation_structure');
  }

  if (route.tab === 'more' && route.sub === 'shift-schedule') {
    return hasCapability(role, 'view_administration');
  }

  if (route.tab === 'more' && (route.sub === 'shift-operations' || route.sub === 'shift-history')) {
    return hasCapability(role, 'view_administration');
  }

  if (route.tab === 'reports' && ['shift-attendance-report', 'shift-handover-report', 'shift-compliance-report'].includes(route.sub ?? '')) {
    return hasCapability(role, 'view_administration');
  }

  if (route.tab === 'more' && route.sub === 'network-master-data') {
    return hasCapability(role, 'manage_scoped_feeders') || hasCapability(role, 'manage_all_feeders');
  }

  if (route.tab === 'more' && route.sub === 'users-access') {
    return hasCapability(role, 'view_scoped_users') || hasCapability(role, 'manage_users');
  }

  if (route.tab === 'more' && route.sub === 'system-configuration') {
    return hasCapability(role, 'manage_scoped_configuration') || hasCapability(role, 'manage_system_configuration');
  }

  if (route.tab === 'more' && route.sub === 'audit-activity') {
    return hasCapability(role, 'view_scoped_audit') || hasCapability(role, 'view_all_audit');
  }

  // App support, profile, and all non-privileged routes remain available to every authenticated role.
  return true;
}
