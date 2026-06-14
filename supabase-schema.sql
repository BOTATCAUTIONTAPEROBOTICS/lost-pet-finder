-- ============================================================
-- Lost Pet Finder — Full Schema
-- Paste into Supabase SQL Editor and click Run
-- Also create a Storage bucket called "pet-photos" set to Public
-- ============================================================

-- ── Pets ─────────────────────────────────────────────────────

create table if not exists pets (
  id              uuid         default gen_random_uuid() primary key,
  owner_id        uuid         references auth.users(id) on delete set null,
  pet_name        text         not null,
  pet_type        text         not null,
  pet_type_other  text,
  description     text         not null,
  photo_url       text,
  owner_contact   text         not null,
  reward          text,
  last_seen_area  text,
  missing_since   timestamptz  not null default now(),
  expires_at      timestamptz  not null default (now() + interval '30 days'),
  status          text         not null default 'active' check (status in ('active', 'found')),
  found_sighting_id  uuid,
  found_at        timestamptz,
  reward_method   text         check (reward_method is null or reward_method in ('cash', 'digital')),
  reward_sent     boolean      not null default false,
  pet_returned    boolean      not null default false,
  is_stolen       boolean      not null default false,
  stolen_reported_at timestamptz,
  tracking_active boolean      not null default false,
  created_at      timestamptz  default now()
);

-- ── Sightings ─────────────────────────────────────────────────

create table if not exists sightings (
  id               uuid         default gen_random_uuid() primary key,
  pet_id           uuid         references pets(id) on delete cascade not null,
  reporter_id      uuid         references auth.users(id) on delete set null,
  reporter_name    text         not null,
  reporter_contact text,
  location         text         not null,
  latitude         float,
  longitude        float,
  photo_url        text,
  note             text,
  has_pet          boolean      default false,
  flagged          boolean      default false,
  payment_type     text         check (payment_type is null or payment_type in ('venmo', 'paypal', 'cashapp', 'zelle')),
  payment_handle   text,
  reward_received  boolean      not null default false,
  reported_at      timestamptz  default now()
);

-- ── Messages (real-time chat thread per sighting) ─────────────

create table if not exists messages (
  id           uuid        default gen_random_uuid() primary key,
  sighting_id  uuid        references sightings(id) on delete cascade not null,
  sender_id    uuid        not null references auth.users(id),
  sender_role  text        not null check (sender_role in ('owner', 'reporter')),
  content      text        not null default '',
  photo_url    text,
  created_at   timestamptz default now()
);

-- ── Row Level Security ────────────────────────────────────────

alter table pets      enable row level security;
alter table sightings enable row level security;
alter table messages  enable row level security;

-- Pets: anyone can view
create policy "pets_select" on pets
  for select using (true);

-- Pets: signed-in users (including anonymous) can post
create policy "pets_insert" on pets
  for insert with check (auth.uid() is not null);

-- Pets: only the owner can update their own pet
create policy "pets_update" on pets
  for update using (auth.uid() = owner_id);

-- Pets: only the owner can delete their own pet
create policy "pets_delete" on pets
  for delete using (auth.uid() = owner_id);

-- Sightings: anyone can view
create policy "sightings_select" on sightings
  for select using (true);

-- Sightings: signed-in users (including anonymous) can report
create policy "sightings_insert" on sightings
  for insert with check (auth.uid() is not null);

-- Sightings: only the reporter can update their own sighting
create policy "sightings_update" on sightings
  for update using (auth.uid() = reporter_id);

-- Sightings: only the reporter can delete their own sighting
create policy "sightings_delete" on sightings
  for delete using (auth.uid() = reporter_id);

-- Messages: only participants can read (owner of pet or reporter of sighting)
create policy "messages_select" on messages
  for select using (
    auth.uid() = sender_id
    or auth.uid() in (
      select owner_id from pets
      where id = (select pet_id from sightings where id = messages.sighting_id)
    )
    or auth.uid() in (
      select reporter_id from sightings where id = messages.sighting_id
    )
  );

-- Messages: only participants can send
create policy "messages_insert" on messages
  for insert with check (
    auth.uid() = sender_id
    and (
      auth.uid() in (
        select owner_id from pets
        where id = (select pet_id from sightings where id = sighting_id)
      )
      or auth.uid() in (
        select reporter_id from sightings where id = sighting_id
      )
    )
  );

-- Messages: only the sender can delete their own message
create policy "messages_delete" on messages
  for delete using (auth.uid() = sender_id);

-- ── Real-time ─────────────────────────────────────────────────

alter publication supabase_realtime add table pets;
alter publication supabase_realtime add table sightings;
alter publication supabase_realtime add table messages;

-- ============================================================
-- MIGRATION — run this whole block if your tables ALREADY exist.
-- (Everything here is safe to run more than once.)
-- ============================================================

alter table pets      add column if not exists found_sighting_id  uuid;
alter table pets      add column if not exists found_at           timestamptz;
alter table pets      add column if not exists reward_method      text;
alter table pets      add column if not exists reward_sent        boolean not null default false;
alter table pets      add column if not exists pet_returned       boolean not null default false;
alter table pets      add column if not exists is_stolen          boolean not null default false;
alter table pets      add column if not exists stolen_reported_at timestamptz;
alter table pets      add column if not exists tracking_active    boolean not null default false;

alter table sightings add column if not exists payment_type    text;
alter table sightings add column if not exists payment_handle  text;
alter table sightings add column if not exists reward_received boolean not null default false;

alter table messages  add column if not exists photo_url text;
alter table messages  alter column content set default '';

-- Who is an admin? Read from the SECURE app_metadata claim. Unlike user_metadata,
-- app_metadata can only be set from the Supabase dashboard / admin API — a normal
-- user cannot grant themselves admin. Set it on your admin user:
--   Authentication → Users → (your user) → app_metadata → {"is_admin": true}
create or replace function public.is_admin() returns boolean
language sql stable as $$
  select coalesce(((auth.jwt() -> 'app_metadata' ->> 'is_admin'))::boolean, false);
$$;

-- Admins can moderate any pet / sighting. (This is also what makes the admin
-- panel's existing Delete buttons actually work under row-level security.)
drop policy if exists "pets_admin_update"      on pets;
create policy "pets_admin_update"      on pets      for update using (public.is_admin());
drop policy if exists "pets_admin_delete"      on pets;
create policy "pets_admin_delete"      on pets      for delete using (public.is_admin());
drop policy if exists "sightings_admin_update" on sightings;
create policy "sightings_admin_update" on sightings for update using (public.is_admin());
drop policy if exists "sightings_admin_delete" on sightings;
create policy "sightings_admin_delete" on sightings for delete using (public.is_admin());

-- Only an admin may STOP tracking a stolen case. An owner may switch tracking ON
-- (by reporting the pet stolen) but cannot switch it back off.
create or replace function public.lock_tracking_active() returns trigger
language plpgsql as $$
begin
  if (old.tracking_active is distinct from new.tracking_active)
     and new.tracking_active = false
     and not public.is_admin() then
    new.tracking_active := old.tracking_active;  -- ignore a non-admin trying to stop tracking
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_tracking on pets;
create trigger trg_lock_tracking before update on pets
  for each row execute function public.lock_tracking_active();
