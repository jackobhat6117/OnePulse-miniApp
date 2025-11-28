'use client';

import { useEffect, useState, useRef } from 'react';
import { retrieveLaunchParams } from '@telegram-apps/sdk-react';
import { RegistrationPayload } from '@/types/user';

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

// New Payload Interface
interface ShareContactPayload {
  phone_number: string;
  telegram_id: number;
}

type AppStatus = 
  | 'idle' 
  | 'checking'            // Verifying Telegram ID
  | 'phone-entry'         // ID Verified, asking for Phone
  | 'submitting-phone'    // Sending Phone to Backend
  | 'completed'           // All done
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
  const [phoneNumber, setPhoneNumber] = useState('');
  const [currentUser, setCurrentUser] = useState<TelegramUser | null>(null);
  const [initDataRawString, setInitDataRawString] = useState<string | undefined>(undefined);
 


  const hasChecked = useRef(false);

  // 1. INITIAL CHECK (Existing logic)
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
        // --- (Same Data Retrieval Logic as before) ---
        let initData: any;
        let initDataRaw: string | undefined;
        try {
          const params = retrieveLaunchParams();
          initData = params.initData;
          initDataRaw = typeof params.initDataRaw === 'string' ? params.initDataRaw : undefined;
        } catch (e) {
          throw new Error("Could not retrieve Telegram data. Open inside Telegram.");
        }

        let tgUser = initData?.user as TelegramUser | undefined;
        let initSource: DebugDetails['initDataSource'] = tgUser ? 'sdk' : undefined;

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

        // Store user for the next step
        setCurrentUser(tgUser);
        setInitDataRawString(initDataRaw);

        // --- Step 1: Verify/Register Telegram ID ---
        const payload: RegistrationPayload = {
          allowed_financial_actions: ["ALL"],
          customer_profile: { avatar: "" },
          first_name: tgUser.firstName.replace(/[^a-zA-Z]/g, '') || 'User',
          is_bot_user: true,
          is_premium: tgUser.isPremium || false,
          kyc_status: "PENDING",
          language_code: tgUser.languageCode || "en",
          last_name: tgUser.lastName || "",
          phone_number: "", // Intentionally empty for first step
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
            throw new Error(errorData.message || `Server error: ${response.statusText}`);
        }

        // --- SUCCESS: Move to Phone Entry Step ---
        console.log("Telegram ID Verified. Moving to Phone Entry.");
        setStatus('phone-entry');

      } catch (err: any) {
        console.error("Initial check failed:", err);
        setErrorMessage(err.message || "Unknown error occurred");
        setStatus('error');
      }
    };

    performCheck();
  }, []);


  // 2. SUBMIT PHONE NUMBER (New Logic)
  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentUser || !phoneNumber) return;
    
    // Basic validation
    if (phoneNumber.length < 5) {
      alert("Please enter a valid phone number");
      return;
    }

    setStatus('submitting-phone');

    try {
      const payload: ShareContactPayload = {
        phone_number: phoneNumber,
        telegram_id: currentUser.id
      };

      console.log("Submitting Phone Payload:", payload);

      const headers: Record<string, string> = {
        'Content-Type': "application/json",
        'X-Channel-Id': "telegram",
        'X-Timestamp': new Date().toISOString(),
        'X-App-Version': "1.0.0",
      };
      if (initDataRawString) headers['X-Telegram-Init'] = initDataRawString;

      const response = await fetch(`${BACKEND_URL}/api/v1/customers/share-contact`, {
        method: 'POST', 
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Phone submission failed: ${response.statusText}`);
      }

      const responseData = await response.json();
      console.log("Phone Registration Success:", responseData);
      
      setStatus('completed');

    } catch (err: any) {
      console.error("Phone submission failed:", err);
      setErrorMessage(err.message || "Failed to save phone number");
      setStatus('error');
    }
  };


  // --- UI RENDERING ---

  // 1. Unsupported Environment
  if (status === 'invalid-environment') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-6 text-center">
        <div className="bg-yellow-100 p-4 rounded-full mb-4">
          <span className="text-2xl">⚠️</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Unsupported Environment</h2>
        <p className="text-gray-600 mb-6 max-w-xs mx-auto">
          Please open this inside the Telegram App.
        </p>
      </div>
    );
  }

  // 2. Loading State (Checking ID or Submitting Phone)
  if (status === 'checking' || status === 'submitting-phone') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-800">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-medium animate-pulse">
            {status === 'checking' ? 'Verifying Account...' : 'Saving Contact Info...'}
        </p>
      </div>
    );
  }

  // 3. Error State
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-red-50 p-6 text-center">
        <div className="bg-red-100 p-4 rounded-full mb-4">
            <span className="text-2xl">❌</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h2>
        <p className="text-gray-600 mb-6 max-w-xs mx-auto">{errorMessage}</p>
        <button 
          onClick={() => window.location.reload()} 
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // 4. PHONE ENTRY STEP (After 'registered' becomes true)
  if (status === 'phone-entry') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6">
        <div className="w-full max-w-sm">
            <div className="text-center mb-8">
                <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">📱</span>
                </div>
                <h1 className="text-2xl font-bold text-gray-900">Next Step</h1>
                <p className="text-gray-500 mt-2">
                    Please provide your phone number to complete the registration.
                </p>
            </div>

            <form onSubmit={handlePhoneSubmit} className="space-y-4">
                <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                        Phone Number
                    </label>
                    <input
                        id="phone"
                        type="tel"
                        placeholder="+251..."
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 placeholder-gray-400"
                        required
                    />
                </div>

                <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transform transition hover:scale-[1.02] active:scale-95"
                >
                    Continue
                </button>
            </form>
            
            <p className="text-xs text-center text-gray-400 mt-6">
                Your number is securely sent to our banking server.
            </p>
        </div>
      </div>
    );
  }

  // 5. Final Success State
  if (status === 'completed') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-green-50 text-center p-6">
        <div className="bg-green-100 p-4 rounded-full mb-4 animate-bounce">
            <span className="text-4xl">✅</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">All Set!</h1>
        <p className="text-gray-600 mt-2">Your registration is complete.</p>
        
        {/* Placeholder for Dashboard Redirect */}
        <button className="mt-8 bg-green-600 text-white px-8 py-3 rounded-full font-semibold shadow-lg">
            Go to Dashboard
        </button>
      </div>
    );
  }

  return null;
}