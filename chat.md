# Chat da Ocorrência — Implementação Completa

Documento de referência para replicar a funcionalidade noutras versões.

---

## Estrutura geral

O Chat é um painel expansível no detalhe de uma ocorrência que permite troca de mensagens em tempo real entre os utilizadores que têm a mesma ocorrência aberta. Utiliza **Socket.IO** para entrega instantânea e tem um endpoint REST como fallback quando o socket não está disponível.

- Mensagens persistidas em base de dados (tabela `mensagens`)
- Histórico das últimas 100 mensagens entregue ao entrar na sala
- Novas mensagens broadcast para todos os presentes na sala via socket
- Fallback REST para quando o socket não está ligado

---

## Base de dados

### Tabela `mensagens` (nova)

```sql
CREATE TABLE IF NOT EXISTS mensagens (
  id            SERIAL PRIMARY KEY,
  ocorrencia_id UUID        NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES utilizadores(id) ON DELETE CASCADE,
  user_nome     TEXT        NOT NULL,
  texto         TEXT        NOT NULL,
  ts            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mensagens_occ ON mensagens(ocorrencia_id);
```

> Nota: na versão original o `id` das ocorrências/utilizadores é `INTEGER`; nesta versão é `UUID`. Ajustar conforme o schema do projecto destino.

---

## API — server.js

### Dependências

```js
const http = require('http');
const { Server: IOServer } = require('socket.io');
// npm install socket.io
```

### GET `/api/ocorrencias/:id/mensagens`

Fallback REST para carregar histórico. Mínimo perfil: `tecnico`.

```js
app.get('/api/ocorrencias/:id/mensagens', requireAuth('tecnico'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM mensagens WHERE ocorrencia_id=$1 ORDER BY ts ASC LIMIT 200',
    [req.params.id]
  );
  res.json(rows);
}));
```

### POST `/api/ocorrencias/:id/mensagens`

Fallback REST para enviar mensagem. Mínimo perfil: `tecnico`. Requer `requireAuthForOccurrence`.
Também emite o evento socket para que os clientes ligados recebam a mensagem em tempo real.

```js
app.post('/api/ocorrencias/:id/mensagens', requireAuth('tecnico'), requireAuthForOccurrence, wrap(async (req, res) => {
  const { texto } = req.body;
  if (!texto?.trim()) return res.status(400).json({ error: 'Texto obrigatório.' });
  const { rows } = await pool.query(
    'INSERT INTO mensagens (ocorrencia_id, user_id, user_nome, texto) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.params.id, req.user.id, req.user.nome, texto.trim()]
  );
  if (_io) _io.to(req.params.id).emit('message', rows[0]);
  res.json(rows[0]);
}));
```

---

## Socket.IO — server.js

O servidor HTTP deve ser criado a partir do `app` Express antes de iniciar o Socket.IO.

```js
let _io;
const httpServer = http.createServer(app);
_io = new IOServer(httpServer);
```

### Autenticação JWT no handshake

```js
_io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Não autenticado.'));
    socket.user = jwt.verify(token, JWT_SECRET);
    socket.user.role = normalizeRole(socket.user.role);
    next();
  } catch {
    next(new Error('Sessão inválida.'));
  }
});
```

### Eventos de ligação

```js
_io.on('connection', socket => {
  const { id: userId, nome } = socket.user;

  // Entrar na sala de uma ocorrência (sai de todas as anteriores)
  socket.on('join_room', async occId => {
    socket.rooms.forEach(r => { if (r !== socket.id) socket.leave(r); });
    socket.join(occId);
    // Envia histórico das últimas 100 mensagens
    try {
      const { rows } = await pool.query(
        'SELECT * FROM mensagens WHERE ocorrencia_id=$1 ORDER BY ts ASC LIMIT 100',
        [occId]
      );
      socket.emit('chat_history', rows);
    } catch (e) { console.error('chat_history:', e.message); }
  });

  // Receber e retransmitir mensagem para toda a sala
  socket.on('send_message', async ({ occId, texto }) => {
    if (!texto?.trim() || !occId) return;
    try {
      const { rows } = await pool.query(
        'INSERT INTO mensagens (ocorrencia_id, user_id, user_nome, texto) VALUES ($1,$2,$3,$4) RETURNING *',
        [occId, userId, nome, texto.trim()]
      );
      _io.to(occId).emit('message', rows[0]);
    } catch (e) { console.error('send_message:', e.message); }
  });
});
```

### Arranque do servidor

O `httpServer` substitui o `app.listen()` usual:

```js
httpServer.listen(PORT, () => console.log(`Servidor a correr na porta ${PORT}`));
```

---

## Migração automática

Adicionar em `runMigrations()`:

```js
await pool.query(`
  CREATE TABLE IF NOT EXISTS mensagens (
    id            SERIAL PRIMARY KEY,
    ocorrencia_id UUID        NOT NULL REFERENCES ocorrencias(id) ON DELETE CASCADE,
    user_id       UUID        NOT NULL REFERENCES utilizadores(id) ON DELETE CASCADE,
    user_nome     TEXT        NOT NULL,
    texto         TEXT        NOT NULL,
    ts            TIMESTAMPTZ DEFAULT NOW()
  )
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_mensagens_occ ON mensagens(ocorrencia_id)`);
```

---

## Frontend — HTML

### Botão de acesso (na barra de acções da ocorrência)

```html
<button class="btn btn-info btn-sm" onclick="toggleChat()" id="btnChat">💬 Chat</button>
```

### Painel

```html
<div id="chat-panel" style="display:none;margin-bottom:24px;">
  <div class="chat-wrap">
    <div class="chat-hdr">
      <div class="chat-title">💬 Chat da Ocorrência</div>
      <button class="btn btn-ghost btn-xs" onclick="toggleChat()">✕</button>
    </div>
    <div id="chat-messages" class="chat-messages">
      <div class="chat-empty">— Sem mensagens —</div>
    </div>
    <div class="chat-input-row">
      <input id="chat-input" class="form-input" placeholder="Mensagem…" style="flex:1;" onkeydown="if(event.key==='Enter')sendChatMsg()"/>
      <button class="btn btn-primary btn-sm" onclick="sendChatMsg()">Enviar</button>
    </div>
  </div>
</div>
```

---

## Frontend — CSS

```css
.chat-wrap{background:var(--surface);border:1px solid var(--border);border-radius:2px;overflow:hidden;}
.chat-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid var(--border);background:var(--surface2);}
.chat-title{font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent2);}
.chat-messages{max-height:320px;overflow-y:auto;padding:8px 16px 4px;display:flex;flex-direction:column;gap:2px;}
.chat-msg{display:flex;gap:10px;padding:5px 0;border-bottom:1px solid rgba(37,39,32,.3);font-size:12px;align-items:flex-start;}
.chat-msg:last-child{border-bottom:none;}
.chat-msg-time{font-family:'IBM Plex Mono',monospace;font-size:9px;color:var(--inactive);white-space:nowrap;padding-top:2px;min-width:38px;}
.chat-msg-nome{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:12px;letter-spacing:.04em;color:var(--accent3);white-space:nowrap;min-width:90px;max-width:120px;overflow:hidden;text-overflow:ellipsis;}
.chat-msg.mine .chat-msg-nome{color:var(--accent);}
.chat-msg-texto{flex:1;color:var(--text);line-height:1.5;}
.chat-input-row{display:flex;gap:8px;padding:10px 16px;border-top:1px solid var(--border);background:var(--surface2);}
.chat-empty{padding:20px;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);}
```

---

## Frontend — JavaScript

### Dependência (Socket.IO client)

Adicionar no `<head>` do HTML:

```html
<script src="/socket.io/socket.io.js"></script>
```

O ficheiro é servido automaticamente pelo servidor Socket.IO.

### Estado global

```js
let _socket = null;
let _socketConnected = false;
```

### Inicialização do socket (ao fazer login / abrir ocorrência)

```js
function initSocket(token){
  if(_socket) return;
  _socket = io({ auth: { token } });

  _socket.on('connect', () => { _socketConnected = true; });
  _socket.on('disconnect', () => { _socketConnected = false; });

  // Chat: histórico ao entrar na sala
  _socket.on('chat_history', msgs => renderChatHistory(msgs));
  // Chat: nova mensagem em tempo real
  _socket.on('message', msg => appendChatMessage(msg));
}

function destroySocket(){
  if(_socket){ _socket.disconnect(); _socket = null; _socketConnected = false; }
}
```

O `token` é o JWT do utilizador autenticado (o mesmo usado nos headers REST).

### Render de mensagens

```js
function chatMsgHtml(m){
  const time = new Date(m.ts).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'});
  const mine = m.user_id === currentUser?.id;
  return `<div class="chat-msg${mine?' mine':''}">
    <span class="chat-msg-time">${time}</span>
    <span class="chat-msg-nome">${esc(m.user_nome||'?')}</span>
    <span class="chat-msg-texto">${esc(m.texto)}</span>
  </div>`;
}

function renderChatHistory(msgs){
  const el = document.getElementById('chat-messages');
  if(!el) return;
  if(!msgs.length){ el.innerHTML='<div class="chat-empty">— Sem mensagens —</div>'; return; }
  el.innerHTML = msgs.map(m => chatMsgHtml(m)).join('');
  el.scrollTop = el.scrollHeight;
}

function appendChatMessage(msg){
  const el = document.getElementById('chat-messages');
  if(!el) return;
  const isEmpty = el.querySelector('.chat-empty');
  if(isEmpty) el.innerHTML = '';
  el.insertAdjacentHTML('beforeend', chatMsgHtml(msg));
  el.scrollTop = el.scrollHeight;
}
```

### Carregamento e toggle

```js
async function loadChatHistory(){
  if(!currentOccId) return;
  try {
    const { data } = await apiFetch(`/api/ocorrencias/${currentOccId}/mensagens`);
    if(data) renderChatHistory(data);
  } catch(e){}
}

function toggleChat(){
  const panel = document.getElementById('chat-panel');
  const btn   = document.getElementById('btnChat');
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : '';
  btn.textContent = visible ? '💬 Chat' : '💬 Fechar Chat';
  if(!visible){
    loadChatHistory();
    if(_socket) _socket.emit('join_room', currentOccId);
  }
}
```

### Envio de mensagem (socket com fallback REST)

```js
async function sendChatMsg(){
  const input = document.getElementById('chat-input');
  const texto = input?.value.trim();
  if(!texto || !currentOccId) return;
  input.value = '';
  if(_socket?.connected){
    _socket.emit('send_message', { occId: currentOccId, texto });
  } else {
    try {
      const { data, error } = await apiFetch(`/api/ocorrencias/${currentOccId}/mensagens`, {
        method:'POST', body: JSON.stringify({ texto })
      });
      if(error) throw new Error(error.message||error);
      appendChatMessage(data);
    } catch(e){ toast(e.message,'err'); input.value = texto; }
  }
}
```

---

## Integração com o ciclo de vida da ocorrência

### Ao abrir uma ocorrência

```js
// Após autenticação e carregamento da ocorrência:
if(_socket) _socket.emit('join_room', currentOccId);
```

Emitir `join_room` faz o socket sair de qualquer sala anterior e entrar na sala nova. O servidor responde com `chat_history`.

### Ao fechar/trocar de ocorrência ou fazer logout

```js
// Limpar o painel visualmente:
document.getElementById('chat-panel').style.display = 'none';
document.getElementById('btnChat').textContent = '💬 Chat';
document.getElementById('chat-messages').innerHTML = '<div class="chat-empty">— Sem mensagens —</div>';
// O socket sai da sala automaticamente ao entrar noutra via join_room,
// ou ao desligar via destroySocket().
```

---

## Notas de portabilidade

- `esc()` — função de escape de HTML (já existente no projecto)
- `apiFetch()` — wrapper fetch com JWT e tratamento de erros (já existente)
- `toast()` — notificações (já existente)
- `currentOccId` — variável global com o UUID da ocorrência aberta
- `currentUser` — variável global com os dados do utilizador autenticado; usado para distinguir mensagens próprias (classe `mine`)
- O socket é iniciado uma única vez após login e destruído no logout; `join_room` é usado para mudar de sala sem recriar o socket
- Não há suporte a edição ou eliminação de mensagens — as mensagens são imutáveis após envio
