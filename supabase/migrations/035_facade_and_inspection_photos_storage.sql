-- 035_facade_and_inspection_photos_storage.sql
-- Create the `facade-photos` and `inspection-photos` storage buckets and RLS
-- policies.
--
-- Same bug class as 020_floor_plans_storage.sql: facade-photos.tsx and
-- inspect.tsx upload to these buckets and read them back via
-- createSignedUrl, but the buckets themselves (and storage.objects RLS
-- policies) were never created — every upload failed with "Bucket not
-- found". Both buckets are private (photos are read back via a 1-hour
-- signed URL, never a public URL), scoped by org via the first path segment
-- of the object name (uploads use `{org_id}/{building_id|element_id}/{file}`,
-- matching the `(storage.foldername(name))[1]` convention below).

insert into storage.buckets (id, name, public)
values
  ('facade-photos', 'facade-photos', false),
  ('inspection-photos', 'inspection-photos', false)
on conflict (id) do update set public = excluded.public;

-- ─── facade-photos ──────────────────────────────────────────────────────────
drop policy if exists "facade_photos_org_select" on storage.objects;
create policy "facade_photos_org_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'facade-photos' and (storage.foldername(name))[1] = public.user_org_id()::text);

drop policy if exists "facade_photos_org_insert" on storage.objects;
create policy "facade_photos_org_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'facade-photos' and (storage.foldername(name))[1] = public.user_org_id()::text);

drop policy if exists "facade_photos_org_update" on storage.objects;
create policy "facade_photos_org_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'facade-photos' and (storage.foldername(name))[1] = public.user_org_id()::text)
  with check (bucket_id = 'facade-photos' and (storage.foldername(name))[1] = public.user_org_id()::text);

drop policy if exists "facade_photos_org_delete" on storage.objects;
create policy "facade_photos_org_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'facade-photos' and (storage.foldername(name))[1] = public.user_org_id()::text);

-- ─── inspection-photos ──────────────────────────────────────────────────────
drop policy if exists "inspection_photos_org_select" on storage.objects;
create policy "inspection_photos_org_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'inspection-photos' and (storage.foldername(name))[1] = public.user_org_id()::text);

drop policy if exists "inspection_photos_org_insert" on storage.objects;
create policy "inspection_photos_org_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'inspection-photos' and (storage.foldername(name))[1] = public.user_org_id()::text);

drop policy if exists "inspection_photos_org_update" on storage.objects;
create policy "inspection_photos_org_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'inspection-photos' and (storage.foldername(name))[1] = public.user_org_id()::text)
  with check (bucket_id = 'inspection-photos' and (storage.foldername(name))[1] = public.user_org_id()::text);

drop policy if exists "inspection_photos_org_delete" on storage.objects;
create policy "inspection_photos_org_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'inspection-photos' and (storage.foldername(name))[1] = public.user_org_id()::text);
