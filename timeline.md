# Fita do Tempo — Implementação Completa

Documento de referência para replicar a funcionalidade noutras versões.

---

## Estrutura geral

A Fita do Tempo é um painel expansível no detalhe de uma ocorrência que agrega, em ordem cronológica inversa, três fontes de eventos:

1. `ocorrencia_timeline` — entradas manuais (meteorologia, meios outros, comunicações, etc.)
2. `ocorrencias_eventos` — log automático de mudanças de estado da ocorrência
3. `meios_eventos` — log automático de acções em cada meio ICNF

Nenhuma tabela existente é alterada; a timeline agrega sem substituir.

---

## Base de dados

### Tabela `ocorrencia_timeline` (nova)

```sql
CREATE TABLE IF NOT EXISTS ocorrencia_timeline (
  id            SERIAL PRIMARY KEY,
  ocorrencia_id UUID        NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
  ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  categoria     TEXT        NOT NULL,
  titulo        TEXT,
  descricao     TEXT,
  dados         JSONB,
  autor_nome    TEXT,
  autor_id      UUID REFERENCES utilizadores(id),
  meio_id       UUID REFERENCES meios(id)
);
```

> Nota: na versão original o `id` das ocorrências/utilizadores/meios é `INTEGER`; nesta versão é `UUID`. Ajustar conforme o schema do projeto destino.

### Tabelas existentes usadas (sem alteração)

- `ocorrencias_eventos(id, ocorrencia_id, ts, tag, meio_label, msg, user_id)`
- `meios_eventos(id, meio_id, ts, msg, user_id)`
- `meios(id, ocorrencia_id, eq, missao, estado, …)`

---

## API — server.js

### GET `/api/ocorrencias/:id/timeline`

Mínimo perfil: `tecnico`.

Devolve UNION das três fontes, ordenado por `ts DESC`:

```js
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
```

Campos devolvidos por linha: `ts, categoria, titulo, descricao, dados, autor_nome, meio_eq`

### POST `/api/ocorrencias/:id/timeline`

Mínimo perfil: `operacional`. Requer `requireAuthForOccurrence`.

```js
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
```

Campos do body: `{ categoria, titulo, ts?, descricao?, dados?, meio_id? }`

---

## Migração automática

Adicionar em `runMigrations()`:

```js
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
```

---

## Frontend — HTML

### Botão de acesso (na barra de acções da ocorrência)

```html
<button class="btn btn-warn btn-sm" onclick="toggleTimeline()" id="btnTimeline">Fita do Tempo</button>
```

### Painel (injected abaixo dos painéis existentes)

```html
<div id="tl-panel" style="display:none;margin-bottom:24px;">
  <div class="tl-panel-wrap">
    <div class="tl-panel-hdr">
      <div class="tl-panel-title">Fita do Tempo</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn-ghost btn-xs auth-op" onclick="openAddTimeline()">+ Adicionar</button>
        <button class="btn btn-ghost btn-xs" onclick="exportFitaDeTempo()">⬇ Exportar</button>
        <button class="btn btn-ghost btn-xs" onclick="toggleTimeline()">✕</button>
      </div>
    </div>
    <div id="tl-cat-filters" class="tl-cat-filters"></div>
    <div class="tl-date-filter">
      <span class="tl-date-lbl">De</span>
      <input type="date" class="form-input" id="tl-date-from" style="padding:4px 8px;font-size:11px;" oninput="renderTimeline()"/>
      <input type="time" class="form-input" id="tl-time-from" style="padding:4px 8px;font-size:11px;width:88px;" oninput="renderTimeline()"/>
      <span class="tl-date-lbl">Até</span>
      <input type="date" class="form-input" id="tl-date-to" style="padding:4px 8px;font-size:11px;" oninput="renderTimeline()"/>
      <input type="time" class="form-input" id="tl-time-to" style="padding:4px 8px;font-size:11px;width:88px;" oninput="renderTimeline()"/>
      <button class="btn btn-ghost btn-xs" onclick="clearTLDateFilter()">✕ Limpar</button>
    </div>
    <div id="tl-body" class="tl-body-scroll"></div>
  </div>
</div>
```

### Modal "Adicionar entrada"

```html
<div class="modal-overlay" id="modal-timeline">
  <div class="modal">
    <button class="modal-close" onclick="closeModal('modal-timeline')">✕</button>
    <div class="modal-title">Adicionar à Fita do Tempo</div>
    <div class="modal-body">
      <div class="form-field">
        <label class="form-label">Categoria</label>
        <select class="form-select" id="tl-form-cat" onchange="onTLCatChange()">
          <option value="meios_outros">Meios Outros</option>
          <option value="meteorologia">Meteorologia</option>
          <option value="comunicacoes">Comunicações</option>
          <option value="atividade_icnf">Atividade ICNF</option>
          <option value="atividade_outros">Atividade Outros</option>
          <option value="outros">Outros</option>
        </select>
      </div>
      <div id="tl-form-fields"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('modal-timeline')">Cancelar</button>
      <button class="btn btn-primary" onclick="submitTimeline()">Guardar</button>
    </div>
  </div>
</div>
```

---

## Frontend — CSS

```css
.tl-panel-wrap{background:var(--surface);border:1px solid var(--border);border-radius:2px;overflow:hidden;}
.tl-panel-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid var(--border);background:var(--surface2);}
.tl-panel-title{font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--warn);}
.tl-cat-filters{display:flex;gap:6px;flex-wrap:wrap;padding:10px 18px 8px;border-bottom:1px solid var(--border);}
.tl-cat-btn{padding:3px 9px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-family:'IBM Plex Mono',monospace;font-size:9px;border-radius:10px;transition:all .12s;letter-spacing:.04em;}
.tl-cat-btn.active{background:var(--surface2);color:var(--accent);border-color:rgba(140,150,28,.3);}
.tl-date-filter{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px 18px;border-bottom:1px solid var(--border);background:var(--surface2);}
.tl-date-lbl{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);white-space:nowrap;}
.tl-body-scroll{max-height:560px;overflow-y:auto;padding:0 18px 12px;}
.tl-day-sep{padding:8px 0 4px;font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border);margin-bottom:4px;}
.tl-entry{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid rgba(37,39,32,.3);align-items:flex-start;}
.tl-entry:last-child{border-bottom:none;}
.tl-time{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--inactive);min-width:36px;padding-top:2px;flex-shrink:0;text-align:right;}
.tl-entry-body{flex:1;}
.tl-cat-label{display:inline-block;padding:1px 7px;border-radius:10px;font-size:8px;font-family:'IBM Plex Mono',monospace;letter-spacing:.04em;text-transform:uppercase;margin-right:5px;vertical-align:middle;}
.tl-cat-ocorrencia      {background:rgba(66,154,189,.15);color:var(--accent3);}
.tl-cat-meios_icnf      {background:rgba(109,184,109,.12);color:var(--success);}
.tl-cat-meios_outros    {background:rgba(140,150,28,.12);color:var(--accent);}
.tl-cat-meteorologia    {background:rgba(90,184,214,.10);color:var(--accent3);}
.tl-cat-comunicacoes    {background:rgba(152,112,208,.12);color:#b890e8;}
.tl-cat-atividade_icnf  {background:rgba(66,154,189,.10);color:var(--icnf-blue-light);}
.tl-cat-atividade_outros{background:rgba(77,102,80,.3);color:var(--muted);}
.tl-cat-outros          {background:rgba(45,61,47,.5);color:var(--muted);}
.tl-titulo{font-size:12px;color:var(--text);line-height:1.5;vertical-align:middle;}
.tl-meta{font-family:'IBM Plex Mono',monospace;font-size:9px;color:var(--inactive);margin-top:3px;}
.tl-meta-meio{color:var(--accent3);margin-left:5px;}
.tl-mission{display:inline-flex;align-items:center;gap:4px;margin-top:4px;padding:2px 8px;border-radius:2px;font-size:10px;font-family:'IBM Plex Mono',monospace;}
.tl-mission-done{background:rgba(109,184,109,.12);color:var(--success);border:1px solid rgba(109,184,109,.25);}
.tl-mission-active{background:rgba(200,154,42,.10);color:var(--warn);border:1px solid rgba(200,154,42,.25);}
```

---

## Frontend — JavaScript

### Constantes e estado

```js
const TL_CATS = {
  ocorrencia:       { label:'Ocorrência' },
  meios_icnf:       { label:'Meios ICNF' },
  meios_outros:     { label:'Meios Outros' },
  meteorologia:     { label:'Meteorologia' },
  comunicacoes:     { label:'Comunicações' },
  atividade_icnf:   { label:'Atividade ICNF' },
  atividade_outros: { label:'Atividade Outros' },
  outros:           { label:'Outros' },
};

let _tlData = [];
let _tlFilter = 'all';
```

### Formulários por categoria (manual — `ocorrencia` e `meios_icnf` são automáticos)

```js
const TL_FORMS = {
  meios_outros:    `<div class="form-field"><label class="form-label">Registo</label><textarea class="form-textarea" id="tlf-texto" rows="5" placeholder="Ex: 2 VFCI dos Bombeiros de Aveiro chegaram ao TO — Setor B."></textarea></div>`,
  meteorologia:    `<div class="form-field"><label class="form-label">Condições meteorológicas</label><textarea class="form-textarea" id="tlf-texto" rows="5" placeholder="Ex: Temp. 28°C · Hum. 32% · Vento NE 35 km/h · Visibilidade boa."></textarea></div>`,
  comunicacoes:    `<div class="form-field"><label class="form-label">Comunicação</label><textarea class="form-textarea" id="tlf-texto" rows="5" placeholder="Ex: CDOS Aveiro — Pedido de reforço com 1 HELICANADA aprovado."></textarea></div>`,
  atividade_icnf:  `<div class="form-field"><label class="form-label">Atividade ICNF</label><textarea class="form-textarea" id="tlf-texto" rows="5" placeholder="Ex: Reconhecimento do perímetro pelo Chefe de Grupo. Fogo controlado no flanco E."></textarea></div>`,
  atividade_outros:`<div class="form-field"><label class="form-label">Atividade de Outros</label><textarea class="form-textarea" id="tlf-texto" rows="5" placeholder="Ex: GNR interdita EN17 em ambos os sentidos. PSP reforça perímetro."></textarea></div>`,
  outros:          `<div class="form-field"><label class="form-label">Registo</label><textarea class="form-textarea" id="tlf-texto" rows="5" placeholder="Texto livre…"></textarea></div>`,
};
```

### Funções de controlo

```js
function toggleTimeline(){
  const panel = document.getElementById('tl-panel');
  const btn   = document.getElementById('btnTimeline');
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : '';
  btn.textContent = visible ? 'Fita do Tempo' : 'Fechar Fita do Tempo';
  if(!visible) loadTimeline();
}

async function loadTimeline(){
  if(!currentOccId) return;
  document.getElementById('tl-body').innerHTML = '<div style="padding:20px 0;text-align:center;font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:var(--muted);">A carregar…</div>';
  const { data, error } = await apiFetch(`/api/ocorrencias/${currentOccId}/timeline`);
  if(error){
    document.getElementById('tl-body').innerHTML = `<div style="padding:20px 0;text-align:center;color:var(--danger);">Erro ao carregar timeline.</div>`;
    return;
  }
  _tlData = data || [];
  _tlFilter = 'all';
  renderTimelineFilters();
  renderTimeline();
}

function renderTimelineFilters(){
  const presentCats = [...new Set(_tlData.map(e => e.categoria))];
  const cats = ['all', ...presentCats];
  document.getElementById('tl-cat-filters').innerHTML = cats.map(c => {
    const info = TL_CATS[c] || { label:c };
    const label = c === 'all' ? 'Tudo' : info.label;
    return `<button class="tl-cat-btn${_tlFilter===c?' active':''}" onclick="setTLFilter('${c}')">${label}</button>`;
  }).join('');
}

function setTLFilter(cat){
  _tlFilter = cat;
  renderTimelineFilters();
  renderTimeline();
}

function getFilteredTLEntries(){
  let entries = _tlFilter === 'all' ? _tlData : _tlData.filter(e => e.categoria === _tlFilter);
  const dateFrom = document.getElementById('tl-date-from')?.value;
  const timeFrom = document.getElementById('tl-time-from')?.value || '00:00';
  const dateTo   = document.getElementById('tl-date-to')?.value;
  const timeTo   = document.getElementById('tl-time-to')?.value || '23:59';
  if(dateFrom){ const from = new Date(`${dateFrom}T${timeFrom}`); entries = entries.filter(e => new Date(e.ts) >= from); }
  if(dateTo)  { const to   = new Date(`${dateTo}T${timeTo}:59`); entries = entries.filter(e => new Date(e.ts) <= to); }
  return entries;
}

function clearTLDateFilter(){
  ['tl-date-from','tl-time-from','tl-date-to','tl-time-to'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  renderTimeline();
}

function renderTimeline(){
  const body = document.getElementById('tl-body');
  if(!body) return;
  const entries = getFilteredTLEntries();
  if(!entries.length){
    body.innerHTML = '<div style="padding:20px 0;text-align:center;font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:var(--muted);">— Sem entradas —</div>';
    return;
  }
  let html = ''; let lastDay = '';
  entries.forEach(e => {
    const d = e.ts.slice(0,10);
    if(d !== lastDay){
      const label = new Date(e.ts).toLocaleDateString('pt-PT',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
      html += `<div class="tl-day-sep">${label}</div>`;
      lastDay = d;
    }
    const time    = new Date(e.ts).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'});
    const cat     = TL_CATS[e.categoria] || { label:e.categoria };
    const catCls  = 'tl-cat-' + (e.categoria||'ocorrencia');
    const meioHtml  = e.meio_eq   ? `<span class="tl-meta-meio">${esc(e.meio_eq)}</span>` : '';
    const autorHtml = e.autor_nome ? ` · ${esc(e.autor_nome)}` : '';
    let missionHtml = '';
    if(e.categoria === 'meios_icnf' && e.dados?.missao){
      const done = e.dados.estado === 'desmobilizado';
      missionHtml = `<div class="tl-mission ${done?'tl-mission-done':'tl-mission-active'}">${done?'Missão concluída':'Em missão'}: ${esc(e.dados.missao)}</div>`;
    }
    html += `<div class="tl-entry">
      <span class="tl-time">${time}</span>
      <div class="tl-entry-body">
        <div><span class="tl-cat-label ${catCls}">${cat.label}</span><span class="tl-titulo">${esc(e.titulo||'')}</span></div>
        ${missionHtml}
        <div class="tl-meta">${autorHtml}${meioHtml}</div>
      </div>
    </div>`;
  });
  body.innerHTML = html;
}
```

### Formulário de adição

```js
function openAddTimeline(){
  document.getElementById('tl-form-cat').value = 'meios_outros';
  onTLCatChange();
  openModal('modal-timeline');
}

function onTLCatChange(){
  const cat = document.getElementById('tl-form-cat').value;
  document.getElementById('tl-form-fields').innerHTML = TL_FORMS[cat] || '';
}

function _tlVal(id){ const el = document.getElementById(id); return el ? el.value.trim() || null : null; }

async function submitTimeline(){
  const cat   = document.getElementById('tl-form-cat').value;
  const texto = _tlVal('tlf-texto');
  if(!texto){ toast('Preencha o texto.','err'); return; }
  const { error } = await apiFetch(`/api/ocorrencias/${currentOccId}/timeline`, {
    method:'POST', body: JSON.stringify({ categoria:cat, titulo:texto, ts:new Date().toISOString() })
  });
  if(error){ toast('Erro ao guardar: '+error,'err'); return; }
  closeModal('modal-timeline');
  toast('Entrada adicionada!','ok');
  await loadTimeline();
}
```

### Exportação para .txt

```js
function exportFitaDeTempo(){
  const o = db.ocorrencias.find(x => x.id === currentOccId);
  if(!o) return;
  const entries = [...getFilteredTLEntries()].reverse();
  const sep  = '═'.repeat(72);
  const sep2 = '─'.repeat(72);
  const now  = new Date().toLocaleString('pt-PT');
  const dateFrom = document.getElementById('tl-date-from')?.value;
  const dateTo   = document.getElementById('tl-date-to')?.value;
  const catInfo  = _tlFilter !== 'all' ? (TL_CATS[_tlFilter]||{label:_tlFilter}).label : null;

  let lines = [];
  lines.push(sep);
  lines.push('  FITA DO TEMPO — GESTÃO MEIOS GFR');
  lines.push(sep);
  lines.push(`  Local ignição : ${o.nome}`);
  lines.push(`  Código occ.   : ${o.ref||'—'}`);
  lines.push(`  Concelho      : ${o.concelho||'—'}`);
  lines.push(`  Início        : ${o.inicio ? new Date(o.inicio).toLocaleString('pt-PT') : '—'}`);
  lines.push(`  Estado        : ${o.status==='active'?'ATIVA':'FECHADA'}`);
  if(catInfo)    lines.push(`  Categoria     : ${catInfo}`);
  if(dateFrom)   lines.push(`  Período       : ${dateFrom} → ${dateTo||'…'}`);
  lines.push(`  Exportado em  : ${now}`);
  lines.push(sep2);
  lines.push('');

  let lastDay = '';
  entries.forEach(e => {
    const d = e.ts.slice(0,10);
    if(d !== lastDay){
      const label = new Date(e.ts).toLocaleDateString('pt-PT',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
      lines.push(''); lines.push(`  ── ${label.toUpperCase()} ──`); lines.push('');
      lastDay = d;
    }
    const time  = new Date(e.ts).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'});
    const cat   = (TL_CATS[e.categoria]||{label:(e.categoria||'—')}).label.padEnd(16);
    const meio  = e.meio_eq    ? ` [${e.meio_eq}]` : '';
    const autor = e.autor_nome ? ` — ${e.autor_nome}` : '';
    lines.push(`  [${time}] [${cat}]${meio} ${e.titulo||''}${autor}`);
    if(e.dados?.missao){
      const done = e.dados.estado === 'desmobilizado';
      lines.push(`           Missão [${done?'CONCLUÍDA':'EM CURSO '}]: ${e.dados.missao}`);
    }
  });
  lines.push(''); lines.push(sep);
  lines.push(`  Fim — Fita do Tempo — Gestão Meios GFR — ${now}`);
  lines.push(sep);

  const blob = new Blob([lines.join('\n')], {type:'text/plain;charset=utf-8'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const safe = (o.nome||'ocorrencia').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,40);
  const tag  = new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
  a.href=url; a.download=`FitaDeTempo_${safe}_${tag}.txt`; a.click();
  URL.revokeObjectURL(url);
  toast('Fita do Tempo exportada!','ok');
}
```

---

## Integração com eventos automáticos

A Fita do Tempo recolhe automaticamente:

- **Eventos de meios ICNF** via `meios_eventos` — cada acção nos `doQuick*` insere em `meios_eventos`; a query UNION puxa-os com categoria `meios_icnf` e anexa a missão/estado actual do meio.
- **Eventos de ocorrência** via `ocorrencias_eventos` — mudanças de estado, observações e acções de sector são inseridas ali; a query UNION puxa-os com categoria `ocorrencia`.

Não é necessário código adicional para estes dois fluxos.

---

## Refresh automático

Sempre que `_socket` emite `data_changed`, se o painel da timeline estiver visível, recarrega:

```js
_socket.on('data_changed', async () => {
  // …
  if(document.getElementById('tl-panel')?.style.display !== 'none') loadTimeline();
});
```

Ao fechar o detalhe da ocorrência, ocultar e limpar o painel:

```js
document.getElementById('btnTimeline').textContent = 'Fita do Tempo';
// (o panel já fica oculto pelo hide geral da página de detalhe)
```

---

## Notas de portabilidade

- `esc()` — função de escape de HTML (já existente no projecto)
- `apiFetch()` — wrapper fetch com JWT e tratamento de erros (já existente)
- `openModal()` / `closeModal()` — sistema modal genérico (já existente)
- `toast()` — notificações (já existente)
- `currentOccId` — variável global com o UUID da ocorrência aberta
- `db.ocorrencias` — cache local usada apenas na exportação para obter meta-dados da ocorrência
- O campo `auth-op` nas classes CSS oculta botões para perfis abaixo de `operacional`
