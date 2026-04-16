import { useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet'

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  
  // Fake state for now
  const [tracks, setTracks] = useState([{ name: 'Morning Run', id: 1 }, { name: 'Evening Walk', id: 2 }])

  const handleLogin = (e) => {
    e.preventDefault()
    // Mock login
    const mockToken = '12345'
    localStorage.setItem('token', mockToken)
    setToken(mockToken)
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
          <form onSubmit={handleLogin}>
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
            <button type="submit" className="md-button">Login</button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <span className="material-symbols-outlined">share_location</span>
          GeoLogger
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <h3 style={{ marginBottom: '16px' }}>Your Tracks</h3>
          {tracks.map(t => (
            <div key={t.id} className="card" style={{ cursor: 'pointer' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>route</span>
                {t.name}
              </h4>
            </div>
          ))}
        </div>
        
        <button onClick={handleLogout} className="md-button secondary" style={{ marginTop: 'auto' }}>
          <span className="material-symbols-outlined">logout</span>
          Logout
        </button>
      </div>
      <div className="map-container">
        <MapContainer center={[51.505, -0.09]} zoom={13} scrollWheelZoom={true}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </MapContainer>
      </div>
    </div>
  )
}

export default App
