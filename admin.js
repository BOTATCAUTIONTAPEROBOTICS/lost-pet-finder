function getDb() {
  if (!window.__db) window.__db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  return window.__db;
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  getDb().auth.onAuthStateChange((event, session) => gateAccess(session));

  const { data: { session } } = await getDb().auth.getSession();
  gateAccess(session);

  document.getElementById('admin-login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('admin-sign-out')?.addEventListener('click', adminSignOut);

  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
});

// ── Auth ──────────────────────────────────────────────────────────────────────

function isAdmin(user) {
  // Authority is enforced server-side by RLS using the secure app_metadata claim.
  // We accept either here just to decide whether to show the panel UI.
  return user?.app_metadata?.is_admin === true || user?.user_metadata?.is_admin === true;
}

function gateAccess(session) {
  if (session?.user && isAdmin(session.user)) {
    showPanel();
  } else if (session?.user) {
    // Signed in, but not an admin account.
    showError('login-error', 'This account is not an admin. Set is_admin in app_metadata, then sign out and use the link again.');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('admin-email').value.trim();
  const btn   = e.target.querySelector('button[type="submit"]');

  btn.textContent = 'Sending…';
  btn.disabled = true;

  // shouldCreateUser:false → only sends a link if this admin account already exists
  const { error } = await getDb().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: location.origin + '/admin.html' },
  });

  btn.textContent = 'Send Magic Link';
  btn.disabled = false;

  if (error) {
    console.error('Admin magic link error:', error);
    showError('login-error', error.message || 'Could not send link — check the email address.');
    return;
  }

  document.getElementById('admin-login-form').hidden = true;
  document.getElementById('login-sent').hidden = false;
}

async function adminSignOut() {
  await getDb().auth.signOut();
  location.reload();
}

// ── Panel ─────────────────────────────────────────────────────────────────────

async function showPanel() {
  document.getElementById('admin-login').hidden  = true;
  document.getElementById('admin-panel').hidden  = false;
  await loadAdminPets();
}

function switchTab(tabId) {
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(c => c.hidden = true);
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(tabId).hidden = false;

  if (tabId === 'sightings-tab') loadAdminSightings();
  if (tabId === 'stolen-tab')    loadAdminStolen();
}

// ── Pets ──────────────────────────────────────────────────────────────────────

async function loadAdminPets() {
  const { data: pets } = await getDb()
    .from('pets')
    .select('*')
    .order('created_at', { ascending: false });

  const container = document.getElementById('admin-pets-list');
  if (!pets || pets.length === 0) {
    container.innerHTML = '<div class="empty-state">No pets posted yet.</div>';
    return;
  }

  container.innerHTML = pets.map(p => `
    <div class="admin-row">
      <div class="admin-row-info">
        <strong>${escHtml(p.pet_name)}</strong>
        <span class="status-tag status-${p.status}">${p.status}</span>
        <span class="date-tag">${new Date(p.created_at).toLocaleDateString()}</span>
        <span>${escHtml(p.owner_contact)}</span>
      </div>
      <button class="btn-danger" onclick="deletePet('${p.id}')">Delete</button>
    </div>`).join('');
}

async function deletePet(id) {
  if (!confirm('Delete this pet post permanently?')) return;
  await getDb().from('pets').delete().eq('id', id);
  await loadAdminPets();
}

// ── Sightings ─────────────────────────────────────────────────────────────────

async function loadAdminSightings() {
  const { data: sightings } = await getDb()
    .from('sightings')
    .select('*, pets(pet_name)')
    .order('reported_at', { ascending: false });

  const container = document.getElementById('admin-sightings-list');
  if (!sightings || sightings.length === 0) {
    container.innerHTML = '<div class="empty-state">No sightings yet.</div>';
    return;
  }

  container.innerHTML = sightings.map(s => `
    <div class="admin-row">
      <div class="admin-row-info">
        <strong>${escHtml(s.pets?.pet_name || 'Unknown pet')}</strong>
        <span>${escHtml(s.location)}</span>
        <span>${escHtml(s.reporter_name)}</span>
        <span class="date-tag">${new Date(s.reported_at).toLocaleDateString()}</span>
      </div>
      <button class="btn-danger" onclick="deleteSighting('${s.id}')">Delete</button>
    </div>`).join('');
}

async function deleteSighting(id) {
  if (!confirm('Delete this sighting permanently?')) return;
  await getDb().from('sightings').delete().eq('id', id);
  await loadAdminSightings();
}

// ── Stolen / Tracking ─────────────────────────────────────────────────────────

let stolenCases = {};  // petId -> { pet, sightings }

async function loadAdminStolen() {
  const container = document.getElementById('admin-stolen-list');

  const { data: pets } = await getDb()
    .from('pets')
    .select('*')
    .eq('is_stolen', true)
    .order('stolen_reported_at', { ascending: false });

  if (!pets || pets.length === 0) {
    container.innerHTML = '<div class="empty-state">No pets reported stolen.</div>';
    return;
  }

  const ids = pets.map(p => p.id);
  const { data: sightings } = await getDb()
    .from('sightings')
    .select('*')
    .in('pet_id', ids)
    .order('reported_at', { ascending: false });

  stolenCases = {};
  pets.forEach(p => { stolenCases[p.id] = { pet: p, sightings: [] }; });
  (sightings || []).forEach(s => { if (stolenCases[s.pet_id]) stolenCases[s.pet_id].sightings.push(s); });

  container.innerHTML = pets.map(p => renderStolenCase(stolenCases[p.id])).join('');
}

function renderStolenCase({ pet: p, sightings }) {
  const reported  = p.stolen_reported_at ? new Date(p.stolen_reported_at).toLocaleString() : '—';
  const tracking  = p.tracking_active;
  const last      = sightings.find(s => s.location);
  const lastKnown = last
    ? `${escHtml(last.location)} <span class="date-tag">${new Date(last.reported_at).toLocaleString()}</span>`
    : '<span class="section-hint">No sightings yet</span>';

  return `
    <div class="case-card">
      <div class="case-head">
        <strong>${escHtml(p.pet_name)}</strong>
        ${p.case_confirmed
          ? '<span class="status-tag status-tracking">Confirmed case</span>'
          : '<span class="status-tag status-active">Under review</span>'}
        <span class="status-tag ${tracking ? 'status-tracking' : 'status-found'}">${tracking ? 'Tracking on' : 'Tracking off'}</span>
        <span class="date-tag">Reported ${reported}</span>
      </div>
      <div class="case-meta">
        <div><strong>Owner:</strong> ${escHtml(p.owner_contact)}</div>
        <div><strong>Last known location:</strong> ${lastKnown}</div>
        <div><strong>Sightings:</strong> ${sightings.length}</div>
      </div>
      <div class="case-actions">
        ${p.case_confirmed ? '' : `<button class="btn-primary" onclick="confirmCase('${p.id}')">Confirm case</button>`}
        <button class="btn-card" onclick="reviewCase('${p.id}')">Review threads</button>
        <button class="btn-card btn-card-outline" onclick="exportCase('${p.id}')">Export for police</button>
        <a class="btn-card btn-card-outline" href="owner.html?id=${p.id}" target="_blank" rel="noopener">Map</a>
        <button class="btn-card" onclick="toggleTracking('${p.id}', ${tracking})">${tracking ? 'Stop tracking' : 'Re-open tracking'}</button>
        <button class="btn-danger" onclick="dismissCase('${p.id}')">Dismiss</button>
      </div>
      <div class="case-review" id="case-review-${p.id}" hidden></div>
    </div>`;
}

async function confirmCase(id) {
  const { data, error } = await getDb().from('pets').update({ case_confirmed: true }).eq('id', id).select();
  if (error || !data || data.length === 0) alert('Could not update. Make sure your admin account has is_admin set in app_metadata.');
  await loadAdminStolen();
}

async function dismissCase(id) {
  if (!confirm('Dismiss this case? This removes the STOLEN flag and stops tracking.')) return;
  const { data, error } = await getDb().from('pets')
    .update({ is_stolen: false, tracking_active: false, case_confirmed: false })
    .eq('id', id).select();
  if (error || !data || data.length === 0) alert('Could not dismiss. Make sure your admin account has is_admin set in app_metadata.');
  await loadAdminStolen();
}

async function toggleTracking(id, currentlyTracking) {
  const verb = currentlyTracking ? 'Stop tracking' : 'Re-open tracking';
  if (!confirm(`${verb} this stolen case?`)) return;

  const { data, error } = await getDb()
    .from('pets')
    .update({ tracking_active: !currentlyTracking })
    .eq('id', id)
    .select();

  if (error || !data || data.length === 0 || data[0].tracking_active === currentlyTracking) {
    alert('Could not change tracking. Make sure your admin account has is_admin set in app_metadata.');
  }
  await loadAdminStolen();
}

async function reviewCase(id) {
  const box = document.getElementById(`case-review-${id}`);
  if (!box) return;
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<p class="thread-loading">Loading threads…</p>';

  const sightings = stolenCases[id]?.sightings || [];
  if (sightings.length === 0) { box.innerHTML = '<p class="section-hint">No sightings or threads for this case yet.</p>'; return; }

  const blocks = [];
  for (const s of sightings) {
    const { data: msgs } = await getDb().from('messages').select('*').eq('sighting_id', s.id).order('created_at', { ascending: true });
    const msgsHtml = (msgs || []).length === 0
      ? '<p class="thread-empty">No messages.</p>'
      : (msgs || []).map(m => `
          <div class="msg msg-${m.sender_role}">
            <span class="msg-role">${m.sender_role === 'owner' ? 'Owner' : 'Reporter'}</span>
            ${m.content ? `<p class="msg-content">${escHtml(m.content)}</p>` : ''}
            ${m.photo_url ? `<a href="${escHtml(m.photo_url)}" target="_blank" rel="noopener"><img src="${escHtml(m.photo_url)}" class="msg-photo" alt="Photo shared in the case thread"></a>` : ''}
            <span class="msg-time">${new Date(m.created_at).toLocaleString()}</span>
          </div>`).join('');
    blocks.push(`
      <div class="case-thread">
        <p class="case-thread-head"><strong>${escHtml(s.location)}</strong> &bull; ${escHtml(s.reporter_name)}${s.reporter_contact ? ' &bull; ' + escHtml(s.reporter_contact) : ''} <span class="date-tag">${new Date(s.reported_at).toLocaleString()}</span></p>
        <div class="thread-messages">${msgsHtml}</div>
      </div>`);
  }
  box.innerHTML = blocks.join('');
}

function exportCase(id) {
  const c = stolenCases[id];
  if (!c) return;
  const p = c.pet;
  const L = [];
  L.push(`STOLEN PET CASE — ${p.pet_name}`);
  L.push(`Status: ${p.case_confirmed ? 'CONFIRMED by admin' : 'Under review'}`);
  L.push(`Reported stolen: ${p.stolen_reported_at ? new Date(p.stolen_reported_at).toLocaleString() : '—'}`);
  L.push(`Pet: ${petTypeText(p)} — ${p.description}`);
  if (p.reward) L.push(`Reward offered: ${p.reward}`);
  L.push(`Owner contact: ${p.owner_contact}`);
  L.push('');
  L.push(`SIGHTINGS (${c.sightings.length}) — most recent first:`);
  c.sightings.forEach((s, i) => {
    L.push(`${i + 1}. ${new Date(s.reported_at).toLocaleString()} — ${s.location}`);
    if (s.latitude && s.longitude) L.push(`   GPS: ${s.latitude}, ${s.longitude}`);
    L.push(`   Reporter: ${s.reporter_name}${s.reporter_contact ? ' (' + s.reporter_contact + ')' : ''}${s.has_pet ? '  *** SAYS THEY HAVE THE PET ***' : ''}`);
    if (s.note) L.push(`   Note: ${s.note}`);
    if (s.photo_url) L.push(`   Photo: ${s.photo_url}`);
  });
  L.push('');
  L.push(`Generated ${new Date().toLocaleString()} via Lost Pet Finder.`);

  const blob = new Blob([L.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `stolen-case-${p.pet_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function petTypeText(p) {
  return p.pet_type === 'other' ? (p.pet_type_other || 'Other') : p.pet_type.charAt(0).toUpperCase() + p.pet_type.slice(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
