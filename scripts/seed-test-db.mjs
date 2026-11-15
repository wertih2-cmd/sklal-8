// Seeds a TEST Supabase project for the Playwright e2e run: four users (admin, supervisor, manager, one disabled),
// one building, three apartments (studio, 1br, 2br) and two housekeepers.
// It is idempotent and it REFUSES to run against the production project.
//
//   E2E_ALLOW_SEED=1 E2E_SUPABASE_URL=https://<test-ref>.supabase.co E2E_SERVICE_ROLE_KEY=... \
//   E2E_ADMIN_PASSWORD=... E2E_SV_PASSWORD=... E2E_MANAGER_PASSWORD=... E2E_DISABLED_PASSWORD=... \
//   npm run seed:test
//
// The service role key stays in your shell: do not put it in a file that is committed.
import { createClient } from '@supabase/supabase-js'

const PRODUCTION_REFS = ['lbbmiwqodiqmkjqhtdmd']

const die = (msg) => {
  console.error(`seed-test-db: ${msg}`)
  process.exit(1)
}

const url = process.env.E2E_SUPABASE_URL
const serviceKey = process.env.E2E_SERVICE_ROLE_KEY
if (process.env.E2E_ALLOW_SEED !== '1') die('set E2E_ALLOW_SEED=1 to confirm that this is a TEST project')
if (!url || !serviceKey) die('E2E_SUPABASE_URL and E2E_SERVICE_ROLE_KEY are required')
if (PRODUCTION_REFS.some((ref) => url.includes(ref))) die('this URL is the PRODUCTION project, refusing to seed it')

const USERS = [
  { login: 'e2e_admin', name: 'E2E Admin', role: 'admin', active: true, env: 'E2E_ADMIN_PASSWORD' },
  { login: 'e2e_sv', name: 'E2E Supervisor', role: 'supervisor', active: true, env: 'E2E_SV_PASSWORD' },
  { login: 'e2e_manager', name: 'E2E Manager', role: 'manager', active: true, env: 'E2E_MANAGER_PASSWORD' },
  { login: 'e2e_disabled', name: 'E2E Disabled', role: 'supervisor', active: false, env: 'E2E_DISABLED_PASSWORD' },
]
for (const u of USERS) if (!process.env[u.env]) die(`${u.env} is required`)

const db = createClient(url, serviceKey, { auth: { persistSession: false } })
const ok = (res, what) => {
  if (res.error) die(`${what}: ${res.error.message}`)
  return res.data
}

async function ensureUser(u) {
  const email = `${u.login}@sklad.internal`
  const password = process.env[u.env]
  const list = ok(await db.auth.admin.listUsers({ page: 1, perPage: 1000 }), 'list users')
  const found = list.users.find((x) => x.email === email)
  let id
  if (found) {
    ok(await db.auth.admin.updateUserById(found.id, { password, email_confirm: true }), `update ${u.login}`)
    id = found.id
  } else {
    id = ok(await db.auth.admin.createUser({ email, password, email_confirm: true }), `create ${u.login}`).user.id
  }
  ok(await db.from('profiles').upsert({ id, login: u.login, full_name: u.name, role: u.role, active: u.active }), `profile ${u.login}`)
  console.log(`user ${u.login} (${u.role}${u.active ? '' : ', disabled'}) ready`)
}

for (const u of USERS) await ensureUser(u)

let building = ok(await db.from('buildings').select('id').eq('name', 'E2E').maybeSingle(), 'find building')
if (!building) building = ok(await db.from('buildings').insert({ name: 'E2E' }).select('id').single(), 'create building')

const APARTMENTS = [
  { number: '1', code: 'E2E/S1', type: 'studio' },
  { number: '2', code: 'E2E/B1', type: '1br' },
  { number: '3', code: 'E2E/B2', type: '2br' },
]
let firstApartmentId = null
for (const a of APARTMENTS) {
  let row = ok(await db.from('apartments').select('id').eq('code', a.code).maybeSingle(), `find ${a.code}`)
  if (!row) row = ok(await db.from('apartments').insert({ building_id: building.id, ...a }).select('id').single(), `create ${a.code}`)
  firstApartmentId ??= row.id
}

for (const name of ['E2E Cleaner A', 'E2E Cleaner B']) {
  const row = ok(await db.from('staff').select('id').eq('full_name', name).maybeSingle(), `find ${name}`)
  if (!row) ok(await db.from('staff').insert({ full_name: name }), `create ${name}`)
}

console.log('\nDone. For the e2e run set:')
console.log(`  E2E_ALLOW=1  E2E_SUPABASE_URL=${url}  E2E_QR_APARTMENT_ID=${firstApartmentId}`)
console.log('  E2E_ADMIN_LOGIN=e2e_admin  E2E_SV_LOGIN=e2e_sv  E2E_DISABLED_LOGIN=e2e_disabled (passwords as above)')
