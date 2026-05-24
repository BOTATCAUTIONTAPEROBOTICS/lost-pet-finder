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
  reported_at      timestamptz  default now()
);

-- ── Messages (real-time chat thread per sighting) ─────────────

create table if not exists messages (
  id           uuid        default gen_random_uuid() primary key,
  sighting_id  uuid        references sightings(id) on delete cascade not null,
  sender_id    uuid        not null references auth.users(id),
  sender_role  text        not null check (sender_role in ('owner', 'reporter')),
  content      text        not null,
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
