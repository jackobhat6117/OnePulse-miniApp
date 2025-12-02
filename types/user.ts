import { DeviceInfoPayload } from "@/utils/getDeviceInfo";

export interface RegistrationPayload {
    allowed_financial_actions: string[]
    customer_profile : {
        avatar: string
    }
  first_name?: string,
  is_bot_user: true,
  is_premium?: true | false,
  kyc_status: string,
  language_code: string,
  last_name: string,
  phone_number: string,
  registration_status: string,
  telegram_id: number,
  username: string
}

export interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  photoUrl?: string;
  isPremium?: boolean;
}

// API Payloads
export interface CheckIdPayload {
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

export interface ShareContactPayload {
  phone_number: string;
  telegram_id: number;
}

export interface DeviceSessionPayload {
  device_info: DeviceInfoPayload;
  phone_number: string;
  telegram_id: string;
}

export interface SimVerifyPayload {
  device_fingerprint: string;
  phone_number: string;
  telegram_id: string;
}

export interface VerifyCodePayload {
  activation_code: string;
  phone_number: string;
  telegram_id: string;
}

export interface ResendCodePayload {
  phone_number: string;
  telegram_id: string;
}

export interface VerifyCustomerPayload {
  account_number: string;
  device_id: string;
  phone_number: string;
  telegram_id: string;
}


export interface ProductValidationPayload {
  channel: string;
  customer_group: string;
  product_code: string;
  tier_group: string;
}

export interface OnePulseRegistrationPayload {
  account_number: string;
  customer_id: string;
  device_id: string;
  phone_number: string;
  pin: string;
  session_id: string;
  telegram_id: string;
}