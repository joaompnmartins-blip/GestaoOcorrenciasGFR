-- Gestão Meios — Railway PostgreSQL Schema
-- Run this once in the Railway database console after provisioning PostgreSQL.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── UTILIZADORES ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS utilizadores (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    nome          TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'visualizador'
                                CHECK (role IN ('admin','gestor','operacional','visualizador')),
    subregiao     TEXT,
    ativo         BOOLEAN     DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ─── EQUIPAS (meios predefinidos) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipas (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        TEXT        NOT NULL,
    tipo        TEXT,
    tipo_equipa TEXT,
    subregiao   TEXT,
    concelho    TEXT,
    capacidade  INT         DEFAULT 0,
    origem      TEXT,
    notas       TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── OPERACIONAIS PREDEFINIDOS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operacionais_predefinidos (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        TEXT        NOT NULL,
    categoria   TEXT,
    contacto    TEXT,
    notas       TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── OCORRÊNCIAS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ocorrencias (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    local_ignicao     TEXT        NOT NULL,
    codigo_ocorrencia TEXT,
    subregiao         TEXT,
    concelho          TEXT,
    obs               TEXT,
    inicio            TIMESTAMPTZ,
    status            TEXT        DEFAULT 'active' CHECK (status IN ('active','closed')),
    created_by        UUID        REFERENCES utilizadores(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ─── MEIOS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meios (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ocorrencia_id           UUID        NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
    equipa_id               UUID        REFERENCES equipas(id) ON DELETE SET NULL,
    eq                      TEXT        NOT NULL,
    tipo                    TEXT,
    matricula               TEXT,
    concelho                TEXT,
    setor                   TEXT,
    operacionais            INT         DEFAULT 0,
    responsavel             TEXT,
    contacto                TEXT,
    data_despacho           DATE,
    hora_despacho           TIME,
    data_saida_entidade     DATE,
    hora_saida_entidade     TIME,
    data_chegada            DATE,
    hora_chegada            TIME,
    horas_max               INT,
    limite_op               TIME,
    limite_op_date          DATE,
    data_demob              DATE,
    hora_demob              TIME,
    data_chegada_entidade   DATE,
    hora_chegada_entidade   TIME,
    km                      INT,
    missao                  TEXT,
    obs                     TEXT,
    estado                  TEXT        DEFAULT 'transito'
                                          CHECK (estado IN ('transito','operacao','descanso','desmobilizado','previsto')),
    previsto_data           DATE,
    previsto_hora           TIME,
    created_by              UUID        REFERENCES utilizadores(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

-- ─── MEIOS OPERATIVOS (nomes dos elementos) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS meios_operativos (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meio_id  UUID NOT NULL REFERENCES meios(id) ON DELETE CASCADE,
    nome     TEXT NOT NULL,
    ordem    INT  DEFAULT 0
);

-- ─── MEIOS EVENTOS (log por meio) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meios_eventos (
    id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    meio_id  UUID        NOT NULL REFERENCES meios(id) ON DELETE CASCADE,
    ts       TIMESTAMPTZ DEFAULT now(),
    msg      TEXT        NOT NULL,
    user_id  UUID        REFERENCES utilizadores(id) ON DELETE SET NULL
);

-- ─── OCORRÊNCIAS EVENTOS (histórico completo) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS ocorrencias_eventos (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ocorrencia_id UUID        NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
    ts            TIMESTAMPTZ DEFAULT now(),
    tag           TEXT        DEFAULT 'occ',
    meio_label    TEXT,
    msg           TEXT        NOT NULL,
    user_id       UUID        REFERENCES utilizadores(id) ON DELETE SET NULL
);

-- ─── SECTORES PREDEFINIDOS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sectores (
    id         SERIAL PRIMARY KEY,
    designacao TEXT   NOT NULL UNIQUE
);
INSERT INTO sectores(designacao) VALUES
  ('PC'),('ALFA'),('BRAVO'),('CHARLIE'),('DELTA'),
  ('FOXTROT'),('GOLF'),('HOTEL'),('INDIA')
ON CONFLICT DO NOTHING;

-- ─── ÍNDICES ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_meios_ocorrencia    ON meios(ocorrencia_id);
CREATE INDEX IF NOT EXISTS idx_meios_estado        ON meios(estado);
CREATE INDEX IF NOT EXISTS idx_meios_eventos_meio  ON meios_eventos(meio_id);
CREATE INDEX IF NOT EXISTS idx_meios_operativos    ON meios_operativos(meio_id);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_status  ON ocorrencias(status);
CREATE INDEX IF NOT EXISTS idx_occ_eventos_occ     ON ocorrencias_eventos(ocorrencia_id);
CREATE INDEX IF NOT EXISTS idx_occ_eventos_ts      ON ocorrencias_eventos(ts);

-- ─── TRIGGERS updated_at ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE OR REPLACE TRIGGER trg_utilizadores_upd
  BEFORE UPDATE ON utilizadores FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER trg_ocorrencias_upd
  BEFORE UPDATE ON ocorrencias  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER trg_meios_upd
  BEFORE UPDATE ON meios        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER trg_equipas_upd
  BEFORE UPDATE ON equipas      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── PRIMEIRO UTILIZADOR ADMIN ────────────────────────────────────────────────
-- Substitua os valores e execute após criar as tabelas.
-- Gere o hash com: node -e "require('bcrypt').hash('A_SUA_PASSWORD',12).then(console.log)"
--
-- INSERT INTO utilizadores (email, password_hash, nome, role, ativo)
-- VALUES (
--   'admin@icnf.pt',
--   '$2b$12$HASH_GERADO_AQUI',
--   'Administrador',
--   'admin',
--   true
-- );
