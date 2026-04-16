import React, { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Polyline } from 'react-leaflet'

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  
  const [tracks, setTracks] = useState([])
  const [selectedTrack, setSelectedTrack] = useState(null)
  const [positions, setPositions] = useState([])

  const API_URL = '/api'

  useEffect(() => {
    if (token) fetchTracks();
  }, [token])

  useEffect(() => {
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

  const handleDelete = async (e, id) => {
      e.stopPropagation()
      if(!confirm('Are you sure you want to delete this track?')) return
      await fetch(`${API_URL}/tracks/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }})
      if(selectedTrack?.id === id) setSelectedTrack(null)
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

  const polylineCoords = positions.map(p => [p.lat, p.lng])

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <span className="material-symbols-outlined">share_location</span>
          GeoLogger
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <h3 style={{ marginBottom: '16px' }}>Your Tracks</h3>
          {tracks.length === 0 && <div>No tracks recorded yet. Start tracking on your mobile app!</div>}
          {tracks.map(t => (
            <div key={t.id} className="card" onClick={() => setSelectedTrack(t)} style={{ cursor: 'pointer', border: selectedTrack?.id === t.id ? '2px solid var(--md-sys-color-primary)' : 'none' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>route</span>
                {t.name}
              </h4>
               <div style={{fontSize: '12px', color: 'gray', margin: '4px 0'}}>{new Date(t.start_time).toLocaleString()}</div>
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
      <div className="map-container">
        <MapContainer center={[51.505, -0.09]} zoom={2} scrollWheelZoom={true} key={selectedTrack?.id || 'default'}>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {polylineCoords.length > 0 && <Polyline positions={polylineCoords} color="var(--md-sys-color-primary)" weight={5} />}
        </MapContainer>
      </div>
    </div>
  )
}

export default App
