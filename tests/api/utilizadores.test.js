'use strict';
const request = require('supertest');
const { app, pool } = require('../../server');
const { setupSchema, truncateAll, createTestUsers, makeToken, authHeader, testPool } = require('../helpers/testdb');

let users, adminToken, gestorToken;

beforeAll(async () => {
  await setupSchema();
  await truncateAll();
  users = await createTestUsers();
  adminToken  = makeToken(users.admin);
  gestorToken = makeToken(users.gestor);
});

afterAll(async () => {
  await pool.end();
});

describe('GET /api/utilizadores', () => {
  test('admin lista utilizadores → 200', async () => {
    const res = await request(app)
      .get('/api/utilizadores')
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    // Não deve expor password_hash
    expect(res.body[0].password_hash).toBeUndefined();
  });

  test('gestor não pode listar → 403', async () => {
    const res = await request(app)
      .get('/api/utilizadores')
      .set(authHeader(gestorToken));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/utilizadores', () => {
  test('admin cria utilizador → 200 + registo', async () => {
    const res = await request(app)
      .post('/api/utilizadores')
      .set(authHeader(adminToken))
      .send({
        email: 'novo@test.pt',
        nome: 'Novo Utilizador',
        password: 'test123',
        role: 'operacional',
      });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.role).toBe('operacional');
    expect(res.body.password_hash).toBeUndefined();

    // Limpar
    await testPool.query('DELETE FROM utilizadores WHERE email=$1', ['novo@test.pt']);
  });

  test('campos obrigatórios em falta → 400', async () => {
    const res = await request(app)
      .post('/api/utilizadores')
      .set(authHeader(adminToken))
      .send({ email: 'incomplete@test.pt' });
    expect(res.status).toBe(400);
  });

  test('gestor não pode criar utilizadores → 403', async () => {
    const res = await request(app)
      .post('/api/utilizadores')
      .set(authHeader(gestorToken))
      .send({ email: 'x@test.pt', nome: 'X', password: 'test123' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/utilizadores/:id', () => {
  test('admin desactiva utilizador → login falha', async () => {
    // Desactivar visualizador
    await request(app)
      .patch(`/api/utilizadores/${users.visualizador.id}`)
      .set(authHeader(adminToken))
      .send({ ativo: false });

    const loginRes = await request(app)
      .post('/api/login')
      .send({ email: 'viz@test.pt', password: 'test123' });
    expect(loginRes.status).toBe(401);

    // Restaurar
    await request(app)
      .patch(`/api/utilizadores/${users.visualizador.id}`)
      .set(authHeader(adminToken))
      .send({ ativo: true });
  });

  test('admin muda role de utilizador', async () => {
    await request(app)
      .patch(`/api/utilizadores/${users.operacional.id}`)
      .set(authHeader(adminToken))
      .send({ role: 'gestor' });

    const { rows } = await testPool.query(
      'SELECT role FROM utilizadores WHERE id=$1',
      [users.operacional.id]
    );
    expect(rows[0].role).toBe('gestor');

    // Restaurar
    await testPool.query(
      'UPDATE utilizadores SET role=$1 WHERE id=$2',
      ['operacional', users.operacional.id]
    );
  });

  test('admin atribui sub-região a gestor', async () => {
    await request(app)
      .patch(`/api/utilizadores/${users.gestor.id}`)
      .set(authHeader(adminToken))
      .send({ subregiao: 'Sub-Região Teste' });

    const { rows } = await testPool.query(
      'SELECT subregiao FROM utilizadores WHERE id=$1',
      [users.gestor.id]
    );
    expect(rows[0].subregiao).toBe('Sub-Região Teste');

    // Restaurar
    await testPool.query(
      'UPDATE utilizadores SET subregiao=NULL WHERE id=$1',
      [users.gestor.id]
    );
  });
});

describe('DELETE /api/utilizadores/:id', () => {
  test('admin não pode eliminar a própria conta → 400', async () => {
    const res = await request(app)
      .delete(`/api/utilizadores/${users.admin.id}`)
      .set(authHeader(adminToken));
    expect(res.status).toBe(400);
  });

  test('gestor não pode eliminar → 403', async () => {
    const res = await request(app)
      .delete(`/api/utilizadores/${users.visualizador.id}`)
      .set(authHeader(gestorToken));
    expect(res.status).toBe(403);
  });
});
