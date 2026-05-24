function getDb() {
  if (!window.__db) window.__db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  return window.__db;
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await getDb().auth.getSession();
  if (session?.user && isAdmin(session.user)) {
    showPanel();
  }

  document.getElementById('admin-login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('admin-2fa-form')?.addEventListener('submit', handleOtp);
  document.getElementById('admin-sign-out')?.addEventListener('click', adminSignOut);

  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
});

// ── Auth ──────────────────────────────────────────────────────────────────────

function isAdmin(user) {
  return user?.user_metadata?.is_admin === true;
}

async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('admin-email').value.trim();
  const password = document.getElementById('admin-password').value;
  const btn      = e.target.querySelector('button[type="submit"]');

  btn.textContent = 'Signing in…';
  btn.disabled = true;

  const { data, error } = await getDb().auth.signInWithPassword({ email, password });

  btn.textContent = 'Sign In';
  btn.disabled = false;

  if (error || !data.user) {
    showError('login-error', 'Invalid email or password.');
    return;
  }

  if (!isAdmin(data.user)) {
    showError('login-error', 'Access denied.');
    await getDb().auth.signOut();
    return;
  }

  // Send 2FA OTP to email
  await getDb().auth.signInWithOtp({ email });
  document.getElementById('admin-login').hidden = true;
  document.getElementById('admin-2fa').hidden   = false;
}

async function handleOtp(e) {
  e.preventDefault();
  const email = document.getElementById('admin-email').value.trim();
  const token = document.getElementById('otp-code').value.trim();
  const btn   = e.target.querySelector('button[type="submit"]');

  btn.textContent = 'Verifying…';
  btn.disabled = true;

  const { data, error } = await getDb().auth.verifyOtp({ email, token, type: 'email' });

  btn.textContent = 'Verify';
  btn.disabled = false;

  if (error || !data.user) {
    showError('otp-error', 'Invalid or expired code. Try signing in again.');
    return;
  }

  if (!isAdmin(data.user)) {
    showError('otp-error', 'Access denied.');
    await getDb().auth.signOut();
    return;
  }

  showPanel();
}

async function adminSignOut() {
  await getDb().auth.signOut();
  location.reload();
}

// ── Panel ─────────────────────────────────────────────────────────────────────

async function showPanel() {
  document.getElementById('admin-login').hidden  = true;
  document.getElementById('admin-2fa').hidden    = true;
  document.getElementById('admin-panel').hidden  = false;
  await loadAdminPets();
}

function switchTab(tabId) {
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(c => c.hidden = true);
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(tabId).hidden = false;

  if (tabId === 'sightings-tab') loadAdminSightings();
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
