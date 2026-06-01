'use strict';
const request = require('supertest');
const { app, pool } = require('../../server');
const { setupSchema, truncateAll, createTestUsers, makeToken, authHeader } = require('../helpers/testdb');
const { ocorrenciaBase } = require('../helpers/fixtures');

let users, adminToken, gestorToken, gestorSRToken, vizToken;

beforeAll(async () => {
  await setupSchema();
  await truncateAll();
  users = await createTestUsers();
  adminToken  = makeToken(users.admin);
  gestorToken = makeToken(users.gestor);
  gestorSRToken = makeToken(users.gestorSR);
  vizToken    = makeToken(users.visualizador);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  const { testPool } = require('../helpers/testdb');
  await testPool.query('TRUNCATE ocorrencias CASCADE');
});

describe('GET /api/ocorrencias', () => {
  test('admin vê todas as ocorrências', async () => {
    const res = await request(app)
      .get('/api/ocorrencias')
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('gestor com sub-região vê só as suas', async () => {
    const { testPool } = require('../helpers/testdb');
    // Criar uma ocorrência na sub-região do gestor
    await testPool.query(
      `INSERT INTO ocorrencias (local_ignicao, subregiao, status, created_by)
       VALUES ('Local A', 'Sub-Região Norte', 'active', $1)`,
      [users.gestorSR.id]
    );
    // Criar uma ocorrência noutra sub-região
    await testPool.query(
      `INSERT INTO ocorrencias (local_ignicao, subregiao, status, created_by)
       VALUES ('Local B', 'Sub-Região Sul', 'active', $1)`,
      [users.admin.id]
    );

    const res = await request(app)
      .get('/api/ocorrencias')
      .set(authHeader(gestorSRToken));
    expect(res.status).toBe(200);
    expect(res.body.every(o => o.subregiao === 'Sub-Região Norte')).toBe(true);
    expect(res.body.length).toBe(1);
  });

  test('gestor sem sub-região vê todas', async () => {
    const { testPool } = require('../helpers/testdb');
    await testPool.query(
      `INSERT INTO ocorrencias (local_ignicao, subregiao, status, created_by)
       VALUES ('Local A', 'Norte', 'active', $1),
              ('Local B', 'Sul', 'active', $1)`,
      [users.admin.id]
    );
    const res = await request(app)
      .get('/api/ocorrencias')
      .set(authHeader(gestorToken));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });
});

describe('POST /api/ocorrencias', () => {
  test('gestor cria ocorrência → 200 + registo', async () => {
    const res = await request(app)
      .post('/api/ocorrencias')
      .set(authHeader(gestorToken))
      .send(ocorrenciaBase);
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.local_ignicao).toBe(ocorrenciaBase.local_ignicao);
    expect(res.body.status).toBe('active');
  });

  test('visualizador não pode criar → 403', async () => {
    const res = await request(app)
      .post('/api/ocorrencias')
      .set(authHeader(vizToken))
      .send(ocorrenciaBase);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/ocorrencias/:id', () => {
  let occId;

  beforeEach(async () => {
    const res = await request(app)
      .post('/api/ocorrencias')
      .set(authHeader(gestorToken))
      .send(ocorrenciaBase);
    occId = res.body.id;
  });

  test('fechar ocorrência não anula local_ignicao (COALESCE)', async () => {
    // PATCH com só status — bug crítico que foi corrigido
    await request(app)
      .patch(`/api/ocorrencias/${occId}`)
      .set(authHeader(gestorToken))
      .send({ status: 'closed' });

    const { testPool } = require('../helpers/testdb');
    const { rows } = await testPool.query('SELECT * FROM ocorrencias WHERE id=$1', [occId]);
    expect(rows[0].status).toBe('closed');
    expect(rows[0].local_ignicao).toBe(ocorrenciaBase.local_ignicao);
  });

  test('editar campos da ocorrência', async () => {
    const res = await request(app)
      .patch(`/api/ocorrencias/${occId}`)
      .set(authHeader(gestorToken))
      .send({ obs: 'Observação actualizada', concelho: 'Novo Concelho' });
    expect(res.status).toBe(200);

    const { testPool } = require('../helpers/testdb');
    const { rows } = await testPool.query('SELECT * FROM ocorrencias WHERE id=$1', [occId]);
    expect(rows[0].obs).toBe('Observação actualizada');
    expect(rows[0].concelho).toBe('Novo Concelho');
    expect(rows[0].local_ignicao).toBe(ocorrenciaBase.local_ignicao);
  });

  test('reabrir ocorrência fechada', async () => {
    await request(app)
      .patch(`/api/ocorrencias/${occId}`)
      .set(authHeader(gestorToken))
      .send({ status: 'closed' });

    const res = await request(app)
      .patch(`/api/ocorrencias/${occId}`)
      .set(authHeader(gestorToken))
      .send({ status: 'active' });
    expect(res.status).toBe(200);

    const { testPool } = require('../helpers/testdb');
    const { rows } = await testPool.query('SELECT * FROM ocorrencias WHERE id=$1', [occId]);
    expect(rows[0].status).toBe('active');
  });
});

describe('DELETE /api/ocorrencias/:id', () => {
  test('admin elimina → 200', async () => {
    const cr = await request(app)
      .post('/api/ocorrencias')
      .set(authHeader(gestorToken))
      .send(ocorrenciaBase);
    const id = cr.body.id;

    const res = await request(app)
      .delete(`/api/ocorrencias/${id}`)
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);

    const { testPool } = require('../helpers/testdb');
    const { rows } = await testPool.query('SELECT * FROM ocorrencias WHERE id=$1', [id]);
    expect(rows.length).toBe(0);
  });

  test('gestor não pode eliminar → 403', async () => {
    const cr = await request(app)
      .post('/api/ocorrencias')
      .set(authHeader(gestorToken))
      .send(ocorrenciaBase);

    const res = await request(app)
      .delete(`/api/ocorrencias/${cr.body.id}`)
      .set(authHeader(gestorToken));
    expect(res.status).toBe(403);
  });
});
