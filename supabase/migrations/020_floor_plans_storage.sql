-- 020_floor_plans_storage.sql
-- Create the `floor-plans` storage bucket and RLS policies.
--
-- The inspection flow (manual trace in FloorPlanImageUpload + Auto-detect in
-- flow.tsx) uploads floor-plan images to the `floor-plans` bucket and reads them
-- back via getPublicUrl. The bucket and its policies were never created, so
-- storage.objects RLS (enabled) denied every upload. This migration provisions
-- the bucket (public, to match the getPublicUrl usage) and the policies needed
-- for authenticated users to upload/overwrite and for public read.

-- Bucket (public so getPublicUrl serves the image directly).
insert into storage.buckets (id, name, public)
values ('floor-plans', 'floor-plans', true)
on conflict (id) do update set public = excluded.public;

-- Public read (bucket is public; objects served via the public URL).
drop policy if exists "floor_plans_read" on storage.objects;
create policy "floor_plans_read" on storage.objects
  for select using (bucket_id = 'floor-plans');

-- Authenticated users may upload floor-plan images.
drop policy if exists "floor_plans_insert" on storage.objects;
create policy "floor_plans_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'floor-plans');

-- Authenticated users may overwrite (upsert: true in the client) their uploads.
drop policy if exists "floor_plans_update" on storage.objects;
create policy "floor_plans_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'floor-plans') with check (bucket_id = 'floor-plans');

-- Authenticated users may delete (e.g. replacing a plan).
drop policy if exists "floor_plans_delete" on storage.objects;
create policy "floor_plans_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'floor-plans');
