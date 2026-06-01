'use strict';
const request = require('supertest');
const { app, pool } = require('../../server');
const { setupSchema, truncateAll, createTestUsers, makeToken, authHeader } = require('../helpers/testdb');

let vizToken;

beforeAll(async () => {
  await setupSchema();
  await truncateAll();
  const users = await createTestUsers();
  vizToken = makeToken(users.visualizador);
});

afterAll(async () => {
  await pool.end();
});

describe('GET /api/fogos/active', () => {
  test('sem JWT → 401', async () => {
    const res = await request(app).get('/api/fogos/active');
    expect(res.status).toBe(401);
  });

  test('com JWT válido → responde (mock fetch)', async () => {
    // Mock da API externa para não depender de rede nos testes
    const mockData = { data: [{ id: 1, local: 'Serra de Teste', lat: 40.0, lng: -8.0 }] };
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const res = await request(app)
      .get('/api/fogos/active')
      .set(authHeader(vizToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockData);

    global.fetch = originalFetch;
  });

  test('quando fogos.pt indisponível → 502', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

    const res = await request(app)
      .get('/api/fogos/active')
      .set(authHeader(vizToken));
    expect(res.status).toBe(502);

    global.fetch = originalFetch;
  });
});
