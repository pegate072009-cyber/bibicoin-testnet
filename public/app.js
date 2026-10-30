
const $=id=>document.getElementById(id);
const API="";
let wallet=null, mining=false, stopFlag=false;
const UNIT=100000000n;
function fmtUnits(v){return (Number(BigInt(v))/1e8).toFixed(8).replace(/\.?0+$/,"")||"0"}
function toUnits(v){if(!/^\d+(\.\d{1,8})?$/.test(v))throw Error("Enter a positive amount with up to 8 decimal places.");let [a,b=""]=v.split(".");return (BigInt(a)*UNIT+BigInt((b+"00000000").slice(0,8))).toString()}
function stable(v){if(Array.isArray(v))return "["+v.map(stable).join(",")+"]";if(v&&typeof v==="object")return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")+"}";return JSON.stringify(v)}
function b64bytes(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
function pemBytes(pem){return b64bytes(pem.replace(/-----[^-]+-----/g,"").replace(/\s/g,""))}
async function signText(privatePem,text){
  if(!crypto.subtle)throw Error("Secure browser cryptography is unavailable. Open this site using HTTPS.");
  const key=await crypto.subtle.importKey("pkcs8",pemBytes(privatePem),{name:"Ed25519"},false,["sign"]);
  const sig=await crypto.subtle.sign({name:"Ed25519"},key,new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function digest(text){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function api(url,opts={}){let r=await fetch(API+url,{...opts,headers:{"Content-Type":"application/json",...(opts.headers||{})}});let raw=await r.text(),j;try{j=raw?JSON.parse(raw):{}}catch{throw Error("Server returned an invalid response. Check that the Bibicoin service is running.")}if(!r.ok)throw Error(j.error||"Request failed");return j}
function node(tag, text, className){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=String(text);return n}
function line(parent, label, value){const p=node("p");p.append(node("b",label+": "),document.createTextNode(String(value)));parent.append(p)}
function renderInfoRows(target, rows){target.replaceChildren();for(const row of rows){const box=node("div",undefined,"status");for(const part of row){if(part.type==="br")box.append(document.createElement("br"));else if(part.type==="strong")box.append(node("b",part.text));else if(part.type==="hash")box.append(node("span",part.text,"hash"));else box.append(document.createTextNode(part.text));}target.append(box)}}
function loadWallet(){try{wallet=JSON.parse(localStorage.getItem("bibicoin_wallet")||"null")}catch{wallet=null}renderWallet()}
function saveWallet(){localStorage.setItem("bibicoin_wallet",JSON.stringify(wallet));renderWallet()}
function renderWallet(){let yes=!!wallet;$("noWallet").classList.toggle("hidden",yes);$("walletArea").classList.toggle("hidden",!yes);if(yes){$("address").textContent=wallet.address;refreshWallet().catch(e=>$("walletStatus").textContent=e.message)}}
async function refreshStatus(){let s=await api("/api/status");$("height").textContent=s.height.toLocaleString();$("issued").textContent=s.issued.toLocaleString()+" BBC";$("reward").textContent=s.reward+" BBC";$("pending").textContent=s.pendingTransactions;$("mineReward").textContent=s.reward+" BBC";$("difficulty").textContent=s.difficulty+" leading zeroes";const r=$("rules");r.replaceChildren();line(r,"Symbol","BBC");line(r,"Maximum supply cap",s.maxSupply.toLocaleString()+" BBC");line(r,"Initial reward","50 BBC");line(r,"Halving interval",s.halvingInterval.toLocaleString()+" blocks");line(r,"SHA-256 difficulty",s.difficulty+" leading zeroes");line(r,"Current mode",s.mode);const p=node("p");p.append(node("b","Latest block hash: "),node("span",s.latestHash,"hash"));r.append(p)}
async function refreshWallet(){if(!wallet)return;let w=await api("/api/wallet/"+wallet.address);$("balance").textContent=fmtUnits(w.balance)+" BBC";$("available").textContent=fmtUnits(w.balance)+" BBC";const rows=w.transactions.map(t=>[{type:"strong",text:"Block "+t.blockHeight},{type:"text",text:" · "+(t.from===wallet.address?"Sent":"Received")+" "+fmtUnits(t.amount)+" BBC"},{type:"br"},{type:"hash",text:t.id}]);renderInfoRows($("walletTx"),rows);if(!rows.length)$("walletTx").textContent="No confirmed transactions yet.";let txs=await api("/api/transactions");let pending=txs.pending.filter(t=>t.from===wallet.address).reduce((s,t)=>s+BigInt(t.amount),0n);$("available").textContent=fmtUnits((BigInt(w.balance)-pending).toString())+" BBC"}
$("createWallet").onclick=async()=>{try{if(wallet&&!confirm("Replace the wallet saved on this device? Back up its key first."))return;let w=await api("/api/wallet/new",{method:"POST",body:"{}"});wallet={address:w.address,publicKey:w.publicKey,privateKey:w.privateKey};saveWallet();$("keyBox").textContent=w.privateKey;$("keyBox").classList.remove("hidden");alert("Wallet created. Back up the private key now. The server will not show it again.")}catch(e){alert(e.message)}};
$("showKey").onclick=()=>{if(!wallet)return;$("keyBox").textContent=wallet.privateKey;$("keyBox").classList.toggle("hidden")};
$("forgetKey").onclick=()=>{if(confirm("Remove the wallet key from this browser? Make sure you have a backup.")){localStorage.removeItem("bibicoin_wallet");wallet=null;renderWallet()}};
$("send").onclick=async()=>{try{if(!wallet)throw Error("Create a wallet first.");let to=$("to").value.trim().toUpperCase(),amount=toUnits($("amount").value);if(!/^BBC[A-F0-9]{40}$/.test(to))throw Error("Recipient address format is invalid.");let tx={from:wallet.address,to,amount,timestamp:Date.now(),nonce:Date.now()+Math.floor(Math.random()*1000000),publicKey:wallet.publicKey};let payload=stable({from:tx.from,to:tx.to,amount:tx.amount,timestamp:tx.timestamp,nonce:tx.nonce});tx.signature=await signText(wallet.privateKey,payload);tx.id=await digest(stable(tx));let result=await api("/api/transaction",{method:"POST",body:JSON.stringify(tx)});$("walletStatus").textContent="Transfer accepted into pending pool. Transaction ID: "+result.transactionId;$("to").value="";$("amount").value="";await refreshStatus();await refreshWallet()}catch(e){$("walletStatus").textContent=e.message}};
async function mineLoop(){if(!wallet)throw Error("Create a wallet before mining.");mining=true;stopFlag=false;$("startMine").disabled=true;$("stopMine").disabled=false;
try{
 while(!stopFlag){
  let {candidate,difficulty}=await api("/api/mine/template",{method:"POST",body:JSON.stringify({miner:wallet.address})});
  let nonce=0,found=null,tries=0,last=Date.now();
  $("mineStatus").textContent="Mining block "+candidate.height+"…";
  while(!stopFlag){
   candidate.nonce=nonce++;
   delete candidate.hash;
   candidate.hash=await digest(stable(candidate));
   tries++;
   if(candidate.hash.startsWith("0".repeat(difficulty))){found={...candidate};break}
   if(tries%100===0){$("mineStatus").textContent=`Mining block ${candidate.height} · ${tries.toLocaleString()} hashes · nonce ${nonce.toLocaleString()}`;await new Promise(r=>setTimeout(r,0))}
  }
  if(stopFlag)break;
  let result=await api("/api/mine/submit",{method:"POST",body:JSON.stringify({block:found})});
  const mineBox=$("mineStatus");mineBox.replaceChildren(node("span","Block "+result.height+" accepted!","good"),document.createElement("br"),document.createTextNode("Hash: "),node("span",result.hash,"hash"));
  await refreshStatus();await refreshWallet();await refreshExplorer();
 }
}catch(e){$("mineStatus").textContent=e.message}
finally{mining=false;$("startMine").disabled=false;$("stopMine").disabled=true;if(stopFlag)$("mineStatus").textContent+=" · Mining stopped."}
}
$("startMine").onclick=()=>mineLoop();$("stopMine").onclick=()=>{stopFlag=true};
async function refreshExplorer(){let blocks=await api("/api/blocks?limit=20");const blockRows=blocks.map(b=>[{type:"strong",text:"Block #"+b.height},{type:"text",text:" · Reward "+b.reward+" BBC · "+b.transactions.length+" transactions"},{type:"br"},{type:"text",text:"Miner: "+b.miner},{type:"br"},{type:"text",text:"Hash: "},{type:"hash",text:b.hash},{type:"br"},{type:"text",text:"Previous: "},{type:"hash",text:b.previousHash}]);renderInfoRows($("blocks"),blockRows);let t=await api("/api/transactions");let all=[...t.pending.map(x=>({...x,state:"Pending"})),...t.confirmed.map(x=>({...x,state:"Confirmed · block "+x.blockHeight}))];const txRows=all.slice(0,30).map(x=>[{type:"strong",text:x.state},{type:"text",text:" · "+fmtUnits(x.amount)+" BBC"},{type:"br"},{type:"text",text:x.from+" → "+x.to},{type:"br"},{type:"hash",text:x.id}]);renderInfoRows($("transactions"),txRows);if(!all.length)$("transactions").textContent="No transactions yet."}
$("refresh").onclick=()=>refreshExplorer().catch(e=>alert(e.message));
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));["wallet","mine","explorer","network"].forEach(id=>$(id).classList.toggle("hidden",id!==b.dataset.tab));if(b.dataset.tab==="explorer")refreshExplorer().catch(e=>alert(e.message))});
loadWallet();Promise.all([refreshStatus(),refreshExplorer()]).catch(e=>console.warn(e));
setInterval(()=>{refreshStatus().catch(()=>{});if(wallet)refreshWallet().catch(()=>{})},10000);
