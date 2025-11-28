'use client';

import { useEffect, useState, useRef } from 'react';
import { retrieveLaunchParams } from '@telegram-apps/sdk-react';
import { getDeviceInfo, DeviceInfoPayload } from '@/utils/getDeviceInfo';

// --- TYPES ---

interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  photoUrl?: string;
  isPremium?: boolean;
}

// Payload for Step 1
interface CheckIdPayload {
  allowed_financial_actions: string[];
  customer_profile: { avatar: string };
  first_name: string;
  is_bot_user: boolean;
  is_premium: boolean;
  kyc_status: string;
  language_code: string;
  last_name: string;
  phone_number: string;
  registration_status: string;
  telegram_id: number;
  username: string;
}

// Payload for Step 2
interface ShareContactPayload {
  phone_number: string;
  telegram_id: number;
}

// Payload for Step 3
interface DeviceSessionPayload {
  device_info: DeviceInfoPayload;
  phone_number: string;
  telegram_id: string; // Cast to string as per requirements
}

type AppStatus = 
  | 'idle' 
  | 'checking'            // 1. Verifying Telegram ID
  | 'id-verified'         // 2. Success screen for ID
  | 'phone-entry'         // 3. User enters phone
  | 'submitting-phone'    // 4. Sending phone to backend
  | 'starting-session'    // 5. Sending device info
  | 'completed'           // 6. All done
  | 'error' 
  | 'invalid-environment';

type UnsafeTelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
} | undefined;

type DebugDetails = {
  initDataSource?: 'sdk' | 'unsafe' | 'url';
  initDataRawPreview?: string;
  user?: TelegramUser;
};

// --- CONSTANTS ---
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

// --- HELPERS ---

const mapUnsafeUser = (unsafeUser: UnsafeTelegramUser): TelegramUser | undefined => {
  if (!unsafeUser) return undefined;
  return {
    id: unsafeUser.id,
    firstName: unsafeUser.first_name,
    lastName: unsafeUser.last_name,
    username: unsafeUser.username,
    languageCode: unsafeUser.language_code,
    photoUrl: unsafeUser.photo_url,
    isPremium: unsafeUser.is_premium,
  };
};

const parseUserFromInitDataString = (initDataString?: string | null): TelegramUser | undefined => {
  if (!initDataString) return undefined;
  try {
    const params = new URLSearchParams(initDataString);
    const userPayload = params.get('user');
    if (!userPayload) return undefined;
    const unsafeUser = JSON.parse(userPayload);
    return mapUnsafeUser(unsafeUser);
  } catch (error) {
    console.warn("Failed to parse user from init data string:", error);
    return undefined;
  }
};

const getInitDataFromUrl = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    const currentUrl = new URL(window.location.href);
    const searchParam = currentUrl.searchParams.get('tgWebAppData');
    if (searchParam) return decodeURIComponent(searchParam);
    if (currentUrl.hash.startsWith('#tgWebAppData=')) {
      return decodeURIComponent(currentUrl.hash.replace('#tgWebAppData=', ''));
    }
  } catch (error) {
    console.warn("Unable to read tgWebAppData param:", error);
  }
  return undefined;
};

// --- COMPONENT ---

export default function RegistrationFlow() {
  const [status, setStatus] = useState<AppStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [debugDetails, setDebugDetails] = useState<DebugDetails | null>(null);
  
  // Data State
  const [phoneNumber, setPhoneNumber] = useState('');
  const [currentUser, setCurrentUser] = useState<TelegramUser | null>(null);
  const [initDataRawString, setInitDataRawString] = useState<string | undefined>(undefined);

  const hasChecked = useRef(false);

  // 1. INITIAL MOUNT & ID CHECK
  useEffect(() => {
    if (!BACKEND_URL) {
      setStatus('error');
      setErrorMessage('The backend URL is not configured correctly.');
      return;
    }

    if (hasChecked.current) return;
    hasChecked.current = true;

    const performCheck = async () => {
      setStatus('checking');
      try {
        // --- A. Retrieve Telegram Data ---
        let initData: any;
        let initDataRaw: string | undefined;
        try {
          const params = retrieveLaunchParams();
          initData = params.initData;
          initDataRaw = typeof params.initDataRaw === 'string' ? params.initDataRaw : undefined;
        } catch (e) {
          console.warn("SDK retrieve failed, trying fallbacks.");
        }

        let tgUser = initData?.user as TelegramUser | undefined;
        let initSource: DebugDetails['initDataSource'] = tgUser ? 'sdk' : undefined;

        // Fallbacks for development/direct link opening
        if (typeof window !== 'undefined') {
          const webApp = (window as any).Telegram?.WebApp;
          const unsafeUser = webApp?.initDataUnsafe?.user as UnsafeTelegramUser;
          
          if (!tgUser) {
            const mapped = mapUnsafeUser(unsafeUser);
            if (mapped) {
              tgUser = mapped;
              initSource = 'unsafe';
            }
          }
          initDataRaw = initDataRaw ?? (typeof webApp?.initData === 'string' ? webApp?.initData : undefined);

          if (!tgUser) {
            const urlInitData = getInitDataFromUrl();
            const parsed = parseUserFromInitDataString(urlInitData);
            if (parsed) {
              tgUser = parsed;
              initSource = 'url';
            }
            initDataRaw = initDataRaw ?? urlInitData;
          }
        }

        setDebugDetails({
          user: tgUser,
          initDataSource: initSource,
          initDataRawPreview: initDataRaw ? `${initDataRaw.slice(0, 80)}...` : undefined,
        });

        if (!tgUser) {
          setStatus('invalid-environment');
          return;
        }

        // Save for later steps
        setCurrentUser(tgUser);
        setInitDataRawString(initDataRaw);

        // --- B. Verify Telegram ID (Step 1) ---
        const payload: CheckIdPayload = {
          allowed_financial_actions: ["ALL"],
          customer_profile: { avatar: "" },
          first_name: tgUser.firstName.replace(/[^a-zA-Z]/g, '') || 'User',
          is_bot_user: true,
          is_premium: tgUser.isPremium || false,
          kyc_status: "PENDING",
          language_code: tgUser.languageCode || "en",
          last_name: tgUser.lastName || "",
          phone_number: "", 
          registration_status: "SELF",
          telegram_id: tgUser.id,
          username: tgUser.username || ""
        };

        const headers: Record<string, string> = {
          'Content-Type': "application/json",
          'X-Channel-Id': "telegram",
          'X-Timestamp': new Date().toISOString(),
          'X-App-Version': "1.0.0",
        };
        if (initDataRaw) headers['X-Telegram-Init'] = initDataRaw;

        const response = await fetch(`${BACKEND_URL}/api/v1/customers/checkTelegramID`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `ID Check Failed: ${response.statusText}`);
        }

        // --- C. Success -> Show "ID Verified" screen ---
        setStatus('id-verified');

      } catch (err: any) {
        console.error("Initialization failed:", err);
        setErrorMessage(err.message || "Unknown error occurred");
        setStatus('error');
      }
    };

    performCheck();
  }, []);

  // 2. HANDLER: Move from ID Verified -> Phone Entry
  const handleContinue = () => {
    setStatus('phone-entry');
  };

  // 3. HANDLER: Submit Phone -> Share Contact -> Start Session
  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !phoneNumber) return;
    
    if (phoneNumber.length < 5) {
      alert("Please enter a valid phone number");
      return;
    }

    setStatus('submitting-phone');

    try {
      const headers: Record<string, string> = {
        'Content-Type': "application/json",
        'X-Channel-Id': "telegram",
        'X-Timestamp': new Date().toISOString(),
        'X-App-Version': "1.0.0",
      };
      if (initDataRawString) headers['X-Telegram-Init'] = initDataRawString;

      // --- Step 2: Share Contact ---
      const contactPayload: ShareContactPayload = {
        phone_number: phoneNumber,
        telegram_id: currentUser.id
      };

      const contactRes = await fetch(`${BACKEND_URL}/api/v1/customers/share-contact`, {
        method: 'POST',
        headers,
        body: JSON.stringify(contactPayload),
      });

      if (!contactRes.ok) {
        const errorData = await contactRes.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to save contact.");
      }

      // --- Step 3: Start Device Session ---
      setStatus('starting-session');

      // Gather device info (Client side)
      const deviceInfo = await getDeviceInfo();

      const sessionPayload: DeviceSessionPayload = {
        device_info: deviceInfo,
        phone_number: phoneNumber,
        telegram_id: currentUser.id.toString()
      };

      const sessionRes = await fetch(`${BACKEND_URL}/api/v1/device-session-start`, {
        method: 'POST',
        headers,
        body: JSON.stringify(sessionPayload),
      });

      if (!sessionRes.ok) {
        const errorData = await sessionRes.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to start device session.");
      }

      // Success
      setStatus('completed');

    } catch (err: any) {
      console.error("Submission failed:", err);
      setErrorMessage(err.message || "Failed to complete registration.");
      setStatus('error');
    }
  };


  // --- UI RENDERERS ---

  if (status === 'invalid-environment') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-6 text-center">
        <div className="bg-yellow-100 p-4 rounded-full mb-4">
          <span className="text-2xl">⚠️</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Unsupported Environment</h2>
        <p className="text-gray-600 mb-6 max-w-xs mx-auto">Please open this app inside Telegram.</p>
        {debugDetails?.user && <p className="text-xs text-gray-400">User detected but context invalid.</p>}
      </div>
    );
  }

  // Loading States
  if (['checking', 'submitting-phone', 'starting-session'].includes(status)) {
    let text = 'Loading...';
    if (status === 'checking') text = 'Verifying Account...';
    if (status === 'submitting-phone') text = 'Saving Contact Info...';
    if (status === 'starting-session') text = 'Initializing Secure Session...';

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-800">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-medium animate-pulse">{text}</p>
        {status === 'starting-session' && <p className="text-xs text-gray-400 mt-2">Configuring device security...</p>}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-red-50 p-6 text-center">
        <div className="bg-red-100 p-4 rounded-full mb-4"><span className="text-2xl">❌</span></div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Connection Failed</h2>
        <p className="text-gray-600 mb-6 max-w-xs mx-auto break-words">{errorMessage}</p>
        <button onClick={() => window.location.reload()} className="bg-blue-600 text-white font-semibold py-2 px-6 rounded-lg">Retry</button>
      </div>
    );
  }

  // SCREEN: ID Verified
  if (status === 'id-verified') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6 animate-in fade-in duration-300">
        <div className="bg-green-100 p-6 rounded-full mb-6">
            <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">ID Verified Successfully</h1>
        <p className="text-gray-500 text-center mb-8 max-w-xs">
          Your Telegram identity has been confirmed. Please continue to set up your contact details.
        </p>
        <button
            onClick={handleContinue}
            className="w-full max-w-sm bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transition-transform active:scale-95"
        >
            Continue
        </button>
      </div>
    );
  }

  // SCREEN: Phone Entry
  if (status === 'phone-entry') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6 animate-in slide-in-from-right duration-300">
        <div className="w-full max-w-sm">
            <div className="text-center mb-8">
                <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">📱</span>
                </div>
                <h1 className="text-2xl font-bold text-gray-900">Share Contact</h1>
                <p className="text-gray-500 mt-2">Enter your phone number to complete registration.</p>
            </div>

            <form onSubmit={handlePhoneSubmit} className="space-y-4">
                <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                    <input
                        id="phone"
                        type="tel"
                        placeholder="+254..."
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-gray-900"
                        required
                        autoFocus
                    />
                </div>
                <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transition-transform active:scale-95"
                >
                    Submit & Start Session
                </button>
            </form>
        </div>
      </div>
    );
  }

  // SCREEN: Completed
  if (status === 'completed') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-green-50 text-center p-6">
        <div className="bg-green-100 p-4 rounded-full mb-4 animate-bounce">
            <span className="text-4xl">✅</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">All Set!</h1>
        <p className="text-gray-600 mt-2">Your secure session is active.</p>
        <button 
            onClick={() => alert("Redirect to dashboard")} // Replace with router.push('/dashboard')
            className="mt-8 bg-green-600 text-white px-8 py-3 rounded-full font-semibold shadow-lg"
        >
            Enter Dashboard
        </button>
      </div>
    );
  }

  return null;
}