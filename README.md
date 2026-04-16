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

## 🚀 Getting Started

### Backend Setup
1. Open the project root.
2. Launch the server using Docker Compose:
```bash
docker-compose up -d
```
The server will now be listening on `http://localhost:3000`. If you run locally without Docker, simply `cd server && npm start`.

### Web Dashboard
1. Navigate into the Web application package.
2. Run the frontend locally:
```bash
cd web
npm install
npm run dev
```

### Mobile App (Android)
1. Navigate to the mobile package.
2. Start the Expo builder:
```bash
cd mobile
npm install
npx expo start
```
Use the **Expo Go** application on your personal Android device to scan the rendered QR code and try out the background tracker locally!

---

## 🛡️ License

This library is distributed under the GNU Affero General Public License v3.0 (AGPLv3). See the `LICENSE` file for more details.
