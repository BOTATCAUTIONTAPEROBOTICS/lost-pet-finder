# Lost Pet Finder — Project PRD

---

## Who is the site for?

Anyone, anywhere, who has lost a pet or spotted a stray in their neighborhood. The site is not limited to one area — any owner in any city can post, and any neighbor can report a sighting.

**The Owner**
Someone whose pet went missing. They are stressed and need to spread the word fast. They fill out a short form, get a private link, and check it repeatedly for new sightings on the map. They can also post up to 3 missing pets at once (in case they have multiple animals missing).

**The Neighbor**
Someone who spotted an animal nearby. They do not want to make an account. They open the site, pick the matching pet, fill in where they saw it, leave their name and contact, and submit in under 60 seconds.

---

## What problem does it solve?

When a pet goes missing, every minute counts. Right now owners text individuals, post on multiple apps, print flyers, and call shelters — all at the same time, while panicking. Neighbors who spot a stray often have no easy way to reach the owner.

This site is one fast, shared place:
- Owner posts once, any neighbor can see it immediately.
- Neighbor reports a sighting in seconds, no account needed.
- Owner sees every sighting on a live map, clustered for readability.

**The core loop:**
1. Owner posts a lost pet (name, type, description, photo, missing-since date, optional reward, owner contact).
2. Owner saves their private link, which is also remembered in the browser.
3. Neighbor spots the pet, opens the site, submits a sighting with their name, contact, location, and optional photo.
4. Owner sees the new sighting pin appear on the clustered map immediately.
5. Owner finds their pet and marks it as found. Neighbors who reported sightings are notified if they left contact info.

---

## Must-have sections

### 1. Post a Lost Pet
A short form for the owner. Required: pet name, type, description, owner contact, missing-since date. Optional (in Advanced Options): photo, reward amount, area last seen, extra notes. Max 3 active posts per device. After posting, the owner sees a private link and it is also saved in the browser's localStorage so they can always find it again from the same device.

### 2. Report a Sighting
A short form for the neighbor. Required: which pet, location, reporter name, reporter contact. Optional (in Advanced Options): photo of the spot, extra note, and an "I have this pet" toggle for neighbors who have actually caught the animal. The sighting is saved and linked to the correct pet record.

### 3. Sightings View (owner's private page)
Reached via the owner's private link. Shows the pet's details, a live feed of sightings (newest first), each sighting as a clustered pin on a Leaflet.js map, and a flag button on each sighting card. The owner can also edit their post, mark the pet as found, or generate a print-ready flyer. Updates in real time — no page refresh needed. If 30 days have passed with zero sightings, a reminder banner appears prompting the owner to share their link more widely.

### 4. Home page
Shows all active lost pet cards. Each card shows the pet's name, type, description, owner contact, and a share button. No post timestamps shown on cards — only the relevant pet details. Cards disappear once a pet is marked as found or expires.

### 5. Admin page (password-protected)
A simple internal page for the site owner to delete spam or fake posts without having to log in to Supabase directly.

---

## Data each section needs to save

### Pets table
| Field | Type | Required? | Notes |
|---|---|---|---|
| id | UUID | Auto | Primary key; used in the private owner link |
| pet_name | Short text | Yes | |
| pet_type | Text | Yes | dog, cat, rabbit, bird, or other |
| pet_type_other | Short text | No | Only used when type is "other" |
| description | Long text | Yes | |
| photo_url | URL string | No | Supabase Storage; placeholder if blank |
| owner_contact | Text | Yes | Phone or email; shown publicly on the pet card |
| reward | Text | No | e.g. "$50 reward" — shown on the card if provided |
| missing_since | Timestamp | Yes | Owner picks date/time; defaults to right now |
| expires_at | Timestamp | Auto | Defaults to 30 days after created_at; owner can extend |
| status | Text | Auto | "active" on create; "found" or "expired" later |
| created_at | Timestamp | Auto | Set by Supabase |

### Sightings table
| Field | Type | Required? | Notes |
|---|---|---|---|
| id | UUID | Auto | Primary key |
| pet_id | UUID | Yes | Foreign key → pets table |
| reporter_name | Text | Yes | |
| reporter_contact | Text | Yes | Phone or email |
| location | Text | Yes | Street name or landmark (MVP); coordinates later |
| photo_url | URL string | No | Photo of where the pet was spotted |
| note | Short text | No | |
| has_pet | Boolean | Auto | False by default; true if neighbor has the animal |
| flagged | Boolean | Auto | False by default; true if flagged as incorrect |
| reported_at | Timestamp | Auto | Set by Supabase |

---

## How the pages connect

```
Home page
  └── reads pets table (status = "active") → shows pet cards with share buttons

Post a Lost Pet page
  └── inserts a new row into pets table
  └── stores private link (pet UUID) in localStorage
  └── returns private link to owner on screen

Report a Sighting page
  └── reads pets table (fills the dropdown)
  └── inserts a new row into sightings table (with reporter name, contact, photo)

Sightings View  (URL: /owner/<pet-id>)
  └── reads one pet from pets table (by UUID)
  └── reads all sightings for that pet
  └── listens for real-time inserts from Supabase
  └── plots clustered sighting pins on Leaflet.js map
  └── shows "no sightings" reminder if 30 days have passed with 0 sightings
  └── lets owner flag / unflag sightings
  └── lets owner edit their pet post
  └── lets owner mark pet as found → notifies reporters who left contact info
  └── lets owner generate a printable flyer

Admin page  (URL: /admin — password-protected)
  └── reads all pets (including found and expired)
  └── lets admin delete spam posts
```

---

## Tech stack

| Layer | Tool | Why |
|---|---|---|
| Frontend | HTML, CSS, JavaScript | Simple, no build tools needed |
| Database | Supabase (PostgreSQL) | Free tier, easy real-time support |
| File storage | Supabase Storage | Pet photos and sighting photos |
| Hosting | Vercel | Free, auto-deploys on save |
| Fonts | Nunito via Google Fonts | Friendly, rounded style |
| Map | Leaflet.js + OpenStreetMap | Free, no API key or billing needed |
| Map clustering | Leaflet.markercluster | Groups nearby pins when zoomed out |
| Local storage | Browser localStorage | Remembers private links on the same device |
| Sharing | Web Share API (mobile) / WhatsApp link (desktop) | One-click share on each pet card |
| Print | Browser print / CSS @media print | Generates a clean flyer layout |

---

## What can wait until later?

- **Map pin location input** — for MVP the neighbor types a text address; dropping a pin on a map is a future upgrade
- **Push notifications** — alert the owner's phone the moment a sighting is submitted
- **User accounts and login** — the private link + localStorage replaces login for the MVP
- **Comments** — back-and-forth conversation under a sighting
- **Email alerts** — automatic email when a new sighting arrives
- **Mobile app** — native iOS or Android version
- **Multiple languages** — English only for now
- **Link recovery** — if the owner clears localStorage, they currently lose their link; email-based recovery is post-MVP

---

## Design goals

- Works on any screen — phone, tablet, and desktop
- Short forms — no more than 4 required fields per form; optional extras live in Advanced Options
- Map first — the clustered Leaflet map is the biggest element on the Sightings View page
- Color palette — light blue main color, orange for buttons and highlights
- No login wall — a neighbor can report a sighting in under 60 seconds without an account
- Clear feedback — every form submit shows a confirmation; every error explains what to fix
- Private link is the key — shown in a copy-ready box immediately after posting, and saved to localStorage automatically
- Share-ready — every pet card has a one-click share button so owners can spread the word instantly
- Print-ready — the flyer layout hides nav, footer, and buttons automatically via CSS

---

## Post lifecycle

```
Owner posts pet
    │
    ▼
Status: "active"  ──────────────────────────────────────────┐
    │                                                        │
    │   Sightings come in                                    │
    │   Map updates live                                     │
    │                                                        │
    ├── After 30 days with 0 sightings:                      │
    │       Show reminder on private page                    │
    │                                                        │
    ├── Owner marks as found:                                │
    │       Status → "found"                                 │
    │       Reporters with contact info notified             │
    │       Card disappears from Home                        │
    │                                                        │
    └── Post expires (30 days, owner-adjustable):            │
            Status → "expired"                               │
            Card disappears from Home ───────────────────────┘
```

---

## Privacy and moderation

- **Owner contact** — shown publicly on each pet card so neighbors can reach out directly
- **Reporter contact** — stored in Supabase but not shown publicly; only used to notify the reporter when the pet is found
- **Flagging** — any visitor can flag a sighting as incorrect. The owner reviews flagged sightings on their private page and can dismiss them
- **Admin** — a password-protected `/admin` page lets the site owner delete spam or fake posts without needing to open Supabase directly
- **Max posts per device** — 3 active posts per device (enforced via localStorage) to limit abuse

---

## Edge cases to think about

| Situation | How to handle |
|---|---|
| No pets posted yet | Sighting dropdown shows "No lost pets posted yet" and disables submit |
| Owner has 3 active posts | Post a Lost Pet form shows a message: "You have reached the limit of 3 active posts. Mark one as found to post again." |
| Owner loses their private link | Link is saved in localStorage; if localStorage is cleared, recovery is post-MVP |
| Neighbor submits sighting with "I have this pet" | Sighting card shows a special badge so owner sees it immediately |
| Post reaches 30-day expiry | Status changes to "expired"; owner can extend from their private page before it expires |
| 30 days pass with 0 sightings | Banner on private page: "No sightings yet — try sharing your link with more neighbors." |
| Photo file too large | Warn before upload; set a max of 5 MB |
| Two sightings submitted at the same second | Supabase assigns each a unique UUID automatically |
| Pet marked as found | Pet disappears from Home; reporters with contact info receive a notification |
| Admin deletes a post | All sightings linked to that pet are also removed |

---

## Success — how do we know it works?

- A pet can be posted in under 2 minutes from opening the site
- The private link appears on screen and is saved to localStorage immediately after posting
- A sighting appears on the owner's clustered map within 5 seconds — no page refresh
- A first-time visitor can figure out how to report a sighting without any instructions
- The site loads correctly on a phone
- A one-click share sends the pet's link via WhatsApp or the device's native share menu

---

## UI and UX

### User flows

**Owner — posting a lost pet:**
1. Lands on Home, clicks "Post a Lost Pet."
2. Fills in pet name, type, description, contact. Picks a missing-since date (defaults to now).
3. Optionally opens Advanced Options to add photo, reward, area, or extra notes.
4. Submits — sees a green confirmation with their private link in a copy-ready box. Link is also saved in localStorage.
5. Returns to Home — their pet card appears with a share button.

**Neighbor — reporting a sighting:**
1. Sees a pet card on Home. Clicks "Report a Sighting."
2. Picks the pet from the dropdown, enters location, name, and contact.
3. Optionally opens Advanced Options to attach a photo or tick "I have this pet."
4. Submits — sees: "Thank you! The owner has been notified."

**Owner — checking sightings:**
1. Opens their private link (bookmarked or found in localStorage).
2. Sees their pet's details, a live sightings feed, and a clustered map.
3. Flags any incorrect sightings. Edits their post if needed.
4. When pet is found, clicks "Mark as Found." Reporters with contact info are notified.

**Owner — printing a flyer:**
1. On their private page, clicks "Print Flyer."
2. Browser opens a print-ready view: pet photo, name, description, contact, and a QR code linking to the post.
3. Owner prints and puts up flyers in the neighborhood.

---

### Interaction states

| State | What the user sees |
|---|---|
| Default | Normal, ready to use |
| Focus | Input gets a blue border highlight |
| Loading | Submit button shows "Posting…" and is disabled |
| Success | Green confirmation message |
| Error | Red message naming exactly what to fix |

---

### Empty states

| Section | Empty state message |
|---|---|
| No active pets on Home | "No pets have been reported missing. If yours is lost, post them here." |
| No sightings on owner's page | "No sightings reported yet. Share your link with neighbors to get leads." |
| 30 days, still no sightings | "No sightings yet after 30 days — try sharing your link more widely." |
| Pet dropdown empty | "No lost pets posted yet — ask the owner to post their pet first." |

---

### Key UX rules

- Every form submit shows a visible confirmation — never leave the user wondering if it worked.
- Submit button shows a loading state ("Posting…") while the request is in flight, and re-enables after.
- Private link must be shown in a copy-ready box immediately after posting.
- No more than 4 required fields per form — optional extras go in Advanced Options.
- Orange button = primary action. Blue outline = secondary. Red = destructive (delete, flag).
- Error messages say what to fix: "Pet name is required" not just "Error."
- Forms reset after a successful submit.

---

### Accessibility basics

- Every input has a visible label — placeholders are hints, not labels.
- Buttons have descriptive text — no icon-only buttons.
- Color is never the only signal — errors show text too, not just red color.
- Page works with keyboard navigation (Tab between fields, Enter to submit).

---

## MVP Ready Check — Lesson 7

- [ ] Owner can post a lost pet (name, type, description, contact, missing-since date)
- [ ] Submitted pet appears in the database with status = "active"
- [ ] Owner receives a private link immediately after posting; link saved to localStorage
- [ ] Pet card appears on Home with owner contact and a share button
- [ ] Neighbor can submit a sighting (pet, location, name, contact)
- [ ] Sighting is saved and linked to the correct pet
- [ ] Owner opens their private link and sees all sightings live
- [ ] Sightings update in real time — no page refresh needed
- [ ] Each sighting appears as a clustered pin on the Leaflet.js map
- [ ] Owner can flag an incorrect sighting
- [ ] Owner can edit their pet post
- [ ] Owner can mark pet as found — pet disappears from Home
- [ ] Reporters with contact info are notified when the pet is found
- [ ] "No sightings" reminder appears after 30 days on the owner's page
- [ ] Owner can generate a printable flyer from their private page
- [ ] Share button on each pet card works on mobile and desktop
- [ ] Admin can delete spam posts from a password-protected page
- [ ] Max 3 active posts per device enforced via localStorage
