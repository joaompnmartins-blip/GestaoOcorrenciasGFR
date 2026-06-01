'use strict';
const request = require('supertest');
const { app, pool } = require('../../server');
const { setupSchema, truncateAll, createTestUsers, JWT_SECRET } = require('../helpers/testdb');
const jwt = require('jsonwebtoken');

let users;

beforeAll(async () => {
  await setupSchema();
  await truncateAll();
  users = await createTestUsers();
});

afterAll(async () => {
  await pool.end();
});

describe('POST /api/login', () => {
  test('credenciais válidas → 200 + token', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'admin@test.pt', password: 'test123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.role).toBe('admin');
    expect(res.body.nome).toBe('Admin Teste');
    const decoded = jwt.verify(res.body.token, JWT_SECRET);
    expect(decoded.role).toBe('admin');
  });

  test('password errada → 401', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'admin@test.pt', password: 'errada' });
    expect(res.status).toBe(401);
  });

  test('email inexistente → 401', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'naoexiste@test.pt', password: 'test123' });
    expect(res.status).toBe(401);
  });

  test('body em falta → 400', async () => {
    const res = await request(app).post('/api/login').send({});
    expect(res.status).toBe(400);
  });

  test('utilizador inactivo → 401', async () => {
    // Desactivar o utilizador directamente na BD
    const { testPool } = require('../helpers/testdb');
    await testPool.query(
      'UPDATE utilizadores SET ativo=false WHERE email=$1',
      ['viz@test.pt']
    );
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'viz@test.pt', password: 'test123' });
    expect(res.status).toBe(401);
    // Restaurar
    await testPool.query(
      'UPDATE utilizadores SET ativo=true WHERE email=$1',
      ['viz@test.pt']
    );
  });
});

describe('Autenticação obrigatória nos endpoints protegidos', () => {
  test('GET /api/ocorrencias sem JWT → 401', async () => {
    const res = await request(app).get('/api/ocorrencias');
    expect(res.status).toBe(401);
  });

  test('GET /api/ocorrencias com token inválido → 401', async () => {
    const res = await request(app)
      .get('/api/ocorrencias')
      .set('Authorization', 'Bearer token-invalido');
    expect(res.status).toBe(401);
  });

  test('GET /api/utilizadores com perfil gestor → 403', async () => {
    const { makeToken } = require('../helpers/testdb');
    const token = makeToken(users.gestor);
    const res = await request(app)
      .get('/api/utilizadores')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('POST /api/ocorrencias com perfil visualizador → 403', async () => {
    const { makeToken } = require('../helpers/testdb');
    const token = makeToken(users.visualizador);
    const res = await request(app)
      .post('/api/ocorrencias')
      .set('Authorization', `Bearer ${token}`)
      .send({ local_ignicao: 'Teste' });
    expect(res.status).toBe(403);
  });

  test('DELETE /api/ocorrencias/:id com perfil gestor → 403', async () => {
    const { makeToken } = require('../helpers/testdb');
    const token = makeToken(users.gestor);
    const res = await request(app)
      .delete('/api/ocorrencias/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('POST /api/meios com perfil operacional → 403', async () => {
    const { makeToken } = require('../helpers/testdb');
    const token = makeToken(users.operacional);
    const res = await request(app)
      .post('/api/meios')
      .set('Authorization', `Bearer ${token}`)
      .send({ eq: 'Teste', ocorrencia_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(403);
  });
});
