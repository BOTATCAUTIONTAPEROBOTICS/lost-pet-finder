function getDb() {
  if (!window.__db) window.__db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  return window.__db;
}

let currentUser;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  getDb().auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      currentUser = session.user;
      showDashboard(session.user);
    } else {
      showLogin();
    }
  });

  const { data: { session } } = await getDb().auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    showDashboard(session.user);
  } else {
    showLogin();
  }

  document.getElementById('login-form')?.addEventListener('submit', sendMagicLink);
  document.getElementById('link-email-form')?.addEventListener('submit', linkEmail);
  document.getElementById('sign-out-btn')?.addEventListener('click', signOut);
});

// ── Auth ──────────────────────────────────────────────────────────────────────

function showLogin() {
  document.getElementById('dash-login').hidden  = false;
  document.getElementById('dash-content').hidden = true;
}

async function showDashboard(user) {
  document.getElementById('dash-login').hidden  = true;
  document.getElementById('dash-content').hidden = false;

  const email = user.email || 'Anonymous session';
  setEl('account-email', email);

  if (user.email) {
    document.getElementById('link-email-section').hidden = true;
  }

  await Promise.all([loadMyPets(user.id), loadMySightings(user.id)]);
  await loadUnreadThreads(user.id);
}

async function sendMagicLink(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const btn   = e.target.querySelector('button[type="submit"]');
  btn.textContent = 'Sending…';
  btn.disabled = true;

  const { error } = await getDb().auth.signInWithOtp({ email });

  btn.textContent = 'Send Magic Link';
  btn.disabled = false;

  if (error) {
    showError('login-error', 'Could not send link — check your email address.');
  } else {
    document.getElementById('login-sent').hidden = false;
    document.getElementById('login-form').hidden = true;
  }
}

async function linkEmail(e) {
  e.preventDefault();
  const email = document.getElementById('link-email-input').value.trim();
  const btn   = e.target.querySelector('button[type="submit"]');
  btn.textContent = 'Sending…';
  btn.disabled = true;

  const { error } = await getDb().auth.updateUser({ email });

  btn.textContent = 'Link Email';
  btn.disabled = false;

  const msg = document.getElementById('link-email-msg');
  msg.textContent = error ? 'Could not send — check the email address.' : 'Check your email and click the confirmation link!';
  msg.hidden = false;
}

async function signOut() {
  await getDb().auth.signOut();
  location.reload();
}

// ── My Pets ───────────────────────────────────────────────────────────────────

async function loadMyPets(userId) {
  const { data: pets } = await getDb()
    .from('pets')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false });

  const container = document.getElementById('dash-pets-list');
  if (!pets || pets.length === 0) {
    container.innerHTML = '<div class="empty-state">No lost pet posts yet. <a href="index.html">Post one now.</a></div>';
    return;
  }

  container.innerHTML = pets.map(p => `
    <div class="dash-row">
      <div class="dash-row-info">
        <strong>${escHtml(p.pet_name)}</strong>
        <span class="pet-type-tag">${escHtml(petTypeLabel(p.pet_type, p.pet_type_other))}</span>
        <span class="status-tag status-${p.status}">${p.status}</span>
      </div>
      <a href="owner.html?id=${p.id}" class="btn-card">Manage &rarr;</a>
    </div>`).join('');
}

// ── My Sightings ──────────────────────────────────────────────────────────────

async function loadMySightings(userId) {
  const { data: sightings } = await getDb()
    .from('sightings')
    .select('*, pets(pet_name)')
    .eq('reporter_id', userId)
    .order('reported_at', { ascending: false });

  const container = document.getElementById('dash-sightings-list');
  if (!sightings || sightings.length === 0) {
    container.innerHTML = '<div class="empty-state">No sightings reported yet.</div>';
    return;
  }

  container.innerHTML = sightings.map(s => `
    <div class="dash-row">
      <div class="dash-row-info">
        <strong>${escHtml(s.pets?.pet_name || 'Unknown pet')}</strong>
        <span class="sighting-location-tag">${escHtml(s.location)}</span>
        <span class="date-tag">${new Date(s.reported_at).toLocaleDateString()}</span>
      </div>
      <a href="sighting.html?id=${s.id}" class="btn-card">View Thread &rarr;</a>
    </div>`).join('');
}

// ── Unread threads ────────────────────────────────────────────────────────────

async function loadUnreadThreads(userId) {
  const lastSeen = localStorage.getItem('lastSeen') ? new Date(localStorage.getItem('lastSeen')) : new Date(0);
  localStorage.setItem('lastSeen', new Date().toISOString());

  const { data: myPets } = await getDb().from('pets').select('id').eq('owner_id', userId);
  const { data: mySightings } = await getDb().from('sightings').select('id').eq('reporter_id', userId);

  const sightingIds = (mySightings || []).map(s => s.id);
  const petIds      = (myPets || []).map(p => p.id);

  let unread = [];

  if (sightingIds.length > 0) {
    const { data: repMsgs } = await getDb()
      .from('messages')
      .select('*, sightings(location, pet_id, pets(pet_name))')
      .in('sighting_id', sightingIds)
      .eq('sender_role', 'owner')
      .gt('created_at', lastSeen.toISOString())
      .order('created_at', { ascending: false });
    if (repMsgs) unread = unread.concat(repMsgs.map(m => ({ ...m, context: 'reporter' })));
  }

  if (petIds.length > 0) {
    const { data: petSightings } = await getDb()
      .from('sightings').select('id').in('pet_id', petIds);
    const petSightingIds = (petSightings || []).map(s => s.id);

    if (petSightingIds.length > 0) {
      const { data: ownerMsgs } = await getDb()
        .from('messages')
        .select('*, sightings(location, pets(pet_name))')
        .in('sighting_id', petSightingIds)
        .eq('sender_role', 'reporter')
        .gt('created_at', lastSeen.toISOString())
        .order('created_at', { ascending: false });
      if (ownerMsgs) unread = unread.concat(ownerMsgs.map(m => ({ ...m, context: 'owner' })));
    }
  }

  const container = document.getElementById('unread-list');
  if (unread.length === 0) {
    container.innerHTML = '<div class="empty-state">No new messages.</div>';
    return;
  }

  const badge = document.getElementById('unread-badge');
  badge.textContent = unread.length;
  badge.hidden = false;

  container.innerHTML = unread.map(m => {
    const petName  = m.sightings?.pets?.pet_name || 'a pet';
    const location = m.sightings?.location || '';
    const page     = m.context === 'reporter' ? `sighting.html?id=${m.sighting_id}` : `owner.html?id=${m.sightings?.pet_id}`;
    return `
      <div class="dash-row unread-row">
        <div class="dash-row-info">
          <strong>${m.context === 'reporter' ? 'Owner replied' : 'Reporter messaged'}</strong>
          <span>${escHtml(petName)} &bull; ${escHtml(location)}</span>
          <span class="date-tag">${new Date(m.created_at).toLocaleString()}</span>
        </div>
        <a href="${page}" class="btn-card">View &rarr;</a>
      </div>`;
  }).join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function petTypeLabel(type, other) {
  if (type === 'other') return other || 'Other';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function setEl(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
