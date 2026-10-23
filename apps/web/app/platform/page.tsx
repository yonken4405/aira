import { PlatformTenants } from '../../src/components/PlatformTenants';
import { requirePlatformPrincipal } from '../../src/lib/platform/guard';
import { getPlatformStore } from '../../src/lib/platform/runtime';

export const dynamic = 'force-dynamic';

export default async function PlatformHomePage() {
  await requirePlatformPrincipal();
  const tenants = await getPlatformStore().listTenants();
  return <PlatformTenants tenants={tenants} />;
}
