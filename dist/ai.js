const AI_BASE = "https://cdn.northstreetumc.org";
const STORE_KEY = "opium_ai_chats_v1";
const $ = (id) => document.getElementById(id);
const els = {
  status: $("status"), chat: $("chat"), chatInner: $("chatInner"),
  form: $("form"), input: $("input"), send: $("send"), model: $("model"),
  webSearch: $("webSearch"), newChat: $("newChat"), recents: $("recents"),
  screenshare: $("screenshare"),
};
let ws = null, chats = loadChats(), currentId = chats[0]?.id || null;
let streaming = false, streamAssistant = null, reconnectTimer = null;

function loadChats() {
  try { const r = JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); return Array.isArray(r) ? r : []; }
  catch { return []; }
}
function saveChats() { try { localStorage.setItem(STORE_KEY, JSON.stringify(chats.slice(0, 40))); } catch {} }
function currentChat() { return chats.find(c => c.id === currentId) || null; }
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function setStatus(text, kind) {
  els.status.textContent = text;
  els.status.className = "status" + (kind ? " " + kind : "");
}
function wsUrl() {
  const u = new URL("/ai", AI_BASE);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}
function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 1500);
}
function connect() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  setStatus("connecting…");
  try { ws = new WebSocket(wsUrl()); } catch { setStatus("failed", "bad"); scheduleReconnect(); return; }
  ws.onopen = () => setStatus("connected", "ok");
  ws.onclose = () => {
    setStatus("disconnected", "bad");
    if (streaming) { streaming = false; streamAssistant = null; updateSend(); renderMessages(); }
    scheduleReconnect();
  };
  ws.onerror = () => setStatus("error", "bad");
  ws.onmessage = (ev) => { try { onServer(JSON.parse(ev.data)); } catch {} };
}
function onServer(m) {
  switch (m.type) {
    case "toast": setStatus(m.text || "notice"); break;
    case "ping": break;
    case "models": {
      const groups = m.models || {}, prev = els.model.value;
      els.model.innerHTML = "";
      Object.keys(groups).forEach((g) => {
        const og = document.createElement("optgroup"); og.label = g;
        (groups[g] || []).forEach((id) => {
          const v = typeof id === "string" ? id : (id.id || id.name || String(id));
          const o = document.createElement("option"); o.value = v; o.textContent = v; og.appendChild(o);
        });
        els.model.appendChild(og);
      });
      const prefer = ["gpt-5-4", "gpt-5-5", "instant"];
      let chosen = prev;
      if (!chosen || ![...els.model.options].some((o) => o.value === chosen))
        chosen = prefer.find((p) => [...els.model.options].some((o) => o.value === p)) || els.model.options[0]?.value;
      if (chosen) els.model.value = chosen;
      break;
    }
    case "message":
      ensureStream(); if (m.conversationId && currentChat()) currentChat().conversationId = m.conversationId;
      streaming = true; updateSend(); renderMessages(); break;
    case "thinking":
      ensureStream(); streamAssistant.reasoning = (streamAssistant.reasoning || "") + (m.delta || m.text || "");
      renderMessages(); break;
    case "content":
      ensureStream(); streamAssistant.content = (streamAssistant.content || "") + (m.delta || m.text || "");
      touchTitle(); renderMessages(); break;
    case "processing": setStatus(m.text || "processing…"); break;
    case "done":
      if (m.conversationId && currentChat()) currentChat().conversationId = m.conversationId;
      streaming = false; streamAssistant = null; setStatus("connected", "ok");
      saveChats(); renderRecents(); updateSend(); renderMessages(); break;
    case "error":
      ensureStream();
      streamAssistant.content = streamAssistant.content
        ? streamAssistant.content + "\n\n" + (m.text || m.error || "Error")
        : (m.text || m.error || "Error");
      streamAssistant.error = true;
      streaming = false; streamAssistant = null; setStatus("connected", "ok");
      saveChats(); updateSend(); renderMessages(); break;
    default: console.log("[AI]", m.type, m);
  }
}
function ensureStream() {
  const c = currentChat(); if (!c) return;
  if (!streamAssistant) {
    streamAssistant = { role: "assistant", content: "", reasoning: "" };
    c.messages.push(streamAssistant); streaming = true;
  }
}
function touchTitle() {
  const c = currentChat(); if (!c || c.title) return;
  const u = c.messages.find((m) => m.role === "user");
  if (u) { c.title = u.content.slice(0, 48); renderRecents(); }
}
function newChat() {
  const c = { id: uid(), title: "", conversationId: null, messages: [], updatedAt: Date.now() };
  chats.unshift(c); currentId = c.id; streaming = false; streamAssistant = null;
  saveChats(); renderRecents(); renderMessages(); updateSend();
  if (ws && ws.readyState === 1) try { ws.send(JSON.stringify({ type: "newChat" })); } catch {}
  els.input.focus();
}
function selectChat(id) {
  if (streaming) return;
  currentId = id; streamAssistant = null; renderRecents(); renderMessages(); updateSend();
}
function renderRecents() {
  els.recents.innerHTML = "";
  chats.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "recent-item" + (c.id === currentId ? " active" : "");
    b.textContent = c.title || "New chat"; b.onclick = () => selectChat(c.id);
    els.recents.appendChild(b);
  });
}
function renderMessages() {
  const c = currentChat(), inner = els.chatInner;
  inner.innerHTML = "";
  if (!c || !c.messages.length) {
    const w = document.createElement("div");
    w.className = "welcome"; w.innerHTML = "What <em>can</em> I help with?";
    inner.appendChild(w); return;
  }
  c.messages.forEach((m) => {
    const row = document.createElement("div");
    row.className = "msg " + m.role + (m.error ? " error" : "");
    const av = document.createElement("div"); av.className = "avatar";
    av.textContent = m.role === "user" ? "You" : "✦";
    const body = document.createElement("div"); body.className = "body";
    if (m.reasoning) {
      const th = document.createElement("div"); th.className = "thinking"; th.textContent = m.reasoning; body.appendChild(th);
    }
    if (m.content) {
      const t = document.createElement("div"); t.textContent = m.content; body.appendChild(t);
    } else if (m.role === "assistant" && streaming && m === streamAssistant) {
      const dots = document.createElement("div"); dots.className = "typing";
      dots.innerHTML = "<i></i><i></i><i></i>"; body.appendChild(dots);
    }
    row.append(av, body); inner.appendChild(row);
  });
  els.chat.scrollTop = els.chat.scrollHeight;
}
function updateSend() {
  const has = !!els.input.value.trim();
  els.send.disabled = !streaming && !has;
  els.send.classList.toggle("stop", streaming);
  els.send.innerHTML = streaming
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l-1.4 1.4L16.2 11H4v2h12.2l-5.6 5.6L12 20l8-8-8-8z"/></svg>';
}
function sendMessage() {
  const text = els.input.value.trim();
  if (!text || streaming) return;
  if (!ws || ws.readyState !== 1) { setStatus("not connected", "bad"); connect(); return; }
  const model = els.model.value;
  if (!model) { setStatus("wait for models…"); return; }
  let c = currentChat();
  if (!c) { newChat(); c = currentChat(); }
  c.messages.push({ role: "user", content: text });
  c.updatedAt = Date.now();
  if (!c.title) c.title = text.slice(0, 48);
  chats = [c, ...chats.filter((x) => x.id !== c.id)];
  saveChats(); renderRecents();
  streamAssistant = { role: "assistant", content: "", reasoning: "" };
  c.messages.push(streamAssistant);
  streaming = true; els.input.value = ""; autoSize(); updateSend(); renderMessages();
  const payload = { type: "sendMessage", content: text, model, webSearch: els.webSearch.classList.contains("on") };
  if (c.conversationId) payload.conversationId = c.conversationId;
  try { ws.send(JSON.stringify(payload)); }
  catch (e) {
    streamAssistant.content = e.message || "Failed to send"; streamAssistant.error = true;
    streaming = false; streamAssistant = null; saveChats(); updateSend(); renderMessages();
  }
}
function autoSize() {
  const ta = els.input; ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
}
els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (streaming) { streaming = false; streamAssistant = null; updateSend(); renderMessages(); return; }
  sendMessage();
});
els.input.addEventListener("input", () => { autoSize(); updateSend(); });
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!streaming) sendMessage(); }
});
els.newChat.addEventListener("click", newChat);
els.webSearch.addEventListener("click", () => els.webSearch.classList.toggle("on"));
els.screenshare.addEventListener("click", () => setStatus("screenshare not wired in this page"));
document.getElementById("attachBtn")?.addEventListener("click", () => setStatus("attachments not wired yet"));
if (!currentId) newChat(); else { renderRecents(); renderMessages(); }
updateSend(); connect(); els.input.focus();
