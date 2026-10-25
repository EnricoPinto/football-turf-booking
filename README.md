# ⚽ TurfBook — Football Turf Booking & Player Finder Platform

A modern, high-performance web platform for football turf management, client booking, and player matchmaking.

---

## 🌟 Key Features

### 1. 🏟️ Turf Owners Dashboard
- Add, update, and manage multiple turfs (pricing, location, amenities, descriptions).
- Generate and manage daily hourly slots (6 AM – 11 PM).
- Confirm or reject client booking requests in real time.
- Overview of revenue and bookings.

### 2. ⚡ Client Booking Portal
- Search turfs by **City** and **Area** (e.g., Mumbai / Virar-W / Legends Turf).
- View turf details, amenities, pricing, and live empty slot availability.
- One-click instant booking request with instant confirmation alerts.
- Personal booking history management with cancellation support.

### 3. 👥 Player Finder (Matchmaking)
- Host friendly 5v5 / 7v7 matches when short on players.
- Browse available open games in your local area.
- Join or leave games with real-time participant tracking.

### 4. 🔔 Real-time In-App Notifications
- Notification badge with unread counters.
- Instant alerts for booking requests, confirmations, rejections, and game joins.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL (with `pg` connection pooling)
- **Session Store:** `connect-pg-simple` (PostgreSQL-backed persistent sessions)
- **Security:** `helmet` (HTTP headers), `express-rate-limit` (anti-spam / DDoS protection), `bcryptjs` (password hashing)
- **Frontend:** Responsive Vanilla HTML5, CSS3 (Sporty Dark / Lime theme), Vanilla JavaScript (SPA navigation with hash routing)
- **Deployment:** Vercel serverless functions (`vercel.json`)

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+ recommended)
- A PostgreSQL database (e.g. from [Neon](https://neon.tech) or [Supabase](https://supabase.com))

### Installation

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd football-turf-web
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Add your credentials to `.env`:
   ```env
   DATABASE_URL=postgres://user:password@host:port/database
   SESSION_SECRET=your_super_secret_session_key
   ```

4. **Run the server:**
   ```bash
   npm start
   ```
   The database tables and demo seed data will be automatically generated upon initial boot!

5. **Visit in browser:**
   ```
   http://localhost:3000
   ```

---

## 🔐 Default Demo Accounts

| Role | Email | Password |
| :--- | :--- | :--- |
| **Owner** | `owner@turfbook.com` | `owner123` |
| **Client** | `client@turfbook.com` | `client123` |
| **Player** | `player@turfbook.com` | `player123` |

---

## ☁️ Deploy to Vercel

1. Push this repository to GitHub.
2. In [Vercel](https://vercel.com), click **Add New Project** and import this repository.
3. Add the following **Environment Variables** in Vercel settings:
   - `DATABASE_URL`: Your cloud PostgreSQL connection string (Supabase / Neon).
   - `SESSION_SECRET`: A long random string.
4. Click **Deploy**!
