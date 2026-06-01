'use strict';
const request = require('supertest');
const { app, pool } = require('../../server');
const { setupSchema, truncateAll, createTestUsers, makeToken, authHeader, testPool } = require('../helpers/testdb');
const { equipaBase } = require('../helpers/fixtures');

let users, gestorToken, vizToken;

beforeAll(async () => {
  await setupSchema();
  await truncateAll();
  users = await createTestUsers();
  gestorToken = makeToken(users.gestor);
  vizToken    = makeToken(users.visualizador);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await testPool.query('TRUNCATE equipas CASCADE');
});

async function criarEquipa(payload = {}) {
  const res = await request(app)
    .post('/api/equipas')
    .set(authHeader(gestorToken))
    .send({ ...equipaBase, ...payload });
  return res.body;
}

describe('GET /api/equipas', () => {
  test('visualizador lista catálogo → 200', async () => {
    await criarEquipa();
    const res = await request(app)
      .get('/api/equipas')
      .set(authHeader(vizToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('lista vazia quando sem registos', async () => {
    const res = await request(app)
      .get('/api/equipas')
      .set(authHeader(vizToken));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });
});

describe('POST /api/equipas', () => {
  test('gestor cria equipa → 200 + registo', async () => {
    const res = await request(app)
      .post('/api/equipas')
      .set(authHeader(gestorToken))
      .send(equipaBase);
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.nome).toBe(equipaBase.nome);
    expect(res.body.tipo_equipa).toBe(equipaBase.tipo_equipa);
    expect(res.body.subregiao).toBe(equipaBase.subregiao);
    expect(res.body.concelho).toBe(equipaBase.concelho);
  });

  test('visualizador não pode criar → 403', async () => {
    const res = await request(app)
      .post('/api/equipas')
      .set(authHeader(vizToken))
      .send(equipaBase);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/equipas/:id', () => {
  test('gestor edita equipa → 200', async () => {
    const eq = await criarEquipa();
    const res = await request(app)
      .patch(`/api/equipas/${eq.id}`)
      .set(authHeader(gestorToken))
      .send({ ...equipaBase, nome: 'Nome Actualizado', capacidade: 5 });
    expect(res.status).toBe(200);

    const { rows } = await testPool.query('SELECT * FROM equipas WHERE id=$1', [eq.id]);
    expect(rows[0].nome).toBe('Nome Actualizado');
    expect(rows[0].capacidade).toBe(5);
  });
});

describe('DELETE /api/equipas/:id', () => {
  test('gestor elimina equipa → 200', async () => {
    const eq = await criarEquipa();
    const res = await request(app)
      .delete(`/api/equipas/${eq.id}`)
      .set(authHeader(gestorToken));
    expect(res.status).toBe(200);

    const { rows } = await testPool.query('SELECT * FROM equipas WHERE id=$1', [eq.id]);
    expect(rows.length).toBe(0);
  });

  test('visualizador não pode eliminar → 403', async () => {
    const eq = await criarEquipa();
    const res = await request(app)
      .delete(`/api/equipas/${eq.id}`)
      .set(authHeader(vizToken));
    expect(res.status).toBe(403);
  });
});
