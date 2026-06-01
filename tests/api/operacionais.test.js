'use strict';
const request = require('supertest');
const { app, pool } = require('../../server');
const { setupSchema, truncateAll, createTestUsers, makeToken, authHeader, testPool } = require('../helpers/testdb');
const { operacionalBase } = require('../helpers/fixtures');

let gestorToken, vizToken;

beforeAll(async () => {
  await setupSchema();
  await truncateAll();
  const users = await createTestUsers();
  gestorToken = makeToken(users.gestor);
  vizToken    = makeToken(users.visualizador);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await testPool.query('TRUNCATE operacionais_predefinidos CASCADE');
});

describe('GET /api/operacionais', () => {
  test('visualizador lista → 200', async () => {
    await request(app)
      .post('/api/operacionais')
      .set(authHeader(gestorToken))
      .send(operacionalBase);

    const res = await request(app)
      .get('/api/operacionais')
      .set(authHeader(vizToken));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].nome).toBe(operacionalBase.nome);
  });
});

describe('POST /api/operacionais', () => {
  test('gestor cria operacional → 200', async () => {
    const res = await request(app)
      .post('/api/operacionais')
      .set(authHeader(gestorToken))
      .send(operacionalBase);
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.nome).toBe(operacionalBase.nome);
  });

  test('visualizador não pode criar → 403', async () => {
    const res = await request(app)
      .post('/api/operacionais')
      .set(authHeader(vizToken))
      .send(operacionalBase);
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/operacionais/:id', () => {
  test('gestor elimina → 200', async () => {
    const cr = await request(app)
      .post('/api/operacionais')
      .set(authHeader(gestorToken))
      .send(operacionalBase);

    const res = await request(app)
      .delete(`/api/operacionais/${cr.body.id}`)
      .set(authHeader(gestorToken));
    expect(res.status).toBe(200);

    const { rows } = await testPool.query(
      'SELECT * FROM operacionais_predefinidos WHERE id=$1',
      [cr.body.id]
    );
    expect(rows.length).toBe(0);
  });
});
