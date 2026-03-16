export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  primary_role: 'admin' | 'instructor' | 'student';
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  roles: { role: string; granted_at: string }[];
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  full_name: string;
  primary_role: string;
  password: string;
  password2: string;
}
