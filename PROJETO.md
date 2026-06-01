# Gestão Meios GFR — Resumo do Projecto

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | `Gestao_Meios_v17.html` — single-file SPA |
| Backend | `server.js` — Node.js / Express |
| Base de dados | Railway PostgreSQL (`DATABASE_URL`) |
| Auth | JWT (12h) em `sessionStorage`, bcrypt passwords |
| Deploy | Railway (NIXPACKS, `node server.js`) |

---

## Ficheiros principais

| Ficheiro | Descrição |
|---|---|
| `Gestao_Meios_v17.html` | Frontend completo (~3700 linhas) |
| `server.js` | API REST + proxy + migrações automáticas |
| `schema.sql` | Schema PostgreSQL (executar uma vez no Railway) |
| `migration_v2_equipas.sql` | 868 meios ICNF 2026 (seed automático no arranque) |
| `manual_utilizador.html` | Manual do utilizador (HTML standalone, abre em nova tab) |
| `railway.json` | Config de deploy Railway |
| `package.json` | Deps: express, pg, bcrypt, jsonwebtoken |

---

## Funcionalidades implementadas

### Autenticação e perfis
- Login com email/password → JWT → `sessionStorage` (`gfr_token`)
- 4 perfis hierárquicos: `visualizador` < `operacional` < `gestor` < `admin`
- Gestor pode ter sub-região atribuída (vê só as suas ocorrências)
- Admin cria utilizadores na UI (sem auto-registo)
- Elementos de UI ocultados por classe CSS (`.auth-admin`, `.auth-gestor`, `.auth-op`); controlo real no servidor via `requireAuth(minRole)`

### Ocorrências
- CRUD completo (criar, editar, fechar, reabrir, eliminar)
- Fechar → move para Arquivo; Reabrir → volta à lista activa
- Filtro por sub-região (gestor: automático; admin: dropdown)
- Importação de ocorrência a partir do **mapa fogos.pt** (pré-preenche formulário)

### Mapa fogos.pt
- Botão "🗺 Fogos Ativos" na barra superior (perfil ≥ gestor)
- Painel split: lista + mapa Leaflet (OpenStreetMap/CartoDB)
- Dados obtidos via proxy `/api/fogos/active` no servidor (Cloudflare bloqueava pedidos directos do browser)
- Clicar num incêndio → "Usar esta ocorrência" → pré-preenche formulário Nova Ocorrência

### Meios
- Adicionar/editar/eliminar meios por ocorrência
- **5 estados**: `previsto` · `transito` · `operacao` · `descanso` · `desmobilizado`
- Estado `previsto`: campo data/hora de disponibilidade esperada; secção separada "⏳ Previstos" no topo da vista por setores; botão "▶ Activar Trânsito"
- Acções rápidas: Activar Op., Descanso, Desmobilizar, Mudar Sector, Obs.
- Limite operacional: calcula hora-limite a partir de chegada + horas máx.; alerta visual quando próximo/expirado
- Lista de operacionais por nome (chips)
- Vista por Setores / Cartões / Tabela
- Log de eventos por meio (persiste na BD)

### Catálogo de meios predefinidos
- 868 registos ICNF 2026 carregados automaticamente no arranque se tabela vazia
- Campos: Designação, Tipo Veículo, Tipo Equipa, Sub-Região, Concelho, Capacidade, Origem
- Filtros no catálogo e no selector "Novo meio": Tipo Equipa, Sub-Região, Concelho, texto livre
- Ao seleccionar preset: preenche automaticamente Designação, Tipo, N.º Operacionais, Concelho
- Tipos novos (ESF, GFR, FSBF, etc.) adicionados dinamicamente ao select se não existirem

### Offline e sincronização
- Cache completo em IndexedDB (`firedpt_v1`): ocorrências, meios, catálogo, operacionais, log, sessão
- Fila de operações pendentes em IndexedDB; replay ordenado ao reconectar
- `idMap` para remap de IDs temporários locais → IDs reais do servidor (criação offline encadeada)
- Sincronização automática 1,5s após recuperar ligação; manual via painel de sincronização
- Indicador de estado na barra superior: ONLINE / N PENDENTES / A SINCRONIZAR / OFFLINE

### Exportação
- Log completo da ocorrência em `.txt` (cabeçalho, sumário de meios, detalhe por meio, log cronológico)

### Manual do utilizador
- `manual_utilizador.html` — HTML standalone editável
- Mesma paleta ICNF e tipografia da aplicação (IBM Plex Mono, Barlow Condensed, Barlow)
- Tema claro/escuro com toggle
- Acessível via item "📖 Manual" no menu lateral (abre em nova tab)
- Cobre: login, perfis, ocorrências, meios, catálogo, arquivo, utilizadores, offline/sync, exportação

---

## API REST (server.js)

| Método | Rota | Mín. perfil | Descrição |
|---|---|---|---|
| POST | `/api/login` | — | Autenticação, retorna JWT |
| GET | `/api/ocorrencias` | visualizador | Lista (filtrada por sub-região para gestores) |
| POST | `/api/ocorrencias` | gestor | Criar |
| PATCH | `/api/ocorrencias/:id` | gestor | Editar / fechar (COALESCE para campos parciais) |
| DELETE | `/api/ocorrencias/:id` | admin | Eliminar |
| GET | `/api/meios` | visualizador | Lista com operativos e eventos |
| POST | `/api/meios` | gestor | Criar |
| PATCH | `/api/meios/:id` | operacional | Editar parcial (só actualiza colunas presentes no body) |
| DELETE | `/api/meios/:id` | gestor | Eliminar |
| PUT | `/api/meios/:id/operativos` | operacional | Substituir lista de operativos |
| POST | `/api/meios_eventos` | operacional | Adicionar evento a meio |
| GET | `/api/ocorrencias_eventos` | visualizador | Log de ocorrência |
| POST | `/api/ocorrencias_eventos` | operacional | Adicionar entrada ao log |
| GET/POST/PATCH/DELETE | `/api/equipas` | visualizador/gestor | Catálogo de meios predefinidos |
| GET/POST/DELETE | `/api/operacionais` | visualizador/gestor | Operacionais predefinidos |
| GET/POST/PATCH/DELETE | `/api/utilizadores` | admin | Gestão de utilizadores |
| GET | `/api/fogos/active` | visualizador | Proxy para `api.fogos.pt/v2/incidents/active` |

---

## Migrações automáticas no arranque

`runMigrations()` em `server.js` corre sempre que o servidor inicia:
1. `ALTER TABLE equipas ADD COLUMN IF NOT EXISTS tipo_equipa TEXT`
2. `ALTER TABLE equipas ADD COLUMN IF NOT EXISTS subregiao TEXT`
3. `ALTER TABLE equipas ADD COLUMN IF NOT EXISTS concelho TEXT`
4. `ALTER TABLE meios ADD COLUMN IF NOT EXISTS previsto_data DATE`
5. `ALTER TABLE meios ADD COLUMN IF NOT EXISTS previsto_hora TIME`
6. Drop/recreate `meios_estado_check` para incluir `'previsto'`
7. Seed de 868 meios ICNF 2026 se `equipas` estiver vazia

---

## Bugs corrigidos relevantes

| Problema | Causa | Solução |
|---|---|---|
| Leaflet SRI hash inválido | Atributos `integrity`/`crossorigin` incorrectos nos CDN tags | Removidos os atributos |
| `local_ignicao` NOT NULL em sync | PATCH ocorrências enviava `{status:'closed'}` sem os outros campos; servidor substituía tudo | `COALESCE($N, coluna)` no UPDATE de ocorrências |
| `ocorrencia_id` NOT NULL em sync | PATCH meios (acções rápidas) enviava rows parciais; servidor substituía todas as colunas a null | Servidor filtra para só actualizar colunas presentes no body (`c in b`) |
| `ERR_CONNECTION_CLOSED` fogos.pt | Cloudflare bloqueia pedidos directos do browser | Proxy `/api/fogos/active` no Express |
| 401 no pedido fogos.pt | `loadFogosData` usava `fetch` directo sem JWT | Mudado para `apiFetch` |
| "Sem meios predefinidos" | Migration SQL não tinha sido corrida no Railway | `runMigrations()` automático no arranque |
| Tipo não preenchido ao seleccionar preset | Tipos novos (ESF, GFR, etc.) não estavam no `<select>` | Opção adicionada dinamicamente se ausente |

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
   VALUES ('admin@icnf.pt', '<hash>', 'Administrador', 'admin', true);
6. As migrações subsequentes (novas colunas, seed) correm automaticamente
```
