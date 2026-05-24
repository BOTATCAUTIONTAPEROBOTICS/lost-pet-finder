function getDb() {
  if (!window.__db) window.__db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  return window.__db;
}

let currentSighting;

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
  if (pet) renderPetRef(pet);

  showSection('sighting-detail');
  showSection('thread-section');

  await loadMessages(id);
  subscribeThread(id);

  document.getElementById('thread-send-form')?.addEventListener('submit', e => sendMessage(e, id));
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
      <p class="msg-content">${esc(m.content)}</p>
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
