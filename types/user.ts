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