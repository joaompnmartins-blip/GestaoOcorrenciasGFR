# Linha de Tempo Global por Ocorrência — Plano de Implementação

## O que existe agora (não se perde nada)

| Tabela | O que guarda | Ligação |
|---|---|---|
| `ocorrencias_eventos` | Log da ocorrência: mudanças de estado, obs, sector | `ocorrencia_id` |
| `meios_eventos` | Log por meio: cada acção dos doQuick* | `meio_id` |

Ambas ficam **intactas**. A timeline agrega-as, não substitui.

---

## Nova tabela: `ocorrencia_timeline`

```sql
CREATE TABLE ocorrencia_timeline (
  id            SERIAL PRIMARY KEY,
  ocorrencia_id INTEGER NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
  ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  categoria     TEXT NOT NULL,   -- ver lista abaixo
  titulo        TEXT,            -- linha curta para o card da timeline
  descricao     TEXT,            -- texto livre / detalhe
  dados         JSONB,           -- campos estruturados por categoria
  autor_nome    TEXT,            -- nome para exibição (desnormalizado)
  autor_id      INTEGER REFERENCES utilizadores(id),
  meio_id       INTEGER REFERENCES meios(id)  -- opcional: ligação a um meio
);
```

### Categorias (`categoria`)

| Valor | Ícone | Dados JSONB típicos |
|---|---|---|
| `geral` | 📝 | — |
| `estado_ocorrencia` | 🔄 | `{estado_anterior, estado_novo}` |
| `comportamento_fogo` | 🔥 | `{propagacao, intensidade, perimetro_ha, frentes}` |
| `meteorologia` | 🌬️ | `{vento_dir, vento_vel, temp, humidade, visibilidade}` |
| `meios_proprios` | 🚒 | `{meio_eq, estado_anterior, estado_novo}` |
| `meios_outros` | 🤝 | `{entidade, designacao, tipo, quantidade, acao}` |
| `comunicacao` | 📡 | `{destinatario, canal}` |
| `decisao` | ⚡ | `{decisao, fundamentacao}` |

---

## Vista unificada — query da timeline

A timeline é uma `UNION ALL` de três fontes, ordenada por `ts`:

```
ocorrencias_eventos  ──┐
                       ├──► ORDER BY ts  ──► frontend
meios_eventos ─────────┤
                       │
ocorrencia_timeline ───┘
```

O GET devolve linhas normalizadas com campos comuns:
`{ ts, categoria, titulo, descricao, dados, autor_nome, meio_eq }`

O frontend não precisa de saber de onde veio cada linha.

---

## API — novos endpoints

| Método | Rota | Mín. perfil | Descrição |
|---|---|---|---|
| GET | `/api/ocorrencias/:id/timeline` | visualizador | Devolve timeline unificada ordenada por ts |
| POST | `/api/ocorrencias/:id/timeline` | operacional | Adiciona nova entrada à `ocorrencia_timeline` |

---

## Alterações mínimas ao que existe

| O que muda | Porquê |
|---|---|
| `runMigrations()` adiciona `CREATE TABLE IF NOT EXISTS ocorrencia_timeline` | Deploy automático sem intervenção manual |
| 2 novos endpoints em `server.js` (GET + POST timeline) | Leitura e escrita |
| `meios_eventos` e `ocorrencias_eventos` — **zero alterações** | Retrocompatibilidade total |
| Novo painel "Linha de Tempo" na UI da ocorrência | Tab ou secção expansível no detalhe da ocorrência |

---

## UI — esboço do painel

```
┌─────────────────────────────────────────────────────┐
│  LINHA DE TEMPO — Ocorrência #42                    │
│  [+ Adicionar entrada ▼]  [🔥][🌬️][🤝][📡][⚡][📝]  │
├─────────────────────────────────────────────────────┤
│ 14:32  🔥 COMPORTAMENTO FOGO                        │
│        Propagação rápida para NE. 2 frentes. ~8ha   │
│        Vento 35km/h NE — João M.                    │
│                                                     │
│ 14:15  🚒 MEIO PRÓPRIO — VFCI-GFR-001              │
│        Previsto → Em Trânsito. Despacho 14:15       │
│        [auto, gerado pelo doQuickTransit]           │
│                                                     │
│ 13:55  🌬️ METEOROLOGIA                              │
│        T:28°C  H:32%  Vento:NE 28km/h               │
│                                                     │
│ 13:40  🤝 MEIOS OUTROS — Bombeiros de Aveiro        │
│        2 VFCI chegaram ao TO. Sector B              │
│                                                     │
│ 13:30  🔄 ESTADO OCORRÊNCIA                         │
│        Aberta → Em curso — João M.                  │
└─────────────────────────────────────────────────────┘
```

### Formulários por categoria

**Comportamento de Fogo**
- Campos: Propagação (texto), Intensidade (baixa/média/alta/extrema), Perímetro estimado (ha), N.º frentes, Observações

**Meteorologia**
- Campos: Temperatura (°C), Humidade relativa (%), Velocidade do vento (km/h), Direcção do vento, Visibilidade, Observações

**Meios de Outras Entidades**
- Campos: Entidade (texto), Designação, Tipo, Quantidade, Acção/Estado, Sector

**Comunicação**
- Campos: Destinatário/Origem, Canal (rádio/telefone/email), Mensagem resumida

**Decisão**
- Campos: Decisão tomada, Fundamentação, Responsável

**Geral**
- Campo único: Texto livre

---

## Vantagens desta abordagem

- **Zero perda de dados**: `meios_eventos` e `ocorrencias_eventos` mantêm-se inalterados
- **Extensível**: novas categorias = apenas novo valor em `categoria`, sem alterar o schema
- **JSONB para dados estruturados**: cada categoria tem os seus campos sem precisar de colunas fixas para cada um
- **doQuick\* alimenta automaticamente**: via `persistOccEvento`, os eventos de meios aparecem na timeline sem código extra
- **Exportação**: o `.txt` existente pode incluir a timeline completa com uma query adicional ao mesmo endpoint

---

## Ordem de implementação sugerida

1. Migração: `CREATE TABLE IF NOT EXISTS ocorrencia_timeline` em `runMigrations()`
2. Endpoint `GET /api/ocorrencias/:id/timeline` com UNION das três tabelas
3. Endpoint `POST /api/ocorrencias/:id/timeline`
4. Painel "Linha de Tempo" na UI — vista de leitura (cards por categoria)
5. Formulário "Adicionar entrada" com selector de categoria e campos dinâmicos
6. Integração automática dos `doQuick*` (passar categoria `meios_proprios` ao `persistOccEvento`)
7. Exportação `.txt` actualizada para incluir a timeline
