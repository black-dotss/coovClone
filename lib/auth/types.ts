export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

export interface SessionContext {
  user: SessionUser;
  sessionToken: string;
  expiresAt: Date;
}
