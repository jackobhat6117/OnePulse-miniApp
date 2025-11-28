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

// --- PAYLOAD INTERFACES ---

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

// 1. SIM Verify Payload
interface SimVerifyPayload {
  device_fingerprint: string;
  phone_number: string;
  telegram_id: string; // Using string to be safe, matches your example "7082..."
}

// 2. Verify Code Payload
interface VerifyCodePayload {
  activation_code: string;
  phone_number: string; // Corrected from "phone_numbe"
  telegram_id: string;
}

// 3. Resend Code Payload
interface ResendCodePayload {
  phone_number: string;
  telegram_id: string;
}

// 4. Verify Customer Payload
interface VerifyCustomerPayload {
  account_number: string;
  device_id: string;
  phone_number: string;
  telegram_id: string;
}

// --- APP STATUS ---

type AppStatus = 
  | 'idle' 
  | 'checking'            // 1. Verifying Telegram ID
  | 'id-verified'         // 2. Success screen for ID
  | 'phone-entry'         // 3. User enters phone
  | 'submitting-phone'    // 4. Sending phone + starting session
  | 'starting-session'    // 5. Sending device info
  | 'sim-verifying'       // 6. NEW: Verifying SIM (Automatic)
  | 'otp-entry'           // 7. NEW: User enters OTP
  | 'verifying-otp'       // 8. NEW: Validating OTP
  | 'account-entry'       // 9. NEW: User enters Account Number
  | 'verifying-customer'  // 10. NEW: Validating Account
  | 'completed'           // 11. All done
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

// --- HELPERS (Parsers) ---
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
  const [errorMessage, setErrorMessage] = useState('');
  const [debugDetails, setDebugDetails] = useState<DebugDetails | null>(null);
  
  // Data States
  const [phoneNumber, setPhoneNumber] = useState('');
  const [currentUser, setCurrentUser] = useState<TelegramUser | null>(null);
  const [initDataRawString, setInitDataRawString] = useState<string | undefined>(undefined);
  
  // New Data States
  const [activationCode, setActivationCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [cachedDeviceInfo, setCachedDeviceInfo] = useState<DeviceInfoPayload | null>(null);

  const hasChecked = useRef(false);

  // --- HELPER: GENERIC FETCH WRAPPER ---
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


  // 1. INITIAL MOUNT (ID Verification)
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
        let initData: any;
        let initDataRaw: string | undefined;
        try {
          const params = retrieveLaunchParams();
          initData = params.initData;
          initDataRaw = typeof params.initDataRaw === 'string' ? params.initDataRaw : undefined;
        } catch (e) { console.warn("SDK retrieve failed"); }

        let tgUser = initData?.user as TelegramUser | undefined;
        // ... (Parsing logic same as before) ...
        // [Condensed for brevity - assume tgUser logic from previous steps is here]
        
        // --- Mocking parsing logic for this snippet ---
        if (typeof window !== 'undefined' && !tgUser) {
           const webApp = (window as any).Telegram?.WebApp;
           const unsafeUser = webApp?.initDataUnsafe?.user;
           if(unsafeUser) tgUser = mapUnsafeUser(unsafeUser);
           initDataRaw = initDataRaw ?? webApp?.initData;
        }
        
        if (!tgUser) {
           // Try URL fallback
           const urlInitData = getInitDataFromUrl();
           const parsed = parseUserFromInitDataString(urlInitData);
           if(parsed) tgUser = parsed;
           initDataRaw = initDataRaw ?? urlInitData;
        }

        if (!tgUser) {
          setStatus('invalid-environment');
          return;
        }

        setCurrentUser(tgUser);
        setInitDataRawString(initDataRaw);

        // Step 1: Check ID
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
        
        setStatus('id-verified');

      } catch (err: any) {
        console.error("Initialization failed:", err);
        setErrorMessage(err.message || "Unknown error occurred");
        setStatus('error');
      }
    };

    performCheck();
  }, []);


  // --- HANDLERS ---

  const handleStartRegistration = () => setStatus('phone-entry');

  // STEP 2 & 3 & 4: Submit Phone -> Share Contact -> Session -> SIM Verify
  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !phoneNumber) return;
    
    if (phoneNumber.length < 5) { alert("Invalid phone"); return; }

    try {
      // 1. Share Contact
      setStatus('submitting-phone');
      const contactPayload: ShareContactPayload = {
        phone_number: phoneNumber,
        telegram_id: currentUser.id
      };
      await authenticatedFetch('/api/v1/customers/share-contact', contactPayload);

      // 2. Start Session (Collect Device Info)
      setStatus('starting-session');
      const deviceInfo = await getDeviceInfo();
      setCachedDeviceInfo(deviceInfo); // Store for later steps

      const sessionPayload: DeviceSessionPayload = {
        device_info: deviceInfo,
        phone_number: phoneNumber,
        telegram_id: currentUser.id.toString()
      };
      await authenticatedFetch('/api/v1/device-session-start', sessionPayload);

      // 3. SIM Verification (Automatic)
      setStatus('sim-verifying');
      const simPayload: SimVerifyPayload = {
        device_fingerprint: deviceInfo.fingerprint,
        phone_number: phoneNumber,
        telegram_id: currentUser.id.toString()
      };
      await authenticatedFetch('/api/v1/SIM-Verify', simPayload);

      // If SIM verify passes, we assume OTP is sent. Move to OTP screen.
      setStatus('otp-entry');

    } catch (err: any) {
      console.error("Flow failed:", err);
      setErrorMessage(err.message);
      setStatus('error');
    }
  };

  // STEP 5: Verify Code
  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    setStatus('verifying-otp');
    try {
      const payload: VerifyCodePayload = {
        activation_code: activationCode,
        phone_number: phoneNumber,
        telegram_id: currentUser.id.toString()
      };
      await authenticatedFetch('/api/v1/verifyCode', payload);
      
      // If code verified, move to Account Entry
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

  // STEP 6: Verify Customer (Account Linking)
  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !cachedDeviceInfo) return;

    setStatus('verifying-customer');
    try {
      const payload: VerifyCustomerPayload = {
        account_number: accountNumber,
        device_id: cachedDeviceInfo.device_id, // From cached device info
        phone_number: phoneNumber,
        telegram_id: currentUser.id.toString()
      };
      await authenticatedFetch('/api/v1/verifyCustomer', payload);

      // Success!
      setStatus('completed');
    } catch (err: any) {
      setErrorMessage(err.message);
      setStatus('error');
    }
  };

  // --- UI RENDERERS ---

  if (status === 'invalid-environment') {
    return <div className="p-6 text-center text-gray-600 bg-gray-50 h-screen flex flex-col items-center justify-center">Please open in Telegram.</div>;
  }

  // Generic Loading Screen
  if (['checking', 'submitting-phone', 'starting-session', 'sim-verifying', 'verifying-otp', 'verifying-customer'].includes(status)) {
    let text = 'Processing...';
    if (status === 'checking') text = 'Verifying ID...';
    if (status === 'submitting-phone') text = 'Saving Contact...';
    if (status === 'starting-session') text = 'Initializing Session...';
    if (status === 'sim-verifying') text = 'Verifying SIM...';
    if (status === 'verifying-otp') text = 'Checking Code...';
    if (status === 'verifying-customer') text = 'Linking Account...';

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-800">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-medium animate-pulse">{text}</p>
      </div>
    );
  }

  // Generic Error Screen
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-red-50 p-6 text-center">
        <div className="bg-red-100 p-4 rounded-full mb-4"><span className="text-2xl">❌</span></div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Error</h2>
        <p className="text-gray-600 mb-6">{errorMessage}</p>
        <button onClick={() => window.location.reload()} className="bg-blue-600 text-white font-semibold py-2 px-6 rounded-lg">Retry</button>
      </div>
    );
  }

  // 1. ID Verified Screen
  if (status === 'id-verified') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6 animate-in fade-in">
        <div className="bg-green-100 p-6 rounded-full mb-6 text-green-600 text-4xl">✓</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">ID Verified</h1>
        <p className="text-gray-500 text-center mb-8">Your Telegram identity is confirmed.</p>
        <button onClick={handleStartRegistration} className="w-full bg-blue-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg">Continue</button>
      </div>
    );
  }

  // 2. Phone Entry Screen
  if (status === 'phone-entry') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6 animate-in slide-in-from-right">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">Your Number</h1>
          <p className="text-gray-500 text-center mb-6">Enter your phone number to begin.</p>
          <form onSubmit={handlePhoneSubmit} className="space-y-4">
            <input type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="+254..." required />
            <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg">Next</button>
          </form>
        </div>
      </div>
    );
  }

  // 3. OTP Entry Screen
  if (status === 'otp-entry') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6 animate-in slide-in-from-right">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">Enter Code</h1>
          <p className="text-gray-500 text-center mb-6">We sent an activation code to {phoneNumber}</p>
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <input 
              type="text" 
              value={activationCode} 
              onChange={(e) => setActivationCode(e.target.value)} 
              className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none text-center text-2xl tracking-widest" 
              placeholder="000000" 
              maxLength={6}
              required 
            />
            <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg">Verify</button>
          </form>
          <button onClick={handleResendCode} className="mt-4 text-blue-600 text-sm font-semibold w-full text-center">Resend Code</button>
        </div>
      </div>
    );
  }

  // 4. Account Entry Screen
  if (status === 'account-entry') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6 animate-in slide-in-from-right">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">Link Account</h1>
          <p className="text-gray-500 text-center mb-6">Enter your bank account number to verify ownership.</p>
          <form onSubmit={handleAccountSubmit} className="space-y-4">
            <input 
              type="text" 
              value={accountNumber} 
              onChange={(e) => setAccountNumber(e.target.value)} 
              className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" 
              placeholder="Account Number" 
              required 
            />
            <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg">Verify Account</button>
          </form>
        </div>
      </div>
    );
  }

  // 5. Completion Screen
  if (status === 'completed') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-green-50 text-center p-6">
        <div className="bg-green-100 p-4 rounded-full mb-4 animate-bounce"><span className="text-4xl">✅</span></div>
        <h1 className="text-2xl font-bold text-gray-900">Registration Complete</h1>
        <p className="text-gray-600 mt-2">Your device and account are fully verified.</p>
        <button className="mt-8 bg-green-600 text-white px-8 py-3 rounded-full font-semibold shadow-lg">Enter Dashboard</button>
      </div>
    );
  }

  return null;
}