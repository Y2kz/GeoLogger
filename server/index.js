require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { XMLParser } = require('fast-xml-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_only';
const PORT = process.env.PORT || 3000;

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];
  
  if (!token && req.query.token) {
     token = req.query.token;
  }
  
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
  
  // Check if registration is enabled
  db.get("SELECT value FROM settings WHERE key = 'public_registration'", async (err, setting) => {
    // If not found or disabled, block registration (unless it's the first user)
    db.get("SELECT COUNT(*) as count FROM users", async (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      
      const isFirstUser = row.count === 0;
      if (!isFirstUser && setting && setting.value !== 'enabled') {
        return res.status(403).json({ error: 'Public registration is currently disabled by administrator.' });
      }

      const role = isFirstUser ? 'admin' : 'user';
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
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    if (user.status === 'blocked') return res.status(403).json({ error: 'Your account has been blocked by an administrator.' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, role: user.role, username: user.username });
  });
});

app.get('/api/users', authenticateToken, requireAdmin, (req, res) => {
  db.all("SELECT id, username, role, status, created_at FROM users", [], (err, rows) => {
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

// Position CRUD (Admin Only)
app.patch('/api/positions/:id', authenticateToken, requireAdmin, (req, res) => {
  const { lat, lng, altitude, timestamp } = req.body;
  db.run(`UPDATE positions SET lat = ?, lng = ?, altitude = ?, timestamp = ? WHERE id = ?`,
    [lat, lng, altitude, timestamp, req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

app.delete('/api/positions/:id', authenticateToken, requireAdmin, (req, res) => {
  db.run(`DELETE FROM positions WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// 3. Legacy uLogger Compatibility API
app.use(express.urlencoded({ extended: true }));
app.all(['/index.php', '/'], async (req, res, next) => {
  const payload = req.method === 'POST' ? req.body : req.query;
  const { action, user, pass } = payload;
  
  if (!action) return next(); // Not a legacy request, pass to next handlers
  
  if (!user || !pass) {
    return res.status(401).json({ error: true, message: 'Authentication missing' });
  }

  // Basic auth verification for legacy clients
  db.get("SELECT * FROM users WHERE username = ?", [user], async (err, dbUser) => {
    if (err || !dbUser) return res.status(401).json({ error: true, message: 'Invalid credentials' });
    const validPassword = await bcrypt.compare(pass, dbUser.password);
    if (!validPassword) return res.status(401).json({ error: true, message: 'Invalid credentials' });

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
           const prefix = payload.track_prefix || "Auto-Sync Track";
           const interval = payload.split_interval || "daily";
           let trackName = prefix;
           
           if (interval === 'daily') {
               trackName = `${prefix} (${new Date().toISOString().split('T')[0]})`;
           } else if (interval === 'weekly') {
               // Approximate weekly suffix
               const d = new Date();
               const week = Math.ceil(d.getDate() / 7);
               trackName = `${prefix} (Week ${week}, ${d.getFullYear()}-${d.getMonth()+1})`;
           } else if (interval === 'monthly') {
               trackName = `${prefix} (${new Date().toISOString().substring(0, 7)})`;
           } else if (interval.startsWith('custom:')) {
               const hours = parseInt(interval.split(':')[1]) || 24;
               const chunk = Math.floor(Date.now() / (1000 * 60 * 60 * hours));
               trackName = `${prefix} (Block H${hours}-${chunk})`;
           }

           db.get("SELECT id FROM tracks WHERE user_id = ? AND name = ?", [dbUser.id, trackName], (err, autoTrack) => {
               if (autoTrack) return insertPosition(autoTrack.id);
               
               db.run("INSERT INTO tracks (user_id, name) VALUES (?, ?)", [dbUser.id, trackName], function(err) {
                  if (err) return res.status(500).json({ error: true, message: 'Track fallback failed' });
                  insertPosition(this.lastID);
               });
           });
           return;
        } else {
           insertPosition(trackid);
        }

        function insertPosition(tId) {
            db.run(
              `INSERT INTO positions (track_id, lat, lng, altitude, speed, bearing, accuracy, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
              tId, lat, lon || payload.lng, 
              altitude !== undefined ? altitude : null, 
              speed !== undefined ? speed : null, 
              bearing !== undefined ? bearing : null, 
              accuracy !== undefined ? accuracy : null, 
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

    res.status(400).json({ error: true, message: 'Unknown action' });
  });
});


// Clear All Tracks
app.delete('/api/tracks/all', authenticateToken, (req, res) => {
  const query = req.user.role === 'admin' ? "DELETE FROM tracks" : "DELETE FROM tracks WHERE user_id = ?";
  const params = req.user.role === 'admin' ? [] : [req.user.id];
  db.run(query, params, function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'All tracks cleared' });
  });
});

// Export All Tracks as GPX
app.get('/api/tracks/all/gpx', authenticateToken, (req, res) => {
  const query = req.user.role === 'admin' 
    ? "SELECT tracks.name as tname, tracks.id as tid, positions.* FROM positions JOIN tracks ON tracks.id = positions.track_id ORDER BY tracks.id, timestamp ASC" 
    : "SELECT tracks.name as tname, tracks.id as tid, positions.* FROM positions JOIN tracks ON tracks.id = positions.track_id WHERE tracks.user_id = ? ORDER BY tracks.id, timestamp ASC";
  const params = req.user.role === 'admin' ? [] : [req.user.id];
  
  db.all(query, params, (err, points) => {
      if (err) return res.status(500).json({ error: err.message });
      
      let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GeoLogger">\n`;
      let currentTrackId = null;

      points.forEach(p => {
          if (p.tid !== currentTrackId) {
              if (currentTrackId !== null) gpx += `    </trkseg>\n  </trk>\n`;
              currentTrackId = p.tid;
              gpx += `  <trk>\n    <name>${p.tname || 'Unknown'}</name>\n    <trkseg>\n`;
          }
          gpx += `      <trkpt lat="${p.lat}" lon="${p.lng}">\n`;
          if (p.altitude) gpx += `        <ele>${p.altitude}</ele>\n`;
          gpx += `        <time>${p.timestamp}</time>\n`;
          gpx += `      </trkpt>\n`;
      });
      if (currentTrackId !== null) gpx += `    </trkseg>\n  </trk>\n`;
      gpx += `</gpx>`;
      
      res.header('Content-Type', 'application/gpx+xml');
      res.attachment(`geologger_full_export.gpx`);
      res.send(gpx);
  });
});

// GPX Import
const upload = multer({ storage: multer.memoryStorage() });
app.post('/api/tracks/import/gpx', authenticateToken, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  try {
     const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
     const jsonObj = parser.parse(req.file.buffer.toString());
     
     if (!jsonObj.gpx || !jsonObj.gpx.trk) {
         return res.status(400).json({ error: 'Invalid GPX format. Missing <trk> tags.'});
     }

     const tracksArr = Array.isArray(jsonObj.gpx.trk) ? jsonObj.gpx.trk : [jsonObj.gpx.trk];
     
     db.serialize(() => {
         let importedCount = 0;
         tracksArr.forEach(trk => {
             const trackName = trk.name || "Imported GPX Track";
             db.run("INSERT INTO tracks (user_id, name) VALUES (?, ?)", [req.user.id, trackName], function(err) {
                 if (err) return;
                 const newTrackId = this.lastID;
                 
                 const segments = Array.isArray(trk.trkseg) ? trk.trkseg : [trk.trkseg];
                 segments.forEach(seg => {
                     if (!seg || !seg.trkpt) return;
                     const points = Array.isArray(seg.trkpt) ? seg.trkpt : [seg.trkpt];
                     
                     const stmt = db.prepare(`INSERT INTO positions (track_id, lat, lng, altitude, timestamp) VALUES (?, ?, ?, ?, ?)`);
                     points.forEach(p => {
                         if(!p["@_lat"] || !p["@_lon"]) return;
                         let timeStr = p.time || new Date().toISOString();
                         stmt.run(newTrackId, p["@_lat"], p["@_lon"], p.ele || null, timeStr);
                         importedCount++;
                     });
                     stmt.finalize();
                 });
             });
         });
         // Since it's serialized we assume basic sequential execution
         setTimeout(() => res.json({ success: true, message: `Imported tracks geometry in background.`}), 500);
     });
     
  } catch (e) {
     return res.status(500).json({ error: 'XML Parsing error: ' + e.message });
  }
});

// Track Deletion
app.delete('/api/tracks/:id', authenticateToken, (req, res) => {
  const trackId = req.params.id;
  db.get("SELECT user_id FROM tracks WHERE id = ?", [trackId], (err, track) => {
     if (err) return res.status(500).json({ error: err.message });
     // User can only delete their own tracks unless admin
     if (!track || (track.user_id !== req.user.id && req.user.role !== 'admin')) {
         return res.status(403).json({ error: 'Unauthorized to delete this track' });
     }
     db.run("DELETE FROM tracks WHERE id = ?", [trackId], function(err) {
         if (err) return res.status(500).json({ error: err.message });
         res.json({ success: true, message: 'Track and cascaded positions deleted' });
     });
  });
});

// GPX Export
app.get('/api/tracks/:id/gpx', authenticateToken, (req, res) => {
  const trackId = req.params.id;
  db.get("SELECT * FROM tracks WHERE id = ?", [trackId], (err, track) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!track || (track.user_id !== req.user.id && req.user.role !== 'admin')) {
         return res.status(403).json({ error: 'Unauthorized' });
      }

      db.all("SELECT lat, lng, altitude, timestamp FROM positions WHERE track_id = ? ORDER BY timestamp ASC", [trackId], (err, points) => {
         if (err) return res.status(500).json({ error: err.message });
         
         let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GeoLogger">\n`;
         gpx += `  <trk>\n    <name>${track.name}</name>\n    <trkseg>\n`;
         
         points.forEach(p => {
             gpx += `      <trkpt lat="${p.lat}" lon="${p.lng}">\n`;
             if (p.altitude) gpx += `        <ele>${p.altitude}</ele>\n`;
             gpx += `        <time>${p.timestamp}</time>\n`;
             gpx += `      </trkpt>\n`;
         });

         gpx += `    </trkseg>\n  </trk>\n</gpx>`;
         
         res.header('Content-Type', 'application/gpx+xml');
         res.attachment(`track_${trackId}.gpx`);
         res.send(gpx);
      });
  });
});

// KML Export
app.get('/api/tracks/:id/kml', authenticateToken, (req, res) => {
  const trackId = req.params.id;
  db.get("SELECT * FROM tracks WHERE id = ?", [trackId], (err, track) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!track || (track.user_id !== req.user.id && req.user.role !== 'admin')) {
         return res.status(403).json({ error: 'Unauthorized' });
      }

      db.all("SELECT lat, lng, altitude, timestamp FROM positions WHERE track_id = ? ORDER BY timestamp ASC", [trackId], (err, points) => {
         if (err) return res.status(500).json({ error: err.message });
         
         let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n`;
         kml += `  <Document>\n    <name>${track.name}</name>\n    <Placemark>\n      <name>${track.name} Path</name>\n      <LineString>\n        <coordinates>\n`;
         
         points.forEach(p => {
             kml += `          ${p.lng},${p.lat}${p.altitude ? ','+p.altitude : ''}\n`;
         });

         kml += `        </coordinates>\n      </LineString>\n    </Placemark>\n  </Document>\n</kml>`;
         
         res.header('Content-Type', 'application/vnd.google-earth.kml+xml');
         res.attachment(`track_${trackId}.kml`);
         res.send(kml);
      });
  });
});

// Settings API
app.get('/api/settings', (req, res) => {
  db.all("SELECT * FROM settings", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  });
});

app.patch('/api/settings', authenticateToken, requireAdmin, (req, res) => {
  const { key, value } = req.body;
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Admin User Management
app.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
    [username, hashedPassword, role || 'user'], function(err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    });
});

app.patch('/api/admin/users/:id/status', authenticateToken, requireAdmin, (req, res) => {
  const { status } = req.body;
  db.run("UPDATE users SET status = ? WHERE id = ?", [status, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
  db.run("DELETE FROM users WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Serve Static Web Frontend
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
