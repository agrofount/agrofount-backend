import request from 'supertest';
import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import { JwtService } from '@nestjs/jwt';
import { createTestApp, TestApp } from './helpers/app';
import { resetState } from './helpers/db';
import { createAdmin, createUser } from './helpers/auth';
import { CatalogSeed, seedCatalog } from './g3/fixtures';
import { NotificationGateway } from '../../src/notification/gateways/notification.gateway';
import { AuthSessionEntity } from '../../src/auth/entities/auth-session.entity';
import { AdminEntity } from '../../src/admins/entities/admin.entity';
import { UserEntity } from '../../src/user/entities/user.entity';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Notification gateway (e2e)', () => {
  let t: TestApp;
  let gateway: NotificationGateway;
  let url: string;
  let catalog: CatalogSeed;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    gateway = t.app.get(NotificationGateway);
    const { port } = t.app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}/notifications`;
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetState(t.app);
    catalog = await seedCatalog(t.app);
  });
  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.close());
  });

  type Client = { socket: Socket; events: unknown[]; closed: Promise<string> };

  const connect = (token?: string): Client => {
    const socket = io(url, {
      auth: token === undefined ? {} : { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    sockets.push(socket);
    const events: unknown[] = [];
    socket.on('notification', (data) => events.push(data));
    const closed = new Promise<string>((resolve) =>
      socket.on('disconnect', (reason) => resolve(reason)),
    );
    return { socket, events, closed };
  };
  /** Resolves once the server has had time to either keep or drop the socket. */
  const settled = async (client: Client) => {
    await Promise.race([client.closed, sleep(1500)]);
  };
  const accepted = async (client: Client) => {
    await settled(client);
    return client.socket.connected;
  };
  const eventually = async (check: () => boolean) => {
    for (let i = 0; i < 50; i += 1) {
      if (check()) return;
      await sleep(100);
    }
    throw new Error('Condition was not met in time');
  };
  const sessionFor = (principalId: string) =>
    t.dataSource
      .getRepository(AuthSessionEntity)
      .findOneByOrFail({ principalId });

  describe('authentication', () => {
    it('lets an admin join its own room and receive emitToUser events', async () => {
      const admin = await createAdmin(t.app);
      const client = connect(admin.token);
      expect(await accepted(client)).toBe(true);

      await gateway.emitToUser(admin.entity.id, 'notification', { n: 1 });
      await eventually(() => client.events.length === 1);
      expect(client.events[0]).toEqual({ n: 1 });
    });

    it('lets a customer join its own room', async () => {
      const user = await createUser(t.app);
      const client = connect(user.token);
      expect(await accepted(client)).toBe(true);
      await gateway.emitToUser(user.entity.id, 'notification', { n: 2 });
      await eventually(() => client.events.length === 1);
    });

    it('accepts the token from the Authorization header too', async () => {
      const user = await createUser(t.app);
      const socket = io(url, {
        extraHeaders: { Authorization: `Bearer ${user.token}` },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      sockets.push(socket);
      const events: unknown[] = [];
      socket.on('notification', (data) => events.push(data));
      await sleep(800);
      expect(socket.connected).toBe(true);
      await gateway.emitToUser(user.entity.id, 'notification', { n: 3 });
      await eventually(() => events.length === 1);
    });

    it.each([
      ['no token', undefined],
      ['an empty token', ''],
      ['a garbage token', 'not-a-jwt'],
    ])('disconnects a client with %s', async (_name, token) => {
      const client = connect(token);
      await client.closed;
      expect(client.socket.connected).toBe(false);
    });

    it('disconnects a token signed with the wrong secret', async () => {
      const user = await createUser(t.app);
      const forged = await new JwtService({ secret: 'x'.repeat(40) }).signAsync(
        { id: user.entity.id, principalType: 'user', sid: 's', ver: 0 },
        { issuer: 'agrofount-api', audience: 'agrofount-client' },
      );
      const client = connect(forged);
      await client.closed;
      expect(client.socket.connected).toBe(false);
    });

    it('disconnects an expired token', async () => {
      const user = await createUser(t.app);
      const session = await sessionFor(user.entity.id);
      const expired = await t.app.get(JwtService).signAsync(
        {
          id: user.entity.id,
          principalType: 'user',
          sid: session.id,
          jti: 'expired-token',
          ver: 0,
        },
        {
          expiresIn: '-10s',
          issuer: 'agrofount-api',
          audience: 'agrofount-client',
        },
      );
      const client = connect(expired);
      await client.closed;
      expect(client.socket.connected).toBe(false);
    });

    it('disconnects a token with the wrong audience', async () => {
      const user = await createUser(t.app);
      const session = await sessionFor(user.entity.id);
      const wrong = await t.app.get(JwtService).signAsync(
        {
          id: user.entity.id,
          principalType: 'user',
          sid: session.id,
          jti: 'wrong-audience',
          ver: 0,
        },
        { expiresIn: '5m', issuer: 'agrofount-api', audience: 'someone-else' },
      );
      const client = connect(wrong);
      await client.closed;
      expect(client.socket.connected).toBe(false);
    });

    it('rejects a revoked session', async () => {
      const user = await createUser(t.app);
      await t.dataSource
        .getRepository(AuthSessionEntity)
        .update({ principalId: user.entity.id }, { revokedAt: new Date() });
      const client = connect(user.token);
      await client.closed;
      expect(client.socket.connected).toBe(false);
    });

    it('rejects an expired session', async () => {
      const user = await createUser(t.app);
      await t.dataSource
        .getRepository(AuthSessionEntity)
        .update(
          { principalId: user.entity.id },
          { expiresAt: new Date(Date.now() - 1000) },
        );
      const client = connect(user.token);
      await client.closed;
      expect(client.socket.connected).toBe(false);
    });

    it('rejects a token after logout', async () => {
      const user = await createUser(t.app);
      await request(t.app.getHttpServer())
        .post('/auth/logout')
        .set(user.auth)
        .expect(201);
      const client = connect(user.token);
      await client.closed;
      expect(client.socket.connected).toBe(false);
    });

    it('rejects a token whose version no longer matches the account', async () => {
      const admin = await createAdmin(t.app);
      await t.dataSource
        .getRepository(AdminEntity)
        .update({ id: admin.entity.id }, { tokenVersion: 5 });
      const client = connect(admin.token);
      await client.closed;
      expect(client.socket.connected).toBe(false);
    });

    it('rejects an account that is no longer verified', async () => {
      const user = await createUser(t.app);
      await t.dataSource
        .getRepository(UserEntity)
        .update({ id: user.entity.id }, { isVerified: false });
      const client = connect(user.token);
      await client.closed;
      expect(client.socket.connected).toBe(false);
    });

    it('delivers nothing to a disconnected client', async () => {
      const user = await createUser(t.app);
      const client = connect('garbage');
      await client.closed;
      await gateway.emitToUser(user.entity.id, 'notification', { n: 4 });
      await sleep(300);
      expect(client.events).toEqual([]);
    });
  });

  describe('room isolation', () => {
    it('never delivers another user events', async () => {
      const a = await createUser(t.app);
      const b = await createUser(t.app);
      const clientA = connect(a.token);
      const clientB = connect(b.token);
      expect(await accepted(clientA)).toBe(true);
      expect(await accepted(clientB)).toBe(true);

      await gateway.emitToUser(b.entity.id, 'notification', { for: 'b' });
      await eventually(() => clientB.events.length === 1);
      await sleep(300);
      expect(clientA.events).toEqual([]);
    });

    it('ignores a subscribe message asking for another user room', async () => {
      const attacker = await createUser(t.app);
      const victim = await createUser(t.app);
      const client = connect(attacker.token);
      expect(await accepted(client)).toBe(true);

      client.socket.emit('subscribe', { userId: victim.entity.id });
      await sleep(300);
      await gateway.emitToUser(victim.entity.id, 'notification', { secret: 1 });
      await sleep(400);
      expect(client.events).toEqual([]);
    });

    it('keeps an admin out of a customer room', async () => {
      const admin = await createAdmin(t.app);
      const user = await createUser(t.app);
      const client = connect(admin.token);
      expect(await accepted(client)).toBe(true);
      client.socket.emit('subscribe', { userId: user.entity.id });
      await gateway.emitToUser(user.entity.id, 'notification', { n: 5 });
      await sleep(400);
      expect(client.events).toEqual([]);
    });

    it('broadcasts only to authenticated sockets', async () => {
      const user = await createUser(t.app);
      const authed = connect(user.token);
      const anonymous = connect();
      expect(await accepted(authed)).toBe(true);
      await anonymous.closed;

      await gateway.broadcastToAll('notification', { all: true });
      await eventually(() => authed.events.length === 1);
      expect(anonymous.events).toEqual([]);
    });
  });

  describe('cart-started alerts', () => {
    it('reaches a connected admin in real time', async () => {
      const admin = await createAdmin(t.app);
      const client = connect(admin.token);
      expect(await accepted(client)).toBe(true);

      const customer = await createUser(t.app, { username: 'Live Farm' });
      await request(t.app.getHttpServer())
        .post('/cart')
        .set(customer.auth)
        .send({ itemId: catalog.feed.id, selectedUOMUnit: 'kg', quantity: 5 })
        .expect(201);

      await eventually(() => client.events.length === 1);
      expect(client.events[0]).toMatchObject({
        title: 'New cart started',
        message: `Live Farm started a cart with ${catalog.feed.product.name}`,
        customerName: 'Live Farm',
      });
      expect(JSON.stringify(client.events[0])).not.toContain(
        customer.entity.email,
      );
    });

    it('does not reach a connected customer', async () => {
      await createAdmin(t.app);
      const customer = await createUser(t.app);
      const client = connect(customer.token);
      expect(await accepted(client)).toBe(true);
      await request(t.app.getHttpServer())
        .post('/cart')
        .set(customer.auth)
        .send({ itemId: catalog.feed.id, selectedUOMUnit: 'kg', quantity: 5 })
        .expect(201);
      await sleep(800);
      expect(client.events).toEqual([]);
    });
  });
});
