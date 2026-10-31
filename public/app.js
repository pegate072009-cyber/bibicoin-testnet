
const $=id=>document.getElementById(id);
const API="";
let wallet=null, mining=false, stopFlag=false;
let savedWallets=[];
try{savedWallets=JSON.parse(localStorage.getItem("darkcoin_wallets")||"[]")}catch{savedWallets=[]}
let profile={name:localStorage.getItem("darkcoin_name")||"Guest",avatar:localStorage.getItem("darkcoin_avatar")||""};
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
async function api(url,opts={}){let r=await fetch(API+url,{...opts,headers:{"Content-Type":"application/json",...(opts.headers||{})}});let raw=await r.text(),j;try{j=raw?JSON.parse(raw):{}}catch{throw Error("Server returned an invalid response. Check that the Darkcoin service is running.")}if(!r.ok)throw Error(j.error||"Request failed");return j}
function node(tag, text, className){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=String(text);return n}
function line(parent, label, value){const p=node("p");p.append(node("b",label+": "),document.createTextNode(String(value)));parent.append(p)}
function renderInfoRows(target, rows){target.replaceChildren();for(const row of rows){const box=node("div",undefined,"status");for(const part of row){if(part.type==="br")box.append(document.createElement("br"));else if(part.type==="strong")box.append(node("b",part.text));else if(part.type==="hash")box.append(node("span",part.text,"hash"));else box.append(document.createTextNode(part.text));}target.append(box)}}
function loadWallet(){wallet=null;renderWallet();renderProfile()}
async function encryptPrivateKey(privateKey,password){
 const enc=new TextEncoder(),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const material=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt']);
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(privateKey));
 const b=x=>btoa(String.fromCharCode(...x));return {version:1,salt:b(salt),iv:b(iv),ciphertext:b(new Uint8Array(ciphertext))};
}
async function decryptPrivateKey(record,password){
 const enc=new TextEncoder(),dec=new TextDecoder(),salt=b64bytes(record.salt),iv=b64bytes(record.iv),data=b64bytes(record.ciphertext);
 const material=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
 return dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,data));
}
async function saveWallet(password){
 const encrypted=await encryptPrivateKey(wallet.privateKey,password);
 const record={address:wallet.address,publicKey:wallet.publicKey,encrypted};
 const idx=savedWallets.findIndex(w=>w.address===wallet.address);if(idx>=0)savedWallets[idx]=record;else savedWallets.push(record);
 localStorage.setItem('darkcoin_wallets',JSON.stringify(savedWallets));localStorage.setItem('darkcoin_active_wallet',wallet.address);renderWallet();renderProfile();
}
function renderWallet(){let yes=!!wallet;$("noWallet").classList.toggle("hidden",yes);$("walletArea").classList.toggle("hidden",!yes);if(yes){$("address").textContent=wallet.address;refreshWallet().catch(e=>$("walletStatus").textContent=e.message)}}
async function refreshStatus(){let s=await api("/api/status");$("height").textContent=s.height.toLocaleString();$("issued").textContent=s.issued.toLocaleString()+" DKC";$("reward").textContent=s.reward+" DKC";$("pending").textContent=s.pendingTransactions;$("mineReward").textContent=s.reward+" DKC";$("difficulty").textContent=s.difficulty+" leading zeroes";const r=$("rules");r.replaceChildren();line(r,"Symbol","DKC");line(r,"Maximum supply cap",s.maxSupply.toLocaleString()+" DKC");line(r,"Initial reward","50 DKC");line(r,"Halving interval",s.halvingInterval.toLocaleString()+" blocks");line(r,"SHA-256 difficulty",s.difficulty+" leading zeroes");line(r,"Current mode",s.mode);const p=node("p");p.append(node("b","Latest block hash: "),node("span",s.latestHash,"hash"));r.append(p)}
async function refreshWallet(){if(!wallet)return;let w=await api("/api/wallet/"+wallet.address);$("balance").textContent=fmtUnits(w.balance)+" DKC";$("available").textContent=fmtUnits(w.balance)+" DKC";const rows=w.transactions.map(t=>[{type:"strong",text:"Block "+t.blockHeight},{type:"text",text:" · "+(t.from===wallet.address?"Sent":"Received")+" "+fmtUnits(t.amount)+" DKC"},{type:"br"},{type:"hash",text:t.id}]);renderInfoRows($("walletTx"),rows);if(!rows.length)$("walletTx").textContent="No confirmed transactions yet.";let txs=await api("/api/transactions");let pending=txs.pending.filter(t=>t.from===wallet.address).reduce((s,t)=>s+BigInt(t.amount),0n);$("available").textContent=fmtUnits((BigInt(w.balance)-pending).toString())+" DKC"}
$("createWallet").onclick=async()=>{try{let password=prompt('Create a wallet encryption password (at least 10 characters). Do not reuse an important password:');if(!password||password.length<10)throw Error('Use at least 10 characters for the wallet encryption password.');let confirmPassword=prompt('Confirm wallet encryption password:');if(password!==confirmPassword)throw Error('Passwords do not match.');let w=await api("/api/wallet/new",{method:"POST",body:"{}"});wallet={address:w.address,publicKey:w.publicKey,privateKey:w.privateKey};await saveWallet(password);$("keyBox").textContent=w.privateKey;$("keyBox").classList.remove("hidden");alert("Wallet created. Back up the private key now. It is encrypted in this browser after you close the page.")}catch(e){alert(e.message)}};
$("showKey").onclick=()=>{if(!wallet)return;$("keyBox").textContent=wallet.privateKey;$("keyBox").classList.toggle("hidden")};
$("forgetKey").onclick=()=>{if(confirm("Remove the wallet key from this browser? Make sure you have a backup.")){savedWallets=savedWallets.filter(w=>w.address!==wallet.address);localStorage.setItem("darkcoin_wallets",JSON.stringify(savedWallets));localStorage.removeItem("darkcoin_active_wallet");wallet=null;renderWallet();renderProfile()}};
$("send").onclick=async()=>{try{if(!wallet)throw Error("Create a wallet first.");let to=$("to").value.trim().toUpperCase(),amount=toUnits($("amount").value);if(!/^DKC[A-F0-9]{40}$/.test(to))throw Error("Recipient address format is invalid.");let current=await api('/api/wallet/'+wallet.address);let tx={from:wallet.address,to,amount,timestamp:Date.now(),nonce:current.nextNonce,publicKey:wallet.publicKey};let payload=stable({from:tx.from,to:tx.to,amount:tx.amount,timestamp:tx.timestamp,nonce:tx.nonce});tx.signature=await signText(wallet.privateKey,payload);tx.id=await digest(stable(tx));let result=await api("/api/transaction",{method:"POST",body:JSON.stringify(tx)});$("walletStatus").textContent="Transfer accepted into pending pool. Transaction ID: "+result.transactionId;$("to").value="";$("amount").value="";await refreshStatus();await refreshWallet()}catch(e){$("walletStatus").textContent=e.message}};
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
async function refreshExplorer(){let blocks=await api("/api/blocks?limit=20");const blockRows=blocks.map(b=>[{type:"strong",text:"Block #"+b.height},{type:"text",text:" · Reward "+b.reward+" DKC · "+b.transactions.length+" transactions"},{type:"br"},{type:"text",text:"Miner: "+b.miner},{type:"br"},{type:"text",text:"Hash: "},{type:"hash",text:b.hash},{type:"br"},{type:"text",text:"Previous: "},{type:"hash",text:b.previousHash}]);renderInfoRows($("blocks"),blockRows);let t=await api("/api/transactions");let all=[...t.pending.map(x=>({...x,state:"Pending"})),...t.confirmed.map(x=>({...x,state:"Confirmed · block "+x.blockHeight}))];const txRows=all.slice(0,30).map(x=>[{type:"strong",text:x.state},{type:"text",text:" · "+fmtUnits(x.amount)+" DKC"},{type:"br"},{type:"text",text:x.from+" → "+x.to},{type:"br"},{type:"hash",text:x.id}]);renderInfoRows($("transactions"),txRows);if(!all.length)$("transactions").textContent="No transactions yet."}
$("refresh").onclick=()=>refreshExplorer().catch(e=>alert(e.message));
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));["wallet","mine","explorer","trading","network","analytics","profile"].forEach(id=>$(id).classList.toggle("hidden",id!==b.dataset.tab));if(b.dataset.tab==="explorer")refreshExplorer().catch(e=>alert(e.message));if(b.dataset.tab==="trading")renderPaper();if(b.dataset.tab==="analytics")refreshCharts().catch(e=>console.warn(e));if(b.dataset.tab==="profile")renderProfile()});
function renderProfile(){if(!$('profileName'))return;$('profileName').textContent=profile.name;$('displayName').value=profile.name;$('avatar').src=profile.avatar||'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"%3E%3Crect width="80" height="80" rx="40" fill="%23253047"/%3E%3Ctext x="40" y="51" text-anchor="middle" font-size="34" fill="white"%3E%D%3C/text%3E%3C/svg%3E';$('walletList').replaceChildren();if(!savedWallets.length)$('walletList').textContent='No wallets saved.';savedWallets.forEach((w,i)=>{let row=node('div',undefined,'status');row.append(node('b','Wallet '+(i+1)+' · '+w.address.slice(0,12)+'…'));let use=node('button','Unlock / Switch');use.onclick=async()=>{try{let pass=prompt('Enter this wallet encryption password:');if(!pass)return;if(!w.encrypted){throw Error('This is an older unencrypted wallet. Export/backup it, then create a new encrypted demo wallet.');}let privateKey=await decryptPrivateKey(w.encrypted,pass);wallet={address:w.address,publicKey:w.publicKey,privateKey};localStorage.setItem('darkcoin_active_wallet',w.address);renderWallet();$('profileStatus').textContent='Wallet unlocked in memory.'}catch(e){$('profileStatus').textContent='Could not unlock wallet. Check password or wallet backup.'}};row.append(document.createTextNode(' '),use);let remove=node('button','Remove');remove.onclick=()=>{if(!confirm('Remove this wallet from this browser?'))return;savedWallets=savedWallets.filter(x=>x.address!==w.address);localStorage.setItem('darkcoin_wallets',JSON.stringify(savedWallets));if(wallet&&wallet.address===w.address){wallet=null;localStorage.removeItem('darkcoin_active_wallet');renderWallet()}renderProfile()};row.append(document.createTextNode(' '),remove);$('walletList').append(row)})}
$('saveProfile').onclick=()=>{profile.name=$('displayName').value.trim().slice(0,32)||'Guest';localStorage.setItem('darkcoin_name',profile.name);renderProfile();$('profileStatus').textContent='Profile name saved on this device.'};
$('avatarFile').onchange=()=>{let f=$('avatarFile').files[0];if(!f)return;if(!/^image\/(png|jpeg|webp)$/.test(f.type)||f.size>1024*1024){$('profileStatus').textContent='Choose PNG, JPG or WebP under 1 MB.';return}let r=new FileReader();r.onload=()=>{profile.avatar=r.result;localStorage.setItem('darkcoin_avatar',profile.avatar);renderProfile();$('profileStatus').textContent='Profile picture updated on this device.'};r.readAsDataURL(f)};
$('addWallet').onclick=()=>$('createWallet').click();
$('logout').onclick=()=>{wallet=null;localStorage.removeItem('darkcoin_active_wallet');renderWallet();$('profileStatus').textContent='Wallet locked and logged out. Encrypted backups remain on this device.'};
function drawChart(target,values){let el=$(target);if(!el)return;let vals=values.length?values:[0];let max=Math.max(...vals,1),min=Math.min(...vals,0),span=max-min||1;let pts=vals.map((v,i)=>`${8+i*(284/Math.max(vals.length-1,1))},${166-((v-min)/span)*142}`).join(' ');el.innerHTML=`<svg viewBox="0 0 300 190" role="img" aria-label="Chart"><line class="gridline" x1="8" y1="24" x2="292" y2="24"/><line class="gridline" x1="8" y1="95" x2="292" y2="95"/><line class="gridline" x1="8" y1="166" x2="292" y2="166"/><polyline points="${pts}"/><text x="8" y="184">Start</text><text x="260" y="184">Latest</text></svg>`}
async function refreshCharts(){if(wallet)$('chartWallet').textContent=wallet.address.slice(0,10)+'…';else $('chartWallet').textContent='No wallet';let n=Number($('chartRange').value||7);let blocks=await api('/api/blocks?limit='+n);drawChart('blockChart',blocks.slice().reverse().map(b=>Number(b.reward||0)));let tx=await api('/api/transactions');let counts=blocks.slice().reverse().map(b=>(b.transactions||[]).length);drawChart('txChart',counts);let bal=wallet?await api('/api/wallet/'+wallet.address):null;let running=0n;let history=[];if(bal){let blocksAsc=blocks.slice().reverse();for(const b of blocksAsc){if(b.miner===wallet.address)running+=BigInt(Math.round((b.reward||0)*1e8));for(const t of b.transactions||[]){if(t.from===wallet.address)running-=BigInt(t.amount);if(t.to===wallet.address)running+=BigInt(t.amount)}history.push(Number(running)/1e8)}}drawChart('balanceChart',history)}
$('chartRange').onchange=()=>refreshCharts().catch(e=>console.warn(e));

// Browser-local paper exchange. This is intentionally disconnected from the real DKC ledger.
const PAPER_KEY='darkcoin_paper_exchange_v1';
const freshPaper=()=>({usd:10000,dkc:0,price:0.01,history:[0.01],high:0.01,low:0.01,volume:0,trades:[],orders:[]});
let paper;try{paper={...freshPaper(),...JSON.parse(localStorage.getItem(PAPER_KEY)||'{}')}}catch{paper=freshPaper()}
function savePaper(){localStorage.setItem(PAPER_KEY,JSON.stringify(paper));renderPaper()}
function money(n){return '$'+Number(n||0).toFixed(6)}
function paperFmt(n){return Number(n||0).toLocaleString(undefined,{maximumFractionDigits:8})}
function renderPaper(){if(!$('marketPrice'))return;$('marketPrice').textContent=money(paper.price);let first=paper.history[0]||paper.price,change=first?(paper.price/first-1)*100:0;$('marketChange').textContent=(change>=0?'+':'')+change.toFixed(2)+'% since demo session';$('marketChange').className='small '+(change>=0?'good':'warn');$('marketHigh').textContent=money(paper.high);$('marketLow').textContent=money(paper.low);$('marketVolume').textContent=paperFmt(paper.volume)+' DKC';$('paperUsd').textContent='$'+paper.usd.toFixed(2);$('paperDkc').textContent=paperFmt(paper.dkc)+' DKC';$('paperEquity').textContent='$'+(paper.usd+paper.dkc*paper.price).toFixed(2);drawChart('marketChart',paper.history);$('paperOpenOrders').replaceChildren();if(!paper.orders.length)$('paperOpenOrders').textContent='No open orders.';paper.orders.forEach(o=>{let d=node('div',`${o.side.toUpperCase()} ${paperFmt(o.amount)} DKC @ ${money(o.limit)} · Open`,'status');let c=node('button','Cancel');c.onclick=()=>{paper.orders=paper.orders.filter(x=>x.id!==o.id);savePaper()};d.append(document.createTextNode(' '),c);$('paperOpenOrders').append(d)});$('paperHistory').replaceChildren();if(!paper.trades.length)$('paperHistory').textContent='No demo trades yet.';paper.trades.slice(0,25).forEach(t=>$('paperHistory').append(node('div',`${new Date(t.time).toLocaleString()} · ${t.side.toUpperCase()} ${paperFmt(t.amount)} DKC @ ${money(t.price)} · ${money(t.total)}`,'status')));renderPaperBook()}
function renderPaperBook(){let el=$('paperBook');if(!el)return;el.replaceChildren();for(let i=3;i>=1;i--)el.append(node('div',`ASK ${money(paper.price*(1+i*0.003))} · ${paperFmt(500+i*137)} DKC`,'warn'));el.append(node('div',`LAST ${money(paper.price)} USD`,'status'));for(let i=1;i<=3;i++)el.append(node('div',`BID ${money(paper.price*(1-i*0.003))} · ${paperFmt(450+i*119)} DKC`,'good'));let note=node('div','All book levels are generated demo liquidity, not real orders.','muted small');el.append(note)}
function executePaper(side,amount,price){let total=amount*price;if(!Number.isFinite(total)||amount<=0)throw Error('Enter a valid positive amount.');if(side==='buy'){if(total>paper.usd)throw Error('Not enough demo USD credits.');paper.usd-=total;paper.dkc+=amount}else{if(amount>paper.dkc)throw Error('Not enough demo DKC holdings.');paper.dkc-=amount;paper.usd+=total}paper.volume+=amount;paper.trades.unshift({id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),side,amount,price,total,time:Date.now()});paper.trades=paper.trades.slice(0,100);}
function processPaperOrders(){let keep=[];for(const o of paper.orders){let hit=o.side==='buy'?paper.price<=o.limit:paper.price>=o.limit;if(hit){try{executePaper(o.side,o.amount,paper.price)}catch(e){o.error=e.message;keep.push(o)}}else keep.push(o)}paper.orders=keep}
function tickPaper(){let drift=(Math.random()-0.49)*0.012;paper.price=Math.max(0.000001,paper.price*(1+drift));paper.history.push(paper.price);paper.history=paper.history.slice(-60);paper.high=Math.max(paper.high,paper.price);paper.low=Math.min(paper.low,paper.price);processPaperOrders();savePaper()}
$('paperType').onchange=()=>{$('limitPriceWrap').classList.toggle('hidden',$('paperType').value!=='limit')};
$('paperSubmit').onclick=()=>{try{let side=$('paperSide').value,type=$('paperType').value,amount=Number($('paperAmount').value);if(!Number.isFinite(amount)||amount<=0)throw Error('Enter a valid positive DKC amount.');if(type==='market'){executePaper(side,amount,paper.price);$('paperStatus').textContent=`Paper ${side} filled: ${paperFmt(amount)} DKC at ${money(paper.price)}.`}else{let limit=Number($('paperLimitPrice').value);if(!Number.isFinite(limit)||limit<=0)throw Error('Enter a valid limit price.');if(side==='buy'&&amount*limit>paper.usd)throw Error('Insufficient demo USD for this limit order.');if(side==='sell'&&amount>paper.dkc)throw Error('Insufficient demo DKC for this limit order.');paper.orders.push({id:String(Date.now())+Math.random(),side,amount,limit});$('paperStatus').textContent='Limit order added to the simulated order queue.'}savePaper()}catch(e){$('paperStatus').textContent=e.message}};
$('resetPaper').onclick=()=>{if(confirm('Reset demo USD credits, DKC holdings, orders and trade history?')){paper=freshPaper();savePaper();$('paperStatus').textContent='Demo portfolio reset.'}};
renderPaper();setInterval(tickPaper,5000);

loadWallet();Promise.all([refreshStatus(),refreshExplorer()]).catch(e=>console.warn(e));
setInterval(()=>{refreshStatus().catch(()=>{});if(wallet)refreshWallet().catch(()=>{})},10000);
