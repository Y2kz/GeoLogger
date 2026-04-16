import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Alert, ScrollView, useColorScheme, BackHandler } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SQLite from 'expo-sqlite';
import { MD3LightTheme, MD3DarkTheme, PaperProvider, Text, Button, Appbar, TextInput, Card, Switch, SegmentedButtons } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const LOCATION_TASK_NAME = 'background-location-task';

const db = SQLite.openDatabaseSync('geologger_offline.db');

db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lat REAL,
    lng REAL,
    altitude REAL,
    speed REAL,
    bearing REAL,
    accuracy REAL,
    timestamp TEXT
  );
  CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY,
    server_url TEXT,
    username TEXT,
    password TEXT,
    auto_sync INTEGER,
    collection_interval_m INTEGER,
    sync_interval_s INTEGER,
    track_prefix TEXT,
    split_interval TEXT,
    split_custom_h INTEGER,
    theme_mode TEXT,
    last_sync_time INTEGER
  );
  INSERT OR IGNORE INTO config (id, server_url, username, password, auto_sync, collection_interval_m, sync_interval_s, track_prefix, split_interval, split_custom_h, theme_mode) 
  VALUES (1, '', '', '', 0, 10, 60, 'GeoLogger', 'daily', 12, 'auto');
`);

async function pushPointToServer(config, p) {
    if (!config.server_url) return { ok: false, error: 'No server' };
    try {
        const baseUrl = config.server_url.trim();
        const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        const res = await fetch(`${url}/index.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'addpos',
                user: config.username,
                pass: config.password,
                lat: p.lat,
                lon: p.lng,
                altitude: p.altitude,
                speed: p.speed,
                bearing: p.bearing,
                accuracy: p.accuracy,
                time: Math.floor(new Date(p.timestamp).getTime() / 1000),
                track_prefix: config.track_prefix,
                split_interval: config.split_interval,
                split_custom_h: config.split_custom_h
            })
        });
        const json = await res.json();
        if (res.ok && !json.error) return { ok: true };
        return { ok: false, error: json.message || 'Server error' };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  if (data) {
    const { locations } = data;
    const now = Math.floor(Date.now() / 1000);
    const config = db.getFirstSync('SELECT * FROM config WHERE id = 1');
    
    let successAny = false;
    for (const loc of locations) {
      const p = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        altitude: loc.coords.altitude,
        speed: loc.coords.speed,
        bearing: loc.coords.heading,
        accuracy: loc.coords.accuracy,
        timestamp: new Date(loc.timestamp).toISOString()
      };
      
      db.runSync(
        'INSERT INTO positions (lat, lng, altitude, speed, bearing, accuracy, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [p.lat, p.lng, p.altitude, p.speed, p.bearing, p.accuracy, p.timestamp]
      );

      if (config && config.auto_sync === 1 && config.server_url) {
          const res = await pushPointToServer(config, p);
          if (res.ok) {
             const row = db.getFirstSync('SELECT id FROM positions WHERE timestamp = ?', [p.timestamp]);
             if (row) db.runSync('DELETE FROM positions WHERE id = ?', [row.id]);
             successAny = true;
          }
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
  const [serverStatus, setServerStatus] = useState(null);
  const isSettingsActive = useRef(false);

  useEffect(() => {
    const handleBack = () => {
      if (isConfiguring) {
        setIsConfiguring(false);
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', handleBack);
    return () => sub.remove();
  }, [isConfiguring]);

  const checkServerPing = async () => {
    const c = db.getFirstSync('SELECT * FROM config WHERE id = 1');
    if (!c || !c.server_url) {
      setServerStatus('error');
      return;
    }
    try {
        const baseUrl = c.server_url.trim();
        const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        const res = await fetch(`${url}/index.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: `action=auth&user=${encodeURIComponent(c.username)}&pass=${encodeURIComponent(c.password)}`
        });
        const json = await res.json();
        if (res.ok && !json.error) {
            setServerStatus('ok');
        } else {
            setServerStatus('error');
        }
    } catch(e) {
        setServerStatus('error');
    }
  };

  useEffect(() => {
    isSettingsActive.current = isConfiguring;
  }, [isConfiguring]);

  useEffect(() => {
    loadConfig();
    checkStatus();
    checkServerPing();
    const interval = setInterval(() => {
        if (!isSettingsActive.current) {
            checkStatus();
            checkServerPing();
        }
    }, 5000);
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
        Alert.alert("Database Error", "Failed to save configuration: " + e.message);
      }
  };

  const checkStatus = async () => {
    const row = db.getFirstSync('SELECT count(*) as count FROM positions');
    if (row) setOfflineCount(row.count);
    
    const tracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
    setIsTracking(tracking);
  };

  const toggleTracking = async () => {
    if (isTracking) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      setIsTracking(false);
    } else {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return Alert.alert("Error", "Location permission required!");
      
      const { status: bg } = await Location.requestBackgroundPermissionsAsync();
      if (bg !== 'granted') return Alert.alert("Error", "Background location permission rigidly required by Android API!");

      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.Highest, 
        distanceInterval: config.collection_interval_m || 10, 
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
          const res = await pushPointToServer(config, p);
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
                <TextInput label="Track Base Name" value={config.track_prefix} onChangeText={t => setConfig({...config, track_prefix: t})} mode="outlined" style={styles.input} />
                <Text style={styles.label}>Splicing</Text>
                <SegmentedButtons
                    value={config.split_interval}
                    onValueChange={v => setConfig({...config, split_interval: v})}
                    buttons={[{ value: 'never', label: 'Off' }, { value: 'daily', label: 'Day' }, { value: 'weekly', label: 'Week' }, { value: 'monthly', label: 'Mon' }, { value: 'custom', label: 'Custom' }]}
                />
                {config.split_interval === 'custom' && (
                    <TextInput label="Hours" keyboardType="numeric" value={config.split_custom_h?.toString()} onChangeText={t => setConfig({...config, split_custom_h: t})} mode="outlined" style={styles.input} />
                )}
                <Text style={styles.label}>Theme</Text>
                <SegmentedButtons
                    value={config.theme_mode}
                    onValueChange={v => setConfig({...config, theme_mode: v})}
                    buttons={[{ value: 'auto', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
                />
                <View style={styles.inlineRow}>
                    <Text>Auto-Sync</Text>
                    <Switch value={config.auto_sync === 1} onValueChange={v => setConfig({...config, auto_sync: v ? 1 : 0})} />
                </View>
                <TextInput label="Sync(s)" keyboardType="numeric" value={config.sync_interval_s.toString()} onChangeText={t => setConfig({...config, sync_interval_s: t})} mode="outlined" style={styles.input} />
                <TextInput label="Collect(m)" keyboardType="numeric" value={config.collection_interval_m.toString()} onChangeText={t => setConfig({...config, collection_interval_m: t})} mode="outlined" style={styles.input} />
                <Button mode="contained" onPress={saveConfig} style={styles.button}>Save</Button>
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
            <Appbar.Content 
              title="GeoLogger Tracker" 
              subtitle={serverStatus === 'ok' ? 'Connected' : (serverStatus === 'error' ? 'Check Server' : 'Checking...')}
              subtitleStyle={{ color: serverStatus === 'ok' ? '#4CAF50' : (serverStatus === 'error' ? '#F44336' : '#FFC107') }}
            />
            <Appbar.Action icon="cog" onPress={() => setIsConfiguring(true)} />
          </Appbar.Header>
          <View style={styles.container}>
            <Card style={styles.card}>
              <Card.Content>
                <Text variant="titleLarge">Status: </Text>
                <Text variant="bodyMedium" style={{color: isTracking ? 'green' : 'gray', fontWeight: 'bold'}}>
                    {isTracking ? "Active" : "Standby"}
                </Text>
              </Card.Content>
            </Card>
            <Text style={{textAlign: 'center', marginVertical: 10}}>{offlineCount} points queued</Text>
            <Button mode="contained-tonal" icon="cloud-upload" loading={isSyncing} onPress={forceSync} style={styles.card}>Sync All</Button>
            <Button mode="contained" icon={isTracking ? "stop" : "map-marker"} buttonColor={isTracking ? theme.colors.error : theme.colors.primary} onPress={toggleTracking} style={styles.mainButton}>
              {isTracking ? "Stop Tracker" : "Start Tracking"}
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
  input: { marginBottom: 16 },
  label: { marginTop: 15, marginBottom: 5, fontWeight: 'bold' },
  button: { marginTop: 20, marginBottom: 40 },
  mainButton: { padding: 8, marginTop: 'auto' },
  inlineRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10}
});
