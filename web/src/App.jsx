import React, { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Popup, useMap } from 'react-leaflet'
import timezones from './timezones.json';

const API_URL = '/api';

const getTzLabel = (tz) => tz;

const getUsernameFromToken = (token) => {
  try {
    if (!token) return '';
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.username || '';
  } catch(e) { return '' }
};

const getRoleFromToken = (token) => {
  try {
    if (!token) return 'user';
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.role || 'user';
  } catch(e) { return 'user' }
};

const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; 
  const dLat = (lat2-lat1) * (Math.PI/180);
  const dLon = (lon2-lon1) * (Math.PI/180); 
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1*(Math.PI/180)) * Math.cos(lat2*(Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c;
};

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

function Dashboard({ token, onLogout }) {
  const [tracks, setTracks] = useState([])
  const [selectedTrack, setSelectedTrack] = useState(null)
  const [positions, setPositions] = useState([])
  
  const [filterStart, setFilterStart] = useState('')
  const [filterEnd, setFilterEnd] = useState('')
  
  const [regEnabled, setRegEnabled] = useState(true);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [editingPoint, setEditingPoint] = useState(null);
  
  // Admin Context State
  const [viewingUserId, setViewingUserId] = useState(null);
  const [viewingUsername, setViewingUsername] = useState(null);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' });
  
  const defaultTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [timeZone, setTimeZone] = useState(localStorage.getItem('timezone') || defaultTz);
  const [themePref, setThemePref] = useState(localStorage.getItem('themePref') || 'auto');

  const isAdmin = getRoleFromToken(token) === 'admin';
  const displayUsername = getUsernameFromToken(token);
  const timezonesArray = Array.isArray(timezones) ? timezones : [];

  useEffect(() => {
     if (themePref === 'auto') {
         document.documentElement.removeAttribute('data-theme');
     } else {
         document.documentElement.setAttribute('data-theme', themePref);
     }
  }, [themePref]);

  useEffect(() => {
    fetchTracks();
    fetchSettings();
    if (isAdmin) fetchAllUsers();
  }, [viewingUserId]);

  useEffect(() => {
    setFilterStart('')
    setFilterEnd('')
    if (selectedTrack) {
        fetchPositions(selectedTrack.id)
    } else {
        setPositions([])
    }
  }, [selectedTrack])

  const fetchSettings = async () => {
    try {
        const res = await fetch(`${API_URL}/settings`);
        const data = await res.json();
        setRegEnabled(data.public_registration === 'enabled');
    } catch(e) {}
  };

  const fetchAllUsers = async () => {
     try {
         const res = await fetch(`${API_URL}/users`, { headers: { 'Authorization': `Bearer ${token}` } });
         const data = await res.json();
         if (Array.isArray(data)) {
             // Extract current user ID from token to identify self
             setAllUsers(data);
         }
     } catch(e) {}
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
        const res = await fetch(`${API_URL}/admin/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(newUser)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setNewUser({ username: '', password: '', role: 'user' });
        fetchAllUsers();
        alert('User created successfully');
    } catch(err) { alert(err.message); }
  };

  const toggleRegistration = async () => {
     const newValue = !regEnabled ? 'enabled' : 'disabled';
     try {
         await fetch(`${API_URL}/settings`, {
             method: 'PATCH',
             headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
             body: JSON.stringify({ key: 'public_registration', value: newValue })
         });
         setRegEnabled(!regEnabled);
     } catch(e) {}
  };

  const fetchTracks = async () => {
      try {
        const url = viewingUserId ? `${API_URL}/tracks?user_id=${viewingUserId}` : `${API_URL}/tracks`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` }})
        if (res.status === 401 || res.status === 403) return onLogout();
        const data = await res.json()
        if (Array.isArray(data)) setTracks(data)
      } catch (e) {
          console.error(e)
      }
  }

  const fetchPositions = async (id) => {
      try {
        const res = await fetch(`${API_URL}/tracks/${id}/positions`, { headers: { 'Authorization': `Bearer ${token}` }})
        const data = await res.json()
        if (Array.isArray(data)) setPositions(data)
      } catch (e) {
          console.error(e)
      }
  }

  const handleSavePoint = async (e) => {
    if (e) e.preventDefault();
    try {
        await fetch(`${API_URL}/positions/${editingPoint.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(editingPoint)
        });
        setPositions(positions.map(p => p.id === editingPoint.id ? { ...p, ...editingPoint } : p));
        setEditingPoint(null);
    } catch(e) { alert('Failed to save point'); }
  };

  const handleDeletePoint = async (pointId) => {
    if (!window.confirm('Are you sure you want to delete this specific point? This cannot be undone.')) return;
    try {
        await fetch(`${API_URL}/positions/${pointId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        setPositions(positions.filter(p => p.id !== pointId));
    } catch(e) { alert('Failed to delete point'); }
  };

  const handleUserAction = async (userId, action, value) => {
    try {
        let url = `${API_URL}/admin/users/${userId}`;
        let method = 'PATCH';
        let body = {};

        if (action === 'status') {
            url += '/status';
            body = { status: value };
        } else if (action === 'delete') {
            if (!window.confirm('Delete this user and all their tracks permanently?')) return;
            method = 'DELETE';
        }

        await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: method !== 'DELETE' ? JSON.stringify(body) : undefined
        });
        fetchAllUsers();
    } catch(e) {}
  };

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
    } catch(err) { alert(err.message); }
  }

  const handleDeleteTrack = async (e, id) => {
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

  const formatTime = (ts) => {
      if (!ts) return '';
      try {
          const safeTs = typeof ts === 'string' && !ts.endsWith('Z') && !ts.includes('+') ? ts.replace(' ', 'T') + 'Z' : ts;
          return new Date(safeTs).toLocaleString(undefined, { timeZone });
      } catch(e) { return new Date(ts).toLocaleString(); }
  };

  const toggleTheme = () => {
      const nextTheme = themePref === 'auto' ? 'dark' : (themePref === 'dark' ? 'light' : 'auto');
      setThemePref(nextTheme);
      localStorage.setItem('themePref', nextTheme);
  };

  const handleTzChange = (newTz) => {
      setTimeZone(newTz);
      localStorage.setItem('timezone', newTz);
  };

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
      for (let i=0; i<pCount-1; i++) { dist += getDistanceFromLatLonInKm(filteredPositions[i].lat, filteredPositions[i].lng, filteredPositions[i+1].lat, filteredPositions[i+1].lng); }
      totalDistance = dist;
      const hours = seconds / 3600;
      if (hours > 0) avgSpeed = totalDistance / hours;
      const alts = filteredPositions.filter(p => p.altitude !== null && p.altitude !== undefined).map(p => p.altitude);
      if (alts.length > 0) { maxAlt = Math.max(...alts); minAlt = Math.min(...alts); }
  }

  const polylineCoords = filteredPositions.map(p => [p.lat, p.lng]);

  const positionsWithProgress = React.useMemo(() => {
    let cumulativeDist = 0;
    const result = [];
    for (let i = 0; i < filteredPositions.length; i++) {
        const p = filteredPositions[i];
        if (i > 0) { cumulativeDist += getDistanceFromLatLonInKm(filteredPositions[i-1].lat, filteredPositions[i-1].lng, p.lat, p.lng); }
        const safeStartTs = filteredPositions[0] && (filteredPositions[0].timestamp.endsWith('Z') || filteredPositions[0].timestamp.includes('+')) ? filteredPositions[0].timestamp : (filteredPositions[0] ? filteredPositions[0].timestamp.replace(' ', 'T') + 'Z' : null);
        const safeCurrentTs = p.timestamp.endsWith('Z') || p.timestamp.includes('+') ? p.timestamp : p.timestamp.replace(' ', 'T') + 'Z';
        const seconds = safeStartTs ? Math.floor((new Date(safeCurrentTs) - new Date(safeStartTs)) / 1000) : 0;
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
        result.push({ ...p, cumulativeDist, durationFormatted, avgSpeedAtPoint });
    }
    return result;
  }, [filteredPositions]);

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header" style={{justifyContent: 'space-between'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}><span className="material-symbols-outlined">share_location</span> GeoLogger</div>
          <span className="material-symbols-outlined" style={{cursor: 'pointer', fontSize: '20px', color: 'var(--md-sys-color-on-surface-variant)'}} onClick={toggleTheme} title="Toggle Theme">
             {themePref === 'auto' ? 'brightness_auto' : (themePref === 'dark' ? 'dark_mode' : 'light_mode')}
          </span>
        </div>
        
        <div style={{ padding: '0 10px 15px 10px', display: 'flex', gap: '5px', flexWrap: 'wrap', borderBottom: '1px solid var(--md-sys-color-surface-variant)', marginBottom: '10px' }}>
             <a href={`${API_URL}/tracks/all/gpx?token=${token}`} className="md-button secondary" style={{flex: 1, padding: '5px', textDecoration: 'none', textAlign: 'center'}}>Export All</a>
             <input type="file" accept=".gpx" onChange={handleImport} style={{display:'none'}} id="gpx-upload" />
             <label htmlFor="gpx-upload" className="md-button secondary" style={{flex: 1, padding: '5px', textAlign:'center', cursor:'pointer', margin: 0}}>Import GPX</label>
              <div style={{display:'flex', flex: '100%', gap: '8px', marginTop: '8px', flexDirection: 'column'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px', width: '100%'}}>
                    <span className="material-symbols-outlined" style={{fontSize: '18px', color: 'var(--md-sys-color-primary)'}}>public</span>
                    <select value={timeZone} onChange={e => handleTzChange(e.target.value)} style={{flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--md-sys-color-outline)', backgroundColor: 'var(--md-sys-color-surface)', fontSize: '13.5px'}}>
                       {timezonesArray.map(tz => <option key={tz} value={tz}>{getTzLabel(tz)}</option>)}
                    </select>
                  </div>
                  <button className="md-button secondary" onClick={handleClearAll} style={{width: '100%', color: 'var(--md-sys-color-error)', padding: '6px', border: '1px dashed var(--md-sys-color-error)', background: 'transparent', fontSize: '12px', height: 'auto', margin: '0'}}>
                      <span className="material-symbols-outlined" style={{fontSize: '16px', verticalAlign: 'middle', marginRight: '4px'}}>delete_forever</span> Clear All Database Records
                  </button>
                  {isAdmin && (
                    <div style={{marginTop: '10px', borderTop: '1px solid var(--md-sys-color-outline-variant)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px'}}>
                        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px'}}>
                            <span>Public Registration</span>
                            <div onClick={toggleRegistration} style={{cursor: 'pointer', width: '36px', height: '20px', borderRadius: '10px', backgroundColor: regEnabled ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-variant)', position: 'relative', transition: '0.3s'}}>
                                <div style={{position: 'absolute', top: '2px', left: regEnabled ? '18px' : '2px', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: 'white', transition: '0.3s'}}></div>
                            </div>
                        </div>
                        <button className="md-button primary" onClick={() => setShowUsersModal(true)} style={{fontSize: '12px', padding: '6px'}}><span className="material-symbols-outlined" style={{fontSize: '16px'}}>group</span> Manage Users</button>
                    </div>
                  )}
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
           <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {viewingUsername ? `Viewing ${viewingUsername}` : 'Your Tracks'}
              {viewingUsername && (
                  <button className="md-button secondary" onClick={() => { setViewingUserId(null); setViewingUsername(null); setSelectedTrack(null); }} style={{padding: '4px 8px', fontSize: '11px', height: 'auto', margin: 0}}>My Tracks</button>
              )}
           </h3>
          {tracks.length === 0 && <div>No tracks recorded yet. Start tracking on your mobile app!</div>}
          {tracks.map(t => (
            <div key={t.id} className="card" onClick={() => setSelectedTrack(t)} style={{ cursor: 'pointer', border: selectedTrack?.id === t.id ? '2px solid var(--md-sys-color-primary)' : 'none' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span className="material-symbols-outlined" style={{ fontSize: '18px' }}>route</span>{t.name}</h4>
               <div style={{fontSize: '12px', color: 'gray', margin: '4px 0'}}>{formatTime(t.start_time)}</div>
               <div style={{display: 'flex', gap: '8px', marginTop: '10px'}}>
                  <a href={`${API_URL}/tracks/${t.id}/gpx?token=${token}`} className="material-symbols-outlined" title="Export GPX" style={{textDecoration:'none', color:'inherit', fontSize:'18px'}}>download</a>
                  <a href={`${API_URL}/tracks/${t.id}/kml?token=${token}`} className="material-symbols-outlined" title="Export KML" style={{textDecoration:'none', color:'inherit', fontSize:'18px'}}>map</a>
                  <span className="material-symbols-outlined" onClick={(e) => handleDeleteTrack(e, t.id)} title="Delete Track" style={{color: 'var(--md-sys-color-error)', cursor:'pointer', fontSize:'18px'}}>delete</span>
               </div>
            </div>
          ))}
        </div>
        <button onClick={onLogout} className="md-button secondary" style={{ marginTop: 'auto' }}><span className="material-symbols-outlined">logout</span>Logout</button>
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
                    <div style={{fontSize: '12px', color: 'gray', marginTop: '5px', alignSelf: 'flex-end'}}>Showing {filteredPositions.length} / {positions.length} points</div>
                </div>
            </div>
        )}

        <MapContainer center={[51.505, -0.09]} zoom={2} scrollWheelZoom={true} key={selectedTrack?.id || 'default'} zoomControl={false}>
          <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {polylineCoords.length > 0 && <MapFitter positions={polylineCoords} />}
          {polylineCoords.length > 1 && <Polyline positions={polylineCoords} color="blue" weight={4} />}

          {positionsWithProgress.map((p, i) => (
             <CircleMarker key={i} center={[p.lat, p.lng]} radius={4} fillColor="white" color="black" weight={1} fillOpacity={1}>
                <Popup className="geologger-popup">
                   <div className="popup-container">
                       <div className="popup-header">
                           <div className="popup-user-info"><span className="material-symbols-outlined">account_circle</span><span style={{fontSize: '18px', fontWeight: '500'}}>{viewingUsername || displayUsername}</span></div>
                           <div className="popup-track-name"><span className="material-symbols-outlined">architecture</span><span>{selectedTrack?.name}</span></div>
                       </div>
                       <div className="popup-main-content">
                           <div className="popup-left-pane">
                               <div className="popup-row"><span className="material-symbols-outlined">today</span><span>{formatTime(p.timestamp).split(',')[0]}</span></div>
                               <div className="popup-row"><span className="material-symbols-outlined">schedule</span><span>{formatTime(p.timestamp).split(',')[1]}</span></div>
                               <div className="popup-row"><span className="material-symbols-outlined">speed</span><span>{(p.speed * 3.6).toFixed(2)} km/h</span></div>
                               <div className="popup-row"><span className="material-symbols-outlined">terrain</span><span>{p.altitude?.toFixed(0) || 0} m a.s.l.</span></div>
                               <div className="popup-row"><span className="material-symbols-outlined">satellite_alt</span><span>{p.accuracy?.toFixed(0) || 0} m 🛰️</span></div>
                               <div className="popup-row"><span className="material-symbols-outlined">explore</span><span>{p.bearing?.toFixed(0) || 0}°</span></div>
                               <div className="popup-row"><span className="material-symbols-outlined">location_on</span><span>{p.lng.toFixed(4)}°E {p.lat.toFixed(4)}°N</span></div>
                           </div>
                           <div className="popup-right-pane">
                               <div className="popup-stat-block"><span className="material-symbols-outlined" style={{color: '#90caf9'}}>history</span><div className="popup-stat-value"><span className="stat-num">{p.durationFormatted}</span><span className="stat-label">Duration</span></div></div>
                               <div className="popup-stat-block"><span className="material-symbols-outlined" style={{color: '#81c784'}}>directions_run</span><div className="popup-stat-value"><span className="stat-num">{p.avgSpeedAtPoint.toFixed(2)} km/h</span><span className="stat-label">Avg. Speed</span></div></div>
                               <div className="popup-stat-block"><span className="material-symbols-outlined" style={{color: '#ffb74d'}}>move_down</span><div className="popup-stat-value"><span className="stat-num">{p.cumulativeDist.toFixed(2)} km</span><span className="stat-label">Distance</span></div></div>
                           </div>
                       </div>
                        <div className="popup-footer">
                            <span>Point {i + 1} of {filteredPositions.length}</span>
                            {isAdmin && !editingPoint && (
                                <div style={{display: 'flex', gap: '10px'}}>
                                    <span onClick={() => setEditingPoint({...p})} style={{color: 'var(--md-sys-color-primary)', cursor: 'pointer', fontSize: '13px', fontWeight: '500'}}>Edit</span>
                                    <span onClick={() => handleDeletePoint(p.id)} style={{color: 'var(--md-sys-color-error)', cursor: 'pointer', fontSize: '13px', fontWeight: '500'}}>Delete</span>
                                </div>
                            )}
                            {editingPoint && editingPoint.id === p.id && (
                                <div style={{display: 'flex', flexDirection: 'column', gap: '5px', width: '100%', marginTop: '10px', backgroundColor: 'var(--md-sys-color-surface-variant)', padding: '10px', borderRadius: '8px'}}>
                                    <div style={{fontSize: '11px', fontWeight: 'bold'}}>Quick Edit</div>
                                    <div style={{display: 'flex', gap: '5px'}}>
                                        <input type="number" step="0.000001" value={editingPoint.lat} onChange={e => setEditingPoint({...editingPoint, lat: parseFloat(e.target.value)})} style={{flex: 1, fontSize: '12px'}} />
                                        <input type="number" step="0.000001" value={editingPoint.lng} onChange={e => setEditingPoint({...editingPoint, lng: parseFloat(e.target.value)})} style={{flex: 1, fontSize: '12px'}} />
                                    </div>
                                    <div style={{display: 'flex', gap: '5px'}}>
                                        <button className="md-button primary" onClick={handleSavePoint} style={{flex: 1, fontSize: '11px', padding: '4px'}}>Save</button>
                                        <button className="md-button secondary" onClick={() => setEditingPoint(null)} style={{flex: 1, fontSize: '11px', padding: '4px'}}>Cancel</button>
                                    </div>
                                </div>
                            )}
                        </div>
                   </div>
                </Popup>
             </CircleMarker>
          ))}
        </MapContainer>
      </div>

        {showUsersModal && (
           <div style={{position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
               <div style={{backgroundColor: 'var(--md-sys-color-surface)', width: '90%', maxWidth: '600px', borderRadius: '16px', padding: '24px', position: 'relative'}}>
                   <h2 style={{margin: '0 0 20px 0'}}>User Management</h2>
                   
                   <div style={{marginBottom: '20px', borderBottom: '1px solid var(--md-sys-color-outline-variant)', paddingBottom: '20px'}}>
                       <h4 style={{marginBottom: '10px'}}>Add New User</h4>
                       <form onSubmit={handleCreateUser} style={{display: 'flex', gap: '8px'}}>
                           <input type="text" placeholder="Username" className="md-input" style={{flex: 1, margin: 0}} value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} required />
                           <input type="password" placeholder="Password" className="md-input" style={{flex: 1, margin: 0}} value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} required />
                           <select className="md-input" style={{width: '90px', margin: 0, height: '40px'}} value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})}>
                               <option value="user">User</option>
                               <option value="admin">Admin</option>
                           </select>
                           <button type="submit" className="md-button primary" style={{padding: '0 16px', height: '40px', margin: 0}}>Add</button>
                       </form>
                   </div>
                   
                   <div style={{maxHeight: '300px', overflowY: 'auto'}}>
                       <table style={{width: '100%', borderCollapse: 'collapse'}}>
                           <thead>
                               <tr style={{borderBottom: '1px solid var(--md-sys-color-outline-variant)'}}>
                                   <th style={{textAlign: 'left', padding: '8px', fontSize: '13px'}}>User</th>
                                   <th style={{textAlign: 'left', padding: '8px', fontSize: '13px'}}>Role</th>
                                   <th style={{textAlign: 'right', padding: '8px', fontSize: '13px'}}>Actions</th>
                               </tr>
                           </thead>
                           <tbody style={{fontSize: '13px'}}>
                               {allUsers.map(u => (
                                   <tr key={u.id} style={{borderBottom: '1px solid var(--md-sys-color-outline-variant)'}}>
                                       <td style={{padding: '8px'}}>
                                           <div style={{fontWeight: '500'}}>{u.username}</div>
                                           <div style={{fontSize: '11px', color: 'gray'}}>{u.status}</div>
                                       </td>
                                       <td style={{padding: '8px'}}>{u.role}</td>
                                       <td style={{padding: '8px', textAlign: 'right'}}>
                                           <button onClick={() => { setViewingUserId(u.id); setViewingUsername(u.username); setShowUsersModal(false); setSelectedTrack(null); }} style={{marginRight: '12px', color: 'var(--md-sys-color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '500'}}>View Map</button>
                                           {u.username !== displayUsername && (
                                              <>
                                               <button onClick={() => handleUserAction(u.id, 'status', u.status === 'blocked' ? 'active' : 'blocked')} style={{marginRight: '12px', color: u.status === 'blocked' ? 'green' : 'orange', background: 'none', border: 'none', cursor: 'pointer'}}>{u.status === 'blocked' ? 'Unblock' : 'Block'}</button>
                                               <button onClick={() => handleUserAction(u.id, 'delete')} style={{color: 'red', background: 'none', border: 'none', cursor: 'pointer'}}>Delete</button>
                                              </>
                                           )}
                                       </td>
                                   </tr>
                               ))}
                           </tbody>
                       </table>
                   </div>
                   <button onClick={() => setShowUsersModal(false)} className="md-button secondary" style={{marginTop: '20px', width: '100%'}}>Close</button>
               </div>
           </div>
        )}
    </div>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handleAuth = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    try {
        const endpoint = isRegister ? '/auth/register' : '/auth/login'
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
    } catch(e) { setErrorMsg(e.message) }
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    setToken(null)
  }

  if (!token) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card">
          <h1 className="auth-title">GeoLogger</h1>
          <form onSubmit={handleAuth}>
            <input type="text" className="md-input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required />
            <input type="password" className="md-input" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
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

  return <Dashboard token={token} onLogout={handleLogout} />
}

export default App
