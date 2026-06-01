# Gestão Ocorrências GFR — Resumo do Projecto

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | `Gestao_Meios_v17.html` — single-file SPA (~4200 linhas) |
| Backend | `server.js` — Node.js / Express |
| Base de dados | Railway PostgreSQL (`DATABASE_URL`) |
| Auth | JWT (12h) em `sessionStorage`, bcrypt passwords |
| Deploy | Railway (NIXPACKS, `node server.js`) |
| PWA | `manifest.json` + `sw.js` (service worker network-first) |

---

## Ficheiros principais

| Ficheiro | Descrição |
|---|---|
| `Gestao_Meios_v17.html` | Frontend completo |
| `server.js` | API REST + proxy + migrações automáticas |
| `schema.sql` | Schema PostgreSQL (executar uma vez no Railway) |
| `migration_v2_equipas.sql` | 868 meios ICNF 2026 (seed automático no arranque) |
| `manifest.json` | Web App Manifest (PWA — nome, ícone, cores ICNF) |
| `sw.js` | Service Worker (cache v2: network-first para HTML, cache para assets) |
| `icons/icon.svg` | Ícone PWA — padrão 4 quadrados ICNF |
| `manual_utilizador.html` | Manual do utilizador (abre em nova tab) |
| `new_profiles.md` | Plano detalhado do modelo de perfis (referência) |
| `railway.json` | Config de deploy Railway |
| `package.json` | Deps: express, pg, bcrypt, jsonwebtoken, dotenv |

---

## Funcionalidades implementadas

### Autenticação e perfis

**4 perfis** com permissões hierárquicas e contextuais:

| Perfil | Acesso | Notas |
|---|---|---|
| `administrador` | Total | Cria utilizadores, nomeia OL, elimina ocorrências |
| `dradj_cnsr` | Sub-região atribuída | Pode auto-nomear-se OL na sua sub-região; admin pode nomeá-lo noutras |
| `tecnico` | Leitura da sub-região | Se nomeado Oficial de Ligação, tem acesso de gestor nessa ocorrência |
| `operacional` | Só o seu meio | Acções rápidas (Activar Op., Obs.) apenas no meio onde está listado |

**Regras contextuais:**
- `ROLE_ORDER`: `tecnico < operacional < dradj_cnsr < administrador`
- JWT normalizado na emissão (aliases `admin→administrador`, `gestor→dradj_cnsr`, `visualizador→tecnico` para tokens antigos)
- `requireAuthForOccurrence`: verifica se o utilizador é OL da ocorrência (tecnico/dradj_cnsr OL)
- `requireAuthForMeio`: verifica membership em `meios_operativos` (operacional/tecnico) ou OL

**Ecrã inicial ao fazer login:** sempre o menu de ocorrências, filtrado por perfil.

**Sidebar por perfil:**
- `operacional`: só "📖 Manual" visível
- Todos os outros: navegação completa

### Oficiais de Ligação

- `dradj_cnsr` e `administrador` podem nomear técnicos, dradj_cnsr e eles próprios como Oficial de Ligação numa ocorrência
- Tabela `ocorrencia_oficiais_ligacao` (ocorrencia_id, utilizador_id, nomeado_por, nomeado_em)
- Painel **⚡ Oficiais de Ligação** na página de detalhe (visível para dradj_cnsr+)
- Nomeação/remoção gera entrada automática na **Fita do Tempo** (categoria Ocorrência)
- Badge **⚡ Ofic. Ligação** no cartão de ocorrência quando o utilizador é OL
- `currentOccIsOL`: flag calculada por `openDetalhe`; controla visibilidade de botões e Fita do Tempo para tecnico/dradj_cnsr OL

### Associar operacionais/técnicos aos meios

- `meios_operativos` tem coluna `utilizador_id UUID` (adicionada via migração)
- Modal de edição de meio: selector de utilizador sistema (tecnico/operacional/dradj_cnsr) junto ao campo de nome
- Ao seleccionar utilizador, nome preenche-se automaticamente; `utilizador_id` é guardado
- Campo de texto mantém-se para operativos sem conta no sistema (retrocompatível)
- `requireAuthForMeio` usa `utilizador_id` para verificar se operacional tem permissão

### Ocorrências

- CRUD completo (criar, editar, fechar, reabrir, eliminar)
- Fechar → move para Arquivo; Reabrir → volta à lista activa
- Filtro por sub-região (dradj_cnsr: automático; administrador: dropdown)
- Importação de ocorrência a partir do **mapa fogos.pt**
- **Visibilidade por perfil:**
  - `administrador`: todas
  - `dradj_cnsr`: sub-região + ocorrências OL noutras sub-regiões
  - `tecnico`: sub-região + ocorrências OL
  - `operacional`: ocorrências onde está incluído num meio

### Fita do Tempo

- Tabela `ocorrencia_timeline` (UUID, JSONB, categoria, autor, meio)
- Painel **⏱ Fita do Tempo** na página de detalhe (oculto para operacional e tecnico não-OL)
- **Categorias:**
  - 🔄 **Ocorrência** — auto-gerada a partir de `ocorrencias_eventos` (criação, estado, OL)
  - 🚒 **Meios ICNF** — auto-gerada a partir de `meios_eventos`; badge de missão ◌/✓
  - 🤝 **Meios Outros** — entrada manual (texto livre)
  - 🌬️ **Meteorologia** — entrada manual (texto livre)
  - 📡 **Comunicações** — entrada manual (texto livre)
  - 🏛️ **Atividade ICNF** — entrada manual (texto livre)
  - 👥 **Atividade Outros** — entrada manual (texto livre)
  - 📝 **Outros** — entrada manual (texto livre)
- Filtros: por categoria (chips) + por intervalo de data/hora (De/Até)
- Exportação em `.txt` com filtros aplicados
- API: `GET/POST /api/ocorrencias/:id/timeline` (UNION de 3 tabelas)

### Meios

- Adicionar/editar/eliminar meios por ocorrência
- **5 estados**: `previsto` · `transito` · `operacao` · `descanso` · `desmobilizado`
- Acções rápidas por perfil:
  - `administrador`/`dradj_cnsr`/`tecnico OL`: todas (Activar, Descanso, Desmob., Setor, Obs., Editar, Apagar)
  - `operacional`: Activar Op., Activar Trânsito, Obs. — apenas no seu meio
  - `tecnico` não-OL: leitura
- Missões: badge ◌ Em missão / ✓ Missão concluída na Fita do Tempo
- Vista por Setores / Cartões / Tabela

### PWA (Progressive Web App)

- `manifest.json`: nome, short_name, cores ICNF, ícone SVG, `display: standalone`
- `sw.js` (cache `gestao-occ-v2`):
  - HTML → **network-first** (actualizações imediatas; cache só para offline)
  - Assets estáticos → cache-first
  - CDN (fontes, Leaflet) → stale-while-revalidate
  - `/api/*` → sempre rede (IndexedDB trata o offline)
- Instalável no Android (Chrome) e iOS (Safari) a partir do browser
- Meta tags: `theme-color`, `apple-mobile-web-app-*`

### Sync automático (near real-time)

- **Poll a cada 30 segundos**: `loadAllData()` + re-render da vista activa
- **Page Visibility API**: fetch imediato quando o utilizador volta ao tab/app
- Garante sincronização entre sessão web e mobile sem WebSockets
- Não corre se offline ou se sincronização manual estiver em curso

### Offline e sincronização manual

- Cache completo em IndexedDB: ocorrências, meios, catálogo, operacionais, log, sessão
- Fila de operações pendentes em IndexedDB; replay ao reconectar
- `idMap` para remap de IDs temporários → IDs reais
- Indicador ONLINE / PENDENTES / A SINCRONIZAR / OFFLINE

### Catálogo de meios predefinidos

- 868 registos ICNF 2026; seed automático no arranque
- Filtros: Tipo Equipa, Sub-Região, Concelho, texto livre
- Ao seleccionar preset: preenche Designação, Tipo, N.º Operacionais, Concelho

### Exportação

- Fita do Tempo (`.txt`, com filtros de categoria e data)
- Log completo da ocorrência (`.txt`)
- Excel de meios ao fechar ocorrência

---

## API REST (server.js)

| Método | Rota | Mín. perfil | Descrição |
|---|---|---|---|
| POST | `/api/login` | — | Autenticação; normaliza role no JWT e na resposta |
| GET | `/api/ocorrencias` | tecnico | Lista filtrada por perfil; campo `is_oficial_ligacao` para tecnico/dradj_cnsr |
| POST | `/api/ocorrencias` | dradj_cnsr | Criar |
| PATCH | `/api/ocorrencias/:id` | tecnico + OL | Editar (requireAuthForOccurrence) |
| DELETE | `/api/ocorrencias/:id` | administrador | Eliminar |
| GET | `/api/meios` | tecnico | Lista com operativos (inclui utilizador_id) e eventos |
| POST | `/api/meios` | tecnico + OL | Criar (requireAuthForOccurrence) |
| PATCH | `/api/meios/:id` | tecnico + meio | Editar parcial (requireAuthForMeio) |
| DELETE | `/api/meios/:id` | dradj_cnsr | Eliminar |
| PUT | `/api/meios/:id/operativos` | operacional + meio | Substituir lista (inclui utilizador_id) |
| POST | `/api/meios_eventos` | operacional | Adicionar evento a meio |
| GET | `/api/ocorrencias_eventos` | tecnico | Log de ocorrência |
| POST | `/api/ocorrencias_eventos` | operacional + OL | Adicionar entrada ao log |
| GET | `/api/ocorrencias/:id/timeline` | tecnico | Fita do Tempo (UNION de 3 tabelas) |
| POST | `/api/ocorrencias/:id/timeline` | operacional + OL | Adicionar entrada manual |
| GET | `/api/ocorrencias/:id/oficiais_ligacao` | tecnico | Lista nomeações |
| POST | `/api/ocorrencias/:id/oficiais_ligacao` | dradj_cnsr | Nomear Oficial de Ligação |
| DELETE | `/api/ocorrencias/:id/oficiais_ligacao/:uid` | dradj_cnsr | Remover nomeação |
| GET/POST/PATCH/DELETE | `/api/equipas` | tecnico/dradj_cnsr | Catálogo de meios predefinidos |
| GET/POST/DELETE | `/api/operacionais` | tecnico/dradj_cnsr | Operacionais predefinidos |
| GET | `/api/utilizadores/tecnicos` | dradj_cnsr | Lista tecnico+operacional+dradj_cnsr (para selector OL e operativos) |
| GET/POST/PATCH/DELETE | `/api/utilizadores` | administrador | Gestão de utilizadores |
| GET | `/api/fogos/active` | tecnico | Proxy para `api.fogos.pt/v2/incidents/active` |

---

## Migrações automáticas no arranque (`runMigrations`)

1. Renomear perfis na BD: `admin→administrador`, `gestor→dradj_cnsr`, `visualizador→tecnico` (idempotente)
2. Alterar `CHECK constraint` de `utilizadores.role` para novos nomes
3. `CREATE TABLE IF NOT EXISTS ocorrencia_oficiais_ligacao`
4. `CREATE TABLE IF NOT EXISTS ocorrencia_timeline`
5. `ALTER TABLE meios_operativos ADD COLUMN IF NOT EXISTS utilizador_id UUID`
6. `ALTER TABLE equipas ADD COLUMN IF NOT EXISTS tipo_equipa/subregiao/concelho`
7. `ALTER TABLE meios ADD COLUMN IF NOT EXISTS previsto_data/previsto_hora`
8. Drop/recreate `meios_estado_check` para incluir `'previsto'`
9. Seed de 868 meios ICNF 2026 se `equipas` estiver vazia

---

## Bugs corrigidos relevantes

| Problema | Causa | Solução |
|---|---|---|
| Acesso perdido após migração de perfis | JWT antigo tinha `role:'admin'`; frontend verificava `'administrador'` | `normalizeRole()` aplicado na emissão do JWT |
| Service worker servia HTML antigo | Cache-first para HTML impedia actualizações | `sw.js` v2: network-first para HTML |
| `[object Object]` nos logs de operativos | `operativos.join()` após operativos passarem a `[{nome,utilizador_id}]` | `.map(o=>o.nome||o).join()` |
| OL panel vazio ao trocar utilizador | `showAuthOverlay` não limpava `_tecnicos`, `currentOccId` | Reset completo de estado no logout |
| Operacional não via ocorrências | Filtro usava só `subregiao`; operacional sem sub-região via nada | Query inclui `meios_operativos.utilizador_id` |
| `foreign key constraint` na migração | `ocorrencia_id INTEGER` vs `UUID` no schema | Alterado para `UUID` |
| `ERR_CONNECTION_CLOSED` fogos.pt | Cloudflare bloqueia pedidos directos do browser | Proxy `/api/fogos/active` no Express |

---

## Notas de deploy (Railway)

```
1. Push para GitHub (Railway faz deploy automático)
2. Railway: criar projecto + addon PostgreSQL
3. Definir env var JWT_SECRET (string longa aleatória)
4. Correr schema.sql na consola Railway PostgreSQL
5. Criar primeiro admin:
   node -e "require('bcrypt').hash('PASSWORD',12).then(console.log)"
   INSERT INTO utilizadores (email, password_hash, nome, role, ativo)
   VALUES ('admin@icnf.pt', '<hash>', 'Administrador', 'administrador', true);
6. As migrações (novos perfis, novas tabelas, novas colunas) correm automaticamente
```

---

## Funcionalidades planeadas / em desenvolvimento

- Chat em tempo real (Socket.io) — ver discussão na conversa
- Upload de ficheiros (imagens, PDF, vídeo) — Cloudflare R2 / Azure Blob
- Vista mobile simplificada (`operativo.html`) — Ângulo 1
- Notificações push (Azure Notification Hubs / PWA)
- Migração para Azure App Service + Azure Database for PostgreSQL (opcional)
