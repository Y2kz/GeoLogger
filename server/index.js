require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_only';
const PORT = process.env.PORT || 3000;

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.sendStatus(403);
  }
};

// --- API ROUTES ---

// 1. Auth & Users
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  // If no users exist, make the first one an admin
  db.get("SELECT COUNT(*) as count FROM users", async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const role = row.count === 0 ? 'admin' : 'user';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
      [username, hashedPassword, role],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username taken' });
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ id: this.lastID, username, role });
      }
    );
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, role: user.role, username: user.username });
  });
});

app.get('/api/users', authenticateToken, requireAdmin, (req, res) => {
  db.all("SELECT id, username, role, created_at FROM users", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 2. Tracking API
app.post('/api/tracks', authenticateToken, (req, res) => {
  const { name } = req.body;
  db.run("INSERT INTO tracks (user_id, name) VALUES (?, ?)", [req.user.id, name], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: this.lastID });
  });
});

app.post('/api/tracks/:id/positions', authenticateToken, (req, res) => {
  const trackId = req.params.id;
  const positions = Array.isArray(req.body) ? req.body : [req.body]; // Allow batch or single
  
  // Verify track belongs to user
  db.get("SELECT * FROM tracks WHERE id = ? AND user_id = ?", [trackId, req.user.id], (err, track) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!track) return res.status(404).json({ error: 'Track not found' });

    const stmt = db.prepare(`INSERT INTO positions 
      (track_id, lat, lng, altitude, speed, bearing, accuracy, timestamp) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

    positions.forEach(pos => {
      stmt.run(trackId, pos.lat, pos.lng, pos.altitude, pos.speed, pos.bearing, pos.accuracy, pos.timestamp);
    });
    
    stmt.finalize((err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ message: `${positions.length} positions added` });
    });
  });
});

// Get tracks for logged in user (or all if admin requested)
app.get('/api/tracks', authenticateToken, (req, res) => {
  db.all("SELECT * FROM tracks WHERE user_id = ? ORDER BY start_time DESC", [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get positions for a track
app.get('/api/tracks/:id/positions', authenticateToken, (req, res) => {
  const trackId = req.params.id;
  db.get("SELECT user_id FROM tracks WHERE id = ?", [trackId], (err, track) => {
    if (err) return res.status(500).json({ error: err.message });
    // Check permission - either owner or admin
    if (!track || (track.user_id !== req.user.id && req.user.role !== 'admin')) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    db.all("SELECT * FROM positions WHERE track_id = ? ORDER BY timestamp ASC", [trackId], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });
});

// 3. Legacy uLogger Compatibility API
app.use(express.urlencoded({ extended: true }));
app.all('/index.php', async (req, res) => {
  const payload = req.method === 'POST' ? req.body : req.query;
  const { action, user, pass } = payload;
  
  if (!user || !pass) {
    return res.status(401).send('Authentication missing');
  }

  // Basic auth verification for legacy clients
  db.get("SELECT * FROM users WHERE username = ?", [user], async (err, dbUser) => {
    if (err || !dbUser) return res.status(401).send('Invalid credentials');
    const validPassword = await bcrypt.compare(pass, dbUser.password);
    if (!validPassword) return res.status(401).send('Invalid credentials');

    // Authenticated
    if (action === 'auth') {
      return res.json({ error: false, message: 'Authenticated' });
    }
    
    if (action === 'addtrack') {
      const name = payload.track || 'Unnamed uLogger Track';
      db.run("INSERT INTO tracks (user_id, name) VALUES (?, ?)", [dbUser.id, name], function(err) {
        if (err) return res.status(500).json({ error: true });
        res.json({ error: false, trackid: this.lastID });
      });
      return;
    }

    if (action === 'addpos') {
      const { trackid, lat, lon, altitude, speed, bearing, accuracy, time } = payload;
      // Verify track belongs to user
      db.get("SELECT id FROM tracks WHERE id = ? AND user_id = ?", [trackid, dbUser.id], (err, track) => {
        if (err || !track) {
           // Fallback: create a default track if app doesn't specify an existing one properly
           db.run("INSERT INTO tracks (user_id, name) VALUES (?, ?)", [dbUser.id, "Default uLogger Track"], function(err) {
              if (err) return res.status(500).json({ error: true, message: 'Track not found and fallback failed' });
              const newTrackId = this.lastID;
              insertPosition(newTrackId);
           });
           return;
        } else {
           insertPosition(trackid);
        }

        function insertPosition(tId) {
            db.run(
              `INSERT INTO positions (track_id, lat, lng, altitude, speed, bearing, accuracy, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                  tId, lat, lon || payload.lng, altitude, speed, bearing, accuracy, 
                  time ? new Date(parseInt(time) * 1000).toISOString() : new Date().toISOString()
              ],
              (err) => {
                  if (err) return res.status(500).json({ error: true });
                  res.json({ error: false, message: 'Position added' });
              }
            );
        }
      });
      return;
    }

    res.status(400).send('Unknown action');
  });
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
