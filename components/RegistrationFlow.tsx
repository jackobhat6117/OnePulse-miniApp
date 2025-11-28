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

// API Payloads
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

interface ShareContactPayload {
  phone_number: string;
  telegram_id: number;
}

interface DeviceSessionPayload {
  device_info: DeviceInfoPayload;
  phone_number: string;
  telegram_id: string;
}

interface SimVerifyPayload {
  device_fingerprint: string;
  phone_number: string;
  telegram_id: string;
}

interface VerifyCodePayload {
  activation_code: string;
  phone_number: string;
  telegram_id: string;
}

interface ResendCodePayload {
  phone_number: string;
  telegram_id: string;
}

interface VerifyCustomerPayload {
  account_number: string;
  device_id: string;
  phone_number: string;
  telegram_id: string;
}

// App Flow Status
type AppStatus = 
  | 'idle' 
  | 'checking'            // 1. Verifying Telegram ID
  | 'id-verified'         // 2. Success screen for ID (Wait for Continue)
  | 'phone-entry'         // 3. User enters phone
  | 'processing-registration' // 4. Combined Loading: Share Contact -> Device Session -> SIM Verify
  | 'otp-entry'           // 5. User enters OTP
  | 'verifying-otp'       // 6. Validating OTP
  | 'account-entry'       // 7. User enters Account Number
  | 'verifying-customer'  // 8. Validating Account
  | 'completed'           // 9. All done
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
  } catch (error) {}
  return undefined;
};

// --- MAIN COMPONENT ---

export default function RegistrationFlow() {
  const [status, setStatus] = useState<AppStatus>('idle');
  const [loadingMessage, setLoadingMessage] = useState('Processing...');
  const [errorMessage, setErrorMessage] = useState('');
  const [debugDetails, setDebugDetails] = useState<DebugDetails | null>(null);
  
  // Data States
  const [phoneNumber, setPhoneNumber] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  
  const [currentUser, setCurrentUser] = useState<TelegramUser | null>(null);
  const [initDataRawString, setInitDataRawString] = useState<string | undefined>(undefined);
  const [cachedDeviceInfo, setCachedDeviceInfo] = useState<DeviceInfoPayload | null>(null);

  const hasChecked = useRef(false);

  // --- FETCH WRAPPER ---
  const authenticatedFetch = async (url: string, payload: any) => {
    const headers: Record<string, string> = {
      'Content-Type': "application/json",
      'X-Channel-Id': "telegram",
      'X-Timestamp': new Date().toISOString(),
      'X-App-Version': "1.0.0",
    };
    if (initDataRawString) headers['X-Telegram-Init'] = initDataRawString;

    const response = await fetch(`${BACKEND_URL}${url}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Request failed: ${response.statusText}`);
    }
    return await response.json();
  };

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
      setLoadingMessage('Verifying Account...');
      try {
        // --- Retrieve Telegram Data ---
        let initData: any;
        let initDataRaw: string | undefined;
        try {
          const params = retrieveLaunchParams();
          initData = params.initData;
          initDataRaw = typeof params.initDataRaw === 'string' ? params.initDataRaw : undefined;
        } catch (e) { /* Ignore SDK error, use fallback */ }

        let tgUser = initData?.user as TelegramUser | undefined;
        let initSource: DebugDetails['initDataSource'] = tgUser ? 'sdk' : undefined;

        if (typeof window !== 'undefined') {
          const webApp = (window as any).Telegram?.WebApp;
          const unsafeUser = webApp?.initDataUnsafe?.user as UnsafeTelegramUser;
          if (!tgUser && unsafeUser) {
             tgUser = mapUnsafeUser(unsafeUser);
             initSource = 'unsafe';
          }
          initDataRaw = initDataRaw ?? webApp?.initData;

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

        setCurrentUser(tgUser);
        setInitDataRawString(initDataRaw);

        // --- Step 1: Check ID ---
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

        await authenticatedFetch('/api/v1/customers/checkTelegramID', payload);
        
        // Success -> Show ID Verified Screen
        setStatus('id-verified');

      } catch (err: any) {
        console.error("Initialization failed:", err);
        setErrorMessage(err.message || "Unknown error occurred");
        setStatus('error');
      }
    };

    performCheck();
  }, []);

  // Handler: Move from ID Verified -> Phone Entry
  const handleContinueToPhone = () => {
    setStatus('phone-entry');
  };

  // Handler: Submit Phone (Runs 3 APIs in sequence)
  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !phoneNumber) return;
    if (phoneNumber.length < 5) { alert("Invalid phone"); return; }

    setStatus('processing-registration');
    
    try {
      // 1. Share Contact
      setLoadingMessage('Saving Contact Info...');
      const contactPayload: ShareContactPayload = {
        phone_number: phoneNumber,
        telegram_id: currentUser.id
      };
      await authenticatedFetch('/api/v1/customers/share-contact', contactPayload);

      // 2. Start Session
      setLoadingMessage('Initializing Secure Session...');
      const deviceInfo = await getDeviceInfo();
      setCachedDeviceInfo(deviceInfo); // Cache for step 4

      const sessionPayload: DeviceSessionPayload = {
        device_info: deviceInfo,
        phone_number: phoneNumber,
        telegram_id: currentUser.id.toString()
      };
      await authenticatedFetch('/api/v1/device-session-start', sessionPayload);

      // 3. SIM Verify
      setLoadingMessage('Verifying Device Security...');
      const simPayload: SimVerifyPayload = {
        device_fingerprint: deviceInfo.fingerprint,
        phone_number: phoneNumber,
        telegram_id: currentUser.id.toString()
      };
      await authenticatedFetch('/api/v1/SIM-Verify', simPayload);

      // All background checks passed -> Go to OTP
      setStatus('otp-entry');

    } catch (err: any) {
      console.error("Registration flow failed:", err);
      setErrorMessage(err.message);
      setStatus('error');
    }
  };

  // Handler: Verify OTP
  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    setStatus('verifying-otp');
    setLoadingMessage('Verifying Code...');
    try {
      const payload: VerifyCodePayload = {
        activation_code: activationCode,
        phone_number: phoneNumber,
        telegram_id: currentUser.id.toString()
      };
      await authenticatedFetch('/api/v1/verifyCode', payload);
      
      // Success -> Go to Account Linking
      setStatus('account-entry');
    } catch (err: any) {
      setErrorMessage(err.message);
      setStatus('error');
    }
  };

  const handleResendCode = async () => {
    if (!currentUser) return;
    try {
      const payload: ResendCodePayload = {
        phone_number: phoneNumber,
        telegram_id: currentUser.id.toString()
      };
      await authenticatedFetch('/api/v1/resendCode', payload);
      alert("Code resent successfully!");
    } catch (err: any) {
      alert("Failed to resend code: " + err.message);
    }
  };

  // Handler: Verify Customer (Account Linking)
  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !cachedDeviceInfo) return;

    setStatus('verifying-customer');
    setLoadingMessage('Linking Bank Account...');
    try {
      const payload: VerifyCustomerPayload = {
        account_number: accountNumber,
        device_id: cachedDeviceInfo.device_id,
        phone_number: phoneNumber,
        telegram_id: currentUser.id.toString()
      };
      await authenticatedFetch('/api/v1/verifyCustomer', payload);

      // Success -> Final Screen
      setStatus('completed');
    } catch (err: any) {
      setErrorMessage(err.message);
      setStatus('error');
    }
  };


  // --- UI RENDERERS ---

  // 1. Invalid Environment (Original UI restored)
  if (status === 'invalid-environment') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-6 text-center">
        <div className="bg-yellow-100 p-4 rounded-full mb-4">
          <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Unsupported Environment</h2>
        <p className="text-gray-600 mb-6 max-w-xs mx-auto">
          Please open this inside the Telegram App.
        </p>
        {debugDetails && (
          <div className="mt-4 text-xs text-left text-gray-500 bg-gray-100 rounded-md p-4 w-full max-w-sm overflow-hidden">
             <p>Source: {debugDetails.initDataSource ?? 'none'}</p>
             <p>User: {debugDetails.user ? 'Detected' : 'Missing'}</p>
          </div>
        )}
      </div>
    );
  }

  // 2. Loading State (Shared)
  if (['checking', 'processing-registration', 'verifying-otp', 'verifying-customer'].includes(status)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-800">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-medium animate-pulse">{loadingMessage}</p>
      </div>
    );
  }

  // 3. Error State (Original UI restored)
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-red-50 p-6 text-center">
        <div className="bg-red-100 p-4 rounded-full mb-4">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Connection Failed</h2>
        <p className="text-gray-600 mb-6 max-w-xs mx-auto break-words">{errorMessage}</p>
        <button 
          onClick={() => window.location.reload()} 
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // 4. ID Verified Screen (Clean UI)
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
          Your Telegram identity has been confirmed.
        </p>

        <button
            onClick={handleContinueToPhone}
            className="w-full max-w-sm bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transform transition hover:scale-[1.02] active:scale-95"
        >
            Continue
        </button>
      </div>
    );
  }

  // 5. Phone Entry Screen
  if (status === 'phone-entry') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6 animate-in slide-in-from-right duration-300">
        <div className="w-full max-w-sm">
            <div className="text-center mb-8">
                <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">📱</span>
                </div>
                <h1 className="text-2xl font-bold text-gray-900">Share Contact</h1>
                <p className="text-gray-500 mt-2">
                    Enter your phone number to complete registration.
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
                        placeholder="+254..."
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                        required
                        autoFocus
                    />
                </div>

                <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transform transition hover:scale-[1.02] active:scale-95"
                >
                    Next
                </button>
            </form>
        </div>
      </div>
    );
  }

  // 6. OTP Entry Screen
  if (status === 'otp-entry') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6 animate-in slide-in-from-right duration-300">
        <div className="w-full max-w-sm">
            <div className="text-center mb-8">
                <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">🔐</span>
                </div>
                <h1 className="text-2xl font-bold text-gray-900">Enter Code</h1>
                <p className="text-gray-500 mt-2">
                    We sent an activation code to <br/><span className="font-semibold text-gray-800">{phoneNumber}</span>
                </p>
            </div>

            <form onSubmit={handleOtpSubmit} className="space-y-6">
                <input
                    type="text"
                    placeholder="000000"
                    value={activationCode}
                    onChange={(e) => setActivationCode(e.target.value)}
                    className="w-full px-4 py-4 text-center text-2xl tracking-widest rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-gray-900"
                    maxLength={6}
                    required
                    autoFocus
                />

                <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transform transition hover:scale-[1.02] active:scale-95"
                >
                    Verify
                </button>
            </form>
            
            <button 
                onClick={handleResendCode}
                className="w-full mt-6 text-sm text-blue-600 font-semibold hover:underline"
            >
                Resend Code
            </button>
        </div>
      </div>
    );
  }

  // 7. Account Entry Screen
  if (status === 'account-entry') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6 animate-in slide-in-from-right duration-300">
        <div className="w-full max-w-sm">
            <div className="text-center mb-8">
                <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">🏦</span>
                </div>
                <h1 className="text-2xl font-bold text-gray-900">Link Bank Account</h1>
                <p className="text-gray-500 mt-2">
                    Enter your account number to finalize the setup.
                </p>
            </div>

            <form onSubmit={handleAccountSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Account Number
                    </label>
                    <input
                        type="text"
                        placeholder="e.g. 1000..."
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-gray-900"
                        required
                        autoFocus
                    />
                </div>

                <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transform transition hover:scale-[1.02] active:scale-95"
                >
                    Link Account
                </button>
            </form>
        </div>
      </div>
    );
  }

  // 8. Completed Screen
  if (status === 'completed') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-green-50 text-center p-6">
        <div className="bg-green-100 p-4 rounded-full mb-4 animate-bounce">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">All Set!</h1>
        <p className="text-gray-600 mt-2">Your secure session is active.</p>
        
        <button className="mt-8 bg-green-600 text-white px-8 py-3 rounded-full font-semibold shadow-lg">
            Go to Dashboard
        </button>
      </div>
    );
  }

  return null;
}