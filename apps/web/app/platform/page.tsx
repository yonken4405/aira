import { PlatformTenants } from '../../src/components/PlatformTenants';
import { requirePlatformPrincipal } from '../../src/lib/platform/guard';
import { getPlatformStore } from '../../src/lib/platform/runtime';

export const dynamic = 'force-dynamic';

export default async function PlatformHomePage() {
  await requirePlatformPrincipal();
  const store = getPlatformStore();
  const [tenants, officePins] = await Promise.all([store.listTenants(), store.listOfficePins()]);

  // Group offices by tenant so each tenant's AgencyNetworkPanel can populate its
  // responder-staffing office picker. Office location/pins carry no citizen data.
  const officesByTenant: Record<string, readonly { readonly id: string; readonly name: string }[]> =
    {};
  for (const pin of officePins) {
    const list = officesByTenant[pin.tenantId] ?? [];
    officesByTenant[pin.tenantId] = [...list, { id: pin.id, name: pin.name }];
  }

  return <PlatformTenants tenants={tenants} officesByTenant={officesByTenant} />;
}