// src/utils/getDeviceInfo.ts

interface GeoLocation {
  city: string;
  country: string;
  lat: string;
  lon: string;
}

export interface DeviceInfoPayload {
  app_version: string;
  cpu_cores: number;
  device_id: string;
  device_type: string;
  fingerprint: string;
  geo_location: GeoLocation;
  ip_address: string;
  locale: string;
  os_name: string;
  os_version: string;
  pixel_ratio: number;
  screen_resolution: string;
  timezone: string;
  touch_support: boolean;
  user_agent: string;
  viewport_height: number;
}

// Helper to generate a random ID if one doesn't exist
const getOrGenerateDeviceId = (): string => {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('device_id');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem('device_id', id);
  }
  return id;
};

// Helper to guess OS (Basic detection)
const getOS = (userAgent: string): { name: string; version: string } => {
  let name = "Unknown";
  let version = "Unknown";
  
  if (userAgent.indexOf("Win") !== -1) name = "Windows";
  else if (userAgent.indexOf("Mac") !== -1) name = "MacOS";
  else if (userAgent.indexOf("Linux") !== -1) name = "Linux";
  else if (userAgent.indexOf("Android") !== -1) name = "Android";
  else if (userAgent.indexOf("like Mac") !== -1) name = "iOS";

  return { name, version };
};

export const getDeviceInfo = async (): Promise<DeviceInfoPayload> => {
  if (typeof window === 'undefined') {
    throw new Error("Device info can only be fetched on the client side");
  }

  // 1. Get IP and Geo (Fetch from a free service, with a timeout fallback)
  let ipData = { ip: '0.0.0.0', city: 'Unknown', country_name: 'Unknown', latitude: 0, longitude: 0 };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout
    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
        ipData = await res.json();
    }
  } catch (e) {
    console.warn("Could not fetch IP data, defaulting to unknown.");
  }

  // 2. Gather Browser Data
  const ua = navigator.userAgent;
  const osInfo = getOS(ua);
  const deviceId = getOrGenerateDeviceId();

  return {
    app_version: "1.0.0", // Hardcoded or from env
    cpu_cores: navigator.hardwareConcurrency || 2,
    device_id: deviceId,
    device_type: /Mobi|Android/i.test(ua) ? "mobile" : "desktop",
    fingerprint: btoa(`${deviceId}-${ua}-${window.screen.width}`).slice(0, 16), // Simple pseudo-fingerprint
    geo_location: {
      city: ipData.city || "Unknown",
      country: ipData.country_name || "Unknown",
      lat: String(ipData.latitude || 0),
      lon: String(ipData.longitude || 0)
    },
    ip_address: ipData.ip || "0.0.0.0",
    locale: navigator.language || "en-US",
    os_name: osInfo.name,
    os_version: osInfo.version, // Extracting actual version from UA is complex, keeping simple for MVP
    pixel_ratio: window.devicePixelRatio || 1,
    screen_resolution: `${window.screen.width}x${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    touch_support: navigator.maxTouchPoints > 0,
    user_agent: ua,
    viewport_height: window.innerHeight
  };
};