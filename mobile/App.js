import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Alert, ScrollView, useColorScheme } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SQLite from 'expo-sqlite';
import { MD3LightTheme, MD3DarkTheme, PaperProvider, Text, Button, Appbar, TextInput, Card, Switch, SegmentedButtons } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const LOCATION_TASK_NAME = 'background-location-task';

// Init DB
const db = SQLite.openDatabaseSync('geologger_offline.db');

db.execSync(`
  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lat REAL,
    lng REAL,
    timestamp DATETIME
  );
  CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    server_url TEXT,
    username TEXT,
    password TEXT,
    auto_sync INTEGER DEFAULT 0
  );
`);

// Database Migrations
try { db.runSync('ALTER TABLE config ADD COLUMN collection_interval_m INTEGER DEFAULT 10'); } catch(e) {}
try { db.runSync('ALTER TABLE config ADD COLUMN sync_interval_s INTEGER DEFAULT 60'); } catch(e) {}
try { db.runSync('ALTER TABLE config ADD COLUMN last_sync_time INTEGER DEFAULT 0'); } catch(e) {}
try { db.runSync('ALTER TABLE config ADD COLUMN track_prefix TEXT DEFAULT "GeoLogger"'); } catch(e) {}
try { db.runSync('ALTER TABLE config ADD COLUMN split_interval TEXT DEFAULT "daily"'); } catch(e) {}
try { db.runSync('ALTER TABLE config ADD COLUMN split_custom_h INTEGER DEFAULT 12'); } catch(e) {}
try { db.runSync('ALTER TABLE config ADD COLUMN theme_mode TEXT DEFAULT "auto"'); } catch(e) {}

// Try inserting default config row if empty
try { db.runSync('INSERT INTO config (id, server_url, username, password, auto_sync, collection_interval_m, sync_interval_s, last_sync_time, track_prefix, split_interval, split_custom_h, theme_mode) VALUES (1, "", "", "", 0, 10, 60, 0, "GeoLogger", "daily", 12, "auto")'); } catch(e) {}

const pushPointToServer = async (config, lat, lng, timestamp) => {
    if (!config.server_url || !config.username) return { ok: false, error: 'Missing Config' };
    try {
        const timeSecs = Math.floor(new Date(timestamp).getTime() / 1000);
        let baseUrl = config.server_url.trim();
        const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        
        const data = { 
            action: 'addpos', 
            user: config.username, 
            pass: config.password, 
            lat, lon: lng, time: timeSecs,
            track_prefix: config.track_prefix || 'GeoLogger',
            split_interval: config.split_interval === 'custom' ? `custom:${config.split_custom_h || 12}` : (config.split_interval || 'daily')
        };
        const formBody = Object.keys(data).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(data[k])).join('&');
        
        const res = await fetch(`${url}/index.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: formBody
        });
        
        const rawText = await res.text();
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${rawText}` };
        
        try {
           const result = JSON.parse(rawText);
           return { ok: result.error === false, error: result.message || 'Unknown server error' };
        } catch(e) {
           return { ok: false, error: 'Invalid JSON response from server' };
        }
    } catch(e) {
        return { ok: false, error: `Network: ${e.message}` };
    }
};

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error || !data) return;
  const location = data.locations[0];
  if (!location) return;

  const lat = location.coords.latitude;
  const lng = location.coords.longitude;
  const isoTime = new Date(location.timestamp).toISOString();
  
  db.runSync('INSERT INTO positions (lat, lng, timestamp) VALUES (?, ?, ?)', [lat, lng, isoTime]);

  const config = db.getFirstSync('SELECT * FROM config WHERE id = 1');
  if (!config || config.auto_sync !== 1) return;

  const now = Math.floor(Date.now() / 1000);
  const syncInterval = config.sync_interval_s || 60;
  
  if (now - (config.last_sync_time || 0) >= syncInterval) {
      const positions = db.getAllSync('SELECT * FROM positions');
      let successAny = false;
      for (const p of positions) {
          const res = await pushPointToServer(config, p.lat, p.lng, p.timestamp);
          if (res.ok) {
              db.runSync('DELETE FROM positions WHERE id = ?', [p.id]);
              successAny = true;
          }
      }
      if (successAny) {
         db.runSync('UPDATE config SET last_sync_time = ? WHERE id = 1', [now]);
      }
  }
});

export default function App() {
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [config, setConfig] = useState({ server_url: '', username: '', password: '', auto_sync: 0, collection_interval_m: 10, sync_interval_s: 60, track_prefix: 'GeoLogger', split_interval: 'daily', split_custom_h: 12, theme_mode: 'auto' });
  const [isTracking, setIsTracking] = useState(false);
  
  const colorScheme = useColorScheme();
  const effectiveTheme = config.theme_mode === 'auto' ? colorScheme : config.theme_mode;
  const theme = effectiveTheme === 'dark' ? MD3DarkTheme : MD3LightTheme;
  const [offlineCount, setOfflineCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    loadConfig();
    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const loadConfig = () => {
      const c = db.getFirstSync('SELECT * FROM config WHERE id = 1');
      if (c) {
          const cleanConfig = {
              ...c,
              collection_interval_m: c.collection_interval_m || 10,
              sync_interval_s: c.sync_interval_s || 60,
              track_prefix: c.track_prefix || 'GeoLogger',
              split_interval: c.split_interval || 'daily',
              split_custom_h: c.split_custom_h || 12,
              theme_mode: c.theme_mode || 'auto'
          };
          setConfig(cleanConfig);
          if (!c.server_url) setIsConfiguring(true);
      }
  };

  const saveConfig = () => {
      let ci = parseInt(config.collection_interval_m);
      let si = parseInt(config.sync_interval_s);
      if (isNaN(ci) || ci < 1) ci = 10;
      if (isNaN(si) || si < 10) si = 60;

      try {
        db.runSync('UPDATE config SET server_url = ?, username = ?, password = ?, auto_sync = ?, collection_interval_m = ?, sync_interval_s = ?, track_prefix = ?, split_interval = ?, split_custom_h = ?, theme_mode = ? WHERE id = 1', 
          [config.server_url, config.username, config.password, config.auto_sync, ci, si, config.track_prefix, config.split_interval, parseInt(config.split_custom_h) || 12, config.theme_mode || 'auto']);
        
        setConfig({...config, collection_interval_m: ci, sync_interval_s: si, split_custom_h: parseInt(config.split_custom_h) || 12});
        setIsConfiguring(false);
        
        if (isTracking) {
           Alert.alert("Saved", "Configuration updated. Restarting tracker to apply new intervals.", [
               {text: "OK", onPress: () => { toggleTracking(); setTimeout(() => toggleTracking(), 1000); }}
           ]);
        }
      } catch(e) {
        Alert.alert("Save Error", e.message);
      }
  };

  const checkStatus = async () => {
    const tracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
    setIsTracking(tracking);
    const result = db.getFirstSync('SELECT COUNT(*) as count FROM positions');
    if (result) setOfflineCount(result.count);
  };

  const toggleTracking = async () => {
    if (isTracking) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      setIsTracking(false);
    } else {
      loadConfig(); 
      const liveConfig = db.getFirstSync('SELECT * FROM config WHERE id = 1');
      if (!liveConfig || !liveConfig.server_url) return Alert.alert("Hold on", "Please configure the Server URL first.");
      
      const { status: fg } = await Location.requestForegroundPermissionsAsync();
      if (fg !== 'granted') return Alert.alert("Error", "Foreground location permission required.");
      
      const { status: bg } = await Location.requestBackgroundPermissionsAsync();
      if (bg !== 'granted') return Alert.alert("Error", "Background location permission rigidly required by Android API!");

      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.Highest, 
        distanceInterval: liveConfig.collection_interval_m || 10, 
        deferredUpdatesInterval: 1000,
        showsBackgroundLocationIndicator: true,
      });
      setIsTracking(true);
    }
  };

  const forceSync = async () => {
      if (!config.server_url) return Alert.alert("No Server", "Configure Server URL first");
      const positions = db.getAllSync('SELECT * FROM positions');
      if (positions.length === 0) return Alert.alert("Empty", "No offline data stored.");
      
      setIsSyncing(true);
      let successCount = 0;
      let lastError = "";
      
      for (const p of positions) {
          const res = await pushPointToServer(config, p.lat, p.lng, p.timestamp);
          if (res.ok) {
              db.runSync('DELETE FROM positions WHERE id = ?', [p.id]);
              successCount++;
          } else {
              if (res.error) lastError = res.error;
          }
      }
      setIsSyncing(false);
      if (successCount > 0) db.runSync('UPDATE config SET last_sync_time = ? WHERE id = 1', [Math.floor(Date.now() / 1000)]);
      checkStatus();
      
      if (successCount === positions.length) {
         Alert.alert("Sync Complete", `Successfully synced all ${successCount} points.`);
      } else {
         Alert.alert("Partial Failure", `Synced ${successCount}/${positions.length} points.\n\nError returned: ${lastError}`);
      }
  };

  if (isConfiguring) {
      // Wrap in View to forcefully enforce actual Paper theme background locally
      return (
        <PaperProvider theme={theme}>
          <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
            <Appbar.Header style={{ backgroundColor: theme.colors.primaryContainer }}>
              <Appbar.Content title="Settings" />
              <Appbar.Action icon="close" onPress={() => setIsConfiguring(false)} />
            </Appbar.Header>
            <ScrollView style={styles.container}>
                <TextInput label="Server URL (http://ip:3000)" value={config.server_url} onChangeText={t => setConfig({...config, server_url: t})} mode="outlined" style={styles.input} />
                <TextInput label="Username" value={config.username} onChangeText={t => setConfig({...config, username: t})} mode="outlined" style={styles.input} />
                <TextInput label="Password" secureTextEntry value={config.password} onChangeText={t => setConfig({...config, password: t})} mode="outlined" style={styles.input} />
                
                <Text style={{marginTop: 15, marginBottom: 10, fontWeight: 'bold'}}>Track Settings</Text>
                <TextInput label="Track Base Name" value={config.track_prefix} onChangeText={t => setConfig({...config, track_prefix: t})} mode="outlined" style={styles.input} />
                
                <Text style={{fontSize: 12, marginBottom: 5}}>Automatic Cloud Track Splicing</Text>
                <SegmentedButtons
                    value={config.split_interval}
                    onValueChange={v => setConfig({...config, split_interval: v})}
                    buttons={[
                        { value: 'never', label: 'Off' },
                        { value: 'daily', label: 'Day' },
                        { value: 'weekly', label: 'Week' },
                        { value: 'monthly', label: 'Mon' },
                        { value: 'custom', label: 'Custom' },
                    ]}
                />
                
                {config.split_interval === 'custom' && (
                    <TextInput label="Custom Chunk Limit (Hours)" keyboardType="numeric" value={config.split_custom_h?.toString()} onChangeText={t => setConfig({...config, split_custom_h: t})} mode="outlined" style={styles.input} />
                )}
                
                <Text style={{marginTop: 15, marginBottom: 5, fontWeight: 'bold'}}>App Theme</Text>
                <SegmentedButtons
                    value={config.theme_mode}
                    onValueChange={v => setConfig({...config, theme_mode: v})}
                    buttons={[
                        { value: 'auto', label: 'System' },
                        { value: 'light', label: 'Light' },
                        { value: 'dark', label: 'Dark' }
                    ]}
                />

                <View style={[styles.inlineRow, {marginTop: 20}]}>
                    <Text variant="titleMedium">Auto-Sync in Background</Text>
                    <Switch value={config.auto_sync === 1} onValueChange={v => setConfig({...config, auto_sync: v ? 1 : 0})} />
                </View>

                {config.auto_sync === 1 && (
                    <TextInput label="Sync Interval (Seconds)" keyboardType="numeric" value={config.sync_interval_s.toString()} onChangeText={t => setConfig({...config, sync_interval_s: t})} mode="outlined" style={styles.input} />
                )}

                <Text style={{marginTop: 15, marginBottom: -5, fontWeight: 'bold'}}>GPS Hardware Config</Text>
                <TextInput label="Data Collection Interval (Meters)" keyboardType="numeric" value={config.collection_interval_m.toString()} onChangeText={t => setConfig({...config, collection_interval_m: t})} mode="outlined" style={styles.input} />

                <Button mode="contained" onPress={saveConfig} style={{marginTop: 20, marginBottom: 40}}>Save & Return</Button>
            </ScrollView>
          </View>
        </PaperProvider>
      )
  }

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
          <Appbar.Header style={{ backgroundColor: theme.colors.primaryContainer }}>
            <Appbar.Content title="GeoLogger Tracker" />
          <Appbar.Action icon="cog" onPress={() => setIsConfiguring(true)} />
        </Appbar.Header>
        
        <View style={styles.container}>
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleLarge">Status: </Text>
              <Text variant="bodyMedium" style={{color: isTracking ? 'green' : 'gray', fontWeight: 'bold'}}>
                  {isTracking ? "Active Background Tracking" : "Standby"}
              </Text>
            </Card.Content>
          </Card>

          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium">Database Integration</Text>
              <Text variant="bodyMedium" numberOfLines={1}>Target: {config.server_url || 'Not set'}</Text>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10}}>
                 <Text variant="titleMedium">{offlineCount}</Text>
                 <Text>points queued for upload</Text>
              </View>
              <Button style={styles.button} mode="contained-tonal" icon="cloud-upload" loading={isSyncing} onPress={forceSync}>
                Force Sync Data
              </Button>
            </Card.Content>
          </Card>

          <Button 
             style={styles.mainButton} mode="contained" icon={isTracking ? "stop" : "map-marker"} 
             buttonColor={isTracking ? theme.colors.error : theme.colors.primary} onPress={toggleTracking}
          >
            {isTracking ? "Stop Tracker" : "Engage Tracking"}
          </Button>
        </View>
        </View>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: { marginBottom: 16 },
  button: { marginTop: 16 },
  input: { marginBottom: 16, marginTop: 10 },
  mainButton: { padding: 8, marginTop: 'auto', marginBottom: 32 },
  inlineRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderRadius: 8, paddingHorizontal: 15, borderWidth: 1, borderColor: '#888'}
});
