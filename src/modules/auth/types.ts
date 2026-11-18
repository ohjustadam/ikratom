export type AuthResult =
  | {
      success: true;
      /** Signup only: Supabase returned a session (email confirmation is off), so go straight in. */
      signedIn?: boolean;
      /** Signup only: the account exists, its confirmation email is queued behind a rush. */
      queued?: boolean;
      error?: never;
      hint?: never;
      errorCode?: never;
    }
  | { error: string; hint?: string; errorCode?: string | null; success?: never; signedIn?: never; queued?: never };

export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  congressional_district: string | null;
  state_senate_district: string | null;
  state_house_district: string | null;
  is_shop_owner: boolean;
  is_medical_professional: boolean;
  shop_name: string | null;
  created_at: string;
  updated_at: string;
};
