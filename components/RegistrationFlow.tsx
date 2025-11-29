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

interface ProductValidationPayload {
  channel: string;
  customer_group: string;
  product_code: string;
  tier_group: string;
}

interface OnePulseRegistrationPayload {
  account_number: string;
  customer_id: string;
  device_id: string;
  phone_number: string;
  pin: string;
  session_id: string;
  telegram_id: string;
}

// --- APP STATUS ---

type AppStatus = 
  | 'idle' 
  | 'checking'            // 1. Verifying Telegram ID
  | 'id-verified'         // 2. Success screen for ID
  | 'phone-entry'         // 3. User enters phone
  | 'processing-registration' // 4. Loading: Share Contact -> Device Session -> SIM Verify
  | 'otp-entry'           // 5. User enters OTP
  | 'verifying-otp'       // 6. Loading: Validating OTP
  | 'account-entry'       // 7. User enters Account Number
  | 'processing-customer' // 8. Loading: Verify Customer -> Product Validation
  | 'pin-setup'           // 9. User enters PIN
  | 'registering-onepulse'// 10. Loading: Final Registration Call
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

// --- UI COMPONENT: HEADER WITH BACK BUTTON ---
const ScreenHeader = ({ title, subtitle, onBack }: { title: string, subtitle?: React.ReactNode, onBack?: () => void }) => (
  <div className="text-center mb-8 relative">
    {onBack && (
      <button 
        onClick={onBack}
        className="absolute left-0 top-1 p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors focus:outline-none"
        type="button"
        aria-label="Go Back"
      >
        {/* Simple Back Arrow SVG */}
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
      </button>
    )}
    <h1 className="text-2xl font-bold text-gray-900 pt-2">{title}</h1>
    {subtitle && <p className="text-gray-500 mt-2 text-sm">{subtitle}</p>}
  </div>
);

// --- MAIN COMPONENT ---

export default function RegistrationFlow() {
  const [status, setStatus] = useState<AppStatus>('idle');
  const [loadingMessage, setLoadingMessage] = useState('Processing...');
  const [errorMessage, setErrorMessage] = useState('');
  const [debugDetails, setDebugDetails] = useState<DebugDetails | null>(null);
  
  // We need to remember where we were if an error happens, so we can retry or go back
  const [lastActiveStatus, setLastActiveStatus] = useState<AppStatus>('idle');

  // Input States
  const [phoneNumber, setPhoneNumber] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [pin, setPin] = useState('');
  
  // Data States
  const [currentUser, setCurrentUser] = useState<TelegramUser | null>(null);
  const [initDataRawString, setInitDataRawString] = useState<string | undefined>(undefined);
  const [cachedDeviceInfo, setCachedDeviceInfo] = useState<DeviceInfoPayload | null>(null);
  
  // Verified Data States (Captured from backend responses)
  const [sessionId, setSessionId] = useState(''); 
  const [customerId, setCustomerId] = useState('');
  const [productCode, setProductCode] = useState('');

  const hasChecked = useRef(false);

  // --- NAVIGATION LOGIC ---

  // 1. General Back Handler (Used in Normal Flow)
  const handleBack = () => {
    switch (status) {
      case 'phone-entry':
        setStatus('id-verified');
        break;
      case 'otp-entry':
        setStatus('phone-entry');
        break;
      case 'account-entry':
        setStatus('phone-entry'); 
        break;
      case 'pin-setup':
        setStatus('account-entry');
        break;
      case 'error':
        // If in error state, handleBack should probably behave like "Cancel/Go Previous"
        handleErrorBack();
        break;
      default:
        console.warn("Back not handled for status:", status);
    }
  };

  // 2. Error Screen "Retry" Handler (Go back to the form you were just on)
  const handleRetry = () => {
    if (lastActiveStatus !== 'idle') {
      setStatus(lastActiveStatus);
    } else {
      window.location.reload();
    }
  };

  // 3. Error Screen "Back" Handler (Go to the step BEFORE the one that failed)
  const handleErrorBack = () => {
    // Determine where to go based on where we failed
    switch (lastActiveStatus) {
      case 'phone-entry':
        setStatus('id-verified');
        break;
      case 'otp-entry':
        setStatus('phone-entry');
        break;
      case 'account-entry':
        setStatus('phone-entry');
        break;
      case 'pin-setup':
        setStatus('account-entry');
        break;
      default:
        // Fallback for initialization errors
        window.location.reload(); 
    }
  };

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
        let initDataRaw: string | undefined;
        try {
          const params = retrieveLaunchParams();
          initDataRaw = typeof params.initDataRaw === 'string' ? params.initDataRaw : undefined;
        } catch (e) { /* Ignore SDK error */ }

        let tgUser = undefined as TelegramUser | undefined;
        let initSource: DebugDetails['initDataSource'];

        if (typeof window !== 'undefined') {
          const webApp = (window as any).Telegram?.WebApp;
          const unsafeUser = webApp?.initDataUnsafe?.user as UnsafeTelegramUser;
          if (unsafeUser) {
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
        setStatus('id-verified');

      } catch (err: any) {
        console.error("Initialization failed:", err);
        setErrorMessage(err.message || "Unknown error occurred");
        setStatus('error');
      }
    };

    performCheck();
  }, []);

  const handleContinueToPhone = () => setStatus('phone-entry');

  // STEP 2: Phone -> Session -> SIM
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
      setCachedDeviceInfo(deviceInfo); 

      const sessionPayload: DeviceSessionPayload = {
        device_info: deviceInfo,
        phone_number: phoneNumber,
        telegram_id: currentUser.id.toString()
      };
      
      const sessionRes = await authenticatedFetch('/api/v1/device-session-start', sessionPayload);
      const newSessionId = sessionRes.data?.session_id || deviceInfo.device_id; 
      setSessionId(newSessionId);

      // 3. SIM Verify
      setLoadingMessage('Verifying Device Security...');
      const simPayload: SimVerifyPayload = {
        device_fingerprint: deviceInfo.fingerprint,
        phone_number: phoneNumber,
        telegram_id: currentUser.id.toString()
      };
      await authenticatedFetch('/api/v1/SIM-Verify', simPayload);

      setStatus('otp-entry');

    } catch (err: any) {
      if (err.message.includes("does not match")) {
        setErrorMessage("Phone number linked to another account.");
      } else {
        setErrorMessage(err.message);
      }
      setLastActiveStatus('phone-entry'); // Save where we were
      setStatus('error');
    }
  };

  // STEP 3: OTP Verification
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
      setStatus('account-entry');
    } catch (err: any) {
      setErrorMessage(err.message);
      setLastActiveStatus('otp-entry'); // Save where we were
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

  // STEP 4: Account Verify -> Product Validation
  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !cachedDeviceInfo) return;

    setStatus('processing-customer');
    setLoadingMessage('Verifying Bank Account...');
    try {
      // 1. Verify Customer
      const customerPayload: VerifyCustomerPayload = {
        account_number: accountNumber,
        device_id: cachedDeviceInfo.device_id,
        phone_number: phoneNumber,
        telegram_id: currentUser.id.toString()
      };
      const customerRes = await authenticatedFetch('/api/v1/verifyCustomer', customerPayload);
      
      const custData = customerRes.data;
      if (!custData || !custData.customer_id || !custData.product_code) {
        throw new Error("Invalid customer data received.");
      }
      
      setCustomerId(custData.customer_id);
      setProductCode(custData.product_code);

      // 2. Product Validation
      setLoadingMessage('Validating Product Eligibility...');
      const productPayload: ProductValidationPayload = {
        channel: "TELEGRAM",
        customer_group: "DEFAULT", // Logic: Default or derived
        product_code: custData.product_code,
        tier_group: "DEFAULT"
      };
      await authenticatedFetch('/api/v1/product-validation', productPayload);

      setStatus('pin-setup');

    } catch (err: any) {
      setErrorMessage(err.message);
      setLastActiveStatus('account-entry'); // Save where we were
      setStatus('error');
    }
  };

  // STEP 5: PIN Setup -> Final Registration
  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !cachedDeviceInfo || !pin) return;
    
    if (pin.length < 4) { alert("PIN must be at least 4 digits"); return; }

    setStatus('registering-onepulse');
    setLoadingMessage('Finalizing Registration...');

    try {
      const payload: OnePulseRegistrationPayload = {
        account_number: accountNumber,
        customer_id: customerId,
        device_id: cachedDeviceInfo.device_id,
        phone_number: phoneNumber,
        pin: pin,
        session_id: sessionId,
        telegram_id: currentUser.id.toString()
      };

      await authenticatedFetch('/api/v1/onepulse-registration', payload);

      setStatus('completed');

    } catch (err: any) {
      setErrorMessage(err.message);
      setLastActiveStatus('pin-setup'); // Save where we were
      setStatus('error');
    }
  };

  // --- UI RENDERERS ---

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

  // Generic Loading
  if (['checking', 'processing-registration', 'verifying-otp', 'processing-customer', 'registering-onepulse'].includes(status)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-800">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-medium animate-pulse">{loadingMessage}</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-red-50 p-6 text-center">
        {/* Error Header with Back Button */}
        <div className="w-full max-w-sm relative">
            <button 
                onClick={handleErrorBack}
                className="absolute left-0 top-0 p-2 text-red-700 hover:bg-red-100 rounded-full transition-colors"
                aria-label="Go Back"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
            </button>
        </div>

        <div className="bg-red-100 p-4 rounded-full mb-4 mt-8">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Connection Failed</h2>
        <p className="text-gray-600 mb-6 break-words max-w-xs mx-auto">{errorMessage}</p>
        
        <button 
          onClick={handleRetry} 
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  // ID Verified
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

  // Phone Entry
  if (status === 'phone-entry') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6 animate-in slide-in-from-right duration-300">
        <div className="w-full max-w-sm">
          <ScreenHeader 
            title="Share Contact" 
            subtitle="Enter your phone number to complete registration."
            onBack={handleBack} 
          />
          <form onSubmit={handlePhoneSubmit} className="space-y-4">
            <input type="tel" placeholder="+254..." value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" required />
            <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg">Next</button>
          </form>
        </div>
      </div>
    );
  }

  // OTP Entry
  if (status === 'otp-entry') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6 animate-in slide-in-from-right duration-300">
        <div className="w-full max-w-sm">
            <ScreenHeader 
                title="Enter Code" 
                subtitle={<>We sent an activation code to <br/><span className="font-semibold text-gray-800">{phoneNumber}</span></>}
                onBack={handleBack} 
            />
            <form onSubmit={handleOtpSubmit} className="space-y-6">
                <input type="text" placeholder="000000" value={activationCode} onChange={(e) => setActivationCode(e.target.value)} className="w-full px-4 py-4 text-center text-2xl tracking-widest rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" maxLength={6} required autoFocus />
                <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg">Verify</button>
            </form>
            <button onClick={handleResendCode} className="w-full mt-6 text-sm text-blue-600 font-semibold hover:underline">Resend Code</button>
        </div>
      </div>
    );
  }

  // Account Entry
  if (status === 'account-entry') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6 animate-in slide-in-from-right duration-300">
        <div className="w-full max-w-sm">
            <ScreenHeader 
                title="Link Bank Account" 
                subtitle="Enter your account number to finalize the setup."
                onBack={handleBack} 
            />
            <form onSubmit={handleAccountSubmit} className="space-y-4">
                <input type="text" placeholder="Account Number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" required autoFocus />
                <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg">Link Account</button>
            </form>
        </div>
      </div>
    );
  }

  // PIN Setup
  if (status === 'pin-setup') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6 animate-in slide-in-from-right duration-300">
        <div className="w-full max-w-sm">
            <ScreenHeader 
                title="Set Your PIN" 
                subtitle="Create a secure 4-digit PIN for your account."
                onBack={handleBack} 
            />
            <form onSubmit={handlePinSubmit} className="space-y-6">
                <input
                    type="password"
                    placeholder="Enter 4-digit PIN"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                    className="w-full px-4 py-4 text-center text-2xl tracking-widest rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none"
                    maxLength={4}
                    required
                    autoFocus
                />

                <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transform transition hover:scale-[1.02] active:scale-95"
                >
                    Complete Registration
                </button>
            </form>
        </div>
      </div>
    );
  }

  // Completed
  if (status === 'completed') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-green-50 text-center p-6">
        <div className="bg-green-100 p-4 rounded-full mb-4 animate-bounce">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">All Set!</h1>
        <p className="text-gray-600 mt-2">Registration successful.</p>
        
        <button 
            onClick={() => alert("Go to Dashboard")} // Replace with router.push('/dashboard')
            className="mt-8 bg-green-600 text-white px-8 py-3 rounded-full font-semibold shadow-lg"
        >
            Go to Dashboard
        </button>
      </div>
    );
  }

  return null;
}