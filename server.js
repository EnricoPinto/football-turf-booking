require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Check for Database URL
if (!process.env.DATABASE_URL) {
  console.error('\n❌ ERROR: DATABASE_URL is missing in .env file!');
  console.error('Please create a Supabase or Neon database and add the connection string to .env\n');
  process.exit(1);
}

// ─── Database Setup (PostgreSQL) ─────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for most cloud providers
});

// Helper functions to map sql.js behavior to pg
async function dbRun(sql, params = []) {
  let paramIndex = 1;
  const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
  const result = await pool.query(pgSql, params);
  if (result.rows.length > 0 && result.rows[0].id) {
    return { lastInsertRowid: result.rows[0].id };
  }
  return { lastInsertRowid: null };
}

async function dbGet(sql, params = []) {
  let paramIndex = 1;
  const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
  const result = await pool.query(pgSql, params);
  return result.rows[0] || null;
}

async function dbAll(sql, params = []) {
  let paramIndex = 1;
  const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
  const result = await pool.query(pgSql, params);
  return result.rows;
}

// ─── Internal Error Logger ───────────────────────────────────────
async function logError(label, err, req = null) {
  console.error(`[${label}]`, err);
  const route = req ? `${req.method} ${req.originalUrl}` : 'Unknown';
  const userId = req && req.session ? req.session.userId : null;
  const message = err.message || String(err);
  const stack = err.stack || '';

  try {
    await pool.query(
      'INSERT INTO error_logs (label, route, message, stack, user_id) VALUES ($1, $2, $3, $4, $5)',
      [label, route, message, stack, userId]
    );
  } catch (e) {
    console.error('Failed to write to error_logs table:', e);
  }
}

// ─── Security Tweaks & Middleware ────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, 
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'fallback-secret-for-development-only',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true
  }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Please log in to continue' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Please log in to continue' });
    if (!roles.includes(req.session.role)) return res.status(403).json({ error: 'You do not have permission for this action' });
    next();
  };
}

// ─── AUTH ROUTES ─────────────────────────────────────────────────

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;
    if (!name || !email || !password || !role) return res.status(400).json({ error: 'Name, email, password, and role are required' });
    if (!['owner', 'client', 'player'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    
    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    
    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = await dbRun(
      'INSERT INTO users (name, email, password, phone, role) VALUES (?, ?, ?, ?, ?) RETURNING id', 
      [name, email, hashedPassword, phone || '', role]
    );
    
    req.session.userId = result.lastInsertRowid;
    req.session.role = role;
    req.session.userName = name;
    res.json({ id: result.lastInsertRowid, name, email, role });
  } catch (err) {
    await logError('Signup error', err, req);
    res.status(500).json({ error: 'Server error during signup' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid email or password' });
    
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.userName = user.name;
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    await logError('Login error', err, req);
    res.status(500).json({ error: 'Server error during login' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const user = await dbGet('SELECT id, name, email, role, phone FROM users WHERE id = ?', [req.session.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ─── TURF ROUTES ─────────────────────────────────────────────────

app.get('/api/turfs', async (req, res) => {
  try {
    const { city, area, search } = req.query;
    let query = 'SELECT t.*, u.name as owner_name FROM turfs t JOIN users u ON t.owner_id = u.id WHERE 1=1';
    const params = [];
    if (city) { query += ' AND LOWER(t.city) = LOWER(?)'; params.push(city); }
    if (area) { query += ' AND LOWER(t.area) = LOWER(?)'; params.push(area); }
    if (search) { query += ' AND (LOWER(t.name) LIKE LOWER(?) OR LOWER(t.address) LIKE LOWER(?))'; params.push(`%${search}%`, `%${search}%`); }
    query += ' ORDER BY t.created_at DESC';
    res.json(await dbAll(query, params));
  } catch (err) {
    await logError('Get turfs error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/turfs/cities', async (req, res) => {
  const cities = await dbAll('SELECT DISTINCT city FROM turfs ORDER BY city');
  res.json(cities.map(c => c.city));
});

app.get('/api/turfs/areas/:city', async (req, res) => {
  const areas = await dbAll('SELECT DISTINCT area FROM turfs WHERE LOWER(city) = LOWER(?) ORDER BY area', [req.params.city]);
  res.json(areas.map(a => a.area));
});

app.get('/api/turfs/:id', async (req, res) => {
  const turf = await dbGet('SELECT t.*, u.name as owner_name FROM turfs t JOIN users u ON t.owner_id = u.id WHERE t.id = ?', [Number(req.params.id)]);
  if (!turf) return res.status(404).json({ error: 'Turf not found' });
  res.json(turf);
});

app.post('/api/turfs', requireRole('owner'), async (req, res) => {
  try {
    const { name, city, area, address, price_per_hour, amenities, image_url, description } = req.body;
    if (!name || !city || !area || !price_per_hour) return res.status(400).json({ error: 'Name, city, area, and price are required' });
    const result = await dbRun(
      'INSERT INTO turfs (owner_id, name, city, area, address, price_per_hour, amenities, image_url, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      [req.session.userId, name, city, area, address || '', price_per_hour, JSON.stringify(amenities || []), image_url || '', description || '']
    );
    const turf = await dbGet('SELECT * FROM turfs WHERE id = ?', [result.lastInsertRowid]);
    res.json(turf);
  } catch (err) {
    await logError('Create turf error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/turfs/:id', requireRole('owner'), async (req, res) => {
  try {
    const turf = await dbGet('SELECT * FROM turfs WHERE id = ? AND owner_id = ?', [Number(req.params.id), req.session.userId]);
    if (!turf) return res.status(404).json({ error: 'Turf not found or unauthorized' });
    const { name, city, area, address, price_per_hour, amenities, image_url, description } = req.body;
    await dbRun(
      'UPDATE turfs SET name=?, city=?, area=?, address=?, price_per_hour=?, amenities=?, image_url=?, description=? WHERE id=?',
      [name || turf.name, city || turf.city, area || turf.area, address || turf.address,
       price_per_hour || turf.price_per_hour, JSON.stringify(amenities || JSON.parse(turf.amenities)),
       image_url || turf.image_url, description || turf.description, Number(req.params.id)]
    );
    res.json(await dbGet('SELECT * FROM turfs WHERE id = ?', [Number(req.params.id)]));
  } catch (err) {
    await logError('Update turf error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/turfs/:id', requireRole('owner'), async (req, res) => {
  try {
    const turf = await dbGet('SELECT * FROM turfs WHERE id = ? AND owner_id = ?', [Number(req.params.id), req.session.userId]);
    if (!turf) return res.status(404).json({ error: 'Turf not found or unauthorized' });
    await dbRun('DELETE FROM slots WHERE turf_id = ?', [Number(req.params.id)]);
    await dbRun('DELETE FROM turfs WHERE id = ?', [Number(req.params.id)]);
    res.json({ message: 'Turf deleted' });
  } catch (err) {
    await logError('Delete turf error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/owner/turfs', requireRole('owner'), async (req, res) => {
  res.json(await dbAll('SELECT * FROM turfs WHERE owner_id = ? ORDER BY created_at DESC', [req.session.userId]));
});

// ─── SLOT ROUTES ─────────────────────────────────────────────────

app.get('/api/turfs/:turfId/slots', async (req, res) => {
  try {
    const { date } = req.query;
    let query = 'SELECT * FROM slots WHERE turf_id = ?';
    const params = [Number(req.params.turfId)];
    if (date) { query += ' AND date = ?'; params.push(date); }
    query += ' ORDER BY date, start_time';
    res.json(await dbAll(query, params));
  } catch (err) {
    await logError('Get slots error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/turfs/:turfId/slots', requireRole('owner'), async (req, res) => {
  try {
    const turf = await dbGet('SELECT * FROM turfs WHERE id = ? AND owner_id = ?', [Number(req.params.turfId), req.session.userId]);
    if (!turf) return res.status(404).json({ error: 'Turf not found or unauthorized' });
    const { slots } = req.body;
    if (!slots || !Array.isArray(slots) || slots.length === 0) return res.status(400).json({ error: 'Slots array is required' });
    
    const ids = [];
    for (const slot of slots) {
      const existing = await dbGet('SELECT id FROM slots WHERE turf_id = ? AND date = ? AND start_time = ? AND end_time = ?', [Number(req.params.turfId), slot.date, slot.start_time, slot.end_time]);
      if (!existing) {
        const r = await dbRun('INSERT INTO slots (turf_id, date, start_time, end_time) VALUES (?, ?, ?, ?) RETURNING id', [Number(req.params.turfId), slot.date, slot.start_time, slot.end_time]);
        ids.push(r.lastInsertRowid);
      }
    }
    
    if (ids.length === 0) return res.json([]);
    const paramHolders = ids.map((_, i) => `$${i + 1}`).join(',');
    const created = await pool.query(`SELECT * FROM slots WHERE id IN (${paramHolders}) ORDER BY date, start_time`, ids);
    res.json(created.rows);
  } catch (err) {
    await logError('Create slots error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/slots/:id', requireRole('owner'), async (req, res) => {
  try {
    const slot = await dbGet('SELECT s.* FROM slots s JOIN turfs t ON s.turf_id = t.id WHERE s.id = ? AND t.owner_id = ?', [Number(req.params.id), req.session.userId]);
    if (!slot) return res.status(404).json({ error: 'Slot not found or unauthorized' });
    if (slot.status === 'booked') return res.status(400).json({ error: 'Cannot delete a booked slot' });
    await dbRun('DELETE FROM slots WHERE id = ?', [Number(req.params.id)]);
    res.json({ message: 'Slot deleted' });
  } catch (err) {
    await logError('Delete slot error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

// ─── BOOKING ROUTES ──────────────────────────────────────────────

app.post('/api/bookings', requireRole('client'), async (req, res) => {
  try {
    const { slot_id, notes } = req.body;
    if (!slot_id) return res.status(400).json({ error: 'Slot ID is required' });
    const slot = await dbGet('SELECT s.*, t.name as turf_name, t.owner_id FROM slots s JOIN turfs t ON s.turf_id = t.id WHERE s.id = ?', [slot_id]);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    if (slot.status !== 'available') return res.status(400).json({ error: 'Slot is not available' });
    
    const existingBooking = await dbGet("SELECT id FROM bookings WHERE slot_id = ? AND client_id = ? AND status IN ('pending', 'confirmed')", [slot_id, req.session.userId]);
    if (existingBooking) return res.status(400).json({ error: 'You already have a booking for this slot' });
    
    const result = await dbRun('INSERT INTO bookings (slot_id, turf_id, client_id, notes) VALUES (?, ?, ?, ?) RETURNING id', [slot_id, slot.turf_id, req.session.userId, notes || '']);
    await dbRun("UPDATE slots SET status = 'booked' WHERE id = ?", [slot_id]);
    const clientName = req.session.userName;
    await dbRun('INSERT INTO notifications (user_id, type, title, message, reference_id) VALUES (?, ?, ?, ?, ?)', [slot.owner_id, 'booking_request', 'New Booking Request!', `${clientName} wants to book ${slot.turf_name} on ${slot.date} from ${slot.start_time} to ${slot.end_time}`, result.lastInsertRowid]);
    
    const booking = await dbGet(
      `SELECT b.*, s.date, s.start_time, s.end_time, t.name as turf_name, t.city, t.area, t.price_per_hour
       FROM bookings b JOIN slots s ON b.slot_id = s.id JOIN turfs t ON b.turf_id = t.id WHERE b.id = ?`, [result.lastInsertRowid]
    );
    res.json(booking);
  } catch (err) {
    await logError('Create booking error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/bookings/my', requireAuth, async (req, res) => {
  try {
    res.json(await dbAll(
      `SELECT b.*, s.date, s.start_time, s.end_time, t.name as turf_name, t.city, t.area, t.price_per_hour, u.name as client_name, u.phone as client_phone, u.email as client_email
       FROM bookings b JOIN slots s ON b.slot_id = s.id JOIN turfs t ON b.turf_id = t.id JOIN users u ON b.client_id = u.id
       WHERE b.client_id = ? OR t.owner_id = ? ORDER BY b.created_at DESC`, [req.session.userId, req.session.userId]
    ));
  } catch (err) {
    await logError('Get bookings error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/owner/bookings', requireRole('owner'), async (req, res) => {
  try {
    res.json(await dbAll(
      `SELECT b.*, s.date, s.start_time, s.end_time, t.name as turf_name, t.city, t.area, t.price_per_hour, u.name as client_name, u.phone as client_phone, u.email as client_email
       FROM bookings b JOIN slots s ON b.slot_id = s.id JOIN turfs t ON b.turf_id = t.id JOIN users u ON b.client_id = u.id
       WHERE t.owner_id = ? ORDER BY b.created_at DESC`, [req.session.userId]
    ));
  } catch (err) {
    await logError('Get owner bookings error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/bookings/:id/status', requireRole('owner'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['confirmed', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status must be confirmed or rejected' });
    const booking = await dbGet(
      `SELECT b.*, t.owner_id, t.name as turf_name, s.date, s.start_time, s.end_time
       FROM bookings b JOIN turfs t ON b.turf_id = t.id JOIN slots s ON b.slot_id = s.id WHERE b.id = ?`, [Number(req.params.id)]
    );
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.owner_id !== req.session.userId) return res.status(403).json({ error: 'Unauthorized' });
    if (booking.status !== 'pending') return res.status(400).json({ error: 'Booking is not pending' });
    
    await dbRun('UPDATE bookings SET status = ? WHERE id = ?', [status, Number(req.params.id)]);
    if (status === 'rejected') await dbRun("UPDATE slots SET status = 'available' WHERE id = ?", [booking.slot_id]);
    
    const statusText = status === 'confirmed' ? '✅ Confirmed' : '❌ Rejected';
    await dbRun('INSERT INTO notifications (user_id, type, title, message, reference_id) VALUES (?, ?, ?, ?, ?)', [booking.client_id, `booking_${status}`, `Booking ${statusText}`, `Your booking for ${booking.turf_name} on ${booking.date} (${booking.start_time} - ${booking.end_time}) has been ${status}.`, booking.id]);
    
    res.json({ message: `Booking ${status}` });
  } catch (err) {
    await logError('Update booking error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/bookings/:id/cancel', requireAuth, async (req, res) => {
  try {
    const booking = await dbGet(
      `SELECT b.*, t.owner_id, t.name as turf_name, s.date, s.start_time, s.end_time
       FROM bookings b JOIN turfs t ON b.turf_id = t.id JOIN slots s ON b.slot_id = s.id WHERE b.id = ? AND b.client_id = ?`, [Number(req.params.id), req.session.userId]
    );
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!['pending', 'confirmed'].includes(booking.status)) return res.status(400).json({ error: 'Cannot cancel this booking' });
    
    await dbRun("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [Number(req.params.id)]);
    await dbRun("UPDATE slots SET status = 'available' WHERE id = ?", [booking.slot_id]);
    await dbRun('INSERT INTO notifications (user_id, type, title, message, reference_id) VALUES (?, ?, ?, ?, ?)', [booking.owner_id, 'booking_cancelled', 'Booking Cancelled', `${req.session.userName} cancelled their booking for ${booking.turf_name} on ${booking.date} (${booking.start_time} - ${booking.end_time}).`, booking.id]);
    
    res.json({ message: 'Booking cancelled' });
  } catch (err) {
    await logError('Cancel booking error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

// ─── NOTIFICATION ROUTES ─────────────────────────────────────────

app.get('/api/notifications', requireAuth, async (req, res) => {
  res.json(await dbAll('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.session.userId]));
});

app.get('/api/notifications/unread-count', requireAuth, async (req, res) => {
  const result = await dbGet('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [req.session.userId]);
  res.json({ count: result ? parseInt(result.count) : 0 });
});

app.put('/api/notifications/:id/read', requireAuth, async (req, res) => {
  await dbRun('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [Number(req.params.id), req.session.userId]);
  res.json({ message: 'Marked as read' });
});

app.put('/api/notifications/read-all', requireAuth, async (req, res) => {
  await dbRun('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.session.userId]);
  res.json({ message: 'All marked as read' });
});

// ─── PLAYER FINDER ROUTES ────────────────────────────────────────

app.get('/api/games', async (req, res) => {
  try {
    const { city, area } = req.query;
    let query = "SELECT g.*, u.name as creator_name FROM game_posts g JOIN users u ON g.creator_id = u.id WHERE g.status = 'open'";
    const params = [];
    if (city) { query += ' AND LOWER(g.city) = LOWER(?)'; params.push(city); }
    if (area) { query += ' AND LOWER(g.area) = LOWER(?)'; params.push(area); }
    query += ' ORDER BY g.date, g.time';
    
    const games = await dbAll(query, params);
    for (const game of games) {
      game.participants = await dbAll('SELECT gp.*, u.name as player_name FROM game_participants gp JOIN users u ON gp.player_id = u.id WHERE gp.game_id = ?', [game.id]);
    }
    res.json(games);
  } catch (err) {
    await logError('Get games error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/games', requireAuth, async (req, res) => {
  try {
    const { turf_name, city, area, date, time, players_needed, description } = req.body;
    if (!city || !area || !date || !time || !players_needed) return res.status(400).json({ error: 'City, area, date, time, and players needed are required' });
    
    const result = await dbRun('INSERT INTO game_posts (creator_id, turf_name, city, area, date, time, players_needed, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', [req.session.userId, turf_name || '', city, area, date, time, players_needed, description || '']);
    await dbRun('INSERT INTO game_participants (game_id, player_id) VALUES (?, ?)', [result.lastInsertRowid, req.session.userId]);
    
    const game = await dbGet('SELECT g.*, u.name as creator_name FROM game_posts g JOIN users u ON g.creator_id = u.id WHERE g.id = ?', [result.lastInsertRowid]);
    game.participants = [{ player_id: req.session.userId, player_name: req.session.userName }];
    res.json(game);
  } catch (err) {
    await logError('Create game error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/games/:id/join', requireAuth, async (req, res) => {
  try {
    const game = await dbGet('SELECT * FROM game_posts WHERE id = ?', [Number(req.params.id)]);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.status !== 'open') return res.status(400).json({ error: 'Game is no longer open' });
    if (game.players_joined >= game.players_needed) return res.status(400).json({ error: 'Game is full' });
    
    const existing = await dbGet('SELECT id FROM game_participants WHERE game_id = ? AND player_id = ?', [Number(req.params.id), req.session.userId]);
    if (existing) return res.status(400).json({ error: 'You already joined this game' });
    
    await dbRun('INSERT INTO game_participants (game_id, player_id) VALUES (?, ?)', [Number(req.params.id), req.session.userId]);
    const newCount = game.players_joined + 1;
    const newStatus = newCount >= game.players_needed ? 'full' : 'open';
    await dbRun('UPDATE game_posts SET players_joined = ?, status = ? WHERE id = ?', [newCount, newStatus, Number(req.params.id)]);
    await dbRun('INSERT INTO notifications (user_id, type, title, message, reference_id) VALUES (?, ?, ?, ?, ?)', [game.creator_id, 'player_joined', 'Player Joined Your Game!', `${req.session.userName} joined your game on ${game.date} at ${game.time}. ${newCount}/${game.players_needed} players.`, game.id]);
    
    res.json({ message: 'Joined successfully', players_joined: newCount, status: newStatus });
  } catch (err) {
    await logError('Join game error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/games/:id/leave', requireAuth, async (req, res) => {
  try {
    const game = await dbGet('SELECT * FROM game_posts WHERE id = ?', [Number(req.params.id)]);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.creator_id === req.session.userId) return res.status(400).json({ error: 'Creator cannot leave their own game' });
    
    const participation = await dbGet('SELECT id FROM game_participants WHERE game_id = ? AND player_id = ?', [Number(req.params.id), req.session.userId]);
    if (!participation) return res.status(400).json({ error: 'You are not in this game' });
    
    await dbRun('DELETE FROM game_participants WHERE game_id = ? AND player_id = ?', [Number(req.params.id), req.session.userId]);
    await dbRun("UPDATE game_posts SET players_joined = players_joined - 1, status = 'open' WHERE id = ?", [Number(req.params.id)]);
    
    res.json({ message: 'Left the game' });
  } catch (err) {
    await logError('Leave game error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/games/my', requireAuth, async (req, res) => {
  try {
    const created = await dbAll('SELECT g.*, u.name as creator_name FROM game_posts g JOIN users u ON g.creator_id = u.id WHERE g.creator_id = ? ORDER BY g.date DESC', [req.session.userId]);
    const joined = await dbAll(
      `SELECT g.*, u.name as creator_name FROM game_posts g JOIN users u ON g.creator_id = u.id JOIN game_participants gp ON gp.game_id = g.id WHERE gp.player_id = ? AND g.creator_id != ? ORDER BY g.date DESC`,
      [req.session.userId, req.session.userId]
    );
    for (const game of [...created, ...joined]) {
      game.participants = await dbAll('SELECT gp.*, u.name as player_name FROM game_participants gp JOIN users u ON gp.player_id = u.id WHERE gp.game_id = ?', [game.id]);
    }
    res.json({ created, joined });
  } catch (err) {
    await logError('Get my games error', err, req); res.status(500).json({ error: 'Server error' });
  }
});

// ─── ERROR LOGS ADMIN ENDPOINT ───────────────────────────────────

app.get('/api/admin/errors', requireRole('owner'), async (req, res) => {
  // Simple endpoint to fetch recent errors
  try {
    const logs = await dbAll('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT 100');
    res.json(logs);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' });
  }
});

// ─── SEED DATA ───────────────────────────────────────────────────

async function setupDatabase() {
  // Create Tables for Postgres
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
    ) WITH (OIDS=FALSE);
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS error_logs (
      id SERIAL PRIMARY KEY,
      label VARCHAR(255),
      route VARCHAR(255),
      message TEXT,
      stack TEXT,
      user_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, 
      name VARCHAR(255) NOT NULL, 
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL, 
      phone VARCHAR(255) DEFAULT '', 
      role VARCHAR(50) NOT NULL CHECK(role IN ('owner','client','player')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS turfs (
      id SERIAL PRIMARY KEY, 
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, 
      name VARCHAR(255) NOT NULL,
      city VARCHAR(255) NOT NULL, 
      area VARCHAR(255) NOT NULL, 
      address TEXT DEFAULT '', 
      price_per_hour INTEGER NOT NULL,
      amenities TEXT DEFAULT '[]', 
      image_url TEXT DEFAULT '', 
      description TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slots (
      id SERIAL PRIMARY KEY, 
      turf_id INTEGER NOT NULL REFERENCES turfs(id) ON DELETE CASCADE, 
      date VARCHAR(20) NOT NULL,
      start_time VARCHAR(20) NOT NULL, 
      end_time VARCHAR(20) NOT NULL,
      status VARCHAR(50) DEFAULT 'available' CHECK(status IN ('available','booked','blocked')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY, 
      slot_id INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE, 
      turf_id INTEGER NOT NULL REFERENCES turfs(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, 
      status VARCHAR(50) DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected','cancelled')),
      notes TEXT DEFAULT '', 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY, 
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, 
      type VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL, 
      message TEXT NOT NULL, 
      reference_id INTEGER, 
      is_read INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_posts (
      id SERIAL PRIMARY KEY, 
      creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, 
      turf_name VARCHAR(255) DEFAULT '',
      city VARCHAR(255) NOT NULL, 
      area VARCHAR(255) NOT NULL, 
      date VARCHAR(20) NOT NULL, 
      time VARCHAR(20) NOT NULL,
      players_needed INTEGER NOT NULL, 
      players_joined INTEGER DEFAULT 1, 
      description TEXT DEFAULT '',
      status VARCHAR(50) DEFAULT 'open' CHECK(status IN ('open','full','cancelled','completed')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_participants (
      id SERIAL PRIMARY KEY, 
      game_id INTEGER NOT NULL REFERENCES game_posts(id) ON DELETE CASCADE, 
      player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(game_id, player_id)
    )
  `);

  const userCount = await dbGet('SELECT COUNT(*) as count FROM users');
  if (userCount && parseInt(userCount.count) > 0) return;

  console.log('🌱 Seeding demo data into PostgreSQL...');

  const ownerPass = bcrypt.hashSync('owner123', 10);
  await dbRun("INSERT INTO users (name, email, password, phone, role) VALUES (?, ?, ?, ?, 'owner')", ['Rajesh Sharma', 'owner@turfbook.com', ownerPass, '9876543210']);
  const owner = await dbGet("SELECT id FROM users WHERE email = 'owner@turfbook.com'");

  const clientPass = bcrypt.hashSync('client123', 10);
  await dbRun("INSERT INTO users (name, email, password, phone, role) VALUES (?, ?, ?, ?, 'client')", ['Amit Patel', 'client@turfbook.com', clientPass, '9876543211']);

  const playerPass = bcrypt.hashSync('player123', 10);
  await dbRun("INSERT INTO users (name, email, password, phone, role) VALUES (?, ?, ?, ?, 'player')", ['Vikram Singh', 'player@turfbook.com', playerPass, '9876543212']);
  const player = await dbGet("SELECT id FROM users WHERE email = 'player@turfbook.com'");

  const turfs = [
    { name: 'Legends Turf', city: 'Mumbai', area: 'Virar-W', address: 'Near Virar Station, West Side', price: 800, amenities: ['Floodlights', 'Parking', 'Changing Room', 'Drinking Water'], desc: 'Premium 5-a-side football turf with world-class floodlights and well-maintained artificial grass.' },
    { name: 'Thunderbolt Arena', city: 'Mumbai', area: 'Virar-W', address: 'Agashi Road, Virar West', price: 1000, amenities: ['Floodlights', 'Parking', 'Shower', 'Cafeteria', 'First Aid'], desc: 'State-of-the-art 7-a-side arena with cafeteria and premium facilities.' },
    { name: 'Kick Off Ground', city: 'Mumbai', area: 'Andheri-W', address: 'Lokhandwala Complex, Andheri West', price: 1200, amenities: ['Floodlights', 'Parking', 'Changing Room', 'Shower', 'Equipment Rental'], desc: 'Located in the heart of Andheri, this 5-a-side turf is perfect for after-work games.' }
  ];

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }

  const timeSlots = [
    { start: '18:00', end: '19:00' }, { start: '19:00', end: '20:00' },
    { start: '20:00', end: '21:00' }, { start: '21:00', end: '22:00' },
  ];

  for (const t of turfs) {
    await dbRun('INSERT INTO turfs (owner_id, name, city, area, address, price_per_hour, amenities, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [owner.id, t.name, t.city, t.area, t.address, t.price, JSON.stringify(t.amenities), t.desc]);
    const turf = await dbGet('SELECT id FROM turfs WHERE name = ?', [t.name]);
    for (const date of dates) {
      for (const slot of timeSlots) {
        await dbRun('INSERT INTO slots (turf_id, date, start_time, end_time) VALUES (?, ?, ?, ?)', [turf.id, date, slot.start, slot.end]);
      }
    }
  }

  // Sample game post
  await dbRun("INSERT INTO game_posts (creator_id, turf_name, city, area, date, time, players_needed, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [player.id, 'Legends Turf', 'Mumbai', 'Virar-W', dates[1], '18:00', 10, "Friendly 5v5 match! All skill levels welcome. Let's have fun!"]);
  const gamePost = await dbGet('SELECT id FROM game_posts ORDER BY id DESC LIMIT 1');
  await dbRun('INSERT INTO game_participants (game_id, player_id) VALUES (?, ?)', [gamePost.id, player.id]);

  console.log('✅ Demo data seeded successfully!');
}

// ─── Catch-all: serve index.html for SPA ─────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Initialize & Start ──────────────────────────────────────────
async function start() {
  try {
    await setupDatabase();
    app.listen(PORT, () => {
      console.log(`\n⚽ TurfBook server running on port ${PORT}\n`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
