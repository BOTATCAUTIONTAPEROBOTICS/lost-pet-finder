# Reunite & Reward + Stolen → Admin Tracking — Design

Date: 2026-06-14
Status: Approved

## Goal

When an owner closes a found pet, keep the owner ↔ finder contact open to arrange
the **pet handover** and pay the **reward** (cash or a third‑party digital handle),
and let owners escalate a case to **STOLEN**, which is tracked under admin oversight.

## Constraints

- Static site (HTML/CSS/vanilla JS) on Vercel + Supabase, publishable client key, no server.
- Therefore no in‑app card processing / payouts. Digital reward = deep‑link into the
  finder's own Venmo / PayPal.me / Cash App / Zelle; the third party moves the money
  owner→finder. App facilitates + records status only (same trust model as the rest of the app).

## Behavior

### Closing a found pet
1. **Mark as Found** opens a picker of people who checked "I have your pet" (highlighted),
   plus other sightings, plus "I found them myself". Owner confirms the finder.
2. Sets `status='found'`, `found_sighting_id`, `found_at`. Pet drops off the public list
   (existing `status='active'` filter).

### Reunion panel (owner page + finder's `sighting.html`)
- Finder's chat thread is pinned and stays open (RLS is identity‑based, so threads already
  survive "found").
- **Reward**: owner picks **Cash** or **Digital**.
  - Cash: owner *Mark reward given* → finder *Reward received*.
  - Digital: finder adds their handle → owner gets a one‑tap **Pay reward** deep‑link
    (amount prefilled when `reward` has a parseable number) → owner *I sent it* → finder *Received*.
    Zelle has no universal link, so the handle is shown to copy.
- **Pet returned ✓**: owner‑confirmed, recorded step that completes the reunion.

### Photos in chat
- 📎 attach button on both sides; uploads to the existing `pet-photos` storage bucket,
  message carries `photo_url`. Photo‑only messages use empty `content`.

### Stolen → admin‑tracked
- Owner toggles **Report Stolen** → `is_stolen=true`, `stolen_reported_at`, `tracking_active=true`.
  Stays public with a red **STOLEN** badge; `status` stays `active` until/if found.
- Admin panel gets a **Stolen / Tracking** tab listing stolen cases with their sightings and a
  link to the case map. **Only an admin can Stop / Re‑open tracking.**

## Data model (additions)

- `pets`: `found_sighting_id uuid`, `found_at timestamptz`, `reward_method text(cash|digital)`,
  `reward_sent bool`, `pet_returned bool`, `is_stolen bool`, `stolen_reported_at timestamptz`,
  `tracking_active bool`
- `sightings`: `payment_type text(venmo|paypal|cashapp|zelle)`, `payment_handle text`, `reward_received bool`
- `messages`: `photo_url text`

Owner writes only `pets` fields; finder writes only their `sightings` row — so existing
owner‑only / reporter‑only RLS covers reward state with no new per‑field policies.

## Auth / RLS / security

- Admin identity moves to the **secure** `app_metadata.is_admin` claim (a user cannot grant
  it to themselves), read via a `public.is_admin()` SQL function.
- New admin `update`/`delete` policies on `pets`/`sightings` (also fixes the currently‑dead
  admin Delete buttons).
- `tracking_active` is guarded by a `before update` trigger: a non‑admin may switch it **on**
  (reporting stolen) but cannot switch it **off**.

## Manual setup step

After deploy, set the admin account's `is_admin: true` in **app_metadata** via the Supabase
dashboard (Authentication → Users → user → app_metadata), and run the migration block at the
bottom of `supabase-schema.sql` in the SQL editor.

## Files

`supabase-schema.sql`, `owner.html`/`owner.js`, `sighting.html`/`sighting.js`,
`app.js` (STOLEN badge), `admin.html`/`admin.js`, `style.css`.
