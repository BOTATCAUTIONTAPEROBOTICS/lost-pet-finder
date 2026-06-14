function getDb() {
  if (!window.__db) window.__db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  return window.__db;
}

let currentSighting, currentPet;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await getDb().auth.getSession();
  if (!session) await getDb().auth.signInAnonymously();

  const id = new URLSearchParams(location.search).get('id');
  if (!id) { showSection('not-found'); return; }

  const { data: sighting, error } = await getDb()
    .from('sightings').select('*').eq('id', id).single();
  if (error || !sighting) { showSection('not-found'); return; }

  currentSighting = sighting;
  renderSighting(sighting);

  const { data: pet } = await getDb()
    .from('pets').select('*').eq('id', sighting.pet_id).single();
  if (pet) { currentPet = pet; renderPetRef(pet); }

  showSection('sighting-detail');
  showSection('thread-section');

  renderFinderSection();
  subscribePet(sighting.pet_id);

  await loadMessages(id);
  subscribeThread(id);

  document.getElementById('thread-send-form')?.addEventListener('submit', e => sendMessage(e, id));
  document.getElementById('thread-photo-input')?.addEventListener('change', e => sendPhoto(e, id));
});

// ── Render sighting ───────────────────────────────────────────────────────────

function renderSighting(s) {
  document.title = `Sighting at ${s.location} — Lost Pet Finder`;
  setEl('detail-location', s.location);
  setEl('detail-date',     new Date(s.reported_at).toLocaleString());
  setEl('detail-reporter', s.reporter_name || 'Anonymous');

  if (s.note) { setEl('detail-note', s.note); showSection('detail-note'); }
  if (s.photo_url) {
    const img = document.getElementById('detail-photo');
    img.src = s.photo_url; img.hidden = false;
  }
  if (s.has_pet) showSection('detail-has-pet');
}

function renderPetRef(pet) {
  setEl('ref-pet-name',    pet.pet_name);
  setEl('ref-pet-type',    pet.pet_type === 'other' ? (pet.pet_type_other || 'Other') : pet.pet_type.charAt(0).toUpperCase() + pet.pet_type.slice(1));
  setEl('ref-pet-desc',    pet.description);
  setEl('ref-pet-contact', pet.owner_contact);
  showSection('pet-ref');
}

// ── Finder reunion / reward panel ─────────────────────────────────────────────

function paymentLabel(type) {
  return { venmo: 'Venmo', paypal: 'PayPal', cashapp: 'Cash App', zelle: 'Zelle' }[type] || type;
}

function renderFinderSection() {
  const pet = currentPet, s = currentSighting;
  const section = document.getElementById('finder-section');
  const body    = document.getElementById('finder-body');
  if (!section || !body || !pet) return;

  // Only relevant once the pet is found.
  if (pet.status !== 'found') { section.hidden = true; return; }

  // Found, but this sighting isn't the chosen finder — just a thank-you note.
  if (pet.found_sighting_id !== s.id) {
    setEl('finder-heading', 'This pet has been found 🎉');
    body.innerHTML = '<p class="section-hint">Thanks for helping — the owner has marked this pet as found.</p>';
    section.hidden = false;
    return;
  }

  setEl('finder-heading', `🎉 You found ${pet.pet_name}!`);
  section.hidden = false;
  const pending = '<span class="section-hint">(waiting for the owner)</span>';
  let h = '<div class="reunion-card"><p class="section-hint">Use the chat below to arrange pickup with the owner. Reward:</p>';

  if (!pet.reward_method) {
    h += '<p class="section-hint">Waiting for the owner to choose how they\'ll send the reward…</p>';
  } else if (pet.reward_method === 'cash') {
    h += `<p>The owner will pay <strong>${esc(pet.reward || 'the reward')}</strong> in cash at handover.</p>`;
    h += rewardReceiptHtml(pet, s, pending);
  } else {
    if (!s.payment_handle) {
      h += `<p>Add your payment info so the owner can send the <strong>${esc(pet.reward || 'reward')}</strong>:</p>
        <div class="pay-form">
          <select id="pay-type">
            <option value="venmo">Venmo</option>
            <option value="paypal">PayPal</option>
            <option value="cashapp">Cash App</option>
            <option value="zelle">Zelle</option>
          </select>
          <input type="text" id="pay-handle" placeholder="@username / email / phone" />
          <button class="btn-primary" id="pay-save">Save</button>
        </div>`;
    } else {
      h += `<p>Your <strong>${esc(paymentLabel(s.payment_type))}</strong>: <strong>${esc(s.payment_handle)}</strong>
        <button class="link-btn" id="pay-edit">Edit</button></p>`;
      h += rewardReceiptHtml(pet, s, pending);
    }
  }

  h += pet.pet_returned ? '<hr><p class="reunited-tag">🎉 Reunited — pet returned!</p>' : '';
  h += '</div>';
  body.innerHTML = h;

  document.getElementById('pay-save')?.addEventListener('click', saveFinderPayment);
  document.getElementById('pay-edit')?.addEventListener('click', () => updateSighting({ payment_handle: null, payment_type: null }));
  document.getElementById('reward-received-btn')?.addEventListener('click', () => updateSighting({ reward_received: true }));
}

function rewardReceiptHtml(pet, s, pending) {
  if (s.reward_received) return '<p class="ok-tag">Reward received ✓</p>';
  if (pet.reward_sent)   return '<button class="btn-primary" id="reward-received-btn">Confirm reward received</button>';
  return `<p class="ok-tag">${pending}</p>`;
}

async function saveFinderPayment() {
  const type   = document.getElementById('pay-type')?.value;
  const handle = document.getElementById('pay-handle')?.value.trim();
  if (!handle) { return; }
  await updateSighting({ payment_type: type, payment_handle: handle });
}

async function updateSighting(patch) {
  await getDb().from('sightings').update(patch).eq('id', currentSighting.id);
  Object.assign(currentSighting, patch);
  renderFinderSection();
}

function subscribePet(petId) {
  getDb().channel('finder-pet-' + petId)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'pets',
      filter: `id=eq.${petId}`
    }, ({ new: pet }) => { currentPet = pet; renderFinderSection(); })
    .subscribe();
}

// ── Messages ──────────────────────────────────────────────────────────────────

async function loadMessages(sightingId) {
  const { data: msgs } = await getDb()
    .from('messages')
    .select('*')
    .eq('sighting_id', sightingId)
    .order('created_at', { ascending: true });

  renderMessages(msgs || []);
}

function renderMessages(msgs) {
  const container = document.getElementById('thread-messages');
  if (!container) return;

  if (msgs.length === 0) {
    container.innerHTML = '<p class="thread-empty">No messages yet. The owner will reply here.</p>';
    return;
  }

  container.innerHTML = msgs.map(m => `
    <div class="msg msg-${m.sender_role}">
      <span class="msg-role">${m.sender_role === 'owner' ? 'Owner' : 'You (Reporter)'}</span>
      ${m.content ? `<p class="msg-content">${esc(m.content)}</p>` : ''}
      ${m.photo_url ? `<a href="${esc(m.photo_url)}" target="_blank" rel="noopener"><img src="${esc(m.photo_url)}" class="msg-photo" alt="Shared photo"></a>` : ''}
      <span class="msg-time">${new Date(m.created_at).toLocaleString()}</span>
    </div>`).join('');

  container.scrollTop = container.scrollHeight;
}

async function sendMessage(e, sightingId) {
  e.preventDefault();
  const input = document.getElementById('thread-input');
  const content = input.value.trim();
  if (!content) return;

  const { data: { user } } = await getDb().auth.getUser();
  if (!user) return;

  input.value = '';
  await getDb().from('messages').insert({
    sighting_id: sightingId,
    sender_id:   user.id,
    sender_role: 'reporter',
    content,
  });
}

async function sendPhoto(e, sightingId) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  const { data: { user } } = await getDb().auth.getUser();
  if (!user) return;

  const url = await uploadThreadPhoto(file);
  if (!url) { alert('Could not upload that photo — please try again.'); return; }
  await getDb().from('messages').insert({
    sighting_id: sightingId,
    sender_id:   user.id,
    sender_role: 'reporter',
    content:     '',
    photo_url:   url,
  });
}

async function uploadThreadPhoto(file) {
  const path = `thread/${Date.now()}_${file.name}`;
  const { data, error } = await getDb().storage.from('pet-photos').upload(path, file);
  if (error) return null;
  return getDb().storage.from('pet-photos').getPublicUrl(data.path).data.publicUrl;
}

function subscribeThread(sightingId) {
  getDb().channel('thread-reporter-' + sightingId)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      filter: `sighting_id=eq.${sightingId}`
    }, () => loadMessages(sightingId))
    .subscribe();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showSection(id) { const el = document.getElementById(id); if (el) el.hidden = false; }
function setEl(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
