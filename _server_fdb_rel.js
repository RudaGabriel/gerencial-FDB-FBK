const http=require("http"),fs=require("fs"),path=require("path"),cp=require("child_process");
const root=path.resolve(process.argv[2]||process.cwd());
const port=parseInt(process.argv[3]||process.env.PORTA||"8000",10);
const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".svg":"image/svg+xml",".ico":"image/x-icon",".txt":"text/plain; charset=utf-8"};
const st={running:false,last_start:0,last_end:0,last_ok:0,last_err:"",next_run:0,tm:null};
const fdb=String(process.env.FDB_FILE||"").trim();
const dbuser=String(process.env.DBUSER||"SYSDBA").trim();
const dbpass=String(process.env.DBPASS||"masterkey").trim();
const key=String(process.env.SRVKEY||"").trim();
const webip=String(process.env.WEB_IP||"127.0.0.1").trim();
const hist=path.join(root,"historico");
const atual=path.join(root,"relatorio_atual.html");
const tmp=path.join(root,"_tmp_relatorio.html");
const confScript=path.join(root,"_gen_script.txt");
const logFile=String(process.env.LOG_FILE||path.join(root,"server.log")).trim();
const MAX_LOG_BYTES=1000*1024;
const MAX_LOG_AGE=7*24*60*60*1000;
const MS15=15*60*1000;
const ua=()=>String(process.env.USERPROFILE||"").trim();
const ensureDir=p=>{if(!fs.existsSync(p))fs.mkdirSync(p,{recursive:true});};
const proibFile=path.join(root,"_proibidos.txt");
const normP=s=>String(s||"").trim().toUpperCase().replace(/\s+/g," ");
const uniq=a=>[...new Set((a||[]).filter(Boolean))];
const parseLista=s=>uniq(String(s||"").split(/\n|,/g).map(normP).filter(Boolean));
const lerProib=cb=>{fs.readFile(proibFile,"utf8",(e,txt)=>{cb(parseLista(e?"":txt));});};
const salvarProib=(arr,cb)=>{fs.writeFile(proibFile,uniq(arr).map(normP).filter(Boolean).join("\n"),"utf8",()=>{cb&&cb();});};
let reqId=0;
const stamp=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;};
const flat=s=>String(s||"").replace(/\s+/g," ").trim();
const tail=s=>{s=flat(s);return s.length>1200?s.slice(-1200):s;};
const lineTs=line=>{const m=String(line||"").match(/^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\]/);return m?new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6])).getTime():0;};
const trimLogText=txt=>{let lines=String(txt||"").replace(/\r/g,"").split("\n");if(lines.length&&lines[lines.length-1]==="")lines.pop();const min=Date.now()-MAX_LOG_AGE;lines=lines.filter(line=>{const ts=lineTs(line);return !ts||ts>=min;});if(!lines.length)return"";let out=lines.join("\n")+"\n";while(Buffer.byteLength(out,"utf8")>MAX_LOG_BYTES&&lines.length>1){lines.shift();out=lines.join("\n")+"\n";}if(Buffer.byteLength(out,"utf8")>MAX_LOG_BYTES)out=out.slice(-MAX_LOG_BYTES);return out;};
const writeLogLine=line=>{if(!logFile){process.stdout.write(line+"\n");return;}let prev="";try{if(fs.existsSync(logFile))prev=fs.readFileSync(logFile,"utf8");}catch{}const next=trimLogText(prev+line+"\n");try{fs.writeFileSync(logFile,next,"utf8");}catch{process.stdout.write(line+"\n");}};
const initLog=()=>{if(!logFile)return;let prev="";try{if(fs.existsSync(logFile))prev=fs.readFileSync(logFile,"utf8");}catch{}try{fs.writeFileSync(logFile,trimLogText(prev),"utf8");}catch{}};
const log=(tag,msg)=>writeLogLine(`[${stamp()}] ${tag}${msg?" "+msg:""}`);
const rip=req=>{let ip=String(req.headers["x-forwarded-for"]||req.socket&&req.socket.remoteAddress||"").split(",")[0].trim();if(ip.startsWith("::ffff:"))ip=ip.slice(7);return ip||"-";};
const rua=req=>{const v=flat(req.headers["user-agent"]||"");return v.length>180?v.slice(0,180):v;};
const existe=p=>{try{return !!p&&fs.existsSync(p)&&fs.statSync(p).isFile();}catch{return false;}};
const lerConfScript=()=>{try{return String(fs.readFileSync(confScript,"utf8")||"").trim();}catch{return "";}};
const resolverScript=()=>{
const up=ua();
const envPath=String(process.env.GEN_SCRIPT||"").trim();
const confPath=lerConfScript();
const cand=[
envPath,
confPath,
up?path.join(up,"Desktop","REL","gerar-relatorio-html.js"):"",
up?path.join(up,"Desktop","gerar-relatorio-html.js"):"",
up?path.join(up,"Documents","gerar-relatorio-html.js"):"",
up?path.join(up,"Downloads","gerar-relatorio-html.js"):"",
path.join(process.cwd(),"gerar-relatorio-html.js"),
path.join(root,"gerar-relatorio-html.js")
].filter(Boolean);
for(const p of cand) if(existe(p)) return p;
return envPath||confPath||"";
};
const deskPath=d=>{const up=ua();if(!up)return"";const dd=String(d.getDate()).padStart(2,"0");const mm=String(d.getMonth()+1).padStart(2,"0");const yy=String(d.getFullYear());return path.join(up,"Desktop",`(FDB-DIA)_relatorio_${dd}-${mm}-${yy}.html`);};
const isoDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const okJson=(res,obj,code=200,extra)=>{res.writeHead(code,Object.assign({"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"},extra||{}));res.end(JSON.stringify(obj||{}));};
const bad=(res,code,msg)=>{res.writeHead(code,{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"});res.end(String(msg||code));};
const cors=()=>({"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"x-key,content-type","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Max-Age":"600"});
const serveFile=(res,fp)=>{fs.stat(fp,(e,s)=>{if(e||!s.isFile())return bad(res,404,"404");const ext=path.extname(fp).toLowerCase();res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","Cache-Control":"no-store"});fs.createReadStream(fp).pipe(res);});};
const cleanHist=d=>{ensureDir(hist);const mid=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();fs.readdir(hist,(e,list)=>{if(e||!Array.isArray(list)||!list.length)return;for(const name of list){if(!name||!/\.html$/i.test(name))continue;const fp=path.join(hist,name);fs.stat(fp,(e2,s)=>{if(e2||!s||!s.isFile())return;const mt=Number(s.mtimeMs||0);if(mt&&mt<mid)fs.unlink(fp,()=>{});});}});};
const scheduleIn=ms=>{if(st.tm)clearTimeout(st.tm);if(ms<1000)ms=1000;st.next_run=Date.now()+ms;st.tm=setTimeout(()=>{gerar("auto").then(()=>scheduleIn(MS15));},ms);};
const initSchedule=()=>{let ms=MS15;try{if(fs.existsSync(atual)){const m=fs.statSync(atual).mtimeMs;const next=m+MS15;const now=Date.now();if(next>now+1000)ms=next-now;}}catch{}scheduleIn(ms);};
const gerar=(motivo,meta)=>{
if(st.running){log("GERAR_SKIP",`motivo=${motivo} estado=running`);return Promise.resolve({ok:false,estado:"running"});}
const script=resolverScript();
if(!fdb||!script||!existe(script)){log("GERAR_SKIP",`motivo=${motivo} estado=sem_cfg fdb=${fdb?"ok":"vazio"} script=${script||"vazio"} script_ok=${existe(script)?"sim":"nao"}`);return Promise.resolve({ok:false,estado:"sem_cfg",erro:`script=${script||"vazio"}`});}
st.running=true;st.last_start=Date.now();st.last_err="";
const d=new Date();
const dataISO=isoDate(d);
const env=Object.assign({},process.env,{FDB_SRV_KEY:key,FDB_SRV_BASE_LOCAL:`http://127.0.0.1:${port}`,FDB_SRV_BASE_REDE:`http://${webip}:${port}`,GEN_SCRIPT:script});
const info=meta&&typeof meta==="object"?meta:{};
log("GERAR_INICIO",`motivo=${motivo} ip=${info.ip||"-"} origem=${info.origem||"-"} ua=${info.ua||"-"} data=${dataISO} script="${script}"`);
return new Promise(res=>{ensureDir(hist);const args=[script,"--fdb",fdb,"--data",dataISO,"--saida",tmp,"--user",dbuser,"--pass",dbpass];const p=cp.spawn(process.execPath,args,{env,windowsHide:true});let out="";p.stdout.on("data",b=>{out+=String(b||"");});p.stderr.on("data",b=>{out+=String(b||"");});p.on("error",e=>{st.running=false;st.last_end=Date.now();st.last_err=flat(e&&e.message||"spawn_error");scheduleIn(MS15);log("GERAR_FALHA",`motivo=${motivo} etapa=spawn erro=${tail(st.last_err)}`);res({ok:false,estado:"spawn_error",erro:st.last_err,next_run:st.next_run});});p.on("close",code=>{st.running=false;st.last_end=Date.now();if(code===0&&fs.existsSync(tmp)){const dp=deskPath(d);const dd=String(d.getDate()).padStart(2,"0");const mm=String(d.getMonth()+1).padStart(2,"0");const yy=String(d.getFullYear());const hh=String(d.getHours()).padStart(2,"0");const mi=String(d.getMinutes()).padStart(2,"0");const histFile=path.join(hist,`(FDB-DIA)_relatorio_${dd}-${mm}-${yy}_${hh}-${mi}.html`);let fileErr="";try{fs.copyFileSync(tmp,atual);if(dp)fs.copyFileSync(tmp,dp);fs.copyFileSync(tmp,histFile);fs.unlinkSync(tmp);}catch(e){fileErr=flat(e&&e.message||"copy_error");}if(!fileErr){st.last_ok=Date.now();cleanHist(d);scheduleIn(MS15);log("GERAR_OK",`motivo=${motivo} atual="${atual}" hist="${histFile}" next_run=${st.next_run}`);res({ok:true,estado:"ok",motivo,saida_atual:atual,next_run:st.next_run,last_ok:st.last_ok,script});return;}st.last_err=fileErr;scheduleIn(MS15);log("GERAR_FALHA",`motivo=${motivo} etapa=arquivo erro=${tail(fileErr)}`);res({ok:false,estado:"erro_arquivo",erro:st.last_err,next_run:st.next_run,script});return;}st.last_err=tail(out)||("erro "+code);scheduleIn(MS15);log("GERAR_FALHA",`motivo=${motivo} code=${code} erro=${tail(st.last_err)}`);res({ok:false,estado:"erro",code,erro:st.last_err,next_run:st.next_run,script});});});
};
ensureDir(hist);initLog();cleanHist(new Date());initSchedule();
process.on("uncaughtException",e=>{log("UNCAUGHT",`erro=${tail(e&&e.stack||e&&e.message||e||"erro")}`);});
process.on("unhandledRejection",e=>{log("UNHANDLED",`erro=${tail(e&&e.stack||e&&e.message||e||"erro")}`);});
const srv=http.createServer((req,res)=>{const u=new URL(req.url||"/","http://127.0.0.1");const p=String(u.pathname||"/");if(req.method==="OPTIONS"){res.writeHead(204,cors());res.end();return;}if(p==="/__status"&&req.method==="GET"){okJson(res,{running:st.running,last_start:st.last_start,last_end:st.last_end,last_ok:st.last_ok,last_err:st.last_err,next_run:st.next_run,port,webip,script:resolverScript(),script_cfg:lerConfScript()},200,cors());return;}if(p==="/__gerar"&&req.method==="POST"){const id=++reqId;const k=String(req.headers["x-key"]||"").trim();const ip=rip(req);const origem=flat(req.headers.origin||req.headers.referer||"-");const a=rua(req);log("GERAR_REQ",`id=${id} ip=${ip} origem=${origem||"-"} key=${key&&k===key?"ok":"invalida"} running=${st.running} ua=${a||"-"}`);if(!key||k!==key){log("GERAR_DENY",`id=${id} ip=${ip} motivo=unauth`);okJson(res,{ok:false,estado:"unauth",req_id:id},401,cors());return;}if(st.running){log("GERAR_BUSY",`id=${id} ip=${ip} last_start=${st.last_start}`);okJson(res,{ok:false,estado:"running",running:true,last_start:st.last_start,last_ok:st.last_ok,next_run:st.next_run,req_id:id},409,cors());return;}gerar("manual",{id,ip,origem,ua:a}).then(r=>{log("GERAR_RES",`id=${id} ok=${!!(r&&r.ok)} estado=${r&&r.estado||"-"} last_ok=${st.last_ok} script="${r&&r.script||resolverScript()||""}" erro=${tail(r&&r.erro||"")||"-"}`);okJson(res,Object.assign({req_id:id},r||{}),200,cors());});return;}if(p==="/__proibidos"&&req.method==="GET"){lerProib(lista=>okJson(res,{ok:true,lista},200,cors()));return;}if(p==="/__proibidos"&&req.method==="POST"){const k=String(req.headers["x-key"]||"").trim();if(key&&k!==key){okJson(res,{ok:false,estado:"unauth"},401,cors());return;}let body="";req.on("data",b=>{body+=String(b||"");if(body.length>200000)body=body.slice(0,200000);});req.on("end",()=>{const inc=parseLista(body);lerProib(lista0=>{const merged=uniq([...lista0,...inc].map(normP).filter(Boolean));salvarProib(merged,()=>okJson(res,{ok:true,lista:merged},200,cors()));});});return;}let rel=p;if(rel==="/"||rel==="")rel="/relatorio_atual.html";rel=rel.replace(/^\/+/,"");const fp=path.resolve(path.join(root,rel));if(fp.indexOf(root)!==0)return bad(res,403,"403");serveFile(res,fp);});
srv.listen(port,"0.0.0.0",()=>{log("SERVIDOR_OK",`${port} ${root} webip=${webip} script="${resolverScript()}" cfg="${lerConfScript()}"`);});
