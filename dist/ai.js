const AI_BASE="https://cdn.northstreetumc.org";
const STORE_KEY="grok_ui_chats_v1";
const CHUNK=800000;
const $=(id)=>document.getElementById(id);

let ws=null,chats=load(),currentId=chats[0]?.id||null;
let streaming=false,streamAsst=null,reconnect=null,pendingMedia=null,ssStream=null;
let webOn=false;

const statusEl=$("status"),recents=$("recents"),empty=$("empty"),thread=$("thread"),msgs=$("msgs");
const input=$("input"),input2=$("input2"),model=$("model"),model2=$("model2");
const send=$("send"),send2=$("send2");

function load(){try{const r=JSON.parse(localStorage.getItem(STORE_KEY)||"[]");return Array.isArray(r)?r:[]}catch{return[]}}
function save(){try{localStorage.setItem(STORE_KEY,JSON.stringify(chats.slice(0,50)))}catch{}}
function cur(){return chats.find(c=>c.id===currentId)||null}
function uid(){return Math.random().toString(36).slice(2)+Date.now().toString(36)}
function setStatus(t,k){statusEl.textContent=t;statusEl.className="status"+(k?" "+k:"")}
function wsUrl(){const u=new URL("/ai",AI_BASE);u.protocol=u.protocol==="https:"?"wss:":"ws:";return u.toString()}

function connect(){
  if(ws&&(ws.readyState===0||ws.readyState===1))return;
  setStatus("connecting…");
  try{ws=new WebSocket(wsUrl())}catch{setStatus("failed","bad");schedule();return}
  ws.onopen=()=>setStatus("connected","ok");
  ws.onclose=()=>{setStatus("disconnected","bad");if(streaming){streaming=false;streamAsst=null;updSend();render()}schedule()};
  ws.onerror=()=>setStatus("error","bad");
  ws.onmessage=(ev)=>{try{onMsg(JSON.parse(ev.data))}catch{}};
}
function schedule(){if(reconnect)clearTimeout(reconnect);reconnect=setTimeout(connect,1500)}

function syncModels(select,list,prev){
  select.innerHTML="";
  Object.keys(list||{}).forEach(g=>{
    const og=document.createElement("optgroup");og.label=g;
    (list[g]||[]).forEach(id=>{
      const v=typeof id==="string"?id:(id.id||id.name||String(id));
      const o=document.createElement("option");o.value=v;o.textContent=v;og.appendChild(o);
    });
    select.appendChild(og);
  });
  const prefer=["grok-4-6","gpt-5-4","gpt-5-5","instant"];
  let chosen=prev;
  if(!chosen||![...select.options].some(o=>o.value===chosen))
    chosen=prefer.find(p=>[...select.options].some(o=>o.value===p))||select.options[0]?.value;
  if(chosen)select.value=chosen;
}

function onMsg(m){
  if(m.type==="requestMediaId"&&pendingMedia){pendingMedia(m.mediaId);pendingMedia=null;return}
  switch(m.type){
    case"toast":setStatus(m.text||"notice");break;
    case"ping":break;
    case"models":
      syncModels(model,m.models,model.value);
      syncModels(model2,m.models,model2.value);
      break;
    case"message":
      ensure();if(m.conversationId&&cur())cur().conversationId=m.conversationId;
      streaming=true;updSend();render();break;
    case"thinking":
      ensure();streamAsst.reasoning=(streamAsst.reasoning||"")+(m.delta||m.text||"");render();break;
    case"content":
      ensure();streamAsst.content=(streamAsst.content||"")+(m.delta||m.text||"");
      title();render();break;
    case"processing":setStatus(m.text||"processing…");break;
    case"done":
      if(m.conversationId&&cur())cur().conversationId=m.conversationId;
      streaming=false;streamAsst=null;setStatus("connected","ok");save();renderRecents();updSend();render();break;
    case"error":
      ensure();streamAsst.content=streamAsst.content?streamAsst.content+"\n\n"+(m.text||m.error||"Error"):(m.text||m.error||"Error");
      streamAsst.error=true;streaming=false;streamAsst=null;setStatus("connected","ok");save();updSend();render();break;
    default:console.log("[AI]",m.type,m);
  }
}
function ensure(){
  const c=cur();if(!c)return;
  if(!streamAsst){streamAsst={role:"assistant",content:"",reasoning:""};c.messages.push(streamAsst);streaming=true}
}
function title(){
  const c=cur();if(!c||c.title)return;
  const u=c.messages.find(m=>m.role==="user");
  if(u){c.title=(u.content||"Image").slice(0,48);renderRecents()}
}

function showThread(on){
  empty.hidden=!!on;thread.hidden=!on;
}
function newChat(){
  const c={id:uid(),title:"",conversationId:null,messages:[],updatedAt:Date.now()};
  chats.unshift(c);currentId=c.id;streaming=false;streamAsst=null;
  save();renderRecents();render();updSend();
  if(ws&&ws.readyState===1)try{ws.send(JSON.stringify({type:"newChat"}))}catch{}
  activeInput().focus();
}
function selectChat(id){
  if(streaming)return;
  currentId=id;streamAsst=null;renderRecents();render();updSend();
}
function renderRecents(){
  recents.innerHTML="";
  chats.forEach(c=>{
    const b=document.createElement("button");
    b.type="button";b.className="chat-item"+(c.id===currentId?" active":"");
    b.textContent=c.title||"New chat";
    b.onclick=()=>selectChat(c.id);
    recents.appendChild(b);
  });
}
function render(){
  const c=cur();
  if(!c||!c.messages.length){showThread(false);return}
  showThread(true);
  msgs.innerHTML="";
  c.messages.forEach(m=>{
    const row=document.createElement("div");
    row.className="msg "+m.role+(m.error?" error":"");
    const av=document.createElement("div");av.className="av";av.textContent=m.role==="user"?"You":"";
    const body=document.createElement("div");body.className="body";
    if(m.reasoning){const t=document.createElement("div");t.className="thinking";t.textContent=m.reasoning;body.appendChild(t)}
    if(m.imageUrl){const img=document.createElement("img");img.className="shot";img.src=m.imageUrl;body.appendChild(img)}
    if(m.content){const t=document.createElement("div");t.textContent=m.content;body.appendChild(t)}
    else if(m.role==="assistant"&&streaming&&m===streamAsst){
      const d=document.createElement("div");d.className="typing";d.innerHTML="<i></i><i></i><i></i>";body.appendChild(d);
    }
    row.append(av,body);msgs.appendChild(row);
  });
  const stage=$("stage");stage.scrollTop=stage.scrollHeight;
}
function activeInput(){return thread.hidden?input:input2}
function activeModel(){return thread.hidden?model:model2}
function updSend(){
  [send,send2].forEach(btn=>{
    const ta=btn===send?input:input2;
    const has=!!ta.value.trim();
    btn.disabled=!streaming&&!has;
    btn.classList.toggle("stop",streaming);
  });
}
function autoSize(ta){ta.style.height="auto";ta.style.height=Math.min(ta.scrollHeight,160)+"px"}

function sendText(){
  const ta=activeInput();
  const text=ta.value.trim();
  if(!text||streaming)return;
  if(!ws||ws.readyState!==1){setStatus("not connected","bad");connect();return}
  const mod=activeModel().value;
  if(!mod){setStatus("wait for models…");return}
  let c=cur();if(!c){newChat();c=cur()}
  c.messages.push({role:"user",content:text});
  c.updatedAt=Date.now();
  if(!c.title)c.title=text.slice(0,48);
  chats=[c,...chats.filter(x=>x.id!==c.id)];
  save();renderRecents();
  streamAsst={role:"assistant",content:"",reasoning:""};
  c.messages.push(streamAsst);
  streaming=true;ta.value="";autoSize(ta);updSend();render();
  const payload={type:"sendMessage",content:text,model:mod,webSearch:webOn};
  if(c.conversationId)payload.conversationId=c.conversationId;
  try{ws.send(JSON.stringify(payload))}catch(e){
    streamAsst.content=e.message||"Failed";streamAsst.error=true;
    streaming=false;streamAsst=null;save();updSend();render();
  }
}

function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>{const s=String(r.result||"");const i=s.indexOf(",");resolve(i>=0?s.slice(i+1):s)};
    r.onerror=reject;r.readAsDataURL(file);
  });
}
async function sendMedia(file,prompt,previewUrl){
  if(!ws||ws.readyState!==1)throw new Error("not connected");
  const mod=activeModel().value;if(!mod)throw new Error("wait for models");
  let c=cur();if(!c){newChat();c=cur()}
  c.messages.push({role:"user",content:prompt||"",imageUrl:previewUrl||undefined});
  if(!c.title)c.title=(prompt||"Image").slice(0,48);
  chats=[c,...chats.filter(x=>x.id!==c.id)];save();renderRecents();
  streamAsst={role:"assistant",content:"",reasoning:""};c.messages.push(streamAsst);
  streaming=true;updSend();render();
  const b64=await fileToBase64(file);
  const mediaId=await new Promise((resolve,reject)=>{
    pendingMedia=resolve;
    ws.send(JSON.stringify({type:"mediaStart",model:mod,mime:file.type||"image/jpeg",conversationId:c.conversationId||undefined}));
    setTimeout(()=>{if(pendingMedia===resolve){pendingMedia=null;reject(new Error("upload timed out"))}},20000);
  });
  for(let i=0;i<b64.length;i+=CHUNK)ws.send(JSON.stringify({type:"mediaChunk",mediaId,chunk:b64.slice(i,i+CHUNK)}));
  ws.send(JSON.stringify({type:"mediaDone",mediaId,prompt:prompt||"Describe this image.",webSearch:webOn}));
}

async function startSS(){
  if(ssStream)return;
  if(!navigator.mediaDevices?.getDisplayMedia){setStatus("screenshare not supported","bad");return}
  try{ssStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false})}
  catch(e){if(e?.name!=="NotAllowedError")setStatus("screenshare failed","bad");return}
  $("ssVideo").srcObject=ssStream;
  $("ssBar").classList.add("show");
  ssStream.getVideoTracks()[0]?.addEventListener("ended",stopSS);
  setStatus("screenshare live","ok");
  if(thread.hidden)showThread(true);
}
function stopSS(){
  if(ssStream){ssStream.getTracks().forEach(t=>t.stop());ssStream=null}
  $("ssVideo").srcObject=null;$("ssBar").classList.remove("show");
  setStatus("connected","ok");
}
async function askSS(){
  if(streaming)return;
  if(!ssStream){await startSS();return}
  const video=$("ssVideo");
  if(!video.videoWidth){setStatus("no frame yet","bad");return}
  const canvas=document.createElement("canvas");
  const scale=Math.min(1,1280/video.videoWidth);
  canvas.width=Math.round(video.videoWidth*scale);
  canvas.height=Math.round(video.videoHeight*scale);
  canvas.getContext("2d").drawImage(video,0,0,canvas.width,canvas.height);
  const blob=await new Promise(r=>canvas.toBlob(r,"image/jpeg",0.85));
  if(!blob)return;
  const file=new File([blob],"screen.jpg",{type:"image/jpeg"});
  const prompt=activeInput().value.trim()||"What do you see on my screen?";
  activeInput().value="";
  await sendMedia(file,prompt,URL.createObjectURL(blob));
}

function bindInput(ta,btn){
  ta.addEventListener("input",()=>{autoSize(ta);updSend()});
  ta.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(!streaming)sendText()}});
  btn.addEventListener("click",()=>{if(streaming){streaming=false;streamAsst=null;updSend();render()}else sendText()});
}
bindInput(input,send);bindInput(input2,send2);

$("newChat").onclick=newChat;
$("promoDismiss").onclick=()=>$("promo").hidden=true;
function toggleWeb(btn){webOn=!webOn;btn.classList.toggle("active",webOn);$("webSearch").classList.toggle("active",webOn);$("webSearch2").classList.toggle("active",webOn)}
$("webSearch").onclick=()=>toggleWeb($("webSearch"));
$("webSearch2").onclick=()=>toggleWeb($("webSearch2"));
$("screenshare").onclick=()=>{if(ssStream)stopSS();else startSS()};
$("screenshare2").onclick=()=>{if(ssStream)stopSS();else startSS()};
$("ssStop").onclick=stopSS;$("ssAsk").onclick=askSS;
$("attachBtn").onclick=$("attachBtn2").onclick=()=>$("fileInput").click();
$("fileInput").onchange=async()=>{
  const f=$("fileInput").files?.[0];$("fileInput").value="";
  if(!f||streaming)return;
  try{await sendMedia(f,activeInput().value.trim()||"Describe this image.",URL.createObjectURL(f));activeInput().value=""}catch(e){setStatus(e.message||"upload failed","bad")}
};
model.onchange=()=>{model2.value=model.value};
model2.onchange=()=>{model.value=model2.value};

if(!currentId)newChat();else{renderRecents();render()}
updSend();connect();input.focus();
