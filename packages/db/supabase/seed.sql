-- AIRA local seed (dev only; `supabase db reset` applies it).
--
-- Deliberately contains NO responder accounts and NO password hashes: accounts are
-- provisioned with the CLI (`pnpm --filter @aira/web auth:create-responder`) so no
-- credential material ever lands in the repository (SECURITY.md §1.6/§6.3).
--
-- One deployment serves one LGU (PRODUCT.md §1), so exactly one LGU office exists;
-- barangays hang off it. Category IDs are the frozen payload enum (PRODUCT.md §4).

insert into public.agencies (id, name, code) values
  ('a1000000-0000-4000-8000-000000000001', 'Bureau of Fire Protection', 'BFP'),
  ('a1000000-0000-4000-8000-000000000002', 'Philippine National Police', 'PNP'),
  ('a1000000-0000-4000-8000-000000000003', 'Emergency Medical Services', 'EMS')
on conflict (id) do nothing;

-- One subscribing tenant (onboarded in person). Each tenant owns one LGU office tree.
insert into public.tenants (id, name, region, province, status) values
  ('7e000000-0000-4000-8000-000000000001', 'Cebu City DRRMO', 'Region VII', 'Cebu', 'active')
on conflict (id) do nothing;

insert into public.offices (id, tenant_id, name, kind, parent_id, lat, lon, region, province) values
  ('0f100000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000001',
   'Cebu City DRRMO', 'LGU', null, 10.3157, 123.8854, 'Region VII', 'Cebu'),
  ('0f100000-0000-4000-8000-000000000002', '7e000000-0000-4000-8000-000000000001',
   'Barangay Lahug', 'BARANGAY', '0f100000-0000-4000-8000-000000000001', 10.3300, 123.9000, 'Region VII', 'Cebu'),
  ('0f100000-0000-4000-8000-000000000003', '7e000000-0000-4000-8000-000000000001',
   'Barangay Mabolo', 'BARANGAY', '0f100000-0000-4000-8000-000000000001', 10.3200, 123.9100, 'Region VII', 'Cebu'),
  ('0f100000-0000-4000-8000-000000000004', '7e000000-0000-4000-8000-000000000001',
   'Barangay Talamban', 'BARANGAY', '0f100000-0000-4000-8000-000000000001', 10.3600, 123.9100, 'Region VII', 'Cebu')
on conflict (id) do nothing;

-- Queue demo rows: 4 dp coordinates, closed category enum, no citizen text.
insert into public.incidents (id, category, lat, lon, status, source, reported_at, office_id) values
  ('1c100000-0000-4000-8000-000000000001', 'SUNOG',   10.3157, 123.8854, 'QUEUED',
   'mesh', now() - interval '8 minutes',  '0f100000-0000-4000-8000-000000000001'),
  ('1c100000-0000-4000-8000-000000000002', 'MEDIKAL', 10.3312, 123.8925, 'QUEUED',
   'mesh', now() - interval '14 minutes', '0f100000-0000-4000-8000-000000000002'),
  ('1c100000-0000-4000-8000-000000000003', 'KRIMEN',  10.2965, 123.9020, 'QUEUED',
   'mesh', now() - interval '21 minutes', '0f100000-0000-4000-8000-000000000003'),
  ('1c100000-0000-4000-8000-000000000004', 'BAHA',    10.3050, 123.8750, 'QUEUED',
   'mesh', now() - interval '33 minutes', '0f100000-0000-4000-8000-000000000001'),
  ('1c100000-0000-4000-8000-000000000005', 'SUNOG',   10.3400, 123.9100, 'QUEUED',
   'mesh', now() - interval '41 minutes', '0f100000-0000-4000-8000-000000000004'),
  ('1c100000-0000-4000-8000-000000000006', 'MEDIKAL', 10.3200, 123.9100, 'QUEUED',
   'manual', now() - interval '52 minutes', '0f100000-0000-4000-8000-000000000003')
on conflict (id) do nothing;

-- Audit trail for the seeded intake events (append-only, actor is the citizen app).
insert into public.incident_events (incident_id, event, to_status, detail)
select id, 'INTAKE', 'QUEUED', 'seed intake'
  from public.incidents
 where id::text like '1c100000-%'
   and not exists (
     select 1 from public.incident_events e
      where e.incident_id = public.incidents.id and e.event = 'INTAKE'
   );
