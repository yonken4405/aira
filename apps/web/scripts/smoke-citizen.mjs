/**
 * DEV smoke-test for the registered-citizen tier: account + medical profile (SECURITY.md §7/§8).
 *
 * Exercises the real HTTP surface of a running `next dev` server against the local DB. It
 * provisions its OWN throwaway citizen each run (no seeded citizen is required) and cleans up
 * after itself by deleting the account at the end.
 *
 *   1. register a fresh citizen by email        -> aira_citizen_session cookie
 *   2. GET /api/citizen/session (authed)         -> same citizen echoed back
 *   3. GET /api/citizen/medical                  -> empty profile is normal
 *   4. PUT /api/citizen/medical                  -> canonical profile echoed, sanitised
 *   5. GET /api/citizen/medical                  -> the profile persisted at rest
 *   6. cross-tier check: citizen cookie must NOT authenticate /api/auth/session (401)
 *   7. device-key identity: POST /api/citizen/device (register-or-login in one step)
 *   8. DELETE /api/citizen/account               -> 204 + cleared cookie
 *   9. GET /api/citizen/session with the dead cookie -> 401 (session revoked)
 *  10. medical profile is gone after the account delete
 *
 * Usage: node scripts/smoke-citizen.mjs [baseUrl]
 */

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const ORIGIN = BASE;

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

async function send(method, path, { body, cookie } = {}) {
  const headers = { origin: ORIGIN };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A 43-char base64url device key (32 random bytes), matching the server DEVICE_KEY_PATTERN. */
function makeDeviceKey() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function main() {
  console.log(`\nSmoke-testing citizen tier on ${BASE}\n`);

  const suffix = Date.now().toString(36);
  const email = `citizen-${suffix}@smoke.test`;
  const password = `smoke-${suffix}-ZxQ9`; // >= 12 chars, mixed; survives the strength check.

  // 1) Register a fresh citizen by email.
  const regRes = await send('POST', '/api/citizen/register', { body: { email, password } });
  check('citizen register 201', regRes.status === 201, `status ${regRes.status}`);
  const citizenCookie = cookieFrom(regRes);
  check('citizen session cookie set', Boolean(citizenCookie), citizenCookie?.split('=')[0]);
  const regJson = await regRes.json().catch(() => ({}));
  const citizenId = regJson.citizen?.id ?? null;
  check('citizen id returned', Boolean(citizenId), citizenId ?? '(none)');

  // 2) Session restore: the cookie resolves to the same citizen.
  const sessRes = await send('GET', '/api/citizen/session', { cookie: citizenCookie });
  const sessJson = await sessRes.json().catch(() => ({}));
  check('citizen session 200', sessRes.status === 200, `status ${sessRes.status}`);
  check(
    'session echoes the same citizen',
    sessJson.citizen?.id === citizenId && sessJson.citizen?.email === email,
    sessJson.citizen?.email ?? '(none)',
  );

  // 3) An absent medical profile is normal (empty, not an error).
  const med0Res = await send('GET', '/api/citizen/medical', { cookie: citizenCookie });
  const med0Json = await med0Res.json().catch(() => ({}));
  check('empty medical GET 200', med0Res.status === 200, `status ${med0Res.status}`);
  check(
    'empty profile has no contacts',
    Array.isArray(med0Json.profile?.contacts) && med0Json.profile.contacts.length === 0,
    `${med0Json.profile?.contacts?.length ?? 'n/a'} contact(s)`,
  );

  // 4) Save a medical profile; the server sanitises + echoes the canonical shape.
  const putRes = await send('PUT', '/api/citizen/medical', {
    cookie: citizenCookie,
    body: {
      bloodType: 'O-',
      ageBand: '18-39',
      allergies: ['penicillin'],
      conditions: ['asthma'],
      medications: ['salbutamol'],
      notes: 'Smoke-test profile.',
      contacts: [{ name: 'Smoke Contact', phone: '0917-000-0000', relation: 'friend' }],
    },
  });
  const putJson = await putRes.json().catch(() => ({}));
  check('medical PUT 200', putRes.status === 200, `status ${putRes.status}`);
  check('PUT echoes blood type', putJson.profile?.bloodType === 'O-', putJson.profile?.bloodType);
  check(
    'PUT echoes the contact',
    putJson.profile?.contacts?.[0]?.name === 'Smoke Contact',
    putJson.profile?.contacts?.[0]?.name ?? '(none)',
  );

  // 5) The profile persisted at rest (decrypts back to the same values).
  const med1Res = await send('GET', '/api/citizen/medical', { cookie: citizenCookie });
  const med1Json = await med1Res.json().catch(() => ({}));
  check('persisted medical GET 200', med1Res.status === 200, `status ${med1Res.status}`);
  check(
    'profile round-trips at rest',
    med1Json.profile?.bloodType === 'O-' &&
      med1Json.profile?.allergies?.[0] === 'penicillin' &&
      med1Json.profile?.contacts?.[0]?.phone === '0917-000-0000',
    `${med1Json.profile?.allergies?.length ?? 0} allergy(ies)`,
  );

  // 6) Cross-tier isolation: a citizen cookie must not authenticate a responder route.
  const crossRes = await send('GET', '/api/auth/session', { cookie: citizenCookie });
  check(
    'citizen cookie rejected on /api/auth/session (401)',
    crossRes.status === 401,
    `status ${crossRes.status}`,
  );

  // 7) Device-key identity: register-or-login in one step, no email/password.
  const deviceKey = makeDeviceKey();
  const devRes = await send('POST', '/api/citizen/device', { body: { deviceKey } });
  const devJson = await devRes.json().catch(() => ({}));
  const deviceCookie = cookieFrom(devRes);
  check('device-key auth 200', devRes.status === 200, `status ${devRes.status}`);
  check(
    'device citizen has no email',
    devJson.citizen?.email === null,
    String(devJson.citizen?.email),
  );
  // Clean up the throwaway device-key account too.
  if (deviceCookie) {
    await send('DELETE', '/api/citizen/account', { cookie: deviceCookie });
  }

  // 8) Delete the email account (also our cleanup for this run).
  const delRes = await send('DELETE', '/api/citizen/account', { cookie: citizenCookie });
  check('account delete 204', delRes.status === 204, `status ${delRes.status}`);
  const cleared = delRes.headers.get('set-cookie') ?? '';
  check(
    'delete clears the session cookie',
    /aira_citizen_session=;|Max-Age=0/i.test(cleared),
    cleared.split(';')[0],
  );

  // 9) The old cookie no longer authenticates (session revoked).
  const deadRes = await send('GET', '/api/citizen/session', { cookie: citizenCookie });
  check('revoked cookie rejected (401)', deadRes.status === 401, `status ${deadRes.status}`);

  // 10) The medical profile is gone with the account.
  const med2Res = await send('GET', '/api/citizen/medical', { cookie: citizenCookie });
  check(
    'medical unreachable after delete (401)',
    med2Res.status === 401,
    `status ${med2Res.status}`,
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
