# Novo Modelo de Perfis e Permissões — Plano de Implementação

## Contexto

O modelo atual é **linear e estático** — o perfil do utilizador define tudo, para sempre:
```
visualizador < operacional < gestor < admin
```

O novo modelo é **híbrido**: o perfil base define o mínimo, mas as permissões reais dependem também do contexto (em que ocorrência? em que meio?).

---

## Perfis e permissões

| Perfil | Situação | Leitura | Escrita |
|---|---|---|---|
| `administrador` | — | tudo | tudo |
| `dradj_cnsr` | — | ocorrências da sua sub-região | gestão completa da sub-região |
| `tecnico` | base (sem nomeação, sem meio) | ocorrências da **sua sub-região** | nenhuma |
| `tecnico` | incluído num meio | idem | ações rápidas **nesse meio** (= operacional) |
| `tecnico` | Oficial de Ligação numa ocorrência | sub-região + ocorrências nomeadas | gestão completa **dessas ocorrências** (= dradj_cnsr) |
| `operacional` | — | ocorrências da sua sub-região | ações rápidas **no próprio meio** |

### Regras detalhadas

- **Administrador**: cria utilizadores, nomeia Oficiais de Ligação, acede a tudo
- **DRAdj+CNSR**: gere ocorrências da sua sub-região, pode nomear Oficiais de Ligação
- **Técnico (base)**: leitura das ocorrências da **sua sub-região**; sem escrita
- **Técnico (em meio)**: se incluído em `meios_operativos` de um meio, pode fazer ações rápidas nesse meio — equivalente a `operacional`
- **Técnico (Oficial de Ligação)**: nomeado por Admin ou DRAdj+CNSR para uma ocorrência específica; passa a ter permissões de DRAdj+CNSR **apenas nessa ocorrência**; mantém leitura da sua sub-região para as restantes
- **Operacional**: leitura das ocorrências da sua sub-região; ações rápidas apenas no meio onde está listado; acede via app mobile

---

## Alterações necessárias

### 1. Renomear perfis na BD

Alterar o `CHECK constraint` na tabela `utilizadores`:

```sql
ALTER TABLE utilizadores DROP CONSTRAINT utilizadores_role_check;
ALTER TABLE utilizadores ADD CONSTRAINT utilizadores_role_check
  CHECK (role IN ('administrador', 'dradj_cnsr', 'tecnico', 'operacional'));
```

Migrar utilizadores existentes:
```sql
UPDATE utilizadores SET role = 'administrador' WHERE role = 'admin';
UPDATE utilizadores SET role = 'dradj_cnsr'    WHERE role = 'gestor';
UPDATE utilizadores SET role = 'tecnico'        WHERE role = 'visualizador';
-- operacional mantém-se igual
```

### 2. Nova tabela: nomeações de Oficial de Ligação

```sql
CREATE TABLE ocorrencia_oficiais_ligacao (
  ocorrencia_id UUID NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
  utilizador_id UUID NOT NULL REFERENCES utilizadores(id) ON DELETE CASCADE,
  nomeado_por   UUID REFERENCES utilizadores(id) ON DELETE SET NULL,
  nomeado_em    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (ocorrencia_id, utilizador_id)
);

CREATE INDEX idx_ofic_lig_occ  ON ocorrencia_oficiais_ligacao(ocorrencia_id);
CREATE INDEX idx_ofic_lig_user ON ocorrencia_oficiais_ligacao(utilizador_id);
```

### 3. Ligar Operacional ao seu meio

Adicionar `utilizador_id` a `meios_operativos` para que o sistema saiba a que meio cada utilizador `operacional` pertence:

```sql
ALTER TABLE meios_operativos ADD COLUMN utilizador_id UUID REFERENCES utilizadores(id) ON DELETE SET NULL;
```

> **Nota**: ao adicionar um operacional ao meio, passa a seleccionar-se da lista de utilizadores com perfil `operacional` em vez de escrever o nome manualmente. A coluna `nome` mantém-se como fallback/display.

---

## Middleware de permissão contextual (server.js)

O `requireAuth(minRole)` actual é substituído ou complementado por funções que verificam também a BD:

```js
// Verifica se o utilizador é dradj_cnsr ou Oficial de Ligação nomeado para a ocorrência
async function requireAuthForOccurrence(req, res, next) {
  const { id: occId } = req.params;
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
}

// Verifica se o utilizador pode actuar sobre um meio (dradj_cnsr, Ofic.Lig. ou operacional do próprio meio)
async function requireAuthForMeio(req, res, next) {
  const { id: meioId } = req.params;
  const { id: userId, role } = req.user;
  if (['administrador', 'dradj_cnsr'].includes(role)) return next();
  // Técnico nomeado Oficial de Ligação na ocorrência deste meio
  if (role === 'tecnico') {
    const { rows } = await pool.query(
      `SELECT 1 FROM ocorrencia_oficiais_ligacao ol
       JOIN meios m ON m.ocorrencia_id = ol.ocorrencia_id
       WHERE m.id = $1 AND ol.utilizador_id = $2`,
      [meioId, userId]
    );
    if (rows.length) return next();
  }
  // Operacional OU Técnico listado neste meio
  if (role === 'operacional' || role === 'tecnico') {
    const { rows } = await pool.query(
      'SELECT 1 FROM meios_operativos WHERE meio_id=$1 AND utilizador_id=$2',
      [meioId, userId]
    );
    if (rows.length) return next();
  }
  return res.status(403).json({ error: 'Sem permissão para este meio.' });
}
```

### Tabela de endpoints actualizada

| Método | Rota | Permissão |
|---|---|---|
| GET | `/api/ocorrencias` | qualquer autenticado; `tecnico` e `operacional` filtrados pela sua `subregiao`; Oficial de Ligação vê também as ocorrências nomeadas |
| POST | `/api/ocorrencias` | `dradj_cnsr` ou `tecnico` nomeado |
| PATCH | `/api/ocorrencias/:id` | `requireAuthForOccurrence` |
| DELETE | `/api/ocorrencias/:id` | `administrador` |
| POST | `/api/meios` | `requireAuthForOccurrence` (via `body.ocorrencia_id`) |
| PATCH | `/api/meios/:id` | `requireAuthForMeio` |
| DELETE | `/api/meios/:id` | `requireAuthForOccurrence` |
| POST | `/api/ocorrencias/:id/timeline` | `requireAuthForOccurrence` |
| GET/POST | `/api/ocorrencia_oficiais_ligacao` | `dradj_cnsr` ou `administrador` |

---

## Novos endpoints necessários

```
GET  /api/ocorrencias/:id/oficiais_ligacao       → lista nomeações da ocorrência
POST /api/ocorrencias/:id/oficiais_ligacao       → nomear Técnico como Oficial de Ligação
DELETE /api/ocorrencias/:id/oficiais_ligacao/:uid → remover nomeação
```

---

## Alterações no frontend

### Web (gestores/admin)
- UI para nomear/remover Oficial de Ligação em cada ocorrência (painel na página de detalhe)
- Selector de utilizadores filtra por perfil `tecnico`
- Badge "Oficial de Ligação" visível na ocorrência

### Mobile PWA (operacional/técnico)
- **Técnico (base)**: vista de leitura — lista de ocorrências e Fita do Tempo
- **Técnico (Oficial de Ligação)**: vista completa de gestão para as ocorrências nomeadas
- **Operacional**: vista ultra-simplificada — só o seu meio, ações rápidas, Fita do Tempo

---

## Ordem de implementação sugerida

1. Renomear perfis na BD + migrar utilizadores existentes
2. Actualizar `ROLE_ORDER` e `requireAuth` em `server.js`
3. Criar tabela `ocorrencia_oficiais_ligacao` via `runMigrations()`
4. Adicionar `utilizador_id` a `meios_operativos` via `runMigrations()`
5. Implementar `requireAuthForOccurrence` e `requireAuthForMeio`
6. Actualizar endpoints existentes para usar novos middlewares
7. Novos endpoints de nomeação
8. UI web: painel de nomeação de Oficial de Ligação
9. UI mobile: vista simplificada por perfil

---

## Notas de segurança

- O JWT continua a conter apenas o perfil base (`role`). As permissões contextuais são sempre verificadas **no servidor** em cada pedido — o cliente nunca é fonte de verdade para permissões.
- A tabela `ocorrencia_oficiais_ligacao` é a fonte de verdade para elevações de perfil.
- Um `tecnico` não nomeado que tente escrever via API recebe 403, independentemente do que o frontend mostre.
