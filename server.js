require('dotenv').config();
'use strict';
const express  = require('express');
const { Pool } = require('pg');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const path     = require('path');

const app  = express();
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const JWT_SECRET  = process.env.JWT_SECRET || 'dev-secret-CHANGE-IN-PRODUCTION';
const JWT_EXPIRES = '12h';
const PORT        = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'Gestao_Meios_v17.html')));

// ─── Role ordering ────────────────────────────────────────────────
const ROLE_ORDER = ['tecnico', 'operacional', 'dradj_cnsr', 'administrador'];

// Backward-compat: accept old role names from JWTs issued before migration
const ROLE_ALIASES = { admin: 'administrador', gestor: 'dradj_cnsr', visualizador: 'tecnico' };
function normalizeRole(r) { return ROLE_ALIASES[r] || r; }

function requireAuth(minRole = 'tecnico') {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      return res.status(401).json({ error: 'Não autenticado.' });
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET);
      req.user.role = normalizeRole(req.user.role);
      if (ROLE_ORDER.indexOf(req.user.role) < ROLE_ORDER.indexOf(minRole))
        return res.status(403).json({ error: 'Sem permissão.' });
      next();
    } catch {
      res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
    }
  };
}

// ─── Middlewares de permissão contextual ─────────────────────────

// Verifica se o utilizador pode gerir uma ocorrência específica
async function requireAuthForOccurrence(req, res, next) {
  try {
    const occId  = req.params.id || req.body?.ocorrencia_id;
    const { id: userId, role } = req.user;
    if (['administrador', 'dradj_cnsr'].includes(role)) return next();
    if (role === 'tecnico') {
      const { rows } = await pool.query(
        'SELECT 1 FROM ocorrencia_oficiais_ligacao WHERE ocorrencia_id=$1 AND utilizador_id=$2',
        [occId, userId]
      );
      if (rows.length) return next();
    }
    return res.status(403).json({ error: 'Sem permissão para esta ocorrência.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// Verifica se o utilizador pode actuar sobre um meio específico
async function requireAuthForMeio(req, res, next) {
  try {
    const meioId = req.params.id;
    const { id: userId, role } = req.user;
    if (['administrador', 'dradj_cnsr'].includes(role)) return next();
    if (role === 'tecnico') {
      const { rows } = await pool.query(
        `SELECT 1 FROM ocorrencia_oficiais_ligacao ol
         JOIN meios m ON m.ocorrencia_id = ol.ocorrencia_id
         WHERE m.id=$1 AND ol.utilizador_id=$2`,
        [meioId, userId]
      );
      if (rows.length) return next();
    }
    if (role === 'operacional' || role === 'tecnico') {
      const { rows } = await pool.query(
        'SELECT 1 FROM meios_operativos WHERE meio_id=$1 AND utilizador_id=$2',
        [meioId, userId]
      );
      if (rows.length) return next();
    }
    return res.status(403).json({ error: 'Sem permissão para este meio.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
  };
}

// ══════════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════════
app.post('/api/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email e password obrigatórios.' });

  const { rows } = await pool.query(
    'SELECT * FROM utilizadores WHERE email = $1',
    [email.trim().toLowerCase()]
  );
  const user = rows[0];

  if (!user || !await bcrypt.compare(password, user.password_hash))
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  if (!user.ativo)
    return res.status(401).json({ error: 'Conta inativa. Contacte o administrador.' });

  const role = normalizeRole(user.role);
  const token = jwt.sign(
    { id: user.id, role, nome: user.nome, subregiao: user.subregiao },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
  res.json({ token, id: user.id, role, nome: user.nome, subregiao: user.subregiao });
}));

// ══════════════════════════════════════════════════════════════════
//  OCORRÊNCIAS
// ══════════════════════════════════════════════════════════════════
app.get('/api/ocorrencias', requireAuth('tecnico'), wrap(async (req, res) => {
  const { role, subregiao, id: userId } = req.user;
  let q, params = [];
  if (role === 'administrador' || (role === 'dradj_cnsr' && !subregiao)) {
    q = 'SELECT * FROM ocorrencias ORDER BY created_at DESC';
  } else if (role === 'dradj_cnsr') {
    q = 'SELECT * FROM ocorrencias WHERE subregiao=$1 ORDER BY created_at DESC';
    params = [subregiao];
  } else {
    // tecnico e operacional: sub-região + OL + meios onde estão listados como operativos
    q = `SELECT * FROM ocorrencias
         WHERE subregiao=$1
            OR id IN (SELECT ocorrencia_id FROM ocorrencia_oficiais_ligacao WHERE utilizador_id=$2)
            OR id IN (
              SELECT m.ocorrencia_id FROM meios m
              JOIN meios_operativos mo ON mo.meio_id = m.id
              WHERE mo.utilizador_id=$2
            )
         ORDER BY created_at DESC`;
    params = [subregiao || '', userId];
  }
  const { rows } = await pool.query(q, params);
  res.json(rows);
}));

app.post('/api/ocorrencias', requireAuth('dradj_cnsr'), wrap(async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(
    `INSERT INTO ocorrencias
       (local_ignicao, codigo_ocorrencia, subregiao, concelho, obs, inicio, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [b.local_ignicao, b.codigo_ocorrencia || null, b.subregiao || null, b.concelho || null,
     b.obs || null, b.inicio || null, b.status || 'active', req.user.id]
  );
  res.json(rows[0]);
}));

app.patch('/api/ocorrencias/:id', requireAuth('tecnico'), requireAuthForOccurrence, wrap(async (req, res) => {
  const b = req.body;
  await pool.query(
    `UPDATE ocorrencias
     SET local_ignicao      = COALESCE($1, local_ignicao),
         codigo_ocorrencia  = COALESCE($2, codigo_ocorrencia),
         subregiao          = COALESCE($3, subregiao),
         concelho           = COALESCE($4, concelho),
         obs                = COALESCE($5, obs),
         inicio             = COALESCE($6, inicio),
         status             = COALESCE($7, status)
     WHERE id=$8`,
    [b.local_ignicao || null, b.codigo_ocorrencia || null, b.subregiao || null, b.concelho || null,
     b.obs || null, b.inicio || null, b.status || null, req.params.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/ocorrencias/:id', requireAuth('administrador'), wrap(async (req, res) => {
  await pool.query('DELETE FROM ocorrencias WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  MEIOS
// ══════════════════════════════════════════════════════════════════
const MEIO_COLS = [
  'ocorrencia_id','eq','tipo','matricula','concelho','setor',
  'operacionais','responsavel','contacto',
  'data_despacho','hora_despacho','data_saida_entidade','hora_saida_entidade',
  'data_chegada','hora_chegada','horas_max','limite_op','limite_op_date',
  'data_demob','hora_demob','data_chegada_entidade','hora_chegada_entidade',
  'km','missao','estado','obs',
  'previsto_data','previsto_hora',
];

app.get('/api/meios', requireAuth('tecnico'), wrap(async (req, res) => {
  const [{ rows: meios }, { rows: operativos }, { rows: eventos }] = await Promise.all([
    pool.query('SELECT * FROM meios ORDER BY created_at'),
    pool.query('SELECT * FROM meios_operativos ORDER BY meio_id, ordem'),
    pool.query('SELECT * FROM meios_eventos ORDER BY ts DESC'),
  ]);
  const result = meios.map(m => ({
    ...m,
    meios_operativos: operativos.filter(o => o.meio_id === m.id),
    meios_eventos:    eventos.filter(e => e.meio_id === m.id),
  }));
  res.json(result);
}));

app.post('/api/meios', requireAuth('tecnico'), requireAuthForOccurrence, wrap(async (req, res) => {
  const b    = req.body;
  const cols = [...MEIO_COLS, 'created_by'];
  const vals = [...MEIO_COLS.map(c => b[c] ?? null), req.user.id];
  const ph   = cols.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await pool.query(
    `INSERT INTO meios (${cols.join(',')}) VALUES (${ph}) RETURNING *`, vals
  );
  res.json(rows[0]);
}));

app.patch('/api/meios/:id', requireAuth('tecnico'), requireAuthForMeio, wrap(async (req, res) => {
  const b = req.body;
  // Only update columns present in the body — partial rows from quick actions
  // must not null out NOT NULL columns like ocorrencia_id or eq.
  const cols = MEIO_COLS.filter(c => c in b);
  if (!cols.length) return res.json({ ok: true });
  const sets = cols.map((c, i) => `${c}=$${i + 1}`).join(',');
  const vals = [...cols.map(c => b[c] ?? null), req.params.id];
  await pool.query(`UPDATE meios SET ${sets} WHERE id=$${cols.length + 1}`, vals);
  res.json({ ok: true });
}));

app.delete('/api/meios/:id', requireAuth('dradj_cnsr'), wrap(async (req, res) => {
  await pool.query('DELETE FROM meios WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Replace all operativos for a meio in one shot
app.put('/api/meios/:id/operativos', requireAuth('operacional'), requireAuthForMeio, wrap(async (req, res) => {
  const rows = req.body.rows || [];
  await pool.query('DELETE FROM meios_operativos WHERE meio_id = $1', [req.params.id]);
  if (rows.length) {
    const vals = rows.flatMap((r, i) => [req.params.id, r.nome, i, r.utilizador_id || null]);
    const ph   = rows.map((_, i) => `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`).join(',');
    await pool.query(`INSERT INTO meios_operativos (meio_id,nome,ordem,utilizador_id) VALUES ${ph}`, vals);
  }
  res.json({ ok: true });
}));

app.post('/api/meios_eventos', requireAuth('operacional'), wrap(async (req, res) => {
  const b = req.body;
  await pool.query(
    'INSERT INTO meios_eventos (meio_id, ts, msg, user_id) VALUES ($1,$2,$3,$4)',
    [b.meio_id, b.ts || new Date().toISOString(), b.msg, req.user.id]
  );
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  OCORRÊNCIAS EVENTOS
// ══════════════════════════════════════════════════════════════════
app.get('/api/ocorrencias_eventos', requireAuth('tecnico'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM ocorrencias_eventos ORDER BY ts DESC');
  res.json(rows);
}));

app.post('/api/ocorrencias_eventos', requireAuth('operacional'), requireAuthForOccurrence, wrap(async (req, res) => {
  const b = req.body;
  await pool.query(
    'INSERT INTO ocorrencias_eventos (ocorrencia_id, ts, tag, meio_label, msg, user_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [b.ocorrencia_id, b.ts || new Date().toISOString(), b.tag || 'occ', b.meio_label || null, b.msg, req.user.id]
  );
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  TIMELINE
// ══════════════════════════════════════════════════════════════════
app.get('/api/ocorrencias/:id/timeline', requireAuth('tecnico'), wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT ts, categoria, titulo, descricao, dados, autor_nome, meio_eq FROM (
      SELECT ot.ts, ot.categoria, ot.titulo, ot.descricao, ot.dados, ot.autor_nome,
             m.eq AS meio_eq
      FROM ocorrencia_timeline ot
      LEFT JOIN meios m ON m.id = ot.meio_id
      WHERE ot.ocorrencia_id = $1

      UNION ALL

      SELECT oe.ts, 'ocorrencia', oe.msg, NULL, NULL::JSONB, NULL, NULL
      FROM ocorrencias_eventos oe
      WHERE oe.ocorrencia_id = $1

      UNION ALL

      SELECT me.ts, 'meios_icnf', me.msg, NULL,
             jsonb_build_object('missao', m.missao, 'estado', m.estado),
             NULL, m.eq
      FROM meios_eventos me
      JOIN meios m ON m.id = me.meio_id
      WHERE m.ocorrencia_id = $1
    ) sub
    ORDER BY ts DESC
  `, [req.params.id]);
  res.json(rows);
}));

app.post('/api/ocorrencias/:id/timeline', requireAuth('operacional'), requireAuthForOccurrence, wrap(async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(
    `INSERT INTO ocorrencia_timeline
       (ocorrencia_id, ts, categoria, titulo, descricao, dados, autor_nome, autor_id, meio_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.params.id, b.ts || new Date().toISOString(), b.categoria, b.titulo || null,
     b.descricao || null, b.dados ? JSON.stringify(b.dados) : null,
     req.user.nome, req.user.id, b.meio_id || null]
  );
  res.json(rows[0]);
}));

// ══════════════════════════════════════════════════════════════════
//  EQUIPAS
// ══════════════════════════════════════════════════════════════════
app.get('/api/equipas', requireAuth('tecnico'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM equipas ORDER BY nome');
  res.json(rows);
}));

app.post('/api/equipas', requireAuth('dradj_cnsr'), wrap(async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(
    'INSERT INTO equipas (nome, tipo, tipo_equipa, subregiao, concelho, capacidade, origem, notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [b.nome, b.tipo || null, b.tipo_equipa || null, b.subregiao || null, b.concelho || null,
     b.capacidade || 0, b.origem || null, b.notas || null]
  );
  res.json(rows[0]);
}));

app.patch('/api/equipas/:id', requireAuth('dradj_cnsr'), wrap(async (req, res) => {
  const b = req.body;
  await pool.query(
    `UPDATE equipas SET nome=$1, tipo=$2, tipo_equipa=$3, subregiao=$4, concelho=$5,
     capacidade=$6, origem=$7, notas=$8 WHERE id=$9`,
    [b.nome, b.tipo || null, b.tipo_equipa || null, b.subregiao || null, b.concelho || null,
     b.capacidade || 0, b.origem || null, b.notas || null, req.params.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/equipas/:id', requireAuth('dradj_cnsr'), wrap(async (req, res) => {
  await pool.query('DELETE FROM equipas WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  OPERACIONAIS PREDEFINIDOS
// ══════════════════════════════════════════════════════════════════
app.get('/api/operacionais', requireAuth('tecnico'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM operacionais_predefinidos ORDER BY nome');
  res.json(rows);
}));

app.post('/api/operacionais', requireAuth('dradj_cnsr'), wrap(async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(
    'INSERT INTO operacionais_predefinidos (nome, categoria, contacto, notas) VALUES ($1,$2,$3,$4) RETURNING *',
    [b.nome, b.categoria || null, b.contacto || null, b.notas || null]
  );
  res.json(rows[0]);
}));

app.patch('/api/operacionais/:id', requireAuth('dradj_cnsr'), wrap(async (req, res) => {
  const b = req.body;
  await pool.query(
    'UPDATE operacionais_predefinidos SET nome=$1, categoria=$2, contacto=$3, notas=$4 WHERE id=$5',
    [b.nome, b.categoria || null, b.contacto || null, b.notas || null, req.params.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/operacionais/:id', requireAuth('dradj_cnsr'), wrap(async (req, res) => {
  await pool.query('DELETE FROM operacionais_predefinidos WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  UTILIZADORES (admin only)
// ══════════════════════════════════════════════════════════════════
// Utilizadores de campo (tecnico + operacional) — acessível a dradj_cnsr para associar aos meios
app.get('/api/utilizadores/tecnicos', requireAuth('dradj_cnsr'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, nome, email, role FROM utilizadores
     WHERE role IN ('tecnico','operacional') AND ativo = true
     ORDER BY nome`
  );
  res.json(rows);
}));

app.get('/api/utilizadores', requireAuth('administrador'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, email, nome, role, subregiao, ativo, created_at FROM utilizadores ORDER BY created_at'
  );
  res.json(rows);
}));

app.post('/api/utilizadores', requireAuth('administrador'), wrap(async (req, res) => {
  const { email, nome, password, role, subregiao } = req.body || {};
  if (!email || !nome || !password)
    return res.status(400).json({ error: 'Email, nome e password obrigatórios.' });
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `INSERT INTO utilizadores (email, nome, password_hash, role, subregiao, ativo)
     VALUES ($1,$2,$3,$4,$5,true)
     RETURNING id, email, nome, role, subregiao, ativo, created_at`,
    [email.trim().toLowerCase(), nome.trim(), hash, role || 'tecnico', subregiao || null]
  );
  res.json(rows[0]);
}));

app.patch('/api/utilizadores/:id', requireAuth('administrador'), wrap(async (req, res) => {
  const { role, subregiao, ativo, password } = req.body || {};
  if (password !== undefined) {
    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE utilizadores SET password_hash=$1 WHERE id=$2', [hash, req.params.id]);
  }
  if (role !== undefined)
    await pool.query('UPDATE utilizadores SET role=$1 WHERE id=$2', [role, req.params.id]);
  if (subregiao !== undefined)
    await pool.query('UPDATE utilizadores SET subregiao=$1 WHERE id=$2', [subregiao || null, req.params.id]);
  if (ativo !== undefined)
    await pool.query('UPDATE utilizadores SET ativo=$1 WHERE id=$2', [ativo, req.params.id]);
  res.json({ ok: true });
}));

app.delete('/api/utilizadores/:id', requireAuth('administrador'), wrap(async (req, res) => {
  if (req.params.id === req.user.id)
    return res.status(400).json({ error: 'Não pode eliminar a sua própria conta.' });
  await pool.query('DELETE FROM utilizadores WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  OFICIAIS DE LIGAÇÃO
// ══════════════════════════════════════════════════════════════════
app.get('/api/ocorrencias/:id/oficiais_ligacao', requireAuth('tecnico'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ol.utilizador_id, ol.nomeado_em, u.nome, u.email
     FROM ocorrencia_oficiais_ligacao ol
     JOIN utilizadores u ON u.id = ol.utilizador_id
     WHERE ol.ocorrencia_id = $1
     ORDER BY ol.nomeado_em`,
    [req.params.id]
  );
  res.json(rows);
}));

app.post('/api/ocorrencias/:id/oficiais_ligacao', requireAuth('dradj_cnsr'), wrap(async (req, res) => {
  const { utilizador_id } = req.body;
  if (!utilizador_id) return res.status(400).json({ error: 'utilizador_id obrigatório.' });
  await pool.query(
    `INSERT INTO ocorrencia_oficiais_ligacao (ocorrencia_id, utilizador_id, nomeado_por)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [req.params.id, utilizador_id, req.user.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/ocorrencias/:id/oficiais_ligacao/:uid', requireAuth('dradj_cnsr'), wrap(async (req, res) => {
  await pool.query(
    'DELETE FROM ocorrencia_oficiais_ligacao WHERE ocorrencia_id=$1 AND utilizador_id=$2',
    [req.params.id, req.params.uid]
  );
  res.json({ ok: true });
}));

// ─── Proxy fogos.pt (browser directo é bloqueado por Cloudflare) ─
app.get('/api/fogos/active', requireAuth('tecnico'), wrap(async (req, res) => {
  const r = await fetch('https://api.fogos.pt/v2/incidents/active', {
    headers: { 'User-Agent': 'GestaoMeiosGFR/1.0' },
  });
  if (!r.ok) return res.status(502).json({ success: false, error: 'fogos.pt indisponível' });
  const data = await r.json();
  res.json(data);
}));

// ─── Startup migrations ──────────────────────────────────────────
async function runMigrations() {
  // ── Renomear perfis (idempotente: só corre se ainda existirem os nomes antigos) ──
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='utilizadores' AND column_name='role') THEN
        ALTER TABLE utilizadores DROP CONSTRAINT IF EXISTS utilizadores_role_check;
        UPDATE utilizadores SET role='administrador' WHERE role='admin';
        UPDATE utilizadores SET role='dradj_cnsr'    WHERE role='gestor';
        UPDATE utilizadores SET role='tecnico'        WHERE role='visualizador';
        ALTER TABLE utilizadores ADD CONSTRAINT utilizadores_role_check
          CHECK (role IN ('administrador','dradj_cnsr','tecnico','operacional'));
      END IF;
    END $$
  `);

  // ── Tabela de nomeações de Oficial de Ligação ────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ocorrencia_oficiais_ligacao (
      ocorrencia_id UUID NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
      utilizador_id UUID NOT NULL REFERENCES utilizadores(id) ON DELETE CASCADE,
      nomeado_por   UUID REFERENCES utilizadores(id) ON DELETE SET NULL,
      nomeado_em    TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (ocorrencia_id, utilizador_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ofic_lig_occ  ON ocorrencia_oficiais_ligacao(ocorrencia_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ofic_lig_user ON ocorrencia_oficiais_ligacao(utilizador_id)`);

  // ── user_id em meios_operativos (para ligar operacional ao seu meio) ─
  await pool.query(`ALTER TABLE meios_operativos ADD COLUMN IF NOT EXISTS utilizador_id UUID REFERENCES utilizadores(id) ON DELETE SET NULL`);

  // Add new columns (idempotent)
  await pool.query(`ALTER TABLE equipas ADD COLUMN IF NOT EXISTS tipo_equipa TEXT`);
  await pool.query(`ALTER TABLE equipas ADD COLUMN IF NOT EXISTS subregiao   TEXT`);
  await pool.query(`ALTER TABLE equipas ADD COLUMN IF NOT EXISTS concelho    TEXT`);

  // Previsto state: new columns + extend CHECK constraint
  await pool.query(`ALTER TABLE meios ADD COLUMN IF NOT EXISTS previsto_data DATE`);
  await pool.query(`ALTER TABLE meios ADD COLUMN IF NOT EXISTS previsto_hora TIME`);
  // Drop old CHECK and re-add with 'previsto' included (idempotent via constraint name)
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'meios_estado_check' AND conrelid = 'meios'::regclass
      ) THEN
        ALTER TABLE meios DROP CONSTRAINT meios_estado_check;
      END IF;
    END $$
  `);
  await pool.query(`
    ALTER TABLE meios ADD CONSTRAINT meios_estado_check
      CHECK (estado IN ('transito','operacao','descanso','desmobilizado','previsto'))
  `);

  // Timeline table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ocorrencia_timeline (
      id            SERIAL PRIMARY KEY,
      ocorrencia_id UUID NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
      ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      categoria     TEXT NOT NULL,
      titulo        TEXT,
      descricao     TEXT,
      dados         JSONB,
      autor_nome    TEXT,
      autor_id      UUID REFERENCES utilizadores(id),
      meio_id       UUID REFERENCES meios(id)
    )
  `);

  // Seed ICNF/ANEPC 2026 data if table is empty
  const { rows: cnt } = await pool.query('SELECT COUNT(*) FROM equipas');
  if (parseInt(cnt[0].count) === 0) {
    const fs = require('fs');
    const sqlPath = require('path').join(__dirname, 'migration_v2_equipas.sql');
    if (fs.existsSync(sqlPath)) {
      const sql = fs.readFileSync(sqlPath, 'utf8');
      await pool.query(sql);
      console.log('Meios predefinidos ICNF/ANEPC 2026 importados.');
    }
  }
}

// ─── Start ────────────────────────────────────────────────────────
if (require.main === module) {
  runMigrations()
    .then(() => app.listen(PORT, () => console.log(`Gestão Meios a correr na porta ${PORT}`)))
    .catch(err => { console.error('Erro na migração:', err.message); process.exit(1); });
}

module.exports = { app, pool };
