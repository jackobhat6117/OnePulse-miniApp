// src/utils/getDeviceInfo.ts

export interface GeoLocation {
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
  touch_support: boolean; // Keep as boolean
  user_agent: string;
  viewport_height: number;
}

// ... (Keep getOrGenerateDeviceId and getOS functions exactly as they were) ...
// Copy the helpers from the previous code if you overwrote them.

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

const getOS = (userAgent: string): { name: string; version: string } => {
  let name = "Unknown";
  if (userAgent.indexOf("Win") !== -1) name = "Windows";
  else if (userAgent.indexOf("Mac") !== -1) name = "MacOS";
  else if (userAgent.indexOf("Linux") !== -1) name = "Linux";
  else if (userAgent.indexOf("Android") !== -1) name = "Android";
  else if (userAgent.indexOf("like Mac") !== -1) name = "iOS";

  return { name, version: "Unknown" }; 
};

export const getDeviceInfo = async (): Promise<DeviceInfoPayload> => {
  if (typeof window === 'undefined') {
    throw new Error("Device info can only be fetched on the client side");
  }

  // 1. Fetch IP Data
  let ipData = { ip: '0.0.0.0', city: 'Unknown', country_name: 'Unknown', latitude: 0, longitude: 0 };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout
    
    // We try to fetch, but we CATCH failures so the app doesn't crash
    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal })
      .catch(() => null); // If network fails (CORS/Blocker), return null
      
    clearTimeout(timeoutId);

    if (res && res.ok) {
        const json = await res.json().catch(() => null);
        if (json) ipData = json;
    }
  } catch (e) {
    console.warn("IP fetch failed safely, using defaults.");
  }


  const ua = navigator.userAgent;
  const osInfo = getOS(ua);
  const deviceId = getOrGenerateDeviceId();
  
  // LOGIC FIX:
  // navigator.maxTouchPoints can be undefined in some webviews.
  // We use `> 0` to convert to boolean safely.
  const hasTouch = (navigator.maxTouchPoints || 0) > 0;

  return {
    app_version: "1.0.0",
    cpu_cores: navigator.hardwareConcurrency || 2,
    device_id: deviceId,
    device_type: /Mobi|Android/i.test(ua) ? "mobile" : "desktop",
    fingerprint: btoa(`${deviceId}-${ua}-${window.screen.width}`).slice(0, 16),
    geo_location: {
      city: ipData.city || "Unknown",
      country: ipData.country_name || "Unknown",
      lat: String(ipData.latitude || 0),
      lon: String(ipData.longitude || 0)
    },
    ip_address: ipData.ip || "0.0.0.0",
    locale: navigator.language || "en-US",
    os_name: osInfo.name,
    os_version: osInfo.version,
    pixel_ratio: window.devicePixelRatio || 1,
    screen_resolution: `${window.screen.width}x${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    
    // --- FIX ATTEMPT ---
    // Try sending 'true' temporarily. If this works, your backend has a bug 
    // where it rejects 'false'. If it fails, revert to 'hasTouch'.
    //  touch_support: hasTouch,
    touch_support: true, 
    
    user_agent: ua,
    viewport_height: window.innerHeight
  };
};

