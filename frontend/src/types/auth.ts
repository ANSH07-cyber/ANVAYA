export type UserRole = "patient" | "doctor" | "admin";

export interface UserPublic {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  full_name: string;
  email: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: UserPublic;
}
