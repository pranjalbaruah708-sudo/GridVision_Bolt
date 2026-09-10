import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.STAGING_SUPABASE_URL;
const serviceRoleKey = process.env.STAGING_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    'Missing STAGING_SUPABASE_URL or STAGING_SERVICE_ROLE_KEY environment variable.'
  );
  process.exit(1);
}

// Safety check: this script must ONLY run against GridVision Staging.
const EXPECTED_PROJECT_REF = 'fylnuppelaebrhqllzzh';

if (!supabaseUrl.includes(EXPECTED_PROJECT_REF)) {
  console.error('STOPPED: Supabase URL is not the GridVision Staging project.');
  console.error(`Expected project ref: ${EXPECTED_PROJECT_REF}`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const users = [
  {
    email: 'operator.a@gridvision-staging.test',
    password: 'ChangeMe-OperatorA-2026!',
    fullName: 'Test Operator A',
    intendedRole: 'OPERATOR',
  },
  {
    email: 'operator.b@gridvision-staging.test',
    password: 'ChangeMe-OperatorB-2026!',
    fullName: 'Test Operator B',
    intendedRole: 'OPERATOR',
  },
  {
    email: 'officer.a@gridvision-staging.test',
    password: 'ChangeMe-OfficerA-2026!',
    fullName: 'Test Officer A',
    intendedRole: 'FIELD_OFFICER',
  },
  {
    email: 'admin@gridvision-staging.test',
    password: 'ChangeMe-Admin-2026!',
    fullName: 'Test Admin',
    intendedRole: 'ADMIN',
  },
];

async function createUser(user) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,

    user_metadata: {
      full_name: user.fullName,
      staging_test_user: true,
    },
  });

  if (error) {
    console.error(`FAILED: ${user.email}`);
    console.error(error.message);
    return;
  }

  console.log(`CREATED: ${user.email}`);
  console.log(`User ID: ${data.user.id}`);
  console.log(`Intended role: ${user.intendedRole}`);
  console.log('---');
}

async function main() {
  console.log('Target: GridVision Staging');
  console.log(`Expected project ref: ${EXPECTED_PROJECT_REF}`);
  console.log('');

  for (const user of users) {
    await createUser(user);
  }

  console.log('');
  console.log('Finished.');
  console.log(
    'Important: this script creates Auth users only. Application roles/station scope are configured separately.'
  );
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});