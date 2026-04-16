# GeoLogger

GeoLogger is a modern, privacy-respecting, and fully self-hosted ecosystem for continuous background location tracking. Inspired by the open-source μlogger project, this suite of applications provides everything you need to securely record, store, and visualize your GPS tracks without submitting data to large corporate providers. 

The project consists of three main components: a Dockerized Node.js Server, a Vite React Web App constructed with a native Material You interface, and a React Native Expo Android App boasting offline tracking capabilities.

---

## 🧭 Architecture

1. **/server - Backend API & Database**
   A Dockerized Express / Node.js backend using SQLite. It securely authenticates users through JWT, allows admins to manage users, and provides endpoints to ingest and export batch location coordinates.
   - **Data Storage:** SQLite database locally mapped to `./data/geologger.sqlite` for frictionless migrations.
   - **Legacy Support:** The backend also includes an `index.php` reverse-proxy that intercepts requests from the official F-Droid `μlogger` Android application. You can upload data to this server using our modern React Native app or the legacy F-Droid variant.

2. **/web - Web App Dashboard**
   A sleek single-page application built with Vite and React. It uses strict Vanilla CSS to perfectly recreate dynamic "Material You" palettes, providing maps and historical track views without depending on bulky CSS frameworks.
   - **Mapping Engine:** Leaflet & React-Leaflet integration to map offline tracks to real-world paths.

3. **/mobile - Android App**
   A streamlined React Native (Expo) app built leveraging `react-native-paper`. 
   - **Offline-First:** Seamlessly caches geolocation coordinates into a local SQLite database when disconnected, offering a one-click sync to your backend server upon reconnecting.
   - **Background Location:** Registers explicit Task Managers ensuring your trail continues drawing flawlessly, even when you lock your screen.

---

## 🔒 Critical Security Configuration

Before deploying, you **MUST** change the default `JWT_SECRET`. This key signs authentication tokens. If left as default, your server is insecure.

### Docker Compose
Edit `docker-compose.yml`:
```yaml
environment:
  - JWT_SECRET=your_new_random_long_string_here
```

---

## 🚀 Deployment Options

### 🐳 Option 1: Docker Compose (Recommended)
1. **Launch the server using Docker Compose:**
```bash
docker-compose up -d
```
The server will now be listening on `http://localhost:3000`. 
- **Persistent Data:** Stored in the `./data` directory relative to the project root.

### 🏗️ Option 2: Manual Docker Build
If you prefer not to use Compose:
1. **Build the image**:
```bash
docker build -t geologger-server .
```
2. **Run the container**:
```bash
docker run -dp 3000:3000 \
  --name geologger-server \
  --restart unless-stopped \
  -v "$(pwd)/data:/app/data" \
  -e JWT_SECRET="your_secret_here" \
  geologger-server
```

### 💻 Option 3: Direct Node.js Deployment (No Docker)
If you wish to run the project directly on your host machine:

#### 1. Build the Frontend
```bash
cd web && npm install && npm run build
```

#### 2. Start the Backend
1. Ensure the contents of `web/dist` are copied to `server/public`.
2. Install server dependencies:
```bash
cd server && npm install
```
3. Start the Server:
```bash
# Set JWT_SECRET in environment first
node index.js
```

---

## 🌐 Port Exposure

By default, the server runs on port **3000**.
To change this, modify the `ports` section in `docker-compose.yml`:
```yaml
ports:
  - "8080:3000"  # Exposes the app on host port 8080
```

---

## 🆙 Upgrading

To upgrade your GeoLogger instance to the latest version:

### Using Docker Compose:
```bash
git pull                   # Get latest code
docker-compose up --build -d  # Rebuild and restart
```

---

## 🛡️ License

This library is distributed under the GNU Affero General Public License v3.0 (AGPLv3). See the `LICENSE` file for more details.
