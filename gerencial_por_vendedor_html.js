(function(){
const Firebird=require("node-firebird");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const cp=require("node:child_process");
const args=process.argv.slice(2);
const pegar=k=>{const i=args.indexOf(k);return i>=0&&i+1<args.length?String(args[i+1]||"").trim():"";};
const fbk=pegar("--fbk");
const fdb=pegar("--fdb");
const dataRaw=pegar("--data");
const dataISO=(()=>{const s=String(dataRaw||"").trim();let m;if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(m)return `${m[3]}-${m[2]}-${m[1]}`;return s;})();
const saida=pegar("--saida");
const usuario=pegar("--user")||"SYSDBA";
const senha=pegar("--pass")||"masterkey";
const gbak=pegar("--gbak")||"C:\\Program Files (x86)\\Firebird\\Firebird_2_5\\bin\\gbak.exe";
if((!fbk&&!fdb)||!dataISO||!saida){console.log("Uso:\nnode gerencial_por_vendedor_html.js --fbk \"C:\\...\\SMALL.fbk\" --data 2026-02-06 --saida \"C:\\...\\relatorio.html\" --user SYSDBA --pass masterkey --gbak \"C:\\...\\gbak.exe\"\nou\nnode gerencial_por_vendedor_html.js --fdb \"C:\\...\\SMALL.FDB\" --data 07/02/2026 --saida \"C:\\...\\relatorio.html\" --user SYSDBA --pass masterkey");process.exit(1);}
const escHtml=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const apagarComRetry=(p,t)=>fs.unlink(p,e=>{if(!e||e?.code==="ENOENT")return;if(e?.code==="EBUSY"&&t<25)return setTimeout(()=>apagarComRetry(p,t+1),350);console.log("Temporário ainda em uso. Apague depois: "+p);});
const execFileP=(cmd,argv)=>new Promise(r=>cp.execFile(cmd,argv,{windowsHide:true,maxBuffer:1024*1024*200},(e,stdout,stderr)=>r({e,stdout:String(stdout||""),stderr:String(stderr||"")})));
const query=(db,sql,params)=>new Promise(r=>db.query(sql,params||[],(e,rows)=>r({e,rows:rows||[]})));
const dataBR=(()=>{let m=String(dataISO||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);if(m)return `${m[3]}/${m[2]}/${m[1]}`;m=String(dataRaw||"").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(m)return `${m[1]}/${m[2]}/${m[3]}`;return String(dataRaw||dataISO||"");})();
const horaGeradaBR=(()=>{const d=new Date();const p=n=>String(n).padStart(2,"0");return `${p(d.getHours())}:${p(d.getMinutes())}`;})();
let tmpCriado="";
let dbPath=fdb||fbk;
const restaurarSeFbk=async()=>{
if(!fbk)return;
tmpCriado=path.join(os.tmpdir(),"small_restore_"+Date.now()+".fdb");
const r=await execFileP(gbak,["-c","-v","-user",usuario,"-password",senha,fbk,tmpCriado]);
if(r.e){console.log((r.stderr||r.stdout||String(r.e)).trim()||"Falha ao restaurar FBK.");process.exit(1);}
dbPath=tmpCriado;
};
const rodar=async()=>{
await restaurarSeFbk();
const opts={host:"127.0.0.1",port:3050,database:dbPath,user:usuario,password:senha,role:null,pageSize:4096,charset:"UTF8"};
Firebird.attach(opts,async function(err,db){
if(err){console.log("Falha ao conectar: "+String(err.message||err));if(tmpCriado)apagarComRetry(tmpCriado,0);process.exit(1);}
const sql=`
with
pag_base as (
  select
    p.data,
    p.pedido,
    p.vendedor,
    iif(
      substring(trim(p.forma) from 1 for 2) between '00' and '99'
      and substring(trim(p.forma) from 3 for 1) = ' ',
      trim(substring(trim(p.forma) from 4)),
      trim(p.forma)
    ) as forma_base
  from pagament p
  where p.data = cast(? as date)
    and p.valor is not null
    and substring(p.forma from 1 for 2) not in ('00','13')
  group by
    p.data,
    p.pedido,
    p.vendedor,
    iif(
      substring(trim(p.forma) from 1 for 2) between '00' and '99'
      and substring(trim(p.forma) from 3 for 1) = ' ',
      trim(substring(trim(p.forma) from 4)),
      trim(p.forma)
    )
),
pag as (
  select
    data,
    pedido,
    vendedor,
    iif(
      upper(forma_base) starting with 'CARTAO ',
      trim(substring(forma_base from 8)),
      forma_base
    ) as forma_nome
  from pag_base
),
venda as (
  select
    data,
    pedido,
    vendedor,
    cast(list(forma_nome,' | ') as varchar(32765)) as pagamentos
  from pag
  group by data, pedido, vendedor
)
select
  v.vendedor as VENDEDOR,
  n.numeronf as NUMERO,
  n.total as TOTAL,
  v.pagamentos as PAGAMENTOS
from venda v
join nfce n on n.data=v.data and n.modelo=99 and n.numeronf=v.pedido
order by v.vendedor, n.numeronf
`;
const r=await query(db,sql,[dataISO]);
if(r.e){db.detach(()=>{if(tmpCriado)apagarComRetry(tmpCriado,0);});console.log("Erro na consulta: "+String(r.e.message||r.e));process.exit(1);}
const linhas=r.rows.map(x=>({vendedor:String(x.VENDEDOR??"").trim()||"(sem vendedor)",numero:String(x.NUMERO??"").trim(),total:Number(x.TOTAL||0),pagamentos:String(x.PAGAMENTOS??"").trim()}));
const porVend=new Map();
for(const it of linhas){if(!porVend.has(it.vendedor))porVend.set(it.vendedor,{vendedor:it.vendedor,qtd:0,total:0});const v=porVend.get(it.vendedor);v.qtd++;v.total+=it.total;}
const vendedores=[...porVend.values()].sort((a,b)=>a.vendedor.localeCompare(b.vendedor,"pt-BR",{sensitivity:"base"}));
const totalGeral=linhas.reduce((a,b)=>a+(b.total||0),0);
const qtdGeral=linhas.length;
const dados={data:dataISO,totais:{qtd:qtdGeral,total:totalGeral},vendedores,vendas:linhas};
const dadosJSON=JSON.stringify(dados).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
const html=`<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gerencial por vendedor - ${escHtml(dataBR)}</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{height:100%;margin:0;background:#0b0f17;color:#e6eaf2;overflow:hidden}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
a{color:inherit}
.app{height:100%;display:grid;grid-template-rows:auto 1fr}
.top{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,0))}
.top .left{display:flex;align-items:center;justify-content:space-between;align-content:space-around;min-width:0;flex:1 1 520px;flex-wrap:wrap;height:40px}
.titulo{font-size:16px;font-weight:750;/*letter-spacing:.2px;*/white-space:nowrap}
.badge{display:inline-flex;max-width:100%;min-width:0;font-size:12px;opacity:.95;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);padding:6px 10px;border-radius:999px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top .right{display:flex;gap:10px;align-items:center;min-width:0;flex:1 1 380px;justify-content:flex-end;flex-wrap:wrap}
.input{flex:1 1 260px;width:auto;max-width:520px;min-width:220px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);color:#e6eaf2;padding:10px 12px;border-radius:12px;outline:none;height:40px}
.input:focus{border-color:rgba(120,180,255,.55);box-shadow:0 0 0 4px rgba(120,180,255,.12)}
.btn{cursor:pointer;user-select:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);color:#e6eaf2;padding:10px 12px;border-radius:12px;height:40px;display:flex;align-items:center;justify-content:center}
.btn:hover{background:rgba(255,255,255,.07)}
#limpar{padding:0 12px}
#ajuda{min-width:40px;padding:0 12px}
.main{min-height:0;display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr)}
.sidebar{min-height:0;min-width:0;border-right:1px solid rgba(255,255,255,.08);padding:12px;display:flex;flex-direction:column;gap:10px;background:rgba(255,255,255,.02)}
.sb-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.sb-title{font-size:13px;opacity:.85;font-weight:650}
.list{min-height:0;overflow:auto;border-radius:12px}
.item{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 10px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);border-radius:12px;margin-bottom:8px;cursor:pointer}
.item:hover{background:rgba(255,255,255,.05)}
.item.sel{border-color:rgba(120,180,255,.55);box-shadow:0 0 0 3px rgba(120,180,255,.10) inset}
.item .nome{font-weight:650;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item .meta{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.item .qtd{font-size:12px;opacity:.85}
.item .tot{font-size:12px;opacity:.9}
.content{min-height:0;min-width:0;padding:12px 12px 12px 14px}
.tableWrap{height:100%;min-width:0;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.tableTop{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08)}
.tableTitle{font-size:13px;opacity:.85;font-weight:650;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.count{font-size:12px;opacity:.85;white-space:nowrap}
.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end;min-width:0}
.grid{min-height:0;min-width:0;overflow:auto}
table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}
thead th{position:sticky;top:0;background:rgba(11,15,23,.95);backdrop-filter:blur(10px);border-bottom:1px solid rgba(255,255,255,.10);padding:12px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.9;text-align:center}
tbody td{padding:12px 10px;border-bottom:1px solid rgba(255,255,255,.06);text-align:center}
tbody td:nth-child(1),tbody td:nth-child(2){white-space:nowrap}
tbody td:nth-child(3){white-space:normal;overflow-wrap:anywhere}
tbody tr{cursor:pointer}
tbody tr:hover{background:rgba(255,255,255,.04)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}
.pill{display:inline-flex;gap:8px;align-items:center;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);font-size:12px;opacity:.95}
.ov{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.65);backdrop-filter:blur(10px);padding:18px}
.ov.on{display:flex}
.modal{width:min(720px,94vw);max-height:86vh;overflow:auto;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));box-shadow:0 26px 80px rgba(0,0,0,.55);padding:14px}
.mhead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
.mtitle{font-weight:800;font-size:14px}
.msub{font-size:12px;opacity:.85;margin-top:4px}
.mbody{display:grid;gap:10px}
.kv{display:grid;grid-template-columns:160px 1fr;gap:8px;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03)}
.k{font-size:12px;opacity:.8}
.v{font-size:13px}
.toastHost{position:fixed;right:16px;bottom:16px;display:grid;gap:10px;z-index:9999;pointer-events:none}
.toast{pointer-events:none;min-width:260px;max-width:min(560px,92vw);padding:13px 14px;border-radius:14px;border:1px solid rgba(180,220,255,.45);background:rgba(8,12,18,.97);box-shadow:0 22px 70px rgba(0,0,0,.70),0 0 0 1px rgba(255,255,255,.07) inset;opacity:0;transform:translateY(10px);transition:opacity .18s ease, transform .18s ease}
.toast.on{opacity:1;transform:translateY(0)}
.toast .t{font-weight:900;font-size:13px;margin-bottom:4px;letter-spacing:.2px}
.toast .d{font-size:12px;opacity:.92}
span#tQtd,span#tTot{padding:0 3px}
@media (max-width:920px){.main{grid-template-columns:1fr}.sidebar{display:none}.top .left{flex-basis:100%}.top .right{flex-basis:100%;justify-content:flex-start}.input{flex:1 1 520px;min-width:220px;max-width:none;width:100%}}
</style></head><body>
<div class="app">
<div class="top">
<div class="left">
<div class="titulo">Gerencial por vendedor</div>
<div class="badge">Data: ${escHtml(dataBR)}</div>
<div class="badge">Dia،،Hora gerada: ${String(new Date().getDate()).padStart(2,"0")+"/"+String(new Date().getMonth()+1).padStart(2,"0")}―${escHtml(horaGeradaBR)}</div>
<div class="badge">Vendas: <span id="tQtd"></span>― Total: <span id="tTot"></span></div>
</div>
<div class="right">
<input id="q" class="input" placeholder="Buscar: Vendedor, Número gerencial, Forma de pagamento, Valor..." autocomplete="off">
<button id="ajuda" class="btn" type="button" title="Coringas disponíveis">?</button>
<button id="limpar" class="btn" type="button">Limpar</button>
</div>
</div>
<div class="main">
<div class="sidebar">
<div class="sb-head">
<div class="sb-title">Vendedores</div>
<div class="pill mono" id="vendSel">Todos</div>
</div>
<div class="list" id="lista"></div>
</div>
<div class="content">
<div class="tableWrap">
<div class="tableTop">
<div class="tableTitle" id="sub">Todos os vendedores</div>
<div class="actions">
<div class="count" id="count"></div>
<div class="btn" id="copiarTudo">Copiar tudo</div>
<div class="btn" id="copiarSemDinheiro">Copiar sem dinheiro</div>
</div>
</div>
<div class="grid">
<table>
<thead><tr>
<th>numero do gerencial</th>
<th>total</th>
<th>forma de pagamento</th>
</tr></thead>
<tbody id="tb"></tbody>
</table>
</div>
</div>
</div>
</div>
</div>
<div class="ov" id="ov" aria-hidden="true">
<div class="modal" role="dialog" aria-modal="true">
<div class="mhead">
<div>
<div class="mtitle" id="mTitulo"></div>
<div class="msub" id="mSub"></div>
</div>
<div class="btn" id="fechar">Fechar</div>
</div>
<div class="mbody" id="mBody"></div>
</div>
</div>
<div class="toastHost" id="toastHost"></div>
<script id="dados" type="application/json">${dadosJSON}</script>
<script>
const qs=s=>document.querySelector(s);
const dadosEl=qs("#dados");
const DADOS=dadosEl?JSON.parse(dadosEl.textContent||"{}"):{vendas:[],vendedores:[],totais:{qtd:0,total:0}};
if(!Array.isArray(DADOS.vendas))DADOS.vendas=[];
if(!Array.isArray(DADOS.vendedores))DADOS.vendedores=[];
if(!DADOS.totais||typeof DADOS.totais!=="object")DADOS.totais={qtd:DADOS.vendas.length,total:DADOS.vendas.reduce((a,b)=>a+Number(b?.total||0),0)};
if(typeof DADOS.totais.qtd!=="number")DADOS.totais.qtd=DADOS.vendas.length;
if(typeof DADOS.totais.total!=="number")DADOS.totais.total=DADOS.vendas.reduce((a,b)=>a+Number(b?.total||0),0);
const fmt=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v||0));
const fmtCopia=v=>new Intl.NumberFormat("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false}).format(Number(v||0));
let vendAtual="",qAtual="",qValor=false,linhaAtual=null,somaSel=null,somaKey="";
const copiarTexto=txt=>{
const fallback=()=>{
const ta=document.createElement("textarea");
ta.value=txt;
ta.style.position="fixed";
ta.style.left="-9999px";
ta.style.top="0";
document.body.appendChild(ta);
ta.focus();
ta.select();
document.execCommand("copy");
ta.remove();
};
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).catch(fallback);
else fallback();
};
const toast=(titulo,desc)=>{
const host=qs("#toastHost");
const el=document.createElement("div");
el.className="toast";
el.innerHTML='<div class="t">'+titulo+'</div><div class="d">'+(desc||"")+'</div>';
host.appendChild(el);
requestAnimationFrame(()=>el.classList.add("on"));
setTimeout(()=>{el.classList.remove("on");setTimeout(()=>el.remove(),220);},3000);
};
const semWS=s=>{
let o="";
for(const ch of String(s||"")){
const c=ch.charCodeAt(0);
if((c>32&&c!==160)||ch===","||ch==="."||ch==="-"||ch==="+"||ch==="*"||ch==="/"||ch==="?"||ch===":"||ch==="="||((ch>="0"&&ch<="9")))o+=ch;
}
return o;
};
const soNumeroBr=raw=>{
let t=String(raw||"");
t=semWS(t).toUpperCase();
if(t.startsWith("R$"))t=t.slice(2);
let x="";
for(const ch of t)if((ch>="0"&&ch<="9")||ch===","||ch==="."||ch==="-")x+=ch;
if(!x)return null;
if(x.indexOf(",")>=0){
x=x.split(".").join("");
x=x.replace(",",".");
}else{
const parts=x.split(".");
if(parts.length>1){
const last=parts[parts.length-1]||"";
if(parts.length>2||last.length===3)x=parts.join("");
}
}
const n=Number(x);
return Number.isFinite(n)?n:null;
};
const limparPadraoValor=p=>{
let o="";
for(const ch of semWS(p)){
if((ch>="0"&&ch<="9")||ch==="*"||ch==="/"||ch==="?"||ch===","||ch===":"||ch===".")o+=ch;
}
return o.split(".").join("");
};
const temDigito=s=>{
for(const ch of s)if(ch>="0"&&ch<="9")return true;
return false;
};
const consultaPareceValor=raw=>{
const s=String(raw||"").trim();
if(!s||s.startsWith("="))return false;
const sx=semWS(s).toUpperCase();
if(!sx)return false;
if(sx.startsWith(">=")||sx.startsWith("<=")||sx.startsWith(">")||sx.startsWith("<"))return true;
if(sx.startsWith("R$")||sx.indexOf(",")>=0)return true;
if((sx.indexOf("*")>=0||sx.indexOf("/")>=0||sx.indexOf("?")>=0||sx.indexOf(":")>=0)&&temDigito(sx))return true;
const dash=sx.indexOf("-");
if(dash>0&&dash<sx.length-1&&temDigito(sx))return true;
if(/^\d+$/.test(sx)&&sx[0]!=="0"&&sx.length<=4)return true;
return false;
};
const isDig=ch=>ch>="0"&&ch<="9";
const matchInicioFull=(pat,full)=>{
const p=limparPadraoValor(pat);
if(!p||!temDigito(p))return false;
const s=String(full||"");
const comma=s.indexOf(",");
const memo=new Map();
const rec=(pi,si)=>{
const key=pi+"|"+si;
if(memo.has(key))return memo.get(key);
if(pi>=p.length){memo.set(key,true);return true;}
if(si>=s.length){memo.set(key,false);return false;}
const ch=p[pi];
let ok=false;
if(ch==="*"){
let k=si;
if(k<s.length&&(isDig(s[k])||s[k]===",")){
for(;k<s.length&&(isDig(s[k])||s[k]===",");k++){
if(rec(pi+1,k+1)){ok=true;break;}
}
}
}else if(ch==="/"){
if(comma>=0&&si>=comma)ok=false;
else if(si<s.length&&isDig(s[si])&&(comma<0||si<comma)){
let end=si;
for(;end<s.length&&isDig(s[end])&&(comma<0||end<comma);end++){}
for(let e=si+1;e<=end;e++)if(rec(pi+1,e)){ok=true;break;}
}
}else if(ch==="?"){
if(isDig(s[si])&&(comma<0||si<comma))ok=rec(pi+1,si+1);
}else if(isDig(ch)||ch===","){
if(s[si]===ch)ok=rec(pi+1,si+1);
}else ok=rec(pi+1,si);
memo.set(key,ok);
return ok;
};
return rec(0,0);
};
const matchDentroInteiro=(pat,inteiro)=>{
const p=limparPadraoValor(pat);
if(!p||!temDigito(p))return false;
let toks="";
for(const ch of p)if(isDig(ch)||ch==="/"||ch==="?")toks+=ch;
if(!toks)return false;
const s=String(inteiro||"");
const memo=new Map();
const rec=(pi,si)=>{
const key=pi+"|"+si;
if(memo.has(key))return memo.get(key);
if(pi>=toks.length){memo.set(key,true);return true;}
if(si>=s.length){memo.set(key,false);return false;}
const ch=toks[pi];
let ok=false;
if(ch==="/"){
let end=si;
for(;end<s.length&&isDig(s[end]);end++){}
for(let e=si+1;e<=end;e++)if(rec(pi+1,e)){ok=true;break;}
}else if(ch==="?"){
ok=isDig(s[si])?rec(pi+1,si+1):false;
}else{
ok=s[si]===ch?rec(pi+1,si+1):false;
}
memo.set(key,ok);
return ok;
};
for(let start=0;start<s.length;start++)if(rec(0,start))return true;
return false;
};
const valorOk=(q,total)=>{
if(!Number.isFinite(total))return null;
const raw=String(q||"").trim();
if(!raw)return null;
const sx=semWS(raw).toUpperCase();
if(!sx)return null;
if(sx.startsWith("="))return null;
const temCoringa=(sx.indexOf("*")>=0||sx.indexOf("/")>=0||sx.indexOf("?")>=0||sx.indexOf(":")>=0)&&temDigito(sx);
const tStr=fmtCopia(total);
const full=tStr;
const inteiro=full.split(",")[0]||full;
if(temCoringa){
const partes=sx.split(":").map(p=>p.trim()).filter(Boolean);
for(const p of partes){
if(p.indexOf("*")>=0){
if(matchInicioFull(p,full))return true;
}else{
if(matchDentroInteiro(p,inteiro))return true;
}
}
return false;
}
if(!temDigito(sx))return null;
const ops=[">=","<=",">","<"];
for(const op of ops)if(sx.startsWith(op)){
const n=soNumeroBr(sx.slice(op.length));
if(n===null)return null;
if(op===">")return total>n;
if(op==="<")return total<n;
if(op===">=")return total>=n;
return total<=n;
}
const dash=sx.indexOf("-");
if(dash>0&&dash<sx.length-1){
const a=soNumeroBr(sx.slice(0,dash));
const b=soNumeroBr(sx.slice(dash+1));
if(a===null||b===null)return null;
const lo=Math.min(a,b),hi=Math.max(a,b);
return total>=lo&&total<=hi;
}
let qv=sx;
if(qv.startsWith("R$"))qv=qv.slice(2);
qv=qv.split(".").join("");
qv=qv.split(",").join("");
const tv=tStr.split(".").join("").split(",").join("");
if(!qv)return null;
return tv.indexOf(qv)>=0;
};
const parseSomaQuery=raw=>{
const s=semWS(String(raw||""));
if(!s.startsWith("="))return null;
const body=s.slice(1);
if(!body||body==="*")return null;
const parts=body.split("*");
const alvo=soNumeroBr(parts[0]);
if(alvo===null)return null;
const tol=parts.length>1?(soNumeroBr(parts[1])??0):0;
return{alvo,tol};
};
const calcSomaSel=()=>{
const p=parseSomaQuery(qAtual);
if(!p){somaSel=null;somaKey="";return;}
const key=(vendAtual||"")+"|"+p.alvo+"|"+p.tol;
if(key===somaKey&&somaSel)return;
somaKey=key;
const itens=[];
for(let i=0;i<DADOS.vendas.length;i++){
const x=DADOS.vendas[i];
if(vendAtual&&x.vendedor!==vendAtual)continue;
const v=Number(x.total||0);
if(!Number.isFinite(v)||v<=0)continue;
itens.push({i,v});
}
itens.sort((a,b)=>b.v-a.v);
const sel=new Set();
let soma=0;
const ex=itens.find(it=>Math.abs(it.v-p.alvo)<0.005);
if(ex){sel.add(ex.i);soma=ex.v;}
else{
const lim=p.alvo+p.tol+0.005;
for(const it of itens)if(soma+it.v<=lim){soma+=it.v;sel.add(it.i);}
}
somaSel={alvo:p.alvo,tol:p.tol,soma,sel};
};
const passaFiltro=(x,i)=>{
if(vendAtual&&x.vendedor!==vendAtual)return false;
const q=String(qAtual||"").trim();
if(!q)return true;
if(q.startsWith("="))return !!(somaSel&&somaSel.sel&&somaSel.sel.has(i));
const ql=q.toLowerCase();
if((x.vendedor||"").toLowerCase().indexOf(ql)>=0||(x.pagamentos||"").toLowerCase().indexOf(ql)>=0||(!qValor&&(x.numero||"").toLowerCase().indexOf(ql)>=0))return true;
const ok=valorOk(q,Number(x.total||0));
return ok===true;
};
const norm=s=>{
let t=String(s||"").trim().toUpperCase();
let o="",sp=false;
for(const ch of t){
const c=ch.charCodeAt(0);
const isWs=c<=32||c===160;
if(isWs){
if(!sp&&o){o+=" ";sp=true;}
}else{
o+=ch;
sp=false;
}
}
return o.trim();
};
const limparPagamentoCopia=p=>String(p||"").split("|").map(s=>s.trim().replace(/^cartao(?: +|$)/i,"").trim()).filter(Boolean).join(" | ");
const formasDe=x=>limparPagamentoCopia(x.pagamentos||"").split("|").map(s=>norm(s)).filter(Boolean);
const temDinheiro=x=>formasDe(x).includes("DINHEIRO");
const resumo=arr=>{
const soma=new Map();
for(const x of arr){
const fs=formasDe(x);
if(!fs.length)continue;
const share=Number(x.total||0)/fs.length;
for(const f of fs)soma.set(f,(soma.get(f)||0)+share);
}
if(!soma.size)return"";
const base=["DEBITO","CREDITO","PIX","DINHEIRO"];
const extras=[...soma.keys()].filter(k=>base.indexOf(k)<0).sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
let out="";
for(const k of base.concat(extras))/*if(soma.has(k))out+=k+"\\t"+fmtCopia(soma.get(k))+"\\n";*/
return out.trim();
};
const montarTextoCopia=(ignorarDinheiro)=>{
const filtradas=DADOS.vendas.filter((x,i)=>passaFiltro(x,i)).filter(x=>!ignorarDinheiro||!temDinheiro(x));
const montarBloco=(nome,arr)=>{
let out=nome+":\\n";
for(const x of arr)out+=String(x.numero||"")+"\\t"+fmtCopia(x.total||0)+"\\t"+limparPagamentoCopia(x.pagamentos||"")+"\\n";
const r=resumo(arr.filter(x=>!ignorarDinheiro||!temDinheiro(x)));
if(r)out+="\\n"+r+"\\n";
return out.trim();
};
if(vendAtual)return montarBloco(vendAtual,filtradas);
const map=new Map();
for(const x of filtradas){
const v=x.vendedor||"(sem vendedor)";
if(!map.has(v))map.set(v,[]);
map.get(v).push(x);
}
const vendes=[...map.keys()].sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
let out="";
for(const v of vendes)out+=montarBloco(v,map.get(v))+"\\n\\n";
return out.trim();
};
const renderLista=()=>{
const root=qs("#lista");
root.innerHTML="";
const all=document.createElement("div");
all.className="item"+(!vendAtual?" sel":"");
all.addEventListener("click",()=>{vendAtual="";calcSomaSel();renderTudo();});
all.innerHTML='<div class="nome">Todos</div><div class="meta"><div class="qtd">Vendas: '+DADOS.totais.qtd+'</div><div class="tot">'+fmt(DADOS.totais.total)+'</div></div>';
root.appendChild(all);
for(const v of DADOS.vendedores){
const div=document.createElement("div");
div.className="item"+(vendAtual===v.vendedor?" sel":"");
div.addEventListener("click",()=>{vendAtual=v.vendedor;calcSomaSel();renderTudo();});
div.innerHTML='<div class="nome">'+v.vendedor+'</div><div class="meta"><div class="qtd">Vendas: '+v.qtd+'</div><div class="tot">'+fmt(v.total)+'</div></div>';
root.appendChild(div);
}
};
const abrirModal=x=>{
linhaAtual=x;
qs("#mTitulo").textContent="Gerencial "+(x.numero||"");
qs("#mSub").textContent="Vendedor: "+(x.vendedor||"");
const body=qs("#mBody");
body.innerHTML="";
const mk=(k,v)=>{
const d=document.createElement("div");
d.className="kv";
d.innerHTML='<div class="k">'+k+'</div><div class="v mono">'+v+'</div>';
return d;
};
body.appendChild(mk("Número",String(x.numero||"")));
body.appendChild(mk("Total",fmt(x.total||0)));
body.appendChild(mk("Formas",String(x.pagamentos||"")));
qs("#ov").classList.add("on");
qs("#ov").setAttribute("aria-hidden","false");
};
const fecharModal=()=>{
qs("#ov").classList.remove("on");
qs("#ov").setAttribute("aria-hidden","true");
linhaAtual=null;
};
const abrirAjuda=()=>{
qs("#mTitulo").textContent="Coringas disponíveis";
qs("#mSub").textContent="Use no campo de busca para filtrar por valor.";
const body=qs("#mBody");
body.innerHTML="";
const add=(k,v)=>{const d=document.createElement("div");d.className="kv";d.innerHTML='<div class="k">'+k+'</div><div class="v">'+v+'</div>';body.appendChild(d);};
add("*","1+ dígitos e/ou vírgula (pode atravessar a vírgula) — casa do começo do valor");
add("/","1+ dígitos (somente antes da vírgula) — procura dentro da parte inteira");
add("?","exatamente 1 dígito (parte inteira) — procura dentro da parte inteira");
add(":","múltiplos padrões (OU)");
add("=151","combinação aproximada para somar até 151");
add("=151*2","combinação aproximada para somar até 151 ± 2");
qs("#ov").classList.add("on");
qs("#ov").setAttribute("aria-hidden","false");
};
const renderTabela=()=>{
const tb=qs("#tb");
tb.innerHTML="";
const filtradas=DADOS.vendas.filter((x,i)=>passaFiltro(x,i));
let soma=0;
for(const x of filtradas)soma+=Number(x.total||0);
const q=String(qAtual||"").trim();
qs("#count").textContent=somaSel&&q.startsWith("=")?(filtradas.length+" vendas | soma "+fmt(soma)+" | alvo "+fmt(somaSel.alvo)+(somaSel.tol?(" ± "+fmt(somaSel.tol)):"")):(filtradas.length+" vendas | "+fmt(soma));
const frag=document.createDocumentFragment();
for(const x of filtradas){
const tr=document.createElement("tr");
tr.addEventListener("click",()=>abrirModal(x));
tr.innerHTML='<td class="mono">'+String(x.numero||"")+'</td><td class="mono">'+fmt(x.total||0)+'</td><td class="mono">'+String(x.pagamentos||"")+'</td>';
frag.appendChild(tr);
}
tb.appendChild(frag);
qs("#sub").textContent=vendAtual?("Vendedor: "+vendAtual):"Todos os vendedores";
qs("#vendSel").textContent=vendAtual||"Todos";
};
const renderTudo=()=>{renderLista();renderTabela();};
qs("#tQtd").textContent=DADOS.totais.qtd;
qs("#tTot").textContent=fmt(DADOS.totais.total);
qs("#q").addEventListener("input",e=>{qAtual=String(e.target.value||"").trim();qValor=consultaPareceValor(qAtual);calcSomaSel();renderTabela();});
qs("#limpar").addEventListener("click",()=>{vendAtual="";qAtual="";qValor=false;qs("#q").value="";calcSomaSel();renderTudo();toast("Filtro limpo","Mostrando todos.");});
qs("#ajuda").addEventListener("click",abrirAjuda);
qs("#copiarTudo").addEventListener("click",()=>{copiarTexto(montarTextoCopia(false));toast("Copiado","Conteúdo completo (com dinheiro).");});
qs("#copiarSemDinheiro").addEventListener("click",()=>{copiarTexto(montarTextoCopia(true));toast("Copiado","Ignorando vendas com Dinheiro.");});
qs("#fechar").addEventListener("click",fecharModal);
qs("#ov").addEventListener("click",e=>{if(e.target===qs("#ov"))fecharModal();});
document.addEventListener("keydown",e=>{if(e.key==="Escape")fecharModal();});
renderTudo();
</script>
</body></html>`;
fs.writeFileSync(saida,html,"utf8");
db.detach(()=>{if(tmpCriado)apagarComRetry(tmpCriado,0);});
console.log("OK: "+saida);
});
};
rodar();
})();