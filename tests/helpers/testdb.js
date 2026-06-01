'use strict';
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/gestao_meios_test';
const JWT_SECRET  = process.env.JWT_SECRET || 'dev-secret-CHANGE-IN-PRODUCTION';

const testPool = new Pool({ connectionString: TEST_DB_URL });

async function setupSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '../../schema.sql'), 'utf8');
  await testPool.query(sql);
}

async function truncateAll() {
  // CASCADE handles meios, meios_eventos, meios_operativos, ocorrencias_eventos
  await testPool.query(
    'TRUNCATE utilizadores, ocorrencias, equipas, operacionais_predefinidos CASCADE'
  );
}

// Cost 1 for speed in tests — never use in production
let _hash;
async function testHash() {
  if (!_hash) _hash = await bcrypt.hash('test123', 1);
  return _hash;
}

async function createTestUsers() {
  const hash = await testHash();
  const [a, g, gs, o, v] = await Promise.all([
    testPool.query(
      `INSERT INTO utilizadores (email, nome, password_hash, role, ativo)
       VALUES ($1,$2,$3,'admin',true) RETURNING *`,
      ['admin@test.pt', 'Admin Teste', hash]
    ),
    testPool.query(
      `INSERT INTO utilizadores (email, nome, password_hash, role, ativo)
       VALUES ($1,$2,$3,'gestor',true) RETURNING *`,
      ['gestor@test.pt', 'Gestor Teste', hash]
    ),
    testPool.query(
      `INSERT INTO utilizadores (email, nome, password_hash, role, subregiao, ativo)
       VALUES ($1,$2,$3,'gestor',$4,true) RETURNING *`,
      ['gestor.sr@test.pt', 'Gestor Sub-Região', hash, 'Sub-Região Norte']
    ),
    testPool.query(
      `INSERT INTO utilizadores (email, nome, password_hash, role, ativo)
       VALUES ($1,$2,$3,'operacional',true) RETURNING *`,
      ['op@test.pt', 'Operacional Teste', hash]
    ),
    testPool.query(
      `INSERT INTO utilizadores (email, nome, password_hash, role, ativo)
       VALUES ($1,$2,$3,'visualizador',true) RETURNING *`,
      ['viz@test.pt', 'Visualizador Teste', hash]
    ),
  ]);

  return {
    admin:      a.rows[0],
    gestor:     g.rows[0],
    gestorSR:   gs.rows[0],
    operacional: o.rows[0],
    visualizador: v.rows[0],
  };
}

function makeToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, nome: user.nome, subregiao: user.subregiao || null },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function makeTokenFor(role, extraFields = {}) {
  return jwt.sign(
    { id: 'test-id', role, nome: 'Teste', subregiao: null, ...extraFields },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = {
  testPool,
  setupSchema,
  truncateAll,
  createTestUsers,
  makeToken,
  makeTokenFor,
  authHeader,
  TEST_DB_URL,
  JWT_SECRET,
};
