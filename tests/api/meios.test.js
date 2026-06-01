'use strict';
const request = require('supertest');
const { app, pool } = require('../../server');
const { setupSchema, truncateAll, createTestUsers, makeToken, authHeader, testPool } = require('../helpers/testdb');
const { ocorrenciaBase, meioBase, meioPrevistoBase } = require('../helpers/fixtures');

let users, adminToken, gestorToken, opToken, vizToken;
let occId;

beforeAll(async () => {
  await setupSchema();
  await truncateAll();
  users = await createTestUsers();
  adminToken  = makeToken(users.admin);
  gestorToken = makeToken(users.gestor);
  opToken     = makeToken(users.operacional);
  vizToken    = makeToken(users.visualizador);

  // Criar ocorrência base para todos os testes
  const res = await request(app)
    .post('/api/ocorrencias')
    .set(authHeader(gestorToken))
    .send(ocorrenciaBase);
  occId = res.body.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await testPool.query('TRUNCATE meios CASCADE');
});

async function criarMeio(payload = {}) {
  const res = await request(app)
    .post('/api/meios')
    .set(authHeader(gestorToken))
    .send({ ...meioBase, ocorrencia_id: occId, ...payload });
  return res.body;
}

describe('GET /api/meios', () => {
  test('visualizador lista meios → 200 + array', async () => {
    await criarMeio();
    const res = await request(app)
      .get('/api/meios')
      .set(authHeader(vizToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    // Deve incluir arrays de operativos e eventos
    expect(Array.isArray(res.body[0].meios_operativos)).toBe(true);
    expect(Array.isArray(res.body[0].meios_eventos)).toBe(true);
  });
});

describe('POST /api/meios', () => {
  test('gestor cria meio em trânsito', async () => {
    const res = await request(app)
      .post('/api/meios')
      .set(authHeader(gestorToken))
      .send({ ...meioBase, ocorrencia_id: occId });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.estado).toBe('transito');
    expect(res.body.ocorrencia_id).toBe(occId);
  });

  test('gestor cria meio previsto com data/hora', async () => {
    const res = await request(app)
      .post('/api/meios')
      .set(authHeader(gestorToken))
      .send({ ...meioPrevistoBase, ocorrencia_id: occId });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('previsto');
    expect(res.body.previsto_data).toBeTruthy();
    expect(res.body.previsto_hora).toBeTruthy();
  });

  test('operacional não pode criar meio → 403', async () => {
    const res = await request(app)
      .post('/api/meios')
      .set(authHeader(opToken))
      .send({ ...meioBase, ocorrencia_id: occId });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/meios/:id — regressão NOT NULL', () => {
  test('PATCH parcial {estado} não anula ocorrencia_id', async () => {
    const meio = await criarMeio();

    await request(app)
      .patch(`/api/meios/${meio.id}`)
      .set(authHeader(opToken))
      .send({ estado: 'operacao' });

    const { rows } = await testPool.query('SELECT * FROM meios WHERE id=$1', [meio.id]);
    expect(rows[0].ocorrencia_id).toBe(occId);
    expect(rows[0].eq).toBe(meioBase.eq);
    expect(rows[0].estado).toBe('operacao');
  });

  test('PATCH parcial {estado:descanso} não anula data_chegada', async () => {
    const meio = await criarMeio({
      estado: 'operacao',
      data_chegada: '2026-06-01',
      hora_chegada: '10:00:00',
    });

    await request(app)
      .patch(`/api/meios/${meio.id}`)
      .set(authHeader(opToken))
      .send({ estado: 'descanso' });

    const { rows } = await testPool.query('SELECT * FROM meios WHERE id=$1', [meio.id]);
    expect(rows[0].estado).toBe('descanso');
    expect(rows[0].data_chegada).toBeTruthy();
    expect(rows[0].ocorrencia_id).toBe(occId);
  });

  test('PATCH body vazio → 200 sem UPDATE desnecessário', async () => {
    const meio = await criarMeio();
    const res = await request(app)
      .patch(`/api/meios/${meio.id}`)
      .set(authHeader(opToken))
      .send({});
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/meios/:id — transições de estado', () => {
  test('previsto → trânsito limpa previsto_data e previsto_hora', async () => {
    const meio = await criarMeio({ ...meioPrevistoBase });

    await request(app)
      .patch(`/api/meios/${meio.id}`)
      .set(authHeader(opToken))
      .send({
        estado: 'transito',
        previsto_data: null,
        previsto_hora: null,
      });

    const { rows } = await testPool.query('SELECT * FROM meios WHERE id=$1', [meio.id]);
    expect(rows[0].estado).toBe('transito');
    expect(rows[0].previsto_data).toBeNull();
    expect(rows[0].previsto_hora).toBeNull();
  });

  test('activar operação guarda data/hora/sector/limite', async () => {
    const meio = await criarMeio();

    await request(app)
      .patch(`/api/meios/${meio.id}`)
      .set(authHeader(opToken))
      .send({
        estado: 'operacao',
        data_chegada: '2026-06-01',
        hora_chegada: '10:00:00',
        horas_max: 12,
        limite_op: '22:00',
        limite_op_date: '2026-06-01',
        setor: 'ALFA',
      });

    const { rows } = await testPool.query('SELECT * FROM meios WHERE id=$1', [meio.id]);
    expect(rows[0].estado).toBe('operacao');
    expect(rows[0].setor).toBe('ALFA');
    expect(rows[0].limite_op).toBe('22:00:00');
  });

  test('desmobilizar guarda data/hora demob', async () => {
    const meio = await criarMeio();

    await request(app)
      .patch(`/api/meios/${meio.id}`)
      .set(authHeader(opToken))
      .send({
        estado: 'desmobilizado',
        data_demob: '2026-06-01',
        hora_demob: '20:00:00',
      });

    const { rows } = await testPool.query('SELECT * FROM meios WHERE id=$1', [meio.id]);
    expect(rows[0].estado).toBe('desmobilizado');
    expect(rows[0].data_demob).toBeTruthy();
  });
});

describe('PUT /api/meios/:id/operativos', () => {
  test('substitui lista de operativos', async () => {
    const meio = await criarMeio();

    const res = await request(app)
      .put(`/api/meios/${meio.id}/operativos`)
      .set(authHeader(opToken))
      .send({ rows: [{ nome: 'João' }, { nome: 'Maria' }] });
    expect(res.status).toBe(200);

    const { rows } = await testPool.query(
      'SELECT * FROM meios_operativos WHERE meio_id=$1 ORDER BY ordem',
      [meio.id]
    );
    expect(rows.length).toBe(2);
    expect(rows[0].nome).toBe('João');
    expect(rows[1].nome).toBe('Maria');
  });

  test('lista vazia remove todos os operativos', async () => {
    const meio = await criarMeio();
    await request(app)
      .put(`/api/meios/${meio.id}/operativos`)
      .set(authHeader(opToken))
      .send({ rows: [{ nome: 'João' }] });

    await request(app)
      .put(`/api/meios/${meio.id}/operativos`)
      .set(authHeader(opToken))
      .send({ rows: [] });

    const { rows } = await testPool.query(
      'SELECT * FROM meios_operativos WHERE meio_id=$1',
      [meio.id]
    );
    expect(rows.length).toBe(0);
  });
});

describe('POST /api/meios_eventos', () => {
  test('operacional adiciona evento a meio', async () => {
    const meio = await criarMeio();

    const res = await request(app)
      .post('/api/meios_eventos')
      .set(authHeader(opToken))
      .send({ meio_id: meio.id, msg: 'Chegou ao TO', ts: new Date().toISOString() });
    expect(res.status).toBe(200);

    const { rows } = await testPool.query(
      'SELECT * FROM meios_eventos WHERE meio_id=$1',
      [meio.id]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].msg).toBe('Chegou ao TO');
  });
});

describe('DELETE /api/meios/:id', () => {
  test('gestor elimina meio → 200', async () => {
    const meio = await criarMeio();
    const res = await request(app)
      .delete(`/api/meios/${meio.id}`)
      .set(authHeader(gestorToken));
    expect(res.status).toBe(200);

    const { rows } = await testPool.query('SELECT * FROM meios WHERE id=$1', [meio.id]);
    expect(rows.length).toBe(0);
  });

  test('operacional não pode eliminar → 403', async () => {
    const meio = await criarMeio();
    const res = await request(app)
      .delete(`/api/meios/${meio.id}`)
      .set(authHeader(opToken));
    expect(res.status).toBe(403);
  });
});
