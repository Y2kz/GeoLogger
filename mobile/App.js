import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Alert } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SQLite from 'expo-sqlite';
import { MD3LightTheme as DefaultTheme, PaperProvider, Text, Button, Appbar, TextInput, Card } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const LOCATION_TASK_NAME = 'background-location-task';

// Open SQLite DB for offline caching
const db = SQLite.openDatabaseSync('geologger_offline.db');

// Create table if not exists
db.execSync(`
  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lat REAL,
    lng REAL,
    timestamp DATETIME
  );
`);

// Define the background task
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error(error);
    return;
  }
  if (data) {
    const { locations } = data;
    const location = locations[0];
    
    if (location) {
        // Run synchronously to insert into local DB
        db.runSync('INSERT INTO positions (lat, lng, timestamp) VALUES (?, ?, ?)', [
            location.coords.latitude,
            location.coords.longitude,
            new Date(location.timestamp).toISOString()
        ]);
        console.log("Saved location offline", location.coords);
    }
  }
});

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#006a60',
    primaryContainer: '#74f8e5',
    secondary: '#4a635f',
    secondaryContainer: '#cce8e2',
    background: '#fafdfa',
    surface: '#fafdfa',
    error: '#ba1a1a',
  },
};

export default function App() {
  const [isTracking, setIsTracking] = useState(false);
  const [offlineCount, setOfflineCount] = useState(0);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkStatus = async () => {
    const tracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
    setIsTracking(tracking);

    const result = db.getFirstSync('SELECT COUNT(*) as count FROM positions');
    if (result) {
        setOfflineCount(result.count);
    }
  };

  const toggleTracking = async () => {
    if (isTracking) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      setIsTracking(false);
    } else {
      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
      if (foregroundStatus === 'granted') {
        const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
        if (backgroundStatus === 'granted') {
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 10, // Receive updates for every 10 meters
            deferredUpdatesInterval: 1000,
            showsBackgroundLocationIndicator: true,
          });
          setIsTracking(true);
        } else {
          Alert.alert("Permission Error", "Background location is needed to track correctly.");
        }
      }
    }
  };

  const syncData = async () => {
     // Fetch from offline DB and send to Server (to be integrated)
     const positions = db.getAllSync('SELECT * FROM positions');
     if (positions.length === 0) {
        Alert.alert("Sync", "No positions to sync.");
        return;
     }

     // Simulate API Sync
     setTimeout(() => {
        db.runSync('DELETE FROM positions');
        setOfflineCount(0);
        Alert.alert("Sync", `Successfully synced ${positions.length} points.`);
     }, 1000);
  };

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <Appbar.Header style={{ backgroundColor: theme.colors.primaryContainer }}>
          <Appbar.Content title="GeoLogger Tracker" titleStyle={{ color: theme.colors.onPrimaryContainer }} />
        </Appbar.Header>
        
        <View style={styles.container}>
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleLarge">Status: </Text>
              <Text variant="bodyMedium" style={{color: isTracking ? 'green' : 'gray', fontWeight: 'bold'}}>
                  {isTracking ? "Active Tracking via GPS" : "Standby"}
              </Text>
            </Card.Content>
          </Card>

          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium">Offline Cache</Text>
              <Text variant="bodyLarge">{offlineCount} positions pending sync</Text>
              <Button style={styles.button} mode="contained-tonal" onPress={syncData}>
                Sync with Server
              </Button>
            </Card.Content>
          </Card>

          <Button 
             style={styles.mainButton} 
             mode="contained" 
             icon={isTracking ? "stop" : "play"} 
             buttonColor={isTracking ? theme.colors.error : theme.colors.primary}
             onPress={toggleTracking}
          >
            {isTracking ? "Stop Tracking" : "Start Tracking"}
          </Button>
        </View>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fafdfa',
  },
  card: {
    marginBottom: 16,
  },
  button: {
    marginTop: 16,
  },
  mainButton: {
    padding: 8,
    marginTop: 'auto',
    marginBottom: 32,
  }
});
