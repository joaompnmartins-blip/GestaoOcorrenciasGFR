# Bateria de Testes — Gestão Meios GFR

## Stack de testes

| Camada | Ferramenta | O que cobre |
|---|---|---|
| API (backend) | Jest + Supertest | Todos os endpoints REST, lógica de negócio, controlo de perfis |
| Unitários (JS puro) | Vitest | Funções isoladas do frontend: cálculos, mapeamento de dados |
| End-to-end (E2E) | Playwright | Fluxos completos no browser: interacções UI + API integradas |

---

## Infraestrutura

```
tests/
├── api/                    ← Jest + Supertest
│   ├── auth.test.js
│   ├── ocorrencias.test.js
│   ├── meios.test.js
│   ├── equipas.test.js
│   ├── operacionais.test.js
│   ├── utilizadores.test.js
│   └── fogos.test.js
├── unit/                   ← Vitest
│   ├── mapTeam.test.js
│   ├── limiteOp.test.js
│   └── formatters.test.js
├── e2e/                    ← Playwright
│   ├── auth.spec.js
│   ├── ocorrencias.spec.js
│   ├── meios-estados.spec.js
│   ├── catalogo.spec.js
│   └── offline-sync.spec.js
└── helpers/
    ├── testdb.js           ← setup/teardown BD de teste
    └── fixtures.js         ← dados de teste reutilizáveis
```

**Variável de ambiente:** `TEST_DATABASE_URL` (BD PostgreSQL separada da produção)

---

## Testes de API

### auth.test.js
| # | Caso de teste | Resultado esperado |
|---|---|---|
| 1 | POST `/api/login` com credenciais válidas | 200 + JWT no body |
| 2 | POST `/api/login` com password errada | 401 |
| 3 | POST `/api/login` com email inexistente | 401 |
| 4 | GET `/api/ocorrencias` sem JWT | 401 |
| 5 | GET `/api/ocorrencias` com JWT expirado | 401 |
| 6 | POST `/api/ocorrencias` com perfil `visualizador` | 403 |
| 7 | POST `/api/meios` com perfil `operacional` | 403 (requer gestor) |
| 8 | DELETE `/api/ocorrencias/:id` com perfil `gestor` | 403 (requer admin) |

### ocorrencias.test.js
| # | Caso de teste | Resultado esperado |
|---|---|---|
| 1 | GET `/api/ocorrencias` (admin) → lista todas | 200 + array |
| 2 | GET `/api/ocorrencias` (gestor com sub-região) → só as suas | 200 + filtrado |
| 3 | POST criar ocorrência com campos obrigatórios | 201 + registo criado |
| 4 | POST criar ocorrência sem `local_ignicao` | 400 ou NOT NULL erro |
| 5 | PATCH fechar ocorrência (`status: 'closed'`) sem outros campos | 200, `local_ignicao` preservado |
| 6 | PATCH reabrir ocorrência (`status: 'active'`) | 200 |
| 7 | PATCH editar campos da ocorrência | 200 + campos actualizados |
| 8 | DELETE ocorrência (admin) | 200 + registo removido |
| 9 | DELETE ocorrência (gestor) | 403 |
| 10 | GET lista após fechar → ocorrência não aparece na lista activa | 200 + ausente |

### meios.test.js
| # | Caso de teste | Resultado esperado |
|---|---|---|
| 1 | GET `/api/meios?ocorrencia_id=X` → lista meios da ocorrência | 200 + array |
| 2 | POST criar meio com estado `previsto` + data/hora | 201 + campos guardados |
| 3 | POST criar meio com estado `transito` | 201 |
| 4 | PATCH parcial `{estado:'operacao'}` não anula `ocorrencia_id` | 200, `ocorrencia_id` intacto |
| 5 | PATCH parcial `{estado:'descanso'}` não anula `data_chegada` | 200, `data_chegada` intacto |
| 6 | PATCH parcial `{estado:'desmobilizado', data_demob, hora_demob}` | 200 |
| 7 | PATCH `{estado:'transito', previsto_data:null, previsto_hora:null}` limpa campos previsto | 200 |
| 8 | PATCH body vazio → retorna ok sem UPDATE | 200, sem erro |
| 9 | PUT `/api/meios/:id/operativos` substitui lista | 200 |
| 10 | DELETE meio (gestor) | 200 |
| 11 | DELETE meio (operacional) | 403 |
| 12 | POST `/api/meios_eventos` adiciona evento | 201 |

### equipas.test.js
| # | Caso de teste | Resultado esperado |
|---|---|---|
| 1 | GET `/api/equipas` → lista catálogo | 200 + array (≥ 868 se seed correu) |
| 2 | GET `/api/equipas?tipo_equipa=GFR` → filtrado | 200 + só GFR |
| 3 | GET `/api/equipas?subregiao=X` → filtrado | 200 + filtrado |
| 4 | POST criar equipa (gestor) | 201 |
| 5 | PATCH editar equipa | 200 |
| 6 | DELETE equipa (gestor) | 200 |
| 7 | Seed automático: tabela vazia no início → 868 registos após migração | verificar count |

### operacionais.test.js
| # | Caso de teste | Resultado esperado |
|---|---|---|
| 1 | GET `/api/operacionais` | 200 + array |
| 2 | POST criar operacional | 201 |
| 3 | DELETE operacional (gestor) | 200 |

### utilizadores.test.js
| # | Caso de teste | Resultado esperado |
|---|---|---|
| 1 | GET `/api/utilizadores` (admin) | 200 + lista |
| 2 | GET `/api/utilizadores` (gestor) | 403 |
| 3 | POST criar utilizador (admin) | 201 |
| 4 | PATCH desactivar utilizador | 200 |
| 5 | Login com utilizador desactivado (`ativo: false`) | 401 |
| 6 | PATCH alterar role para admin (admin) | 200 |

### fogos.test.js
| # | Caso de teste | Resultado esperado |
|---|---|---|
| 1 | GET `/api/fogos/active` com JWT válido | 200 + dados (ou mock) |
| 2 | GET `/api/fogos/active` sem JWT | 401 |

---

## Testes unitários (Vitest)

### mapTeam.test.js
| # | Caso de teste |
|---|---|
| 1 | `mapTeam` converte row PostgreSQL para objecto JS com todos os campos |
| 2 | `mapTeam` com `previsto_data` e `previsto_hora` preenchidos |
| 3 | `mapTeam` com campos nulos não quebra |

### limiteOp.test.js
| # | Caso de teste |
|---|---|
| 1 | Chegada 08:00 + 12h = limite 20:00 mesmo dia |
| 2 | Chegada 20:00 + 8h = limite 04:00 dia seguinte (data correcta) |
| 3 | Chegada 23:30 + 12h = limite 11:30 dia seguinte |

### formatters.test.js
| # | Caso de teste |
|---|---|
| 1 | Formatação de data ISO para `DD/MM/YYYY` |
| 2 | Estado `previsto` → badge label `PREVISTO` |
| 3 | Estado desconhecido → fallback sem crash |

---

## Testes E2E (Playwright)

### auth.spec.js
| # | Caso de teste |
|---|---|
| 1 | Login com credenciais válidas → entra na aplicação |
| 2 | Login com password errada → mensagem de erro visível |
| 3 | Logout → volta ao ecrã de login |
| 4 | Reload após login → sessão mantida (sessionStorage) |
| 5 | Perfil `visualizador` → botões de criar/editar não visíveis |

### ocorrencias.spec.js
| # | Caso de teste |
|---|---|
| 1 | Criar ocorrência → aparece na lista |
| 2 | Editar ocorrência → campos actualizados na lista |
| 3 | Fechar ocorrência → desaparece da lista activa |
| 4 | Abrir arquivo → ocorrência fechada visível |
| 5 | Reabrir ocorrência do arquivo → volta à lista activa |

### meios-estados.spec.js
| # | Caso de teste |
|---|---|
| 1 | Adicionar meio com estado `previsto` → aparece na secção "Previstos" |
| 2 | Clicar "▶ Activar Trânsito" → modal abre, confirmar → toast aparece |
| 3 | Após activar trânsito → meio sai da secção previstos, aparece em trânsito |
| 4 | Activar operação → campo limite_op calculado e visível |
| 5 | Transição para descanso → toast "Em Descanso" visível |
| 6 | Desmobilizar → meio aparece como desmobilizado |
| 7 | Mudar sector → toast com novo sector visível |
| 8 | Registar observação → toast "Observação registada" |
| 9 | Todas as transições: modal fecha após confirmar |

### catalogo.spec.js
| # | Caso de teste |
|---|---|
| 1 | Abrir selector de preset → lista carrega |
| 2 | Filtrar por tipo → lista filtrada |
| 3 | Seleccionar preset → formulário preenchido (designação, tipo, operacionais, concelho) |
| 4 | Tipo não existente no select → adicionado dinamicamente |

### offline-sync.spec.js
| # | Caso de teste |
|---|---|
| 1 | Simular offline (interceptar rede) → indicador muda para OFFLINE |
| 2 | Criar meio offline → vai para fila, indicador "N PENDENTES" |
| 3 | Restaurar rede → sync automático, indicador volta a ONLINE |
| 4 | Dado criado offline existe na BD após sync |

---

## Comandos para correr

```bash
# Testes de API
npm run test:api

# Testes unitários
npm run test:unit

# Testes E2E
npm run test:e2e

# Todos
npm test
```

---

## Notas de setup

- `TEST_DATABASE_URL` deve apontar para uma BD PostgreSQL separada
- Antes de cada suite de API: `runMigrations()` + truncate das tabelas + inserir fixtures
- Testes E2E: servidor local na porta 3001 (separado da produção)
- Fogos.pt: mock da API externa nos testes (evitar dependência de rede)
