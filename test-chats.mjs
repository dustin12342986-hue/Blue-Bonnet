/* Chats: does a conversation survive a reload, and does it stay small? */
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
const HTML = readFileSync("index.html", "utf8");
const wait = (ms) => new Promise(r => setTimeout(r, ms));
let pass=0, fail=0;
const ck=(n,c,d="")=>{c?pass++:fail++;console.log((c?"PASS":"FAIL")+" - "+n+(d?"   ["+d+"]":""));};

function boot(store) {
  const dom = new JSDOM(HTML, { runScripts:"dangerously", pretendToBeVisual:true, url:"https://example.com/",
    beforeParse(w){ if(store) w.localStorage.setItem("bluebonnet-memory-v1", store); } });
  return dom.window;
}
async function skip(w){ for(let i=0;i<3;i++){ w.document.querySelectorAll(".onboard-opts button").forEach(b=>b.click()); await wait(50);} }
function stubOk(w, reply){
  w.eval(`window.fetch = async () => ({ ok:true, status:200, body:{getReader(){let done=false;return{async read(){
    if(done) return {done:true}; done=true;
    return {done:false, value:new TextEncoder().encode('data: '+JSON.stringify({type:"content_block_delta",delta:{type:"text_delta",text:${JSON.stringify(reply)}}})+'\\n\\n')};
  }};}} });`);
}

console.log("\n-- a chat is saved and survives a reload --");
let saved;
{
  const w = boot(); await wait(700); await skip(w); stubOk(w,"Try Maple Street.");
  w.document.getElementById("msgInput").value = "the Corolla needs an inspection";
  w.document.getElementById("sendBtn").click();
  await wait(600);
  const mem = JSON.parse(w.localStorage.getItem("bluebonnet-memory-v1"));
  saved = w.localStorage.getItem("bluebonnet-memory-v1");
  ck("chat recorded", (mem.chats||[]).length === 1, JSON.stringify((mem.chats||[]).map(c=>c.title)));
  ck("titled from the first thing said", /Corolla/.test(mem.chats[0].title), mem.chats[0].title);
  ck("both turns kept", mem.chats[0].msgs.length === 2, String(mem.chats[0].msgs.length));
}
{
  const w = boot(saved); await wait(800);
  const shown = w.document.getElementById("chatBody").textContent;
  ck("conversation is back on screen after reload", /Corolla/.test(shown) && /Maple Street/.test(shown));
  ck("model context restored too", w.__bb ? true : false);
}

console.log("\n-- switching, starting fresh, deleting --");
{
  const w = boot(saved); await wait(800); const B = w.__bb;
  w.document.getElementById("chatsBtn").click(); await wait(60);
  ck("panel opens", w.document.getElementById("chatsPanel").classList.contains("show"));
  ck("past chat listed", w.document.querySelectorAll(".chat-item").length === 1,
     String(w.document.querySelectorAll(".chat-item").length));

  B.newChat(); await wait(60);
  ck("new chat clears the screen", w.document.getElementById("chatBody").textContent.trim() === "");
  stubOk(w,"Second reply.");
  w.document.getElementById("msgInput").value = "different topic entirely";
  w.document.getElementById("sendBtn").click(); await wait(600);
  ck("now two chats", B.memory.chats.length === 2, String(B.memory.chats.length));

  const first = B.memory.chats.find(c=>/Corolla/.test(c.title));
  B.openChat(first.id); await wait(60);
  ck("switching back restores the old one", /Corolla/.test(w.document.getElementById("chatBody").textContent));

  B.deleteChat(first.id); await wait(60);
  ck("delete removes it", !B.memory.chats.some(c=>/Corolla/.test(c.title)), String(B.memory.chats.length));
}

console.log("\n-- attachment bytes never hit storage --");
{
  const w = boot(); await wait(700); await skip(w); const B = w.__bb;
  const big = "A".repeat(200000);
  B.clearMessages();
  B.pushMessage({ role:"user", content:[{type:"image",source:{type:"base64",media_type:"image/png",data:big}},{type:"text",text:"what is this bill"}]});
  B.pushMessage({ role:"assistant", content:"It's a water bill." });
  B.saveCurrentChat();
  const raw = w.localStorage.getItem("bluebonnet-memory-v1");
  ck("base64 not persisted", raw.indexOf(big.slice(0,500)) === -1);
  ck("storage stays small", raw.length < 50000, raw.length + " bytes");
  ck("text of the turn survives", /what is this bill/.test(raw));
  ck("attachment noted, not dropped", /\[attachment\]/.test(raw));
}

console.log("\n-- many chats stay bounded --");
{
  const w = boot(); await wait(700); const B = w.__bb;
  for (let i=0;i<60;i++){
    B.newChat(); B.clearMessages();
    B.pushMessage({role:"user",content:"topic number "+i+" "+"x".repeat(400)});
    B.pushMessage({role:"assistant",content:"ok "+i});
    B.saveCurrentChat();
  }
  ck("capped at 40", B.memory.chats.length <= 40, String(B.memory.chats.length));
  ck("newest kept, oldest dropped", B.memory.chats.some(c=>/topic number 59/.test(c.title))
     && !B.memory.chats.some(c=>/topic number 0 /.test(c.title)));
  ck("total storage sane", w.localStorage.getItem("bluebonnet-memory-v1").length < 400000,
     w.localStorage.getItem("bluebonnet-memory-v1").length + " bytes");
}

console.log("\n"+pass+" passed, "+fail+" failed\n");
process.exit(fail?1:0);
