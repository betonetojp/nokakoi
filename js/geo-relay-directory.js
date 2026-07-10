/**
 * GeoRelayDirectory
 * 
 * Handles fetching, caching, and distance calculations for geographic Nostr relays
 * based on the georelays database.
 */

const CSV_URL = 'https://raw.githubusercontent.com/permissionlesstech/georelays/refs/heads/main/nostr_relays.csv';
const CACHE_KEY = 'nokakoi_georelays_cache';
const CACHE_TS_KEY = 'nokakoi_georelays_cache_ts';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const charToValue = {};
for (let i = 0; i < BASE32.length; i++) {
  charToValue[BASE32[i]] = i;
}

/**
 * Decodes a geohash string to the center latitude and longitude of its cell.
 */
function decodeGeohashCenter(geohash) {
  if (!geohash) return { lat: 0, lon: 0 };
  let latInterval = [-90.0, 90.0];
  let lonInterval = [-180.0, 180.0];
  let isEven = true;

  const chars = geohash.toLowerCase();
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cd = charToValue[ch];
    if (cd === undefined) continue;
    for (let mask of [16, 8, 4, 2, 1]) {
      if (isEven) {
        const mid = (lonInterval[0] + lonInterval[1]) / 2;
        if ((cd & mask) !== 0) {
          lonInterval[0] = mid;
        } else {
          lonInterval[1] = mid;
        }
      } else {
        const mid = (latInterval[0] + latInterval[1]) / 2;
        if ((cd & mask) !== 0) {
          latInterval[0] = mid;
        } else {
          latInterval[1] = mid;
        }
      }
      isEven = !isEven;
    }
  }
  return {
    lat: (latInterval[0] + latInterval[1]) / 2,
    lon: (lonInterval[0] + lonInterval[1]) / 2
  };
}

/**
 * Calculates the Haversine distance in kilometers between two sets of coordinates.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Parses the CSV string from the georelays database.
 */
function parseCSV(text) {
  const result = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    // Skip header line
    if (i === 0 && raw.toLowerCase().includes('relay url')) continue;
    
    const parts = raw.split(',');
    if (parts.length < 3) continue;
    
    let host = parts[0].trim();
    // remove protocol if present
    if (host.includes('://')) {
      host = host.split('://')[1];
    }
    const lat = parseFloat(parts[1].trim());
    const lon = parseFloat(parts[2].trim());
    if (!host || isNaN(lat) || isNaN(lon)) continue;
    result.push({ host, lat, lon });
  }
  return result;
}

/**
 * Fetches and caches the CSV data from GitHub.
 */
async function fetchAndCache() {
  try {
    const response = await fetch(CSV_URL);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const text = await response.text();
    const parsed = parseCSV(text);
    if (parsed.length > 0) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(parsed));
      localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
      return parsed;
    }
  } catch (error) {
    console.error('[GeoRelayDirectory] Failed to fetch and cache remote relays:', error);
  }
  return null;
}

function loadCachedRelays() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    console.error('[GeoRelayDirectory] Failed to read cached relays:', e);
  }
  return null;
}

function isCacheStale() {
  const ts = localStorage.getItem(CACHE_TS_KEY);
  if (!ts) return true;
  return (Date.now() - parseInt(ts, 10)) > CACHE_TTL_MS;
}

/**
 * Returns up to `count` relay URLs (wss://) closest to the geohash center.
 * If cache is stale or missing, fetches from remote first.
 */
export async function getClosestRelays(geohash, count = 5, algo = 'merged', mergeParent = false) {
  let entries = loadCachedRelays();
  const stale = isCacheStale();
  
  if (!entries || stale) {
    const fetched = await fetchAndCache();
    if (fetched) {
      entries = fetched;
    }
  }
  
  if (!entries || entries.length === 0) {
    return null;
  }
  
  const getSingleLevelRelays = (gh) => {
    const { lat, lon } = decodeGeohashCenter(gh);
    
    const getIosRelays = () => {
      return entries
        .map(e => ({
          host: e.host,
          dist: haversineKm(lat, lon, e.lat, e.lon)
        }))
        .sort((a, b) => {
          if (Math.abs(a.dist - b.dist) < 1e-9) {
            return a.host.localeCompare(b.host);
          }
          return a.dist - b.dist;
        })
        .slice(0, count)
        .map(e => `wss://${e.host}/`);
    };

    const getAndroidRelays = () => {
      return entries
        .map(e => ({
          host: e.host,
          dist: haversineKm(lat, lon, e.lat, e.lon)
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, count)
        .map(e => `wss://${e.host}/`);
    };

    if (algo === 'ios') {
      return getIosRelays();
    } else if (algo === 'android') {
      return getAndroidRelays();
    } else {
      // merged
      const iosSet = getIosRelays();
      const androidSet = getAndroidRelays();
      return Array.from(new Set([...iosSet, ...androidSet]));
    }
  };

  const primaryRelays = getSingleLevelRelays(geohash) || [];

  if (mergeParent && geohash.length > 1) {
    const parentGeohash = geohash.slice(0, -1);
    const parentRelays = getSingleLevelRelays(parentGeohash) || [];
    return Array.from(new Set([...primaryRelays, ...parentRelays]));
  }

  return primaryRelays;
}
