function getDb() {
  if (!window.__db) window.__db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  return window.__db;
}

let map, clusterGroup, currentPet;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { showSection('not-found'); return; }

  const { data: pet, error } = await getDb().from('pets').select('*').eq('id', id).single();
  if (error || !pet) { showSection('not-found'); return; }

  currentPet = pet;
  renderPet(pet);
  initMap();
  await loadSightings(id);
  subscribeRealtime(id);
  checkReminder(pet);

  document.getElementById('mark-found-btn')?.addEventListener('click', () => markAsFound(id));
  document.getElementById('print-btn')?.addEventListener('click', () => window.print());
  document.getElementById('copy-link-btn')?.addEventListener('click', copyLink);
  document.getElementById('edit-form')?.addEventListener('submit', e => saveEdit(e, id));
  document.getElementById('edit-toggle')?.addEventListener('click', toggleEdit);
});

// ── Render pet details ────────────────────────────────────────────────────────

function renderPet(pet) {
  document.title = `${pet.pet_name} — Lost Pet Finder`;
  setEl('pet-name-display',    pet.pet_name);
  setEl('pet-type-display',    typeLabel(pet));
  setEl('pet-desc-display',    pet.description);
  setEl('pet-contact-display', pet.owner_contact);
  setEl('pet-missing-display', `Missing since ${new Date(pet.missing_since).toLocaleDateString()}`);

  const photo = document.getElementById('pet-photo-display');
  if (photo && pet.photo_url) { photo.src = pet.photo_url; photo.hidden = false; }

  const reward = document.getElementById('pet-reward-display');
  if (reward && pet.reward) { reward.textContent = `Reward: ${pet.reward}`; reward.hidden = false; }

  if (pet.status === 'found') {
    document.getElementById('mark-found-btn').textContent = 'Already marked as found';
    document.getElementById('mark-found-btn').disabled = true;
    document.getElementById('found-banner').hidden = false;
  }

  document.getElementById('owner-link-display').value = location.href;

  // Pre-fill edit form
  setVal('edit-description', pet.description);
  setVal('edit-contact',     pet.owner_contact);
  setVal('edit-reward',      pet.reward || '');
}

function typeLabel(pet) {
  return pet.pet_type === 'other' ? (pet.pet_type_other || 'Other') :
    pet.pet_type.charAt(0).toUpperCase() + pet.pet_type.slice(1);
}

// ── Map ───────────────────────────────────────────────────────────────────────

function initMap() {
  map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  clusterGroup = L.markerClusterGroup();
  map.addLayer(clusterGroup);
}

function updateMap(sightings) {
  clusterGroup.clearLayers();
  const pinned = sightings.filter(s => s.latitude && s.longitude && !s.flagged);
  pinned.forEach(s => {
    const marker = L.marker([s.latitude, s.longitude]);
    marker.bindPopup(`<strong>${s.location}</strong><br>${s.reporter_name}<br>${new Date(s.reported_at).toLocaleString()}`);
    clusterGroup.addLayer(marker);
  });
  if (pinned.length > 0) map.fitBounds(clusterGroup.getBounds().pad(0.3));
}

// ── Sightings ─────────────────────────────────────────────────────────────────

async function loadSightings(petId) {
  const { data } = await getDb().from('sightings').select('*').eq('pet_id', petId).order('reported_at', { ascending: false });
  renderSightings(data || []);
  updateMap(data || []);
}

function renderSightings(sightings) {
  const list = document.getElementById('sightings-list');
  if (sightings.length === 0) {
    list.innerHTML = '<div class="empty-state">No sightings reported yet. Share your link with neighbors to get leads.</div>';
    return;
  }
  list.innerHTML = sightings.map(sightingCard).join('');
  list.querySelectorAll('.flag-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleFlag(btn.dataset.id, btn.dataset.flagged === 'true'));
  });
}

function sightingCard(s) {
  const date = new Date(s.reported_at).toLocaleString();
  return `
    <div class="sighting-card${s.flagged ? ' sighting-flagged' : ''}${s.has_pet ? ' sighting-has-pet' : ''}">
      ${s.has_pet ? '<div class="badge badge-has-pet">They have your pet!</div>' : ''}
      ${s.flagged  ? '<div class="badge badge-flagged">Flagged</div>' : ''}
      <p class="sighting-location"><strong>${esc(s.location)}</strong></p>
      <p class="sighting-meta">${date} &bull; ${esc(s.reporter_name)} &bull; ${esc(s.reporter_contact)}</p>
      ${s.note ? `<p class="sighting-note">${esc(s.note)}</p>` : ''}
      ${s.photo_url ? `<img src="${esc(s.photo_url)}" class="sighting-photo" alt="Sighting photo">` : ''}
      <button class="flag-btn${s.flagged ? ' flagged' : ''}" data-id="${s.id}" data-flagged="${s.flagged}">
        ${s.flagged ? 'Unflag' : 'Flag as incorrect'}
      </button>
    </div>`;
}

async function toggleFlag(id, currently) {
  await getDb().from('sightings').update({ flagged: !currently }).eq('id', id);
  await loadSightings(currentPet.id);
}

// ── Real-time ─────────────────────────────────────────────────────────────────

function subscribeRealtime(petId) {
  getDb().channel('owner-sightings-' + petId)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'sightings',
      filter: `pet_id=eq.${petId}`
    }, () => loadSightings(petId))
    .subscribe();
}

// ── Mark as found ─────────────────────────────────────────────────────────────

async function markAsFound(petId) {
  if (!confirm('Mark this pet as found? The post will be removed from the public list.')) return;

  const { data: reporters } = await getDb().from('sightings').select('reporter_name, reporter_contact').eq('pet_id', petId);
  await getDb().from('pets').update({ status: 'found' }).eq('id', petId);

  document.getElementById('mark-found-btn').disabled = true;
  document.getElementById('mark-found-btn').textContent = 'Marked as found';
  document.getElementById('found-banner').hidden = false;

  if (reporters?.length > 0) {
    const list = reporters.map(r => `${r.reporter_name}: ${r.reporter_contact}`).join('\n');
    document.getElementById('reporters-to-thank').textContent = list;
    document.getElementById('thank-reporters').hidden = false;
  }
}

// ── Edit pet ──────────────────────────────────────────────────────────────────

function toggleEdit() {
  const form = document.getElementById('edit-section');
  form.hidden = !form.hidden;
}

async function saveEdit(e, petId) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  await getDb().from('pets').update({
    description:   document.getElementById('edit-description').value.trim(),
    owner_contact: document.getElementById('edit-contact').value.trim(),
    reward:        document.getElementById('edit-reward').value.trim() || null,
  }).eq('id', petId);

  btn.textContent = 'Save Changes';
  btn.disabled = false;
  document.getElementById('edit-success').hidden = false;
  setTimeout(() => document.getElementById('edit-success').hidden = true, 3000);
}

// ── Reminder ──────────────────────────────────────────────────────────────────

function checkReminder(pet) {
  const days = (Date.now() - new Date(pet.created_at).getTime()) / 86400000;
  if (days >= 30) document.getElementById('no-sightings-reminder').hidden = false;
}

// ── Copy link ─────────────────────────────────────────────────────────────────

function copyLink() {
  const input = document.getElementById('owner-link-display');
  input.select();
  navigator.clipboard.writeText(input.value).catch(() => document.execCommand('copy'));
  const btn = document.getElementById('copy-link-btn');
  btn.textContent = 'Copied!';
  setTimeout(() => btn.textContent = 'Copy Link', 2000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showSection(id) { document.getElementById(id).hidden = false; }
function setEl(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function setVal(id, val)  { const el = document.getElementById(id); if (el) el.value = val; }
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
