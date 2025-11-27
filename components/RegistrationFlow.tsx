'use client';

import { useEffect, useState, useRef } from 'react';
import { retrieveLaunchParams } from '@telegram-apps/sdk-react';
import { RegistrationPayload } from '@/types/user';

// 1. DEFINE THE INTERFACE MANUALLY
// This tells TypeScript exactly what to expect from the Telegram User object.
interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  photoUrl?: string;
  isPremium?: boolean;
}

// Replace with your actual endpoint
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

type UnsafeTelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
} | undefined;

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

export default function RegistrationFlow() {
  const [status, setStatus] = useState<'idle' | 'checking' | 'registered' | 'error' | 'invalid-environment'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  
  // Ref to prevent double-execution in React Strict Mode
  const hasChecked = useRef(false);

  useEffect(() => {
    if (!BACKEND_URL) {
      setStatus('error');
      setErrorMessage('The application is not configured correctly. Please contact support.');
      return;
    }

    if (hasChecked.current) return;
    hasChecked.current = true;

    const performRegistration = async () => {
      
      setStatus('checking');
      try {
        // 1. Safely retrieve Telegram Data
        let initData: any;
        let initDataRaw: string | undefined;
        try {
          console.log("Attempting to retrieve launch parameters...");
          const params = retrieveLaunchParams();
          console.log("Launch parameters received:", params);
          initData = params.initData;
          initDataRaw = typeof params.initDataRaw === 'string' ? params.initDataRaw : undefined;
          console.log("initData object:", initData);
        } catch (e) {
          console.error("Error retrieving launch parameters:", e);
          throw new Error("Could not retrieve Telegram data. Please open this inside Telegram.");
        }

        // Prefer user from initData (SDK), but gracefully fall back to Telegram WebApp global
        let tgUser = initData?.user as TelegramUser | undefined;

        // Fallback: use window.Telegram.WebApp data or tgWebAppData URL param
        if (typeof window !== 'undefined') {
          const webApp = (window as any).Telegram?.WebApp;
          const unsafeUser = webApp?.initDataUnsafe?.user as UnsafeTelegramUser;
          console.log("Fallback initDataUnsafe.user:", unsafeUser);
          tgUser = tgUser ?? mapUnsafeUser(unsafeUser);
          initDataRaw = initDataRaw ?? webApp?.initData;

          if (!tgUser) {
            const urlInitData = getInitDataFromUrl();
            console.log("Parsing tgWebAppData from URL:", urlInitData);
            tgUser = parseUserFromInitDataString(urlInitData);
            initDataRaw = initDataRaw ?? urlInitData;
          }
        }

        console.log("Resolved Telegram user:", tgUser);

        if (!tgUser) {
           setStatus('invalid-environment');
           return;
        }

       
        const payload: RegistrationPayload = {
          allowed_financial_actions: ["ALL"],
          customer_profile: {
            avatar: tgUser.photoUrl || "" 
          },
          first_name: tgUser.firstName,
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

        console.log("Sending Payload:", payload);

        // 3. Send to Backend
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Channel-Id': 'telegram',
          'X-Timestamp': new Date().toISOString(),
          'X-App-Version': '1.0.0',
        };

        if (initDataRaw) {
          headers['X-Telegram-Init'] = initDataRaw;
        }

        const response = await fetch(BACKEND_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          // Try to parse error message from backend, fallback to status text
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `Server error: ${response.statusText}`);
        }

        const responseData = await response.json();
        console.log("Registration Success:", responseData);
        
        // Success State
        setStatus('registered');

      } catch (err: any) {
        console.error("Registration failed:", err);
        setErrorMessage(err.message || "Unknown error occurred");
        setStatus('error');
      }
    };

    performRegistration();
  }, []);

  // --- UI STATES ---

  if (status === 'invalid-environment') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-6 text-center">
        <div className="bg-yellow-100 p-4 rounded-full mb-4">
          <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Unsupported Environment</h2>
        <p className="text-gray-600 mb-6 max-w-xs mx-auto">
          This application is designed to be used inside the Telegram app. Please open it from your Telegram bot.
        </p>
      </div>
    );
  }

  if (status === 'checking') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-800">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-medium animate-pulse">Verifying Account...</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-red-50 p-6 text-center">
        <div className="bg-red-100 p-4 rounded-full mb-4">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Connection Failed</h2>
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

  if (status === 'registered') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-green-50 text-center p-6">
        <div className="bg-green-100 p-4 rounded-full mb-4">
          <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Welcome!</h1>
        <p className="text-gray-600 mt-2">Your account has been verified.</p>
        {/* You can auto-redirect here using router.push('/dashboard') */}
      </div>
    );
  }

  return null; // Idle state (rarely visible due to useEffect)
}