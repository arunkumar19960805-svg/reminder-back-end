import request from 'supertest';
import app from '../app';
import { User } from '../database/models';

export const api = () => request(app);

export interface Actor {
  id: string;
  email: string;
  token: string;
}

export const createUserAndLogin = async (
  overrides: Partial<{
    email: string;
    password: string;
    fullName: string;
    role: 'admin' | 'user';
    timezone: string;
    isActive: boolean;
  }> = {}
): Promise<Actor> => {
  const email = overrides.email || `u${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.com`;
  const password = overrides.password || 'Password@123';

  const user = await User.create({
    email,
    password,
    fullName: overrides.fullName || 'Test User',
    role: overrides.role || 'user',
    timezone: overrides.timezone || 'Asia/Kolkata',
    isActive: overrides.isActive ?? true,
  });

  const res = await api().post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed in helper: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return { id: user.id, email, token: res.body.data.accessToken };
};

/** An ISO timestamp `minutes` from now, with offset, as the API requires. */
export const isoFromNow = (minutes: number): string =>
  new Date(Date.now() + minutes * 60_000).toISOString();

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
