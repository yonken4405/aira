import { CitizenTracking } from '../../../src/components/CitizenTracking';

export const dynamic = 'force-dynamic';

/**
 * Civilian tracking page (DESIGN.md §5a). Reached from the deep-link returned at
 * intake: `/track/<incidentId>?t=<token>` for an anonymous reporter, or without the
 * token for a logged-in citizen (resolved via their session). No account required.
 */
export default async function TrackPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const rawToken = Array.isArray(query.t) ? query.t[0] : query.t;

  return <CitizenTracking incidentId={id} token={rawToken ?? null} />;
}
