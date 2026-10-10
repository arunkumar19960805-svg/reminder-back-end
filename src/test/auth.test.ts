import { sequelize } from '../config/database';
import { initAssociations, User } from '../database/models';
import { api, createUserAndLogin, auth, Actor } from './helpers';

let admin: Actor;
let member: Actor;

beforeAll(async () => {
  initAssociations();
  await sequelize.sync({ force: true });
  admin = await createUserAndLogin({ role: 'admin', fullName: 'Admin' });
  member = await createUserAndLogin({ role: 'user', fullName: 'Member' });
});

afterAll(async () => {
  await sequelize.close();
});

describe('Authentication', () => {
  it('logs in with valid credentials and returns tokens', async () => {
    const email = 'login.ok@test.com';
    await User.create({ email, password: 'Password@123', fullName: 'Login Ok', role: 'user' });

    const res = await api().post('/api/v1/auth/login').send({ email, password: 'Password@123' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
  });

  it('never returns the password hash', async () => {
    const res = await api().get('/api/v1/auth/me').set(auth(member.token));
    expect(res.status).toBe(200);
    expect(res.body.data.password).toBeUndefined();
  });

  it('rejects a wrong password with 401', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: member.email, password: 'WrongPassword1' });
    expect(res.status).toBe(401);
  });

  it('does not reveal whether an email exists', async () => {
    const unknown = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.com', password: 'Password@123' });
    const wrongPass = await api()
      .post('/api/v1/auth/login')
      .send({ email: member.email, password: 'WrongPassword1' });

    expect(unknown.status).toBe(wrongPass.status);
    expect(unknown.body.message).toBe(wrongPass.body.message);
  });

  it('rejects requests with no token', async () => {
    const res = await api().get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const res = await api().get('/api/v1/auth/me').set(auth('not-a-real-token'));
    expect(res.status).toBe(401);
  });

  it('validates the login payload', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'bad', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('rotates refresh tokens and rejects the consumed one', async () => {
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: 'Password@123' });
    const original = login.body.data.refreshToken;

    const first = await api().post('/api/v1/auth/refresh').send({ refreshToken: original });
    expect(first.status).toBe(200);
    expect(first.body.data.accessToken).toBeDefined();

    // Replaying the already-used refresh token must fail.
    const replay = await api().post('/api/v1/auth/refresh').send({ refreshToken: original });
    expect(replay.status).toBe(401);
  });

  it('changes a password and invalidates the old one', async () => {
    const actor = await createUserAndLogin({ password: 'OldPassword@1' });

    const change = await api()
      .post('/api/v1/auth/change-password')
      .set(auth(actor.token))
      .send({ currentPassword: 'OldPassword@1', newPassword: 'NewPassword@2' });
    expect(change.status).toBe(200);

    const oldLogin = await api()
      .post('/api/v1/auth/login')
      .send({ email: actor.email, password: 'OldPassword@1' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await api()
      .post('/api/v1/auth/login')
      .send({ email: actor.email, password: 'NewPassword@2' });
    expect(newLogin.status).toBe(200);
  });

  it('rejects a password change with the wrong current password', async () => {
    const res = await api()
      .post('/api/v1/auth/change-password')
      .set(auth(member.token))
      .send({ currentPassword: 'Nope@12345', newPassword: 'Another@123' });
    expect(res.status).toBe(400);
  });
});

describe('Deactivated accounts', () => {
  it('blocks protected API access for a user deactivated after their token was issued', async () => {
    const victim = await createUserAndLogin();

    // Token works while active.
    const before = await api().get('/api/v1/auth/me').set(auth(victim.token));
    expect(before.status).toBe(200);

    await api()
      .patch(`/api/v1/users/${victim.id}/status`)
      .set(auth(admin.token))
      .send({ isActive: false });

    // Same still-valid JWT must now be refused.
    const after = await api().get('/api/v1/auth/me').set(auth(victim.token));
    expect(after.status).toBe(403);
  });

  it('prevents a deactivated user from logging in', async () => {
    const victim = await createUserAndLogin({ password: 'Password@123' });
    await api()
      .patch(`/api/v1/users/${victim.id}/status`)
      .set(auth(admin.token))
      .send({ isActive: false });

    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: victim.email, password: 'Password@123' });
    expect(res.status).toBe(403);
  });
});
