const AI_BASE = "https://cdn.northstreetumc.org";
const STORE_KEY = "grok_ai_chats_v1";
const CHUNK = 800000;
const $ = (id) => document.getElementById(id);
const els = {
  status: $("status"), chat: $("chat"), chatInner: $("chatInner"),
  form: $("form"), input: $("input"), send: $("send"), model: $("model"),
  webSearch: $("webSearch"), newChat: $("newChat"), recents: $("recents"),
  screenshare: $("screenshare"), ssBar: $("ssBar"), ssVideo: $("ssVideo"),
  ssAsk: $("ssAsk"), ssStop: $("ssStop"), ssDot: $("ssDot"), ssLabel: $("ssLabel"),
  attachBtn: $("attachBtn"), fileInput: $("fileInput"),
};
let ws = null, chats = loadChats(), currentId = chats[0]?.id || null;
let streaming = false, streamAssistant = null, reconnectTimer = null;
let pendingMediaResolve = null, ssStream = null;

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
  try { ws = new WebSocket(wsUrl()); }
  catch { setStatus("failed", "bad"); scheduleReconnect(); return; }
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
  if (m.type === "requestMediaId" && pendingMediaResolve) {
    pendingMediaResolve(m.mediaId); pendingMediaResolve = null; return;
  }
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
      const prefer = ["grok-4-6", "gpt-5-4", "gpt-5-5", "instant"];
      let chosen = prev;
      if (!chosen || ![...els.model.options].some((o) => o.value === chosen))
        chosen = prefer.find((p) => [...els.model.options].some((o) => o.value === p)) || els.model.options[0]?.value;
      if (chosen) els.model.value = chosen;
      break;
    }
    case "message":
      ensureStream();
      if (m.conversationId && currentChat()) currentChat().conversationId = m.conversationId;
      streaming = true; updateSend(); renderMessages(); break;
    case "thinking":
      ensureStream();
      streamAssistant.reasoning = (streamAssistant.reasoning || "") + (m.delta || m.text || "");
      renderMessages(); break;
    case "content":
      ensureStream();
      streamAssistant.content = (streamAssistant.content || "") + (m.delta || m.text || "");
      touchTitle(); renderMessages(); break;
    case "processing": setStatus(m.text || "processing…"); break;
    case "image":
    case "video":
      ensureStream();
      streamAssistant.content = (streamAssistant.content || "") + (streamAssistant.content ? "\n\n" : "") + `[${m.type}](${m.url || ""})`;
      renderMessages(); break;
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
  if (u) { c.title = (u.content || "Image").slice(0, 48); renderRecents(); }
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
    b.type = "button";
    b.className = "recent-item" + (c.id === currentId ? " active" : "");
    b.textContent = c.title || "New chat";
    b.onclick = () => selectChat(c.id);
    els.recents.appendChild(b);
  });
}
function renderMessages() {
  const c = currentChat(), inner = els.chatInner;
  inner.innerHTML = "";
  if (!c || !c.messages.length) {
    inner.innerHTML = '<div class="welcome"><h1>What can I <em>help</em> with?</h1><p>Ask anything, share your screen, or toggle web search.</p></div>';
    return;
  }
  c.messages.forEach((m) => {
    const row = document.createElement("div");
    row.className = "msg " + m.role + (m.error ? " error" : "");
    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = m.role === "user" ? "You" : "G";
    const body = document.createElement("div");
    body.className = "body";
    if (m.reasoning) {
      const th = document.createElement("div");
      th.className = "thinking"; th.textContent = m.reasoning; body.appendChild(th);
    }
    if (m.imageUrl) {
      const img = document.createElement("img");
      img.className = "shot"; img.src = m.imageUrl; img.alt = "Attachment"; body.appendChild(img);
    }
    if (m.content) {
      const t = document.createElement("div"); t.textContent = m.content; body.appendChild(t);
    } else if (m.role === "assistant" && streaming && m === streamAssistant) {
      const dots = document.createElement("div");
      dots.className = "typing"; dots.innerHTML = "<i></i><i></i><i></i>"; body.appendChild(dots);
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
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
async function sendMedia(file, prompt, previewUrl) {
  if (!ws || ws.readyState !== 1) throw new Error("not connected");
  const model = els.model.value;
  if (!model) throw new Error("wait for models");
  let c = currentChat();
  if (!c) { newChat(); c = currentChat(); }
  c.messages.push({ role: "user", content: prompt || "", imageUrl: previewUrl || undefined });
  if (!c.title) c.title = (prompt || "Screen / image").slice(0, 48);
  chats = [c, ...chats.filter((x) => x.id !== c.id)];
  saveChats(); renderRecents();
  streamAssistant = { role: "assistant", content: "", reasoning: "" };
  c.messages.push(streamAssistant);
  streaming = true; updateSend(); renderMessages();
  const b64 = await fileToBase64(file);
  const mediaId = await new Promise((resolve, reject) => {
    pendingMediaResolve = resolve;
    ws.send(JSON.stringify({
      type: "mediaStart", model, mime: file.type || "image/jpeg",
      conversationId: c.conversationId || undefined,
    }));
    setTimeout(() => {
      if (pendingMediaResolve === resolve) { pendingMediaResolve = null; reject(new Error("upload timed out")); }
    }, 20000);
  });
  for (let i = 0; i < b64.length; i += CHUNK) {
    ws.send(JSON.stringify({ type: "mediaChunk", mediaId, chunk: b64.slice(i, i + CHUNK) }));
  }
  ws.send(JSON.stringify({
    type: "mediaDone", mediaId,
    prompt: prompt || "Describe this image.",
    webSearch: els.webSearch.classList.contains("on"),
  }));
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
  const payload = {
    type: "sendMessage", content: text, model,
    webSearch: els.webSearch.classList.contains("on"),
  };
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
async function startScreenshare() {
  if (ssStream) { setStatus("screenshare already active"); return; }
  if (!navigator.mediaDevices?.getDisplayMedia) { setStatus("screenshare not supported", "bad"); return; }
  try {
    ssStream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "monitor" }, audio: false });
  } catch (err) {
    if (err?.name !== "NotAllowedError") setStatus("screenshare failed", "bad");
    return;
  }
  els.ssVideo.srcObject = ssStream;
  els.ssBar.classList.add("show");
  els.screenshare.classList.add("live");
  els.ssDot.hidden = false;
  els.ssLabel.textContent = "Live — click “Ask about screen” to analyze a frame";
  const track = ssStream.getVideoTracks()[0];
  if (track) track.addEventListener("ended", stopScreenshare);
  setStatus("screenshare live", "ok");
}
function stopScreenshare() {
  if (ssStream) { ssStream.getTracks().forEach((t) => t.stop()); ssStream = null; }
  els.ssVideo.srcObject = null;
  els.ssBar.classList.remove("show");
  els.screenshare.classList.remove("live");
  els.ssDot.hidden = true;
  setStatus("connected", "ok");
}
async function captureScreenFrame() {
  const video = els.ssVideo;
  if (!ssStream || !video.videoWidth) throw new Error("no screen frame yet");
  const canvas = document.createElement("canvas");
  const maxW = 1280;
  const scale = Math.min(1, maxW / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  if (!blob) throw new Error("capture failed");
  return { file: new File([blob], "screen.jpg", { type: "image/jpeg" }), previewUrl: URL.createObjectURL(blob) };
}
async function askAboutScreen() {
  if (streaming) return;
  if (!ssStream) { await startScreenshare(); return; }
  try {
    els.ssAsk.disabled = true;
    els.ssLabel.textContent = "Capturing frame…";
    const { file, previewUrl } = await captureScreenFrame();
    const prompt = els.input.value.trim() || "What do you see on my screen? Summarize and answer any visible questions.";
    els.input.value = ""; autoSize();
    els.ssLabel.textContent = "Sending to AI…";
    await sendMedia(file, prompt, previewUrl);
    els.ssLabel.textContent = "Live — click “Ask about screen” to analyze a frame";
  } catch (e) {
    setStatus(e.message || "screenshare error", "bad");
    els.ssLabel.textContent = "Capture failed — try again";
  } finally { els.ssAsk.disabled = false; }
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
els.screenshare.addEventListener("click", () => { if (ssStream) stopScreenshare(); else startScreenshare(); });
els.ssStop.addEventListener("click", stopScreenshare);
els.ssAsk.addEventListener("click", askAboutScreen);
els.attachBtn.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files?.[0];
  els.fileInput.value = "";
  if (!file || streaming) return;
  try {
    const previewUrl = URL.createObjectURL(file);
    const prompt = els.input.value.trim() || "Describe this image.";
    els.input.value = ""; autoSize();
    await sendMedia(file, prompt, previewUrl);
  } catch (e) { setStatus(e.message || "upload failed", "bad"); }
});
if (!currentId) newChat(); else { renderRecents(); renderMessages(); }
updateSend(); connect(); els.input.focus();
