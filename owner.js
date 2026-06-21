function getDb() {
  if (!window.__db) window.__db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  return window.__db;
}

let map, clusterGroup, currentPet;
let allSightings = [];

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await getDb().auth.getSession();
  if (!session) await getDb().auth.signInAnonymously();

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
  await renderReunionIfFound(id);

  document.getElementById('mark-found-btn')?.addEventListener('click', () => openFinderPicker(id));
  document.getElementById('stolen-toggle')?.addEventListener('click', () => reportStolen(id));
  document.getElementById('finder-cancel')?.addEventListener('click', closeFinderPicker);
  document.getElementById('delete-post-btn')?.addEventListener('click', () => deletePost(id));
  document.getElementById('print-btn')?.addEventListener('click', printFlyer);
  window.addEventListener('afterprint', () => document.body.classList.remove('printing-flyer'));
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

  if (pet.is_stolen) {
    document.getElementById('stolen-banner').hidden = false;
    const sb = document.getElementById('stolen-toggle');
    if (sb) { sb.disabled = true; sb.textContent = 'Reported stolen — admin tracking'; }
  }

  document.getElementById('owner-link-display').value = location.href;

  setVal('edit-description', pet.description);
  setVal('edit-contact',     pet.owner_contact);
  setVal('edit-reward',      pet.reward || '');
}

function typeLabel(pet) {
  return pet.pet_type === 'other' ? (pet.pet_type_other || 'Other') :
    pet.pet_type.charAt(0).toUpperCase() + pet.pet_type.slice(1);
}

// ── Map ───────────────────────────────────────────────────────────────────────

let lastSeenLatLng = null;

function initMap() {
  map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  L.control.scale({ imperial: true, metric: true }).addTo(map);

  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML =
      '<span class="leg-dot leg-sighting"></span>Sighting' +
      '<span class="leg-dot leg-haspet"></span>Has your pet' +
      '<span class="leg-dot leg-lastseen"></span>Last seen';
    return div;
  };
  legend.addTo(map);

  clusterGroup = L.markerClusterGroup({ showCoverageOnHover: false });
  map.addLayer(clusterGroup);
}

function pinIcon(kind) {
  return L.divIcon({
    className: 'map-pin-wrap',
    html: `<div class="map-pin map-pin-${kind}"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  });
}

function sightingPopup(s) {
  return `
    <div class="map-popup">
      ${s.has_pet ? '<span class="map-popup-badge">Has your pet!</span>' : ''}
      <strong>${esc(s.location)}</strong>
      <div class="map-popup-meta">${esc(s.reporter_name)} &bull; ${new Date(s.reported_at).toLocaleString()}</div>
      ${s.note ? `<div class="map-popup-note">${esc(s.note)}</div>` : ''}
    </div>`;
}

async function geocodeArea(q) {
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`);
    const data = await res.json();
    if (data?.[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {}
  return null;
}

async function updateMap(sightings) {
  clusterGroup.clearLayers();

  sightings
    .filter(s => s.latitude && s.longitude && !s.flagged)
    .forEach(s => {
      const marker = L.marker([s.latitude, s.longitude], { icon: pinIcon(s.has_pet ? 'haspet' : 'sighting') });
      marker.bindPopup(sightingPopup(s));
      clusterGroup.addLayer(marker);
    });

  // Reference marker for the owner's "last seen" area (geocoded once, then cached)
  if (currentPet?.last_seen_area && !lastSeenLatLng) {
    lastSeenLatLng = await geocodeArea(currentPet.last_seen_area);
  }
  if (lastSeenLatLng) {
    const m = L.marker([lastSeenLatLng.lat, lastSeenLatLng.lng], { icon: pinIcon('lastseen') });
    m.bindPopup(`<div class="map-popup"><strong>Last seen area</strong><div class="map-popup-meta">${esc(currentPet.last_seen_area)}</div></div>`);
    clusterGroup.addLayer(m);
  }

  if (clusterGroup.getLayers().length > 0) {
    map.fitBounds(clusterGroup.getBounds().pad(0.3), { maxZoom: 16 });
  }
}

// ── Sightings ─────────────────────────────────────────────────────────────────

async function loadSightings(petId) {
  const { data } = await getDb().from('sightings').select('*').eq('pet_id', petId).order('reported_at', { ascending: false });
  allSightings = data || [];
  renderSightings(allSightings);
  updateMap(allSightings);
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
  list.querySelectorAll('.open-thread-btn').forEach(btn => {
    btn.addEventListener('click', () => openThread(btn.dataset.id));
  });
}

function sightingCard(s) {
  const date = new Date(s.reported_at).toLocaleString();
  const contact = s.reporter_contact ? ` &bull; ${esc(s.reporter_contact)}` : '';
  return `
    <div class="sighting-card${s.flagged ? ' sighting-flagged' : ''}${s.has_pet ? ' sighting-has-pet' : ''}" id="sc-${s.id}">
      ${s.has_pet ? '<div class="badge badge-has-pet">They have your pet!</div>' : ''}
      ${s.flagged  ? '<div class="badge badge-flagged">Flagged</div>' : ''}
      <p class="sighting-location"><strong>${esc(s.location)}</strong></p>
      <p class="sighting-meta">${date} &bull; ${esc(s.reporter_name)}${contact}</p>
      ${s.note ? `<p class="sighting-note">${esc(s.note)}</p>` : ''}
      ${s.photo_url ? `<img src="${esc(s.photo_url)}" class="sighting-photo" alt="Sighting photo">` : ''}
      <div class="sighting-actions">
        <button class="open-thread-btn btn-card" data-id="${s.id}">Open Thread</button>
        <button class="flag-btn${s.flagged ? ' flagged' : ''}" data-id="${s.id}" data-flagged="${s.flagged}">
          ${s.flagged ? 'Unflag' : 'Flag as incorrect'}
        </button>
      </div>
      <div class="thread-box" id="thread-${s.id}" hidden></div>
    </div>`;
}

async function toggleFlag(id, currently) {
  await getDb().from('sightings').update({ flagged: !currently }).eq('id', id);
  await loadSightings(currentPet.id);
}

// ── Thread (reusable, photo-capable) ──────────────────────────────────────────

let openThreadId = null;
const threadBoxes = new Map();
const subscribedThreads = new Set();

async function openThread(sightingId) {
  const box = document.getElementById(`thread-${sightingId}`);
  if (!box) return;

  if (openThreadId && openThreadId !== sightingId) {
    const prev = document.getElementById(`thread-${openThreadId}`);
    if (prev) prev.hidden = true;
  }

  if (!box.hidden) { box.hidden = true; openThreadId = null; return; }

  openThreadId = sightingId;
  await mountThread(box, sightingId);
}

function msgRowHtml(m) {
  const who = m.sender_role === 'owner' ? 'You (Owner)' : 'Reporter';
  return `
    <div class="msg msg-${m.sender_role}">
      <span class="msg-role">${who}</span>
      ${m.content ? `<p class="msg-content">${esc(m.content)}</p>` : ''}
      ${m.photo_url ? `<a href="${esc(m.photo_url)}" target="_blank" rel="noopener"><img src="${esc(m.photo_url)}" class="msg-photo" alt="Shared photo"></a>` : ''}
      <span class="msg-time">${new Date(m.created_at).toLocaleString()}</span>
    </div>`;
}

async function fetchMessages(sightingId) {
  const { data } = await getDb().from('messages').select('*').eq('sighting_id', sightingId).order('created_at', { ascending: true });
  return data || [];
}

function messagesHtml(msgs) {
  return msgs.length === 0
    ? '<p class="thread-empty">No messages yet. Send the first one!</p>'
    : msgs.map(msgRowHtml).join('');
}

async function mountThread(box, sightingId) {
  box.hidden = false;
  threadBoxes.set(sightingId, box);
  box.innerHTML = '<p class="thread-loading">Loading messages…</p>';

  const msgs = await fetchMessages(sightingId);
  box.innerHTML = `
    <div class="thread-messages">${messagesHtml(msgs)}</div>
    <form class="thread-send-form">
      <label class="thread-attach" title="Attach a photo">&#128206;<input type="file" accept="image/*" class="thread-photo-input" hidden></label>
      <input type="text" class="thread-input" placeholder="Type a message…" />
      <button type="submit" class="btn-send">Send</button>
    </form>`;

  const msgsEl = box.querySelector('.thread-messages');
  if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;

  box.querySelector('.thread-send-form').addEventListener('submit', e => sendThreadMessage(e, sightingId, box));
  box.querySelector('.thread-photo-input').addEventListener('change', e => sendThreadPhoto(e, sightingId));

  subscribeThreadOnce(sightingId);
}

async function refreshThreadMessages(sightingId) {
  const box = threadBoxes.get(sightingId);
  const msgsEl = box?.querySelector('.thread-messages');
  if (!msgsEl) return;
  msgsEl.innerHTML = messagesHtml(await fetchMessages(sightingId));
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

async function sendThreadMessage(e, sightingId, box) {
  e.preventDefault();
  const input = box.querySelector('.thread-input');
  const content = input.value.trim();
  if (!content) return;

  const { data: { user } } = await getDb().auth.getUser();
  if (!user) return;

  input.value = '';
  await getDb().from('messages').insert({ sighting_id: sightingId, sender_id: user.id, sender_role: 'owner', content });
}

async function sendThreadPhoto(e, sightingId) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  const { data: { user } } = await getDb().auth.getUser();
  if (!user) return;

  const url = await uploadThreadPhoto(file);
  if (!url) { alert('Could not upload that photo — please try again.'); return; }
  await getDb().from('messages').insert({ sighting_id: sightingId, sender_id: user.id, sender_role: 'owner', content: '', photo_url: url });
}

async function uploadThreadPhoto(file) {
  const path = `thread/${Date.now()}_${file.name}`;
  const { data, error } = await getDb().storage.from('pet-photos').upload(path, file);
  if (error) return null;
  return getDb().storage.from('pet-photos').getPublicUrl(data.path).data.publicUrl;
}

function subscribeThreadOnce(sightingId) {
  if (subscribedThreads.has(sightingId)) return;
  subscribedThreads.add(sightingId);
  getDb().channel('thread-owner-' + sightingId)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      filter: `sighting_id=eq.${sightingId}`
    }, () => refreshThreadMessages(sightingId))
    .subscribe();
}

// ── Real-time sightings ───────────────────────────────────────────────────────

function subscribeRealtime(petId) {
  getDb().channel('owner-sightings-' + petId)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'sightings',
      filter: `pet_id=eq.${petId}`
    }, () => loadSightings(petId))
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'sightings',
      filter: `pet_id=eq.${petId}`
    }, () => { loadSightings(petId); renderReunionIfFound(petId); })
    .subscribe();
}

// ── Mark as found: pick the finder ────────────────────────────────────────────

function openFinderPicker(petId) {
  const overlay = document.getElementById('finder-picker');
  const optWrap = document.getElementById('finder-options');
  if (!overlay || !optWrap) return;
  setEl('fp-pet-name', currentPet?.pet_name || 'your pet');

  const claimants = allSightings.filter(s => s.has_pet && !s.flagged);
  const others    = allSightings.filter(s => !s.has_pet && !s.flagged);

  const optionHtml = (s, claim) => `
    <button class="finder-option${claim ? ' finder-option-claim' : ''}" data-id="${s.id}">
      ${claim ? '<span class="badge badge-has-pet">Says they have your pet</span>' : ''}
      <strong>${esc(s.reporter_name)}</strong>${s.reporter_contact ? ' &bull; ' + esc(s.reporter_contact) : ''}
      <span class="finder-option-loc">${esc(s.location)}</span>
    </button>`;

  let html = claimants.map(s => optionHtml(s, true)).join('') + others.map(s => optionHtml(s, false)).join('');
  if (!claimants.length && !others.length) html = '<p class="section-hint">No sightings reported yet.</p>';
  html += `<button class="finder-option finder-option-none" data-id="">I found them myself (no finder)</button>`;
  optWrap.innerHTML = html;

  optWrap.querySelectorAll('.finder-option').forEach(b =>
    b.addEventListener('click', () => confirmFinder(petId, b.dataset.id || null)));

  overlay.hidden = false;
}

function closeFinderPicker() {
  const overlay = document.getElementById('finder-picker');
  if (overlay) overlay.hidden = true;
}

async function confirmFinder(petId, sightingId) {
  closeFinderPicker();
  await getDb().from('pets').update({
    status: 'found',
    found_sighting_id: sightingId,
    found_at: new Date().toISOString(),
  }).eq('id', petId);

  const btn = document.getElementById('mark-found-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Marked as found'; }
  document.getElementById('found-banner').hidden = false;

  await renderReunionIfFound(petId);
  document.getElementById('reunion-section')?.scrollIntoView({ behavior: 'smooth' });
}

// ── Report stolen ─────────────────────────────────────────────────────────────

async function reportStolen(petId) {
  if (currentPet?.is_stolen) return;
  if (!confirm('Report this pet as STOLEN? This escalates the case: it stays public so neighbors keep reporting sightings, and an admin will track it. Only an admin can stop the tracking.')) return;

  await getDb().from('pets').update({
    is_stolen: true,
    stolen_reported_at: new Date().toISOString(),
    tracking_active: true,
  }).eq('id', petId);

  if (currentPet) currentPet.is_stolen = true;
  document.getElementById('stolen-banner').hidden = false;
  const sb = document.getElementById('stolen-toggle');
  if (sb) { sb.disabled = true; sb.textContent = 'Reported stolen — admin tracking'; }
}

// ── Reunion & reward ──────────────────────────────────────────────────────────

function parseAmount(rewardText) {
  const m = String(rewardText || '').match(/\d+(\.\d{1,2})?/);
  return m ? m[0] : '';
}

function paymentLabel(type) {
  return { venmo: 'Venmo', paypal: 'PayPal', cashapp: 'Cash App', zelle: 'Zelle' }[type] || type;
}

function paymentLink(type, handle, amount) {
  const h = encodeURIComponent(String(handle || '').replace(/^[@$]/, ''));
  const a = amount ? encodeURIComponent(amount) : '';
  if (type === 'venmo')   return `https://venmo.com/u/${h}${a ? `?txn=pay&amount=${a}` : ''}`;
  if (type === 'paypal')  return `https://paypal.me/${h}${a ? `/${a}` : ''}`;
  if (type === 'cashapp') return `https://cash.app/$${h}${a ? `/${a}` : ''}`;
  return null; // zelle has no universal payment link
}

async function updatePet(petId, patch) {
  await getDb().from('pets').update(patch).eq('id', petId);
  await renderReunionIfFound(petId);
}

async function renderReunionIfFound(petId) {
  const { data: pet } = await getDb().from('pets').select('*').eq('id', petId).single();
  if (!pet) return;
  currentPet = pet;

  const section = document.getElementById('reunion-section');
  const body    = document.getElementById('reunion-body');
  if (!section || !body) return;

  if (pet.status !== 'found') { section.hidden = true; return; }
  section.hidden = false;

  let finder = null;
  if (pet.found_sighting_id) {
    const { data } = await getDb().from('sightings').select('*').eq('id', pet.found_sighting_id).single();
    finder = data || null;
  }

  if (!finder) {
    body.innerHTML = '<div class="reunion-card"><p class="reunited-tag">🎉 Marked as found.</p></div>';
    return;
  }

  const amount = parseAmount(pet.reward);
  const pending = '<span class="section-hint">(waiting for finder to confirm)</span>';
  let h = `<div class="reunion-card">
    <p>Confirmed finder: <strong>${esc(finder.reporter_name)}</strong>${finder.reporter_contact ? ' &bull; ' + esc(finder.reporter_contact) : ''}</p>`;

  if (!pet.reward_method) {
    h += `<p class="section-hint">How do you want to give the reward?</p>
      <div class="reward-method-btns">
        <button class="btn-outline reward-method" data-method="cash">Cash in person</button>
        <button class="btn-outline reward-method" data-method="digital">Digital payment</button>
      </div>`;
  } else if (pet.reward_method === 'cash') {
    h += pet.reward_sent
      ? `<p class="ok-tag">Reward given ✓ ${finder.reward_received ? '&mdash; finder confirmed ✓' : pending}</p>`
      : `<p>Reward: <strong>${esc(pet.reward || '—')}</strong> in cash at handover.</p>
         <button class="btn-primary" id="reward-given-btn">Mark reward given</button>`;
    h += `<p class="reward-change"><button class="link-btn" id="reward-change-btn">Change method</button></p>`;
  } else {
    if (!finder.payment_handle) {
      h += `<p class="section-hint">Waiting for ${esc(finder.reporter_name)} to add their payment info on their page…</p>`;
    } else {
      const link = paymentLink(finder.payment_type, finder.payment_handle, amount);
      h += `<p>Pay <strong>${esc(pet.reward || '')}</strong> via ${esc(paymentLabel(finder.payment_type))} &bull; <strong>${esc(finder.payment_handle)}</strong></p>`;
      h += link
        ? `<a href="${esc(link)}" target="_blank" rel="noopener" class="btn-primary">Pay reward &rarr;</a> `
        : `<p class="section-hint">Open your banking app and send to the handle above.</p>`;
      h += pet.reward_sent
        ? `<p class="ok-tag">Marked sent ✓ ${finder.reward_received ? '&mdash; finder confirmed ✓' : pending}</p>`
        : `<button class="btn-outline" id="reward-sent-btn">I sent it</button>`;
    }
    h += `<p class="reward-change"><button class="link-btn" id="reward-change-btn">Change method</button></p>`;
  }

  h += pet.pet_returned
    ? '<hr><p class="reunited-tag">🎉 Reunited — pet returned!</p>'
    : '<hr><button class="btn-primary" id="pet-returned-btn">Pet returned ✓</button>';
  h += `</div><div class="reunion-thread" id="reunion-thread"></div>`;
  body.innerHTML = h;

  body.querySelectorAll('.reward-method').forEach(b =>
    b.addEventListener('click', () => updatePet(petId, { reward_method: b.dataset.method })));
  document.getElementById('reward-change-btn')?.addEventListener('click', () => updatePet(petId, { reward_method: null, reward_sent: false }));
  document.getElementById('reward-given-btn')?.addEventListener('click', () => updatePet(petId, { reward_sent: true }));
  document.getElementById('reward-sent-btn')?.addEventListener('click', () => updatePet(petId, { reward_sent: true }));
  document.getElementById('pet-returned-btn')?.addEventListener('click', () => updatePet(petId, { pet_returned: true }));

  const threadEl = document.getElementById('reunion-thread');
  if (threadEl) mountThread(threadEl, finder.id);
}

// ── Delete post ───────────────────────────────────────────────────────────────

async function deletePost(petId) {
  if (!confirm('Permanently delete this post? This also removes all sightings and messages tied to it. This cannot be undone.')) return;

  const btn = document.getElementById('delete-post-btn');
  btn.disabled = true;
  btn.textContent = 'Deleting…';

  // .select() returns the deleted rows — empty means RLS blocked it (not the owner)
  const { data, error } = await getDb().from('pets').delete().eq('id', petId).select();

  if (error || !data || data.length === 0) {
    btn.disabled = false;
    btn.textContent = 'Delete Post';
    alert('Could not delete this post. You can only delete a post from the same device or account it was created on.');
    return;
  }

  // Drop it from this device's saved posts, if present
  try {
    const mine = JSON.parse(localStorage.getItem('myPets') || '[]').filter(p => p.id !== petId);
    localStorage.setItem('myPets', JSON.stringify(mine));
  } catch {}

  alert('Your post has been deleted.');
  location.href = 'index.html';
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

// ── Printable flyer ───────────────────────────────────────────────────────────
// One ready-made flyer template per animal type. Headline, accent colour and the
// "if you find me" advice are tailored to how that animal behaves when lost; the
// name, reward, photo and other details are auto-filled from the post.

const FLYER_TEMPLATES = {
  dog: {
    emoji: '🐕', word: 'DOG', accent: '#2B7FBA',
    tips: [
      "Please don't chase me — a scared dog can bolt into traffic.",
      "Crouch low, avoid staring, and tempt me with food or a calm voice.",
      "If you can't catch me safely, note where I went and call below.",
    ],
  },
  cat: {
    emoji: '🐈', word: 'CAT', accent: '#E05520',
    tips: [
      "I'm likely hiding close by — check under porches, cars, sheds and bushes.",
      "I may be too frightened to come out, even to my owner. Don't chase me.",
      "Leave food out and call the number below with the location.",
    ],
  },
  rabbit: {
    emoji: '🐇', word: 'RABBIT', accent: '#7A4FB5',
    tips: [
      "I frighten easily and may freeze or dart — approach slowly and stay low.",
      "Tempt me with greens and gently block off escape routes.",
      "Check sheltered, shady spots: under bushes, decks and hedges.",
    ],
  },
  bird: {
    emoji: '🦜', word: 'BIRD', accent: '#2E7D32',
    tips: [
      "I may be perched high in a tree or on a roof — look and listen for me.",
      "Don't startle me; speak softly and call my owner right away.",
      "Familiar voices and sounds may keep me nearby until help arrives.",
    ],
  },
  other: {
    emoji: '🐾', word: 'PET', accent: '#2B7FBA',
    tips: [
      "Please don't chase me — I may be frightened and run.",
      "Approach calmly and quietly, and offer food if it's safe to.",
      "Note where you saw me and call the number below.",
    ],
  },
};

function flyerTemplate(pet) {
  const t = FLYER_TEMPLATES[pet.pet_type] || FLYER_TEMPLATES.other;
  const word = pet.pet_type === 'other'
    ? (pet.pet_type_other ? pet.pet_type_other.toUpperCase() : 'PET')
    : t.word;
  return { ...t, word };
}

function buildFlyerHtml(pet) {
  const t = flyerTemplate(pet);
  const missing = new Date(pet.missing_since).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const tips = t.tips.map(x => `<li>${esc(x)}</li>`).join('');

  return `
    <article class="flyer-sheet" style="--flyer-accent:${t.accent}">
      <header class="flyer-head">
        <p class="flyer-kicker">Have you seen me?</p>
        <h1 class="flyer-title"><span class="flyer-emoji">${t.emoji}</span> LOST ${esc(t.word)}</h1>
      </header>

      ${pet.photo_url ? `<img src="${esc(pet.photo_url)}" class="flyer-photo" alt="Photo of ${esc(pet.pet_name)}">` : ''}

      <h2 class="flyer-name">${esc(pet.pet_name)}</h2>
      ${pet.reward ? `<p class="flyer-reward">REWARD: ${esc(pet.reward)}</p>` : ''}

      <div class="flyer-facts">
        ${pet.description ? `<p class="flyer-desc">${esc(pet.description)}</p>` : ''}
        ${pet.last_seen_area ? `<p class="flyer-fact"><strong>Last seen:</strong> ${esc(pet.last_seen_area)}</p>` : ''}
        <p class="flyer-fact"><strong>Missing since:</strong> ${esc(missing)}</p>
      </div>

      <div class="flyer-tips">
        <h3>If you find me</h3>
        <ul>${tips}</ul>
      </div>

      <div class="flyer-contact-row">
        <div class="flyer-contact">
          <p class="flyer-contact-label">Please contact</p>
          <p class="flyer-contact-value">${esc(pet.owner_contact)}</p>
        </div>
        <div class="flyer-qr">
          <div id="flyer-qr-code"></div>
          <p class="flyer-qr-cap">Scan to report a sighting</p>
        </div>
      </div>

      <p class="flyer-foot">Posted with Lost Pet Finder — helping neighbors help each other.</p>
    </article>`;
}

function printFlyer() {
  if (!currentPet) return;

  const root = document.getElementById('flyer-root');
  if (!root) { window.print(); return; }

  root.innerHTML = buildFlyerHtml(currentPet);

  // QR code → the public "report a sighting" page for this pet.
  const qrEl = document.getElementById('flyer-qr-code');
  if (qrEl && typeof QRCode !== 'undefined') {
    try {
      new QRCode(qrEl, {
        text: `${location.origin}/sighting.html?id=${currentPet.id}`,
        width: 132, height: 132, correctLevel: QRCode.CorrectLevel.M,
      });
    } catch { qrEl.closest('.flyer-qr')?.remove(); }
  } else if (qrEl) {
    qrEl.closest('.flyer-qr')?.remove(); // QR library unavailable — drop the empty slot
  }

  document.body.classList.add('printing-flyer');
  window.print();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showSection(id) { document.getElementById(id).hidden = false; }
function setEl(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function setVal(id, val)  { const el = document.getElementById(id); if (el) el.value = val; }
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
