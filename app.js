function getDb() {
  if (!window.__db) window.__db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  return window.__db;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function petTypeLabel(type, other) {
  if (type === 'other') return other || 'Other';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function showEl(id)  { const el = document.getElementById(id); if (el) el.hidden = false; }
function hideEl(id)  { const el = document.getElementById(id); if (el) el.hidden = true;  }
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function clearError(id) { hideEl(id); }

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Home page — pet cards ─────────────────────────────────────────────────────

async function loadActivePets() {
  const { data: pets, error } = await getDb()
    .from('pets')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  const container = document.getElementById('pet-cards-list');
  if (!container) return;

  if (error || !pets || pets.length === 0) {
    container.innerHTML = '<div class="empty-state">No pets have been reported missing. If yours is lost, post them here.</div>';
    return;
  }

  container.innerHTML = pets.map(renderPetCard).join('');

  container.querySelectorAll('.btn-share').forEach(btn => {
    btn.addEventListener('click', () => sharePet(btn.dataset.id, btn.dataset.name));
  });
  container.querySelectorAll('.btn-report').forEach(btn => {
    btn.addEventListener('click', () => { showPage('sighting'); preselectPet(btn.dataset.id); });
  });
}

function renderPetCard(pet) {
  const type = petTypeLabel(pet.pet_type, pet.pet_type_other);
  const missingDate = new Date(pet.missing_since).toLocaleDateString();
  return `
    <div class="pet-card">
      ${pet.photo_url ? `<img src="${escHtml(pet.photo_url)}" alt="${escHtml(pet.pet_name)}" class="pet-card-photo">` : ''}
      <h3>${escHtml(pet.pet_name)}</h3>
      <p class="pet-type-tag">${escHtml(type)}</p>
      <p class="pet-desc">${escHtml(pet.description)}</p>
      ${pet.reward ? `<p class="reward-tag">Reward: ${escHtml(pet.reward)}</p>` : ''}
      <p class="contact">${escHtml(pet.owner_contact)}</p>
      <p class="missing-since">Missing since ${missingDate}</p>
      <div class="card-actions">
        <button class="btn-card btn-report" data-id="${pet.id}">Report a Sighting</button>
        <button class="btn-card btn-card-outline btn-share" data-id="${pet.id}" data-name="${escHtml(pet.pet_name)}">Share</button>
      </div>
    </div>`;
}

// ── My saved pets (localStorage) ─────────────────────────────────────────────

function getMyPets() {
  try { return JSON.parse(localStorage.getItem('myPets') || '[]'); }
  catch { return []; }
}

function saveMyPets(arr) {
  localStorage.setItem('myPets', JSON.stringify(arr));
}

function renderMyPets() {
  const container = document.getElementById('my-pets-list');
  if (!container) return;
  const pets = getMyPets();
  if (pets.length === 0) {
    container.innerHTML = '<div class="empty-state">No posts saved on this device yet. Post a lost pet to get your private link.</div>';
    return;
  }
  container.innerHTML = pets.map(p => `
    <div class="my-pet-row">
      <span>${escHtml(p.name)}</span>
      <a href="owner.html?id=${p.id}" class="btn-card">View my page &rarr;</a>
    </div>`).join('');
}

// ── Post a Lost Pet ───────────────────────────────────────────────────────────

async function uploadPhoto(file, folder) {
  const path = `${folder}/${Date.now()}_${file.name}`;
  const { data, error } = await getDb().storage.from('pet-photos').upload(path, file);
  if (error) return null;
  return getDb().storage.from('pet-photos').getPublicUrl(data.path).data.publicUrl;
}

async function submitLostPet(e) {
  e.preventDefault();
  clearError('post-error');
  hideEl('post-success');

  const myPets = getMyPets();
  if (myPets.length >= 3) {
    showError('post-error', 'You have 3 active posts saved on this device. Mark one as found before posting again.');
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.textContent = 'Posting…';
  btn.disabled = true;

  const petType    = document.getElementById('pet-type').value;
  const photoFile  = document.getElementById('pet-photo').files[0];
  const missingVal = document.getElementById('missing-since').value;
  const expires    = new Date();
  expires.setDate(expires.getDate() + 30);

  const { data: { user } } = await getDb().auth.getUser();

  const petData = {
    owner_id:       user?.id ?? null,
    pet_name:       document.getElementById('pet-name').value.trim(),
    pet_type:       petType,
    pet_type_other: petType === 'other' ? document.getElementById('pet-type-other').value.trim() : null,
    description:    document.getElementById('pet-description').value.trim(),
    owner_contact:  document.getElementById('owner-contact-post').value.trim(),
    reward:         document.getElementById('reward').value.trim() || null,
    last_seen_area: document.getElementById('last-seen-area')?.value.trim() || null,
    missing_since:  missingVal ? new Date(missingVal).toISOString() : new Date().toISOString(),
    expires_at:     expires.toISOString(),
    photo_url:      photoFile ? await uploadPhoto(photoFile, 'pets') : null,
  };

  const { data, error } = await getDb().from('pets').insert(petData).select().single();

  btn.textContent = 'Post Lost Pet';
  btn.disabled = false;

  if (error) { showError('post-error', 'Something went wrong — please try again.'); return; }

  myPets.push({ id: data.id, name: data.pet_name });
  saveMyPets(myPets);

  const link = `${location.origin}/owner.html?id=${data.id}`;
  document.getElementById('owner-link-input').value = link;
  showEl('post-success');
  e.target.reset();
  hideEl('photo-preview');
  await loadActivePets();
}

function copyOwnerLink() {
  const input = document.getElementById('owner-link-input');
  input.select();
  navigator.clipboard.writeText(input.value).catch(() => document.execCommand('copy'));
  setText('copy-btn', 'Copied!');
  setTimeout(() => setText('copy-btn', 'Copy'), 2000);
}

// ── Email linking (owner) ─────────────────────────────────────────────────────

async function linkOwnerEmail(e) {
  e.preventDefault();
  const email = document.getElementById('owner-email-input').value.trim();
  if (!email) return;

  const btn = e.target.querySelector('button[type="submit"]');
  btn.textContent = 'Sending…';
  btn.disabled = true;

  const { error } = await getDb().auth.updateUser({ email });

  btn.textContent = 'Send link';
  btn.disabled = false;

  if (error) {
    setText('owner-email-msg', 'Could not send — check the email address.');
  } else {
    setText('owner-email-msg', 'Check your email and click the confirmation link!');
  }
  showEl('owner-email-msg');
}

// ── Report a Sighting ─────────────────────────────────────────────────────────

async function loadPetsDropdown() {
  const sel = document.getElementById('sighting-pet');
  if (!sel) return;
  sel.innerHTML = '<option value="">Loading…</option>';

  const { data: pets } = await getDb()
    .from('pets')
    .select('id, pet_name, pet_type, pet_type_other')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (!pets || pets.length === 0) {
    sel.innerHTML = '<option value="">No lost pets posted yet</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  sel.innerHTML = '<option value="">Select a pet…</option>' +
    pets.map(p => `<option value="${p.id}">${escHtml(p.pet_name)} — ${petTypeLabel(p.pet_type, p.pet_type_other)}</option>`).join('');
}

function preselectPet(id) {
  const sel = document.getElementById('sighting-pet');
  if (sel) sel.value = id;
}

async function geocode(loc) {
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(loc)}&format=json&limit=1`);
    const data = await res.json();
    if (data?.[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {}
  return null;
}

async function reverseGeocode(lat, lng) {
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
    const data = await res.json();
    return data?.display_name || null;
  } catch {}
  return null;
}

// Exact GPS coords captured by the "Here" button; cleared if the user edits the field by hand
let sightingCoords = null;

function useMyLocation() {
  const btn    = document.getElementById('use-location-btn');
  const status = document.getElementById('location-status');
  const input  = document.getElementById('sighting-location');

  if (!('geolocation' in navigator)) {
    setText('location-status', 'Location is not supported on this device — please type it instead.');
    showEl('location-status');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Locating…';
  setText('location-status', 'Getting your location…');
  showEl('location-status');

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    sightingCoords = { lat: latitude, lng: longitude };

    const address = await reverseGeocode(latitude, longitude);
    input.value = address || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

    btn.disabled = false;
    btn.innerHTML = '📍 Here';
    setText('location-status', 'Pinned to your current location ✓');
  }, () => {
    btn.disabled = false;
    btn.innerHTML = '📍 Here';
    setText('location-status', 'Could not get your location — check permissions, or type it instead.');
  }, { enableHighAccuracy: true, timeout: 10000 });
}

async function submitSighting(e) {
  e.preventDefault();
  clearError('sighting-error');
  hideEl('sighting-success');

  const petId = document.getElementById('sighting-pet').value;
  if (!petId) { showError('sighting-error', 'Please select which pet you saw.'); return; }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.textContent = 'Submitting…';
  btn.disabled = true;

  const loc       = document.getElementById('sighting-location').value.trim();
  const coords    = sightingCoords || await geocode(loc);
  const photoFile = document.getElementById('sighting-photo-input')?.files[0];

  const { data: { user } } = await getDb().auth.getUser();

  const anonId = user?.id ? user.id.slice(0, 7).toUpperCase() : Math.random().toString(36).slice(2,9).toUpperCase();

  const sightingData = {
    pet_id:           petId,
    reporter_id:      user?.id ?? null,
    reporter_name:    document.getElementById('reporter-name').value.trim() || `Anonymous ${anonId}`,
    reporter_contact: document.getElementById('reporter-contact').value.trim() || null,
    location:         loc,
    latitude:         coords?.lat ?? null,
    longitude:        coords?.lng ?? null,
    note:             document.getElementById('sighting-note').value.trim() || null,
    has_pet:          document.getElementById('has-pet')?.checked ?? false,
    photo_url:        photoFile ? await uploadPhoto(photoFile, 'sightings') : null,
  };

  const { data, error } = await getDb().from('sightings').insert(sightingData).select().single();

  btn.textContent = 'Submit Sighting';
  btn.disabled = false;

  if (error) { showError('sighting-error', 'Something went wrong — please try again.'); return; }

  // Show private sighting link
  const sightingLink = `${location.origin}/sighting.html?id=${data.id}`;
  const linkEl = document.getElementById('sighting-private-link');
  if (linkEl) linkEl.value = sightingLink;

  showEl('sighting-success');
  e.target.reset();
  hideEl('sighting-photo-preview');
  hideEl('location-status');
  sightingCoords = null;
}

function copySightingLink() {
  const input = document.getElementById('sighting-private-link');
  if (!input) return;
  input.select();
  navigator.clipboard.writeText(input.value).catch(() => document.execCommand('copy'));
  setText('copy-sighting-btn', 'Copied!');
  setTimeout(() => setText('copy-sighting-btn', 'Copy'), 2000);
}

// ── Email linking (sighter) ───────────────────────────────────────────────────

async function linkSighterEmail(e) {
  e.preventDefault();
  const email = document.getElementById('sighter-email-input').value.trim();
  if (!email) return;

  const btn = e.target.querySelector('button[type="submit"]');
  btn.textContent = 'Sending…';
  btn.disabled = true;

  const { error } = await getDb().auth.updateUser({ email });

  btn.textContent = 'Send link';
  btn.disabled = false;

  if (error) {
    setText('sighter-email-msg', 'Could not send — check the email address.');
  } else {
    setText('sighter-email-msg', 'Check your email and click the confirmation link!');
  }
  showEl('sighter-email-msg');
}

// ── Share ─────────────────────────────────────────────────────────────────────

async function sharePet(id, name) {
  const url  = `${location.origin}/owner.html?id=${id}`;
  const text = `Help find ${name}! Report any sighting here.`;
  if (navigator.share) {
    try { await navigator.share({ title: `Lost Pet: ${name}`, text, url }); return; } catch {}
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank');
}

// ── Page navigation ───────────────────────────────────────────────────────────

function showPage(target) {
  document.querySelectorAll('.page').forEach(p => p.hidden = true);
  document.querySelector(`.page[data-page="${target}"]`).hidden = false;
  document.querySelectorAll('nav a').forEach(l => l.classList.remove('active'));
  const link = document.querySelector(`nav a[data-target="${target}"]`);
  if (link) link.classList.add('active');
  if (target === 'sighting') loadPetsDropdown();
  if (target === 'mypets')   renderMyPets();
}

// ── Photo preview helper ──────────────────────────────────────────────────────

function setupPhotoPreview(inputId, previewId) {
  const input   = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!input || !preview) return;
  input.addEventListener('change', function () {
    if (this.files?.[0]) { preview.src = URL.createObjectURL(this.files[0]); preview.hidden = false; }
    else { preview.src = ''; preview.hidden = true; }
  });
}

// ── Advanced options toggle helper ────────────────────────────────────────────

function setupAdvancedToggle(toggleId, bodyId, chevronId) {
  const toggle  = document.getElementById(toggleId);
  const body    = document.getElementById(bodyId);
  const chevron = document.getElementById(chevronId);
  if (!toggle || !body) return;
  toggle.addEventListener('click', function () {
    const open = body.classList.toggle('open');
    if (chevron) chevron.innerHTML = open ? '&#9650;' : '&#9660;';
    this.classList.toggle('open', open);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('nav a[data-target]').forEach(link => {
    link.addEventListener('click', e => { e.preventDefault(); showPage(link.dataset.target); });
  });

  document.getElementById('lost-pet-form')?.addEventListener('submit', submitLostPet);
  document.getElementById('sighting-form')?.addEventListener('submit', submitSighting);
  document.getElementById('use-location-btn')?.addEventListener('click', useMyLocation);
  // Typing a location by hand discards the GPS pin so the typed text is geocoded instead
  document.getElementById('sighting-location')?.addEventListener('input', () => { sightingCoords = null; });
  document.getElementById('copy-btn')?.addEventListener('click', copyOwnerLink);
  document.getElementById('copy-sighting-btn')?.addEventListener('click', copySightingLink);
  document.getElementById('owner-email-form')?.addEventListener('submit', linkOwnerEmail);
  document.getElementById('sighter-email-form')?.addEventListener('submit', linkSighterEmail);

  const petTypeSelect = document.getElementById('pet-type');
  const otherField    = document.getElementById('pet-type-other-field');
  if (petTypeSelect && otherField) {
    petTypeSelect.addEventListener('change', () => {
      otherField.hidden = petTypeSelect.value !== 'other';
    });
  }

  setupPhotoPreview('pet-photo', 'photo-preview');
  setupPhotoPreview('sighting-photo-input', 'sighting-photo-preview');
  setupAdvancedToggle('advanced-toggle', 'advanced-body', 'chevron');
  setupAdvancedToggle('sighting-advanced-toggle', 'sighting-advanced-body', 'sighting-chevron');

  const { data: { session } } = await getDb().auth.getSession();
  if (!session) await getDb().auth.signInAnonymously();

  await loadActivePets();
});
