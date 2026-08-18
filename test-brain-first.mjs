/* The gateway is the brain and the primary. Anthropic is reserve. */
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
const HTML = readFileSync("index.html","utf8");
const KIT = readFileSync("blue-bonnet-kit.js","utf8");
const wait = ms => new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ck=(n,c,d="")=>{c?pass++:fail++;console.log((c?"PASS":"FAIL")+" - "+n+(d?"   ["+d+"]":""));};

function boot(){
  // inline the kit so no network fetch is needed
  const html = HTML.replace('<script src="blue-bonnet-kit.js"></script>', '<script>'+KIT+'</script>');
  const dom = new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://example.com/"});
  return dom.window;
}
async function skip(w){for(let i=0;i<3;i++){w.document.querySelectorAll(".onboard-opts button").forEach(b=>b.click());await wait(50);}}
const oaDelta = t => 'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n';
const anDelta = t => 'data: '+JSON.stringify({type:"content_block_delta",delta:{type:"text_delta",text:t}})+'\n\n';
function sse(chunks){let i=0;const enc=new TextEncoder();
  return {getReader(){return{async read(){ if(i>=chunks.length) return {done:true};
    return {done:false,value:enc.encode(chunks[i++])};}};}};}
const okStream = chunks => ({ok:true,status:200,headers:{get:()=>"text/event-stream"},body:sse(chunks)});

console.log("\n-- the brain answers first --");
{
  const w = boot(); await wait(700); await skip(w);
  w.eval(`window.__urls=[]; window.fetch = async (u,o) => { window.__urls.push(String(u));
    return window.__mk(String(u)); };`);
  w.__mk = (u) => u.includes("gateway") ? okStream([oaDelta("Start "),oaDelta("with the bill.")])
                                        : okStream([anDelta("anthropic answered")]);
  w.document.getElementById("msgInput").value="where do I start";
  w.document.getElementById("sendBtn").click(); await wait(700);
  const urls = w.eval("window.__urls");
  ck("gateway called first", /gateway/.test(urls[0]), urls.join(" | "));
  ck("anthropic never touched", !urls.some(u=>/app-proxy/.test(u)), urls.join(" | "));
  ck("brain reply on screen", /Start with the bill/.test(w.document.getElementById("chatBody").textContent));
  ck("header shows brain mode", /BRAIN/.test(w.document.getElementById("statusText").textContent),
     w.document.getElementById("statusText").textContent);
  ck("no per-message symbol clutter",
     !/\u{1F9E0}/u.test(w.document.getElementById("chatBody").textContent));
}

console.log("\n-- brain down: anthropic is the reserve --");
{
  const w = boot(); await wait(700); await skip(w);
  w.eval(`window.__urls=[]; window.fetch = async (u,o) => { window.__urls.push(String(u)); return window.__mk(String(u)); };`);
  w.__mk = (u) => u.includes("gateway")
    ? ({ok:false,status:502,headers:{get:()=>"application/json"},text:async()=>'{"error":{"message":"Backup providers all failed — groq: no GROQ_API_KEY set"}}'})
    : okStream([anDelta("Reserve here.")]);
  w.document.getElementById("msgInput").value="hi";
  w.document.getElementById("sendBtn").click(); await wait(1400);
  const urls = w.eval("window.__urls");
  ck("tried gateway, then anthropic", /gateway/.test(urls[0]) && urls.some(u=>/app-proxy/.test(u)), urls.join(" | "));
  ck("user still gets an answer", /Reserve here/.test(w.document.getElementById("chatBody").textContent));
  ck("header shows reserve", /RESERVE/.test(w.document.getElementById("statusText").textContent),
     w.document.getElementById("statusText").textContent);
}

console.log("\n-- both down: names the brain's reason too --");
{
  const w = boot(); await wait(700); await skip(w);
  w.eval(`window.fetch = async (u,o) => window.__mk(String(u));`);
  w.__mk = (u) => u.includes("gateway")
    ? ({ok:false,status:502,headers:{get:()=>"application/json"},text:async()=>'{"error":{"message":"groq: no GROQ_API_KEY set"}}'})
    : ({ok:false,status:400,headers:{get:()=>"application/json"},text:async()=>'{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}'});
  w.document.getElementById("msgInput").value="hi";
  w.document.getElementById("sendBtn").click(); await wait(1200);
  const shown = w.document.getElementById("chatBody").textContent;
  ck("says anthropic is out of credit", /out of API credit/i.test(shown), shown.slice(-140));
  ck("also says why the brain failed", /brain:.*GROQ_API_KEY/.test(shown), shown.slice(-160));
}

console.log("\n-- gateway gets the full system prompt --");
{
  const w = boot(); await wait(700); await skip(w);
  w.eval(`window.__body=null; window.fetch = async (u,o) => { if(String(u).includes("gateway")) window.__body=JSON.parse(o.body);
    return window.__mk(String(u)); };`);
  w.__mk = () => okStream([oaDelta("ok")]);
  w.document.getElementById("msgInput").value="hi";
  w.document.getElementById("sendBtn").click(); await wait(600);
  const b = w.eval("window.__body");
  ck("asked the gateway to stream", b && b.stream === true);
  ck("system turn is a flat string", b && typeof b.messages[0].content === "string");
  ck("identity reached the brain", b && /BLUE BONNET/.test(b.messages[0].content));
  ck("knowledge base reached the brain", b && b.messages[0].content.length > 3000, b && String(b.messages[0].content.length));
  ck("no [object Object]", b && !/\[object Object\]/.test(b.messages[0].content));
}

console.log("\n"+pass+" passed, "+fail+" failed\n");
process.exit(fail?1:0);
