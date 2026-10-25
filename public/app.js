/* ════════════════════════════════════════════════════════════
   TurfBook — Frontend Application Logic
   ════════════════════════════════════════════════════════════ */

// ─── State ───────────────────────────────────────────────────────
let currentUser = null;
let currentPage = 'home';
let selectedTurfId = null;
let selectedSlotId = null;
let selectedSlotData = null;
let selectedTurfData = null;
let addSlotsTurfId = null;
let notificationInterval = null;

// ─── API Helper ──────────────────────────────────────────────────
async function api(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  } catch (err) {
    throw err;
  }
}

// ─── Toast Notifications ─────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─── Navigation ──────────────────────────────────────────────────
function navigateTo(page, params = {}) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');

  // Update nav
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const navLink = document.querySelector(`[data-page="${page}"]`);
  if (navLink) navLink.classList.add('active');

  currentPage = page;
  closeDropdowns();
  closeMobileNav();

  // Show target page
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) {
    pageEl.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Page-specific loading
  switch (page) {
    case 'home': loadHomeTurfs(); break;
    case 'book': loadBookPage(); break;
    case 'players': loadPlayersPage(); break;
    case 'dashboard': loadDashboard(); break;
    case 'my-bookings': loadMyBookings(); break;
    case 'turf-detail':
      if (params.turfId) showTurfDetail(params.turfId);
      break;
  }
}

function navigateToArea(area) {
  window.location.hash = 'book';
  setTimeout(() => {
    document.getElementById('filter-city').value = 'Mumbai';
    onCityChange().then(() => {
      document.getElementById('filter-area').value = area;
      onAreaChange();
    });
  }, 100);
}

// ─── Auth ────────────────────────────────────────────────────────
function showAuthModal(tab = 'login') {
  document.getElementById('auth-modal').style.display = 'flex';
  switchAuthTab(tab);
}

function closeAuthModal() {
  document.getElementById('auth-modal').style.display = 'none';
  document.getElementById('login-error').textContent = '';
  document.getElementById('signup-error').textContent = '';
}

function switchAuthTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
  document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('signup-form').style.display = tab === 'signup' ? 'block' : 'none';
}

function fillDemo(role) {
  const emails = { owner: 'owner@turfbook.com', client: 'client@turfbook.com', player: 'player@turfbook.com' };
  const passwords = { owner: 'owner123', client: 'client123', player: 'player123' };
  document.getElementById('login-email').value = emails[role];
  document.getElementById('login-password').value = passwords[role];
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  try {
    const user = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    currentUser = user;
    closeAuthModal();
    updateUIForUser();
    showToast(`Welcome back, ${user.name}!`, 'success');
    startNotificationPolling();
  } catch (err) {
    document.getElementById('login-error').textContent = err.message;
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const name = document.getElementById('signup-name').value;
  const email = document.getElementById('signup-email').value;
  const phone = document.getElementById('signup-phone').value;
  const password = document.getElementById('signup-password').value;
  const role = document.querySelector('input[name="signup-role"]:checked')?.value;

  if (!role) {
    document.getElementById('signup-error').textContent = 'Please select a role';
    return;
  }

  try {
    const user = await api('/api/auth/signup', { method: 'POST', body: { name, email, password, phone, role } });
    currentUser = user;
    closeAuthModal();
    updateUIForUser();
    showToast(`Welcome to TurfBook, ${user.name}!`, 'success');
    startNotificationPolling();
  } catch (err) {
    document.getElementById('signup-error').textContent = err.message;
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  stopNotificationPolling();
  updateUIForUser();
  window.location.hash = 'home';
  showToast('Logged out successfully', 'info');
}

function updateUIForUser() {
  const actions = document.getElementById('nav-actions');
  const userSection = document.getElementById('nav-user');

  if (currentUser) {
    actions.style.display = 'none';
    userSection.style.display = 'flex';
    document.getElementById('user-avatar').textContent = currentUser.name.charAt(0).toUpperCase();
    document.getElementById('user-name').textContent = currentUser.name;

    // Show/hide dashboard based on role
    const dashLink = document.getElementById('dropdown-dashboard');
    dashLink.style.display = 'flex';
    if (currentUser.role === 'owner') {
      dashLink.querySelector('svg').nextSibling.textContent = ' Owner Dashboard';
    } else if (currentUser.role === 'player') {
      dashLink.querySelector('svg').nextSibling.textContent = ' My Games';
    } else {
      dashLink.querySelector('svg').nextSibling.textContent = ' Dashboard';
    }
  } else {
    actions.style.display = 'flex';
    userSection.style.display = 'none';
  }
}

// ─── Dropdowns ───────────────────────────────────────────────────
function toggleUserMenu() {
  document.getElementById('user-dropdown').classList.toggle('show');
  document.getElementById('notifications-panel').classList.remove('show');
}

function toggleNotifications() {
  document.getElementById('notifications-panel').classList.toggle('show');
  document.getElementById('user-dropdown').classList.remove('show');
  loadNotifications();
}

function closeDropdowns() {
  document.getElementById('user-dropdown')?.classList.remove('show');
  document.getElementById('notifications-panel')?.classList.remove('show');
}

function toggleMobileNav() {
  document.getElementById('nav-links').classList.toggle('show');
}
function closeMobileNav() {
  document.getElementById('nav-links').classList.remove('show');
}

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.nav-user') && !e.target.closest('.notifications-panel')) {
    closeDropdowns();
  }
});

// ─── Notifications ───────────────────────────────────────────────
async function loadNotifications() {
  if (!currentUser) return;
  try {
    const notifications = await api('/api/notifications');
    const list = document.getElementById('notif-list');
    if (notifications.length === 0) {
      list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
      return;
    }
    list.innerHTML = notifications.map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="markNotifRead(${n.id})">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-message">${escapeHtml(n.message)}</div>
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Load notifications error:', err);
  }
}

async function updateNotifBadge() {
  if (!currentUser) return;
  try {
    const { count } = await api('/api/notifications/unread-count');
    const badge = document.getElementById('notif-badge');
    if (count > 0) {
      badge.style.display = 'flex';
      badge.textContent = count > 9 ? '9+' : count;
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    console.error('Update notif badge error:', err);
  }
}

async function markNotifRead(id) {
  try {
    await api(`/api/notifications/${id}/read`, { method: 'PUT' });
    loadNotifications();
    updateNotifBadge();
  } catch (err) {
    console.error(err);
  }
}

async function markAllRead() {
  try {
    await api('/api/notifications/read-all', { method: 'PUT' });
    loadNotifications();
    updateNotifBadge();
    showToast('All notifications marked as read', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function startNotificationPolling() {
  updateNotifBadge();
  stopNotificationPolling();
  notificationInterval = setInterval(updateNotifBadge, 15000);
}

function stopNotificationPolling() {
  if (notificationInterval) { clearInterval(notificationInterval); notificationInterval = null; }
}

// ─── Home Page ───────────────────────────────────────────────────
async function loadHomeTurfs() {
  try {
    const turfs = await api('/api/turfs');
    const grid = document.getElementById('home-turf-grid');
    grid.innerHTML = turfs.slice(0, 3).map(t => renderTurfCard(t)).join('');
  } catch (err) {
    console.error('Load home turfs error:', err);
  }
}

// ─── Book Page ───────────────────────────────────────────────────
async function loadBookPage() {
  await loadCities();
  await loadTurfs();
}

async function loadCities() {
  try {
    const cities = await api('/api/turfs/cities');
    const select = document.getElementById('filter-city');
    const gamesSelect = document.getElementById('games-filter-city');
    select.innerHTML = '<option value="">All Cities</option>' + cities.map(c => `<option value="${c}">${c}</option>`).join('');
    if (gamesSelect) gamesSelect.innerHTML = '<option value="">All Cities</option>' + cities.map(c => `<option value="${c}">${c}</option>`).join('');
  } catch (err) {
    console.error(err);
  }
}

async function onCityChange() {
  const city = document.getElementById('filter-city').value;
  const areaSelect = document.getElementById('filter-area');
  areaSelect.innerHTML = '<option value="">All Areas</option>';
  if (city) {
    try {
      const areas = await api(`/api/turfs/areas/${encodeURIComponent(city)}`);
      areaSelect.innerHTML += areas.map(a => `<option value="${a}">${a}</option>`).join('');
    } catch (err) {
      console.error(err);
    }
  }
  loadTurfs();
}

function onAreaChange() {
  loadTurfs();
}

let searchTimeout;
function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadTurfs, 300);
}

async function loadTurfs() {
  const city = document.getElementById('filter-city').value;
  const area = document.getElementById('filter-area').value;
  const search = document.getElementById('filter-search').value;

  let url = '/api/turfs?';
  if (city) url += `city=${encodeURIComponent(city)}&`;
  if (area) url += `area=${encodeURIComponent(area)}&`;
  if (search) url += `search=${encodeURIComponent(search)}&`;

  try {
    const turfs = await api(url);
    const grid = document.getElementById('book-turf-grid');
    const empty = document.getElementById('no-turfs');

    if (turfs.length === 0) {
      grid.innerHTML = '';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      grid.innerHTML = turfs.map(t => renderTurfCard(t)).join('');
    }
  } catch (err) {
    console.error('Load turfs error:', err);
  }
}

function renderTurfCard(turf) {
  let amenities = [];
  try { amenities = JSON.parse(turf.amenities || '[]'); } catch(e) { amenities = []; }
  return `
    <div class="turf-card" onclick="window.location.hash='turf/${turf.id}'">
      <div class="turf-card-image">
        ⚽
        <div class="turf-card-price">₹${turf.price_per_hour}/hr</div>
      </div>
      <div class="turf-card-body">
        <div class="turf-card-name">${escapeHtml(turf.name)}</div>
        <div class="turf-card-location">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${escapeHtml(turf.city)} / ${escapeHtml(turf.area)}
        </div>
        <div class="turf-card-amenities">
          ${amenities.slice(0, 4).map(a => `<span class="amenity-tag">${escapeHtml(a)}</span>`).join('')}
          ${amenities.length > 4 ? `<span class="amenity-tag">+${amenities.length - 4} more</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ─── Turf Detail ─────────────────────────────────────────────────
async function showTurfDetail(turfId) {
  selectedTurfId = turfId;

  // Show page
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.getElementById('page-turf-detail').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  try {
    const turf = await api(`/api/turfs/${turfId}`);
    selectedTurfData = turf;
    let amenities = [];
    try { amenities = JSON.parse(turf.amenities || '[]'); } catch(e) {}

    document.getElementById('turf-detail-name').textContent = turf.name;
    document.getElementById('turf-detail-location').textContent = `${turf.city} / ${turf.area}`;
    document.getElementById('turf-detail-desc').textContent = turf.description || 'No description available.';
    document.getElementById('turf-detail-address').textContent = turf.address || 'Address not provided';
    document.getElementById('turf-detail-price').textContent = `₹${turf.price_per_hour} / hour`;
    document.getElementById('turf-detail-owner').textContent = `Managed by ${turf.owner_name}`;
    document.getElementById('turf-detail-amenities').innerHTML = amenities.map(a => `<span class="amenity-tag">${escapeHtml(a)}</span>`).join('');

    // Set date picker to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('slot-date-picker').value = today;
    document.getElementById('slot-date-picker').min = today;

    loadSlotsForDate();
  } catch (err) {
    showToast('Failed to load turf details', 'error');
  }
}

async function loadSlotsForDate() {
  const date = document.getElementById('slot-date-picker').value;
  if (!date || !selectedTurfId) return;

  try {
    const slots = await api(`/api/turfs/${selectedTurfId}/slots?date=${date}`);
    const grid = document.getElementById('slots-grid');
    const empty = document.getElementById('no-slots');

    if (slots.length === 0) {
      grid.innerHTML = '';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      grid.innerHTML = slots.map(s => `
        <div class="slot-card ${s.status === 'booked' ? 'slot-booked' : ''} ${s.status === 'blocked' ? 'slot-blocked' : ''}"
             onclick="${s.status === 'available' ? `selectSlot(${s.id}, '${s.start_time}', '${s.end_time}', '${s.date}')` : ''}">
          <div class="slot-time">${formatTime(s.start_time)} - ${formatTime(s.end_time)}</div>
          <div class="slot-status ${s.status}">${s.status === 'available' ? '● Available' : s.status === 'booked' ? '● Booked' : '● Blocked'}</div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Load slots error:', err);
  }
}

function selectSlot(slotId, startTime, endTime, date) {
  if (!currentUser) {
    showAuthModal('login');
    showToast('Please log in to book a slot', 'info');
    return;
  }
  if (currentUser.role !== 'client') {
    showToast('Only clients can book turfs. Please log in as a client.', 'error');
    return;
  }

  selectedSlotId = slotId;
  selectedSlotData = { startTime, endTime, date };

  // Show booking modal with summary
  const summary = document.getElementById('booking-summary');
  summary.innerHTML = `
    <div class="booking-row"><span class="booking-label">Turf</span><span class="booking-value">${escapeHtml(selectedTurfData.name)}</span></div>
    <div class="booking-row"><span class="booking-label">Location</span><span class="booking-value">${escapeHtml(selectedTurfData.city)} / ${escapeHtml(selectedTurfData.area)}</span></div>
    <div class="booking-row"><span class="booking-label">Date</span><span class="booking-value">${formatDate(date)}</span></div>
    <div class="booking-row"><span class="booking-label">Time</span><span class="booking-value">${formatTime(startTime)} - ${formatTime(endTime)}</span></div>
    <div class="booking-row"><span class="booking-label">Price</span><span class="booking-value booking-total">₹${selectedTurfData.price_per_hour}</span></div>
  `;
  document.getElementById('booking-notes').value = '';
  document.getElementById('booking-modal').style.display = 'flex';
}

async function handleBooking(e) {
  e.preventDefault();
  if (!selectedSlotId) return;

  const notes = document.getElementById('booking-notes').value;
  try {
    await api('/api/bookings', {
      method: 'POST',
      body: { slot_id: selectedSlotId, notes }
    });
    closeModal('booking-modal');
    showToast('Booking request sent! The owner will confirm shortly.', 'success');
    loadSlotsForDate(); // Refresh slots
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Dashboard ───────────────────────────────────────────────────
async function loadDashboard() {
  if (!currentUser) {
    showAuthModal('login');
    return;
  }

  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.getElementById('page-dashboard').style.display = 'block';

  document.getElementById('owner-dashboard').style.display = 'none';
  document.getElementById('client-dashboard').style.display = 'none';
  document.getElementById('player-dashboard').style.display = 'none';

  if (currentUser.role === 'owner') {
    document.getElementById('dashboard-title').textContent = 'Owner Dashboard';
    document.getElementById('dashboard-subtitle').textContent = 'Manage your turfs, slots, and bookings';
    document.getElementById('owner-dashboard').style.display = 'block';
    loadOwnerTurfs();
    loadOwnerBookings();
  } else if (currentUser.role === 'client') {
    document.getElementById('dashboard-title').textContent = 'My Bookings';
    document.getElementById('dashboard-subtitle').textContent = 'Track your turf reservations';
    document.getElementById('client-dashboard').style.display = 'block';
    loadClientBookings();
  } else if (currentUser.role === 'player') {
    document.getElementById('dashboard-title').textContent = 'My Games';
    document.getElementById('dashboard-subtitle').textContent = 'Games you created or joined';
    document.getElementById('player-dashboard').style.display = 'block';
    loadMyGames();
  }
}

function switchDashTab(btn) {
  const tabGroup = btn.closest('.dashboard-tabs');
  tabGroup.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const tabName = btn.getAttribute('data-tab');
  const parent = btn.closest('#owner-dashboard') || btn.closest('#player-dashboard');
  parent.querySelectorAll('.dash-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`panel-${tabName}`).style.display = 'block';
}

// Owner: Load turfs
async function loadOwnerTurfs() {
  try {
    const turfs = await api('/api/owner/turfs');
    const list = document.getElementById('owner-turfs-list');
    if (turfs.length === 0) {
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">🏟️</span><h3>No turfs yet</h3><p>Add your first turf to get started</p></div>';
      return;
    }
    list.innerHTML = turfs.map(t => {
      let amenities = [];
      try { amenities = JSON.parse(t.amenities || '[]'); } catch(e) {}
      return `
        <div class="owner-turf-card">
          <div class="owner-turf-header">
            <div class="owner-turf-name">${escapeHtml(t.name)}</div>
            <span class="amenity-tag">₹${t.price_per_hour}/hr</span>
          </div>
          <div class="owner-turf-meta">
            <span>📍 ${escapeHtml(t.city)} / ${escapeHtml(t.area)}</span>
            <span>📍 ${escapeHtml(t.address || 'No address')}</span>
          </div>
          <div class="turf-card-amenities mt-2">
            ${amenities.map(a => `<span class="amenity-tag">${escapeHtml(a)}</span>`).join('')}
          </div>
          <div class="owner-turf-actions">
            <button class="btn btn-primary btn-sm" onclick="showAddSlotsModal(${t.id}, '${escapeHtml(t.name)}')">Add Slots</button>
            <button class="btn btn-outline btn-sm" onclick="window.location.hash='turf/${t.id}'">View</button>
            <button class="btn btn-danger btn-sm" onclick="deleteTurf(${t.id})">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    showToast('Failed to load turfs', 'error');
  }
}

// Owner: Load bookings
async function loadOwnerBookings() {
  try {
    const bookings = await api('/api/owner/bookings');
    const list = document.getElementById('owner-bookings-list');
    if (bookings.length === 0) {
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">📋</span><h3>No booking requests</h3><p>Bookings will appear here when clients book your turfs</p></div>';
      return;
    }
    list.innerHTML = bookings.map(b => renderBookingCard(b, 'owner')).join('');
  } catch (err) {
    showToast('Failed to load bookings', 'error');
  }
}

// Client: Load bookings
async function loadClientBookings() {
  try {
    const bookings = await api('/api/bookings/my');
    const list = document.getElementById('client-bookings-list');
    if (bookings.length === 0) {
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">📋</span><h3>No bookings yet</h3><p>Find a turf and book your first game!</p></div>';
      return;
    }
    list.innerHTML = bookings.map(b => renderBookingCard(b, 'client')).join('');
  } catch (err) {
    showToast('Failed to load bookings', 'error');
  }
}

// Shared: My Bookings page
async function loadMyBookings() {
  if (!currentUser) { showAuthModal('login'); return; }

  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.getElementById('page-my-bookings').style.display = 'block';

  try {
    const bookings = await api('/api/bookings/my');
    const list = document.getElementById('all-bookings-list');
    const empty = document.getElementById('no-bookings');
    if (bookings.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      list.innerHTML = bookings.map(b => renderBookingCard(b, currentUser.role)).join('');
    }
  } catch (err) {
    showToast('Failed to load bookings', 'error');
  }
}

function renderBookingCard(booking, viewRole) {
  const badgeClass = { pending: 'badge-pending', confirmed: 'badge-confirmed', rejected: 'badge-rejected', cancelled: 'badge-cancelled' };
  return `
    <div class="booking-card">
      <div class="booking-card-header">
        <div class="booking-card-title">${escapeHtml(booking.turf_name)}</div>
        <span class="booking-badge ${badgeClass[booking.status] || ''}">${booking.status}</span>
      </div>
      <div class="booking-card-details">
        <div class="booking-card-detail">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${formatDate(booking.date)}
        </div>
        <div class="booking-card-detail">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${formatTime(booking.start_time)} - ${formatTime(booking.end_time)}
        </div>
        <div class="booking-card-detail">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          ₹${booking.price_per_hour}
        </div>
        ${viewRole === 'owner' && booking.client_name ? `
          <div class="booking-card-detail">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            ${escapeHtml(booking.client_name)} (${escapeHtml(booking.client_phone || booking.client_email)})
          </div>
        ` : ''}
      </div>
      <div class="booking-card-actions">
        ${viewRole === 'owner' && booking.status === 'pending' ? `
          <button class="btn btn-primary btn-sm" onclick="updateBookingStatus(${booking.id}, 'confirmed')">✅ Confirm</button>
          <button class="btn btn-danger btn-sm" onclick="updateBookingStatus(${booking.id}, 'rejected')">❌ Reject</button>
        ` : ''}
        ${viewRole === 'client' && (booking.status === 'pending' || booking.status === 'confirmed') ? `
          <button class="btn btn-outline btn-sm" onclick="cancelBooking(${booking.id})">Cancel Booking</button>
        ` : ''}
      </div>
    </div>
  `;
}

async function updateBookingStatus(bookingId, status) {
  try {
    await api(`/api/bookings/${bookingId}/status`, { method: 'PUT', body: { status } });
    showToast(`Booking ${status}!`, 'success');
    loadOwnerBookings();
    updateNotifBadge();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function cancelBooking(bookingId) {
  if (!confirm('Are you sure you want to cancel this booking?')) return;
  try {
    await api(`/api/bookings/${bookingId}/cancel`, { method: 'PUT' });
    showToast('Booking cancelled', 'info');
    if (currentPage === 'my-bookings') loadMyBookings();
    else if (currentPage === 'dashboard') loadClientBookings();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Add Turf ────────────────────────────────────────────────────
function showAddTurfModal() {
  document.getElementById('add-turf-modal').style.display = 'flex';
  document.getElementById('add-turf-form').reset();
}

async function handleAddTurf(e) {
  e.preventDefault();
  const amenityCheckboxes = document.querySelectorAll('#amenities-checkboxes input:checked');
  const amenities = Array.from(amenityCheckboxes).map(cb => cb.value);

  try {
    await api('/api/turfs', {
      method: 'POST',
      body: {
        name: document.getElementById('turf-name').value,
        city: document.getElementById('turf-city').value,
        area: document.getElementById('turf-area').value,
        address: document.getElementById('turf-address').value,
        price_per_hour: parseInt(document.getElementById('turf-price').value),
        description: document.getElementById('turf-desc').value,
        amenities,
      }
    });
    closeModal('add-turf-modal');
    showToast('Turf added successfully!', 'success');
    loadOwnerTurfs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteTurf(turfId) {
  if (!confirm('Are you sure you want to delete this turf? All slots will be removed.')) return;
  try {
    await api(`/api/turfs/${turfId}`, { method: 'DELETE' });
    showToast('Turf deleted', 'info');
    loadOwnerTurfs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Add Slots ───────────────────────────────────────────────────
function showAddSlotsModal(turfId, turfName) {
  addSlotsTurfId = turfId;
  document.getElementById('add-slots-turf-name').textContent = `for ${turfName}`;

  // Set date to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('slot-date').value = today;
  document.getElementById('slot-date').min = today;

  // Generate time slots
  const grid = document.getElementById('time-slots-grid');
  const times = [];
  for (let h = 6; h < 22; h++) {
    times.push({ start: `${String(h).padStart(2, '0')}:00`, end: `${String(h + 1).padStart(2, '0')}:00` });
  }
  grid.innerHTML = times.map(t => `
    <label class="time-slot-option">
      <input type="checkbox" value="${t.start}-${t.end}">
      <span class="time-slot-label">${formatTime(t.start)} - ${formatTime(t.end)}</span>
    </label>
  `).join('');

  document.getElementById('add-slots-modal').style.display = 'flex';
}

async function handleAddSlots(e) {
  e.preventDefault();
  const date = document.getElementById('slot-date').value;
  const checkedSlots = document.querySelectorAll('#time-slots-grid input:checked');

  if (checkedSlots.length === 0) {
    showToast('Please select at least one time slot', 'error');
    return;
  }

  const slots = Array.from(checkedSlots).map(cb => {
    const [start_time, end_time] = cb.value.split('-');
    return { date, start_time, end_time };
  });

  try {
    await api(`/api/turfs/${addSlotsTurfId}/slots`, { method: 'POST', body: { slots } });
    closeModal('add-slots-modal');
    showToast(`${slots.length} slots added!`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Player Finder ───────────────────────────────────────────────
async function loadPlayersPage() {
  await loadCities();
  await loadGames();
}

async function loadGames() {
  const city = document.getElementById('games-filter-city')?.value || '';
  const area = document.getElementById('games-filter-area')?.value || '';

  let url = '/api/games?';
  if (city) url += `city=${encodeURIComponent(city)}&`;
  if (area) url += `area=${encodeURIComponent(area)}&`;

  try {
    const games = await api(url);
    const grid = document.getElementById('games-grid');
    const empty = document.getElementById('no-games');

    if (games.length === 0) {
      grid.innerHTML = '';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      grid.innerHTML = games.map(g => renderGameCard(g)).join('');
    }
  } catch (err) {
    console.error('Load games error:', err);
  }
}

function renderGameCard(game) {
  const progress = (game.players_joined / game.players_needed) * 100;
  const isJoined = game.participants?.some(p => p.player_id === currentUser?.id);
  const isCreator = game.creator_id === currentUser?.id;

  return `
    <div class="game-card">
      <div class="game-header">
        <div class="game-title">${escapeHtml(game.turf_name || 'Open Game')}</div>
        <span class="game-status ${game.status}">${game.status}</span>
      </div>
      <div class="game-meta">
        <div class="game-meta-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${escapeHtml(game.city)} / ${escapeHtml(game.area)}
        </div>
        <div class="game-meta-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${formatDate(game.date)} at ${formatTime(game.time)}
        </div>
        <div class="game-meta-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Posted by ${escapeHtml(game.creator_name)}
        </div>
      </div>
      ${game.description ? `<div class="game-desc">${escapeHtml(game.description)}</div>` : ''}
      <div class="game-players">
        <div class="game-players-label">Players</div>
        <div class="game-progress-bar"><div class="game-progress-fill" style="width:${progress}%"></div></div>
        <div class="game-players-count">${game.players_joined} / ${game.players_needed} joined</div>
      </div>
      ${game.participants && game.participants.length > 0 ? `
        <div class="game-participants">
          ${game.participants.map(p => `<span class="participant-chip">${escapeHtml(p.player_name)}</span>`).join('')}
        </div>
      ` : ''}
      <div class="game-actions">
        ${!currentUser ? `<button class="btn btn-primary btn-sm" onclick="showAuthModal('login')">Log in to Join</button>` : ''}
        ${currentUser && !isJoined && !isCreator && game.status === 'open' ? `<button class="btn btn-primary btn-sm" onclick="joinGame(${game.id})">Join Game</button>` : ''}
        ${currentUser && isJoined && !isCreator ? `<button class="btn btn-outline btn-sm" onclick="leaveGame(${game.id})">Leave Game</button>` : ''}
        ${isCreator ? `<span class="amenity-tag">Your Game</span>` : ''}
        ${isJoined && !isCreator ? `<span class="amenity-tag" style="background:rgba(59,130,246,0.1);color:var(--blue-400);border-color:rgba(59,130,246,0.2);">Joined ✓</span>` : ''}
      </div>
    </div>
  `;
}

async function joinGame(gameId) {
  try {
    await api(`/api/games/${gameId}/join`, { method: 'POST' });
    showToast('You joined the game! 🎉', 'success');
    loadGames();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function leaveGame(gameId) {
  if (!confirm('Leave this game?')) return;
  try {
    await api(`/api/games/${gameId}/leave`, { method: 'POST' });
    showToast('You left the game', 'info');
    loadGames();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function showPostGameModal() {
  if (!currentUser) { showAuthModal('login'); showToast('Please log in to post a game', 'info'); return; }
  document.getElementById('post-game-modal').style.display = 'flex';
  document.getElementById('post-game-form').reset();
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('game-date').min = today;
  document.getElementById('game-date').value = today;
}

async function handlePostGame(e) {
  e.preventDefault();
  try {
    await api('/api/games', {
      method: 'POST',
      body: {
        city: document.getElementById('game-city').value,
        area: document.getElementById('game-area').value,
        turf_name: document.getElementById('game-turf').value,
        date: document.getElementById('game-date').value,
        time: document.getElementById('game-time').value,
        players_needed: parseInt(document.getElementById('game-players').value),
        description: document.getElementById('game-desc').value,
      }
    });
    closeModal('post-game-modal');
    showToast('Game posted! Players can now join.', 'success');
    loadGames();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadMyGames() {
  try {
    const { created, joined } = await api('/api/games/my');
    document.getElementById('my-created-games').innerHTML = created.length === 0
      ? '<div class="empty-state"><span class="empty-icon">🎮</span><h3>No games created</h3></div>'
      : created.map(g => renderGameCard(g)).join('');
    document.getElementById('my-joined-games').innerHTML = joined.length === 0
      ? '<div class="empty-state"><span class="empty-icon">🤝</span><h3>No games joined</h3></div>'
      : joined.map(g => renderGameCard(g)).join('');
  } catch (err) {
    showToast('Failed to load games', 'error');
  }
}

// ─── Modal Helper ────────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  });
});

// ─── Utilities ───────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(time) {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const d = new Date(dateStr);
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Init ────────────────────────────────────────────────────────
async function init() {
  // Check if user is logged in
  try {
    const user = await api('/api/auth/me');
    currentUser = user;
    updateUIForUser();
    startNotificationPolling();
  } catch (err) {
    // Not logged in
  }

  // Handle hash routing
  handleRoute();
  window.addEventListener('hashchange', handleRoute);

  // Load home turfs
  loadHomeTurfs();
}

function handleRoute() {
  const hash = window.location.hash.replace('#', '') || 'home';
  const [page, ...rest] = hash.split('/');

  switch (page) {
    case 'home': navigateTo('home'); break;
    case 'book': navigateTo('book'); break;
    case 'players': navigateTo('players'); break;
    case 'dashboard': navigateTo('dashboard'); break;
    case 'my-bookings': navigateTo('my-bookings'); break;
    case 'turf':
      if (rest[0]) navigateTo('turf-detail', { turfId: parseInt(rest[0]) });
      break;
    default: navigateTo('home');
  }
}

init();
