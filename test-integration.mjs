import { JSDOM } from "/home/claude/bb/node_modules/jsdom/lib/api.js";
import fs from "fs";
const kit = fs.readFileSync("/tmp/bbk/blue-bonnet-kit.js","utf8");
const dom = new JSDOM(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><script>${kit}<\/script></body></html>`,{runScripts:"dangerously"});
const w=dom.window;
const rd=(e,f)=>{try{return w.eval(e)}catch(err){return f}};

const res=[],ck=(n,c,x="")=>res.push((c?"PASS":"FAIL")+" - "+n+(x?" ["+x+"]":""));

rd(`BBKit.configure({gatewayKey:"k1", anthropicProxyUrl:"https://proxy.example.dev", app:"blue-bonnet"})`);

// This is exactly what Blue Bonnet Brain sends: two blocks, first one cached.
rd(`window.__sent=null;
 window.fetch = async (u,o) => {
   const b=JSON.parse(o.body);
   if(String(u).includes("proxy.example.dev")){
     return {ok:false,status:400,text:async()=>'{"error":{"message":"credit balance is too low"}}'};
   }
   window.__sent=b;
   return {ok:true,status:200,json:async()=>({choices:[{message:{content:"gateway reply"}}],bb:{interaction_id:"g1"}})};
 };`);

const out = await w.eval(`(async()=>{
  const msgs=[{role:"user",content:"what about the Corolla"}];
  const r = await BBKit.ask({
    system:[
      {type:"text",text:"You are Blue Bonnet. HARD BOUNDARY: never hand down a verdict about someone's relationships or mental health.",cache_control:{type:"ephemeral"}},
      {type:"text",text:"ESTABLISHED — They own the Corolla"}
    ],
    messages: msgs,
  });
  return {r, sent: window.__sent};
})()`);

const sysMsg = out.sent.messages[0];
console.log("\n--- what the gateway actually received as the system prompt ---");
console.log(JSON.stringify(sysMsg.content).slice(0,220));
console.log();

ck("fell back to gateway", out.r.usedBackup === true);
ck("gateway system prompt is a usable string", typeof sysMsg.content === "string", typeof sysMsg.content);
ck("identity survives the fallback", String(sysMsg.content).includes("You are Blue Bonnet"), String(sysMsg.content).slice(0,60));
ck("HARD BOUNDARY survives the fallback", String(sysMsg.content).includes("HARD BOUNDARY"));
ck("memory block survives the fallback", String(sysMsg.content).includes("Corolla"));
ck("no [object Object] leaked", !String(sysMsg.content).includes("[object Object]"));

console.log(res.join("\n"));
console.log("\n"+res.filter(x=>x.startsWith("PASS")).length+"/"+res.length+" passed\n");
process.exit(0);
