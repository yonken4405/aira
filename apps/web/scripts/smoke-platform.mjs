/**
 * DEV smoke-test for the multi-tenant platform + email-login flows.
 *
 * Exercises the real HTTP surface of a running `next dev` server against the seeded
 * local DB:
 *   1. platform login (admin@aira.dev)      -> session cookie
 *   2. list tenants / office pins (authed)
 *   3. create a fresh tenant
 *   4. bootstrap that tenant's first DRRM admin (one-time password)
 *   5. responder email login (dispatch@aira.dev)
 *   6. cross-tier check: platform cookie must NOT authenticate /api/auth/session
 *
 * Usage: node scripts/smoke-platform.mjs [baseUrl]
 */

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const ORIGIN = BASE;
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'password123';

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${mark}] ${label}${detail ? ` - ${detail}` : ''}`);
}

function cookieFrom(res) {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  return raw.split(';')[0];
}

async function post(path, body, cookie) {
  const headers = { 'content-type': 'application/json', origin: ORIGIN };
  if (cookie) headers.cookie = cookie;
  return fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function get(path, cookie) {
  const headers = { origin: ORIGIN };
  if (cookie) headers.cookie = cookie;
  return fetch(`${BASE}${path}`, { headers });
}

async function main() {
  console.log(`\nSmoke-testing ${BASE}\n`);

  // 1) Platform login.
  const loginRes = await post('/api/platform/login', {
    email: 'admin@aira.dev',
    password: PASSWORD,
  });
  check('platform login 200', loginRes.status === 200, `status ${loginRes.status}`);
  const platformCookie = cookieFrom(loginRes);
  check('platform session cookie set', Boolean(platformCookie), platformCookie?.split('=')[0]);

  // 2) Authed reads.
  const tenantsRes = await get('/api/platform/tenants', platformCookie);
  const tenantsJson = await tenantsRes.json().catch(() => ({}));
  check('list tenants 200', tenantsRes.status === 200, `status ${tenantsRes.status}`);
  check(
    'seed tenant present',
    Array.isArray(tenantsJson.tenants) && tenantsJson.tenants.length >= 1,
    `${tenantsJson.tenants?.length ?? 0} tenant(s)`,
  );

  const pinsRes = await get('/api/platform/offices', platformCookie);
  const pinsJson = await pinsRes.json().catch(() => ({}));
  check('list office pins 200', pinsRes.status === 200, `status ${pinsRes.status}`);
  check(
    'office pins present',
    Array.isArray(pinsJson.offices) && pinsJson.offices.length >= 1,
    `${pinsJson.offices?.length ?? 0} office(s)`,
  );

  // 3) Create a fresh tenant (unique name per run).
  const suffix = Date.now().toString(36);
  const createRes = await post(
    '/api/platform/tenants',
    {
      name: `Smoke LGU ${suffix}`,
      region: 'Region VII (Central Visayas)',
      province: 'Bohol',
      lguName: `Tagbilaran ${suffix}`,
      lat: 9.6475,
      lon: 123.8556,
    },
    platformCookie,
  );
  const createJson = await createRes.json().catch(() => ({}));
  check('create tenant 201', createRes.status === 201, `status ${createRes.status}`);
  const newTenantId = createJson.tenant?.id ?? null;
  check('new tenant id returned', Boolean(newTenantId), newTenantId ?? '(none)');

  // 4) Bootstrap that tenant's first DRRM admin.
  if (newTenantId) {
    const bootRes = await post(
      `/api/platform/tenants/${newTenantId}/admin`,
      { email: `admin-${suffix}@smoke.test` },
      platformCookie,
    );
    const bootJson = await bootRes.json().catch(() => ({}));
    check('bootstrap tenant admin 201', bootRes.status === 201, `status ${bootRes.status}`);
    check(
      'one-time password returned',
      typeof bootJson.password === 'string' && bootJson.password.length >= 12,
      bootJson.email ?? '(none)',
    );
  }

  // 5) Responder email login.
  const respRes = await post('/api/auth/login', { email: 'dispatch@aira.dev', password: PASSWORD });
  const respJson = await respRes.json().catch(() => ({}));
  check('responder email login 200', respRes.status === 200, `status ${respRes.status}`);
  check(
    'viewer returned for dispatcher',
    respJson.viewer != null,
    JSON.stringify(respJson.viewer ?? respJson.error ?? {}),
  );

  // 6) Cross-tier isolation: a platform cookie must not authenticate a responder route.
  const crossRes = await get('/api/auth/session', platformCookie);
  check(
    'platform cookie rejected on /api/auth/session (401)',
    crossRes.status === 401,
    `status ${crossRes.status}`,
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
