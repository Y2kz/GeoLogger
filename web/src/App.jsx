import React, { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Popup, useMap } from 'react-leaflet'
import timezones from './timezones.json';

function MapFitter({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      if (positions.length === 1) {
          map.setView(positions[0], 16);
      } else {
          map.fitBounds(positions, { padding: [50, 50], maxZoom: 16 });
      }
    }
  }, [positions, map]);
  return null;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  
  const [tracks, setTracks] = useState([])
  const [selectedTrack, setSelectedTrack] = useState(null)
  const [positions, setPositions] = useState([])
  
  const [filterStart, setFilterStart] = useState('')
  const [filterEnd, setFilterEnd] = useState('')
  
  const defaultTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [timeZone, setTimeZone] = useState(localStorage.getItem('timezone') || defaultTz);

  const timezonesArray = timezones;

  const getTzLabel = (tz) => {
    return tz;
  };
  
  const [themePref, setThemePref] = useState(localStorage.getItem('themePref') || 'auto');

  useEffect(() => {
     if (themePref === 'auto') {
         document.documentElement.removeAttribute('data-theme');
     } else {
         document.documentElement.setAttribute('data-theme', themePref);
     }
  }, [themePref]);

  const toggleTheme = () => {
      const nextTheme = themePref === 'auto' ? 'dark' : (themePref === 'dark' ? 'light' : 'auto');
      setThemePref(nextTheme);
      localStorage.setItem('themePref', nextTheme);
  };

  const handleTzChange = (newTz) => {
      setTimeZone(newTz);
      localStorage.setItem('timezone', newTz);
  };

  const formatTime = (ts) => {
      if (!ts) return '';
      try {
          // SQLite returns CURRENT_TIMESTAMP as implicitly UTC but without Z notation!
          const safeTs = typeof ts === 'string' && !ts.endsWith('Z') && !ts.includes('+') ? ts.replace(' ', 'T') + 'Z' : ts;
          return new Date(safeTs).toLocaleString(undefined, { timeZone });
      } catch(e) {
          return new Date(ts).toLocaleString(); // Fallback if TZ is invalid
      }
  };

  const getUsernameFromToken = () => {
     try {
       if (!token) return '';
       const payload = JSON.parse(atob(token.split('.')[1]));
       return payload.username || '';
     } catch(e) { return '' }
  };
  const displayUsername = username || getUsernameFromToken();

  const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371; 
    const dLat = (lat2-lat1) * (Math.PI/180);
    const dLon = (lon2-lon1) * (Math.PI/180); 
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1*(Math.PI/180)) * Math.cos(lat2*(Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c;
  };

  const API_URL = '/api'

  useEffect(() => {
    if (token) fetchTracks();
  }, [token])

  useEffect(() => {
    setFilterStart('')
    setFilterEnd('')
    if (selectedTrack) {
        fetchPositions(selectedTrack.id)
    } else {
        setPositions([])
    }
  }, [selectedTrack])

  const fetchTracks = async () => {
      try {
        const res = await fetch(`${API_URL}/tracks`, { headers: { 'Authorization': `Bearer ${token}` }})
        if (res.status === 401 || res.status === 403) return handleLogout();
        const data = await res.json()
        setTracks(data)
      } catch (e) {
          console.error(e)
      }
  }

  const fetchPositions = async (id) => {
      try {
        const res = await fetch(`${API_URL}/tracks/${id}/positions`, { headers: { 'Authorization': `Bearer ${token}` }})
        const data = await res.json()
        setPositions(data)
      } catch (e) {
          console.error(e)
      }
  }

  const handleAuth = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    const endpoint = isRegister ? '/auth/register' : '/auth/login'
    try {
        const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        
        if (isRegister) {
            setIsRegister(false)
            setErrorMsg('Registration successful. Please login.')
            return
        }
        localStorage.setItem('token', data.token)
        setToken(data.token)
    } catch(e) {
        setErrorMsg(e.message)
    }
  }

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    
    try {
       const res = await fetch(`${API_URL}/tracks/import/gpx`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
       });
       const data = await res.json();
       if (data.error) throw new Error(data.error);
       alert(data.message);
       fetchTracks();
    } catch(err) {
       alert(err.message);
    }
  }

  const handleDelete = async (e, id) => {
      e.stopPropagation()
      if(!confirm('Are you sure you want to delete this track?')) return
      await fetch(`${API_URL}/tracks/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }})
      if(selectedTrack?.id === id) setSelectedTrack(null)
      fetchTracks()
  }

  const handleClearAll = async () => {
      if(!confirm('DANGER: Are you absolutely sure you want to completely erase ALL of your tracks? This cannot be undone.')) return
      await fetch(`${API_URL}/tracks/all`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }})
      setSelectedTrack(null)
      fetchTracks()
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    setToken(null)
    setTracks([])
    setSelectedTrack(null)
  }

  if (!token) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card">
          <h1 className="auth-title">GeoLogger</h1>
          <form onSubmit={handleAuth}>
            <input 
              type="text" 
              className="md-input" 
              placeholder="Username" 
              value={username}
              onChange={e => setUsername(e.target.value)}
              required 
            />
            <input 
              type="password" 
              className="md-input" 
              placeholder="Password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              required 
            />
            {errorMsg && <div style={{color:'var(--md-sys-color-error)', marginBottom:'10px'}}>{errorMsg}</div>}
            <button type="submit" className="md-button" style={{marginBottom:'10px'}}>
               {isRegister ? 'Register' : 'Login'}
            </button>
            <button type="button" className="md-button secondary" onClick={() => setIsRegister(!isRegister)}>
               {isRegister ? 'Switch to Login' : 'Create an Account'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Filter Logic
  const filteredPositions = positions.filter(p => {
    if (filterStart && new Date(p.timestamp) < new Date(filterStart)) return false;
    if (filterEnd && new Date(p.timestamp) > new Date(filterEnd)) return false;
    return true;
  });

  let tripDuration = '0s';
  let totalDistance = 0;
  let avgSpeed = 0;
  let maxAlt = null;
  let minAlt = null;

  if (filteredPositions.length > 1) {
      const pCount = filteredPositions.length;
      const safeStartTs = filteredPositions[0].timestamp.endsWith('Z') || filteredPositions[0].timestamp.includes('+') ? filteredPositions[0].timestamp : filteredPositions[0].timestamp.replace(' ', 'T') + 'Z';
      const safeEndTs = filteredPositions[pCount-1].timestamp.endsWith('Z') || filteredPositions[pCount-1].timestamp.includes('+') ? filteredPositions[pCount-1].timestamp : filteredPositions[pCount-1].timestamp.replace(' ', 'T') + 'Z';
      
      const tStart = new Date(safeStartTs);
      const tEnd = new Date(safeEndTs);
      
      const seconds = Math.floor((tEnd - tStart) / 1000);
      if (seconds > 0) {
          const days = Math.floor(seconds / 86400);
          const hrs = Math.floor((seconds % 86400) / 3600);
          const mins = Math.floor((seconds % 3600) / 60);
          const secs = seconds % 60;
          tripDuration = `${days > 0 ? days + 'd ' : ''}${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      }

      let dist = 0;
      for (let i=0; i<pCount-1; i++) {
         dist += getDistanceFromLatLonInKm(filteredPositions[i].lat, filteredPositions[i].lng, filteredPositions[i+1].lat, filteredPositions[i+1].lng);
      }
      totalDistance = dist;
      
      const hours = seconds / 3600;
      if (hours > 0) avgSpeed = totalDistance / hours;
      
      const alts = filteredPositions.filter(p => p.altitude !== null && p.altitude !== undefined).map(p => p.altitude);
      if (alts.length > 0) {
          maxAlt = Math.max(...alts);
          minAlt = Math.min(...alts);
      }
  }

  const polylineCoords = filteredPositions.map(p => [p.lat, p.lng]);

  const positionsWithProgress = React.useMemo(() => {
    let cumulativeDist = 0;
    const result = [];
    for (let i = 0; i < filteredPositions.length; i++) {
        const p = filteredPositions[i];
        if (i > 0) {
            cumulativeDist += getDistanceFromLatLonInKm(filteredPositions[i-1].lat, filteredPositions[i-1].lng, p.lat, p.lng);
        }
        
        const safeStartTs = filteredPositions[0].timestamp.endsWith('Z') || filteredPositions[0].timestamp.includes('+') ? filteredPositions[0].timestamp : filteredPositions[0].timestamp.replace(' ', 'T') + 'Z';
        const safeCurrentTs = p.timestamp.endsWith('Z') || p.timestamp.includes('+') ? p.timestamp : p.timestamp.replace(' ', 'T') + 'Z';
        
        const seconds = Math.floor((new Date(safeCurrentTs) - new Date(safeStartTs)) / 1000);
        let durationFormatted = '0s';
        if (seconds > 0) {
            const days = Math.floor(seconds / 86400);
            const hrs = Math.floor((seconds % 86400) / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            durationFormatted = `${days > 0 ? days + 'd ' : ''}${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }

        const hours = seconds / 3600;
        const avgSpeedAtPoint = hours > 0 ? cumulativeDist / hours : 0;

        result.push({
            ...p,
            cumulativeDist,
            durationFormatted,
            avgSpeedAtPoint
        });
    }
    return result;
  }, [filteredPositions]);

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header" style={{justifyContent: 'space-between'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
             <span className="material-symbols-outlined">share_location</span> GeoLogger
          </div>
          <span className="material-symbols-outlined" style={{cursor: 'pointer', fontSize: '20px', color: 'var(--md-sys-color-on-surface-variant)'}} onClick={toggleTheme} title="Toggle Theme">
             {themePref === 'auto' ? 'brightness_auto' : (themePref === 'dark' ? 'dark_mode' : 'light_mode')}
          </span>
        </div>
        
        <div style={{ padding: '0 10px 15px 10px', display: 'flex', gap: '5px', flexWrap: 'wrap', borderBottom: '1px solid var(--md-sys-color-surface-variant)', marginBottom: '10px' }}>
             <a href={`${API_URL}/tracks/all/gpx?token=${token}`} className="md-button secondary" style={{flex: 1, padding: '5px', textDecoration: 'none', textAlign: 'center'}}>
                 Export All
             </a>
             <input type="file" accept=".gpx" onChange={handleImport} style={{display:'none'}} id="gpx-upload" />
             <label htmlFor="gpx-upload" className="md-button secondary" style={{flex: 1, padding: '5px', textAlign:'center', cursor:'pointer', margin: 0}}>
                 Import GPX
             </label>
             <div style={{display:'flex', flex: '100%', gap: '5px', marginTop: '5px'}}>
                 <select value={timeZone} onChange={e => handleTzChange(e.target.value)} style={{flex: 1, padding: '5px'}}>
                    {timezonesArray.map(tz => <option key={tz} value={tz}>{getTzLabel(tz)}</option>)}
                 </select>
                 <button className="md-button secondary" onClick={handleClearAll} style={{flex: 1, color: 'var(--md-sys-color-error)', padding: '5px'}}>
                     Clear DB
                 </button>
             </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
           {selectedTrack && positions.length > 0 && (
             <div style={{ backgroundColor: 'var(--md-sys-color-surface-variant)', padding: '10px', borderRadius: '8px', marginBottom: '15px' }}>
                 <h4 style={{margin: '0 0 10px 0', borderBottom: '1px solid var(--md-sys-color-outline)', paddingBottom: '5px'}}>Trip Summary</h4>
                 <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px'}}><span className="material-symbols-outlined" style={{fontSize: '18px'}}>sync_alt</span> {totalDistance.toFixed(2)} km</div>
                 <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px'}}><span className="material-symbols-outlined" style={{fontSize: '18px'}}>schedule</span> {tripDuration}</div>
                 <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px'}}><span className="material-symbols-outlined" style={{fontSize: '18px'}}>speed</span> {avgSpeed.toFixed(2)} km/h</div>
                 {maxAlt !== null && <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px'}}><span className="material-symbols-outlined" style={{fontSize: '18px'}}>terrain</span> {minAlt.toFixed(0)} - {maxAlt.toFixed(0)} m a.s.l.</div>}
             </div>
           )}
          <h3 style={{ marginBottom: '16px' }}>Your Tracks</h3>
          {tracks.length === 0 && <div>No tracks recorded yet. Start tracking on your mobile app!</div>}
          {tracks.map(t => (
            <div key={t.id} className="card" onClick={() => setSelectedTrack(t)} style={{ cursor: 'pointer', border: selectedTrack?.id === t.id ? '2px solid var(--md-sys-color-primary)' : 'none' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>route</span>
                {t.name}
              </h4>
               <div style={{fontSize: '12px', color: 'gray', margin: '4px 0'}}>{formatTime(t.start_time)}</div>
               <div style={{display: 'flex', gap: '8px', marginTop: '10px'}}>
                  <a href={`${API_URL}/tracks/${t.id}/gpx?token=${token}`} className="material-symbols-outlined" title="Export GPX" style={{textDecoration:'none', color:'inherit', fontSize:'18px'}}>download</a>
                  <a href={`${API_URL}/tracks/${t.id}/kml?token=${token}`} className="material-symbols-outlined" title="Export KML" style={{textDecoration:'none', color:'inherit', fontSize:'18px'}}>map</a>
                  <span className="material-symbols-outlined" onClick={(e) => handleDelete(e, t.id)} title="Delete Track" style={{color: 'var(--md-sys-color-error)', cursor:'pointer', fontSize:'18px'}}>delete</span>
               </div>
            </div>
          ))}
        </div>
        
        <button onClick={handleLogout} className="md-button secondary" style={{ marginTop: 'auto' }}>
          <span className="material-symbols-outlined">logout</span>
          Logout
        </button>
      </div>
      
      <div className="map-container" style={{ position: 'relative' }}>
        {selectedTrack && positions.length > 0 && (
            <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, backgroundColor: 'var(--md-sys-color-surface)', color: 'var(--md-sys-color-on-surface)', padding: '15px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', width: '300px', border: '1px solid var(--md-sys-color-surface-variant)' }}>
                <h4 style={{margin: '0 0 10px 0'}}>Time Frame Filter</h4>
                <div style={{display: 'flex', flexDirection: 'column', gap: '5px'}}>
                    <div style={{fontSize: '12px'}}>Start Range:</div>
                    <input type="datetime-local" value={filterStart} onChange={e => setFilterStart(e.target.value)} style={{padding: '5px'}} />
                    
                    <div style={{fontSize: '12px', marginTop: '5px'}}>End Range:</div>
                    <input type="datetime-local" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} style={{padding: '5px'}} />
                    
                    <div style={{fontSize: '12px', color: 'gray', marginTop: '5px', alignSelf: 'flex-end'}}>
                        Showing {filteredPositions.length} / {positions.length} points
                    </div>
                </div>
            </div>
        )}

        <MapContainer center={[51.505, -0.09]} zoom={2} scrollWheelZoom={true} key={selectedTrack?.id || 'default'} zoomControl={false}>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {polylineCoords.length > 0 && <MapFitter positions={polylineCoords} />}
          
          {polylineCoords.length > 1 && (
            <Polyline positions={polylineCoords} color="blue" weight={4} />
          )}

          {/* Node Render Engine (Mimicking F-Droid layout) */}
          {positionsWithProgress.map((p, i) => (
             <CircleMarker 
                key={i} center={[p.lat, p.lng]} radius={4} 
                fillColor="white" color="black" weight={1} fillOpacity={1} 
             >
                <Popup className="geologger-popup">
                   <div className="popup-container">
                       <div className="popup-header">
                           <div className="popup-user-info">
                               <span className="material-symbols-outlined">account_circle</span>
                               <span style={{fontSize: '18px', fontWeight: '500'}}>{displayUsername}</span>
                           </div>
                           <div className="popup-track-name">
                               <span className="material-symbols-outlined">architecture</span>
                               <span>{selectedTrack?.name}</span>
                           </div>
                       </div>
                       
                       <div className="popup-main-content">
                           <div className="popup-left-pane">
                               <div className="popup-row">
                                   <span className="material-symbols-outlined">today</span>
                                   <span>{formatTime(p.timestamp).split(',')[0]}</span>
                               </div>
                               <div className="popup-row">
                                   <span className="material-symbols-outlined">schedule</span>
                                   <span>{formatTime(p.timestamp).split(',')[1]}</span>
                               </div>
                               <div className="popup-row">
                                   <span className="material-symbols-outlined">speed</span>
                                   <span>{(p.speed * 3.6).toFixed(2)} km/h</span>
                               </div>
                               <div className="popup-row">
                                   <span className="material-symbols-outlined">terrain</span>
                                   <span>{p.altitude?.toFixed(0) || 0} m a.s.l.</span>
                               </div>
                               <div className="popup-row">
                                   <span className="material-symbols-outlined">satellite_alt</span>
                                   <span>{p.accuracy?.toFixed(0) || 0} m 🛰️</span>
                               </div>
                               <div className="popup-row">
                                   <span className="material-symbols-outlined">explore</span>
                                   <span>{p.bearing?.toFixed(0) || 0}°</span>
                               </div>
                               <div className="popup-row">
                                   <span className="material-symbols-outlined">location_on</span>
                                   <span>{p.lng.toFixed(4)}°E {p.lat.toFixed(4)}°N</span>
                               </div>
                           </div>

                           <div className="popup-right-pane">
                               <div className="popup-stat-block">
                                   <span className="material-symbols-outlined" style={{color: '#90caf9'}}>history</span>
                                   <div className="popup-stat-value">
                                       <span className="stat-num">{p.durationFormatted}</span>
                                       <span className="stat-label">Duration</span>
                                   </div>
                               </div>
                               <div className="popup-stat-block">
                                   <span className="material-symbols-outlined" style={{color: '#81c784'}}>directions_run</span>
                                   <div className="popup-stat-value">
                                       <span className="stat-num">{p.avgSpeedAtPoint.toFixed(2)} km/h</span>
                                       <span className="stat-label">Avg. Speed</span>
                                   </div>
                               </div>
                               <div className="popup-stat-block">
                                   <span className="material-symbols-outlined" style={{color: '#ffb74d'}}>move_down</span>
                                   <div className="popup-stat-value">
                                       <span className="stat-num">{p.cumulativeDist.toFixed(2)} km</span>
                                       <span className="stat-label">Distance</span>
                                   </div>
                               </div>
                           </div>
                       </div>

                       <div className="popup-footer">
                           <span>Point {i + 1} of {filteredPositions.length}</span>
                           <span className="edit-link">Edit position</span>
                       </div>
                   </div>
                </Popup>
             </CircleMarker>
          ))}

        </MapContainer>
      </div>
    </div>
  )
}

export default App
