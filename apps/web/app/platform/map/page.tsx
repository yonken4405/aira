import { PlatformMap } from '../../../src/components/PlatformMap';
import { requirePlatformPrincipal } from '../../../src/lib/platform/guard';

export const dynamic = 'force-dynamic';

export default async function PlatformMapPage() {
  await requirePlatformPrincipal();
  return <PlatformMap />;
}
