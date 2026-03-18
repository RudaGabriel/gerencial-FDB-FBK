(function() {
	const Firebird = require("node-firebird");
	const fs = require("node:fs");
	const os = require("node:os");
	const path = require("node:path");
	const cp = require("node:child_process");
	const args = process.argv.slice(2);
	const pegar = k => {
		const i = args.indexOf(k);
		return i >= 0 && i + 1 < args.length ? String(args[i + 1] || "").trim() : "";
	};
	const fbk = pegar("--fbk");
	const fdb = pegar("--fdb");
	const dataRaw = pegar("--data");
	const dataISO = (() => {
		const s = String(dataRaw || "").trim();
		let m;
		if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
		m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
		if (m) return `${m[3]}-${m[2]}-${m[1]}`;
		return s;
	})();
	const saida = pegar("--saida");
	const usuario = pegar("--user") || "SYSDBA";
	const senha = pegar("--pass") || "masterkey";
	const gbak = pegar("--gbak") || "C:\\Program Files (x86)\\Firebird\\Firebird_2_5\\bin\\gbak.exe";
	if ((!fbk && !fdb) || !dataISO || !saida) {
		console.log("Uso:\nnode gerar-relatorio-html.js --fbk \"C:\\...\\SMALL.fbk\" --data 2026-02-06 --saida \"C:\\...\\relatorio.html\" --user SYSDBA --pass masterkey --gbak \"C:\\...\\gbak.exe\"\nou\nnode gerar-relatorio-html.js --fdb \"C:\\...\\SMALL.FDB\" --data 07/02/2026 --saida \"C:\\...\\relatorio.html\" --user SYSDBA --pass masterkey");
		process.exit(1);
	}
	const escHtml = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	const apagarComRetry = (p, t) => fs.unlink(p, e => {
		if (!e || e?.code === "ENOENT") return;
		if (e?.code === "EBUSY" && t < 25) return setTimeout(() => apagarComRetry(p, t + 1), 350);
		console.log("Temporário ainda em uso. Apague depois: " + p);
	});
	const execFileP = (cmd, argv) => new Promise(r => cp.execFile(cmd, argv, {
		windowsHide: true,
		maxBuffer: 1024 * 1024 * 200
	}, (e, stdout, stderr) => r({
		e,
		stdout: String(stdout || ""),
		stderr: String(stderr || "")
	})));
	const query = (db, sql, params) => new Promise(r => db.query(sql, params || [], (e, rows) => r({
		e,
		rows: rows || []
	})));
	const dataBR = (() => {
		let m = String(dataISO || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (m) return `${m[3]}/${m[2]}/${m[1]}`;
		m = String(dataRaw || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
		if (m) return `${m[1]}/${m[2]}/${m[3]}`;
		return String(dataRaw || dataISO || "");
	})();
	const horaGeradaBR = (() => {
		const d = new Date();
		const p = n => String(n).padStart(2, "0");
		return `${p(d.getHours())}:${p(d.getMinutes())}`;
	})();
	const diaMesGeradaBR = (() => {
		const d = new Date();
		const p = n => String(n).padStart(2, "0");
		return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
	})();
	const ano2 = String(new Date().getFullYear()).slice(-2);
	let tmpCriado = "";
	let dbPath = fdb || fbk;
	const restaurarSeFbk = async () => {
		if (!fbk) return;
		tmpCriado = path.join(os.tmpdir(), "small_restore_" + Date.now() + ".fdb");
		const r = await execFileP(gbak, ["-c", "-v", "-user", usuario, "-password", senha, fbk, tmpCriado]);
		if (r.e) {
			console.log((r.stderr || r.stdout || String(r.e)).trim() || "Falha ao restaurar FBK.");
			process.exit(1);
		}
		dbPath = tmpCriado;
	};
	const rodar = async () => {
		await restaurarSeFbk();
		const opts = {
			host: "127.0.0.1",
			port: 3050,
			database: dbPath,
			user: usuario,
			password: senha,
			role: null,
			pageSize: 4096,
			charset: "UTF8"
		};
		Firebird.attach(opts, async function(err, db) {
			if (err) {
				console.log("Falha ao conectar: " + String(err.message || err));
				if (tmpCriado) apagarComRetry(tmpCriado, 0);
				process.exit(1);
			}
			const id = s => '"' + String(s || "").replace(/"/g, '""') + '"';
			const camposCache = new Map();
			const camposTabela = async nome => {
				const n = String(nome || "").trim().toUpperCase();
				if (camposCache.has(n)) return camposCache.get(n);
				const rr = await query(db, "select trim(rf.rdb$field_name) as C from rdb$relation_fields rf where trim(rf.rdb$relation_name)=?", [n]);
				const set = new Set();
				if (!rr.e && rr.rows)
					for (const r of rr.rows) {
						const c = String(r.C ?? "").trim().toUpperCase();
						if (c) set.add(c);
					}
				camposCache.set(n, set);
				return set;
			};
			const listarTabelas = async prefixo => {
				const p = String(prefixo || "").trim().toUpperCase();
				const rr = await query(db, "select trim(r.rdb$relation_name) as T from rdb$relations r where r.rdb$system_flag=0 and r.rdb$view_blr is null and trim(r.rdb$relation_name) starting with ? order by 1", [p]);
				const out = [];
				if (!rr.e && rr.rows)
					for (const r of rr.rows) {
						const t = String(r.T ?? "").trim().toUpperCase();
						if (t) out.push(t);
					}
				return out;
			};
			const camposNfce = await camposTabela("NFCE");
			const escolherCampoJoin = async () => {
				const cand = ["NUMERONF", "CONTROLE", "GERENCIAL", "PEDIDO"];
				let fallback = "";
				for (const c of cand)
					if (camposNfce.has(c) && !fallback) fallback = c;
				for (const c of cand) {
					if (!camposNfce.has(c)) continue;
					const rr = await query(db, `select first 1 1 as OK from nfce n where n.data=cast(? as date) and n.modelo=99 and n.${c} is not null and exists(select 1 from pagament p where p.data=n.data and trim(leading '0' from cast(p.pedido as varchar(30)))=trim(leading '0' from cast(n.${c} as varchar(30))) and p.valor is not null)`, [dataISO]);
					if (!rr.e && rr.rows && rr.rows.length) return c;
				}
				return fallback || "NUMERONF";
			};
			const campoJoinPag = await escolherCampoJoin();
			const campoNumeroOut = campoJoinPag;
			const campoCaixa = camposNfce.has("CAIXA") ? "CAIXA" : (camposNfce.has("NUMCAIXA") ? "NUMCAIXA" : "");
			const selCaixa = campoCaixa ? ("cast(n." + campoCaixa + " as varchar(20))") : "cast('' as varchar(20))";
			const sql = `
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
    forma_base as forma_nome
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
  n.modelo as MODELO,
  cast(n.${campoNumeroOut} as varchar(30)) as NUMERO,
  ${selCaixa} as CAIXA,
  n.total as TOTAL,
  v.pagamentos as PAGAMENTOS
from venda v
join nfce n on n.data=v.data and n.modelo in (99,65) and trim(leading '0' from cast(n.${campoJoinPag} as varchar(30)))=trim(leading '0' from cast(v.pedido as varchar(30)))
order by v.vendedor, n.modelo, n.${campoNumeroOut}
`;
			const r = await query(db, sql, [dataISO]);
			if (r.e) {
				db.detach(() => {
					if (tmpCriado) apagarComRetry(tmpCriado, 0);
				});
				console.log("Erro na consulta: " + String(r.e.message || r.e));
				process.exit(1);
			}
			const linhas = r.rows.map(x => {
				let numero = String(x.NUMERO ?? "").trim();
				if (/^\d+$/.test(numero) && numero.length < 6) numero = numero.padStart(6, "0");
				let caixa = String(x.CAIXA ?? "").trim();
				if (/^\d+$/.test(caixa) && caixa.length < 3) caixa = caixa.padStart(3, "0");
				const modelo = Number(x.MODELO || 99);
				return {
					vendedor: String(x.VENDEDOR ?? "").trim() || "(sem vendedor)",
					modelo,
					tipo: modelo === 65 ? "nfc-e" : "gerencial",
					numero,
					caixa,
					total: Number(x.TOTAL || 0),
					pagamentos: String(x.PAGAMENTOS ?? "").trim(),
					itens: ""
				};
			});
			const fmtQtd = v => {
				const n = Number(v || 0);
				if (!Number.isFinite(n)) return "0";
				const r = Math.round(n);
				if (Math.abs(n - r) < 1e-9) return String(r);
				let s = String(n);
				if (s.indexOf("e") >= 0 || s.indexOf("E") >= 0) s = n.toFixed(4);
				s = s.replace(/0+$/, "").replace(/\.$/, "");
				return s.replace(".", ",");
			};

			const rrAlt = await query(db, `
select
  cast(PEDIDO as varchar(30)) as PED,
  cast(CAIXA as varchar(10)) as CX,
  DESCRICAO,
  QUANTIDADE
from ALTERACA
where DATA = cast(? as date)
order by PEDIDO, ITEM
`, [dataISO]);

			if (!rrAlt.e && rrAlt.rows && rrAlt.rows.length) {
				const mp = new Map();
				for (const row of rrAlt.rows) {
					let ped = String(row.PED ?? "").trim();
					if (/^\d+$/.test(ped) && ped.length < 6) ped = ped.padStart(6, "0");
					let cx = String(row.CX ?? "").trim();
					cx = cx.replace(/\D+/g, "");
					if (cx && cx.length < 3) cx = cx.padStart(3, "0");
					const desc = String(row.DESCRICAO || "").trim();
					if (!ped || !desc) continue;
					const qtd = fmtQtd(row.QUANTIDADE);
					const key = ped + "|" + cx;
					if (!mp.has(key)) mp.set(key, []);
					mp.get(key).push(qtd + "x " + desc);
				}
				for (const x of linhas) {
					const key = String(x.numero || "").trim() + "|" + String(x.caixa || "").trim();
					const arr = mp.get(key);
					if (!arr || !arr.length) continue;
					let t = "";
					for (let i = 0; i < arr.length; i++) {
						const linha = "⤷ " + String(arr[i] || "");
						const add = (t ? "\n" : "") + linha;
						t += add;
					}
					x.itens = t;
				}
			}

			const porVend = new Map();
			for (const it of linhas) {
				if (!porVend.has(it.vendedor)) porVend.set(it.vendedor, {
					vendedor: it.vendedor,
					qtd: 0,
					total: 0
				});
				const v = porVend.get(it.vendedor);
				v.qtd++;
				v.total += it.total;
			}
			const vendedores = [...porVend.values()].sort((a, b) => a.vendedor.localeCompare(b.vendedor, "pt-BR", {
				sensitivity: "base"
			}));
			const totalGeral = linhas.reduce((a, b) => a + (b.total || 0), 0);
			const qtdGeral = linhas.length;
			const srv_key=String(process.env.FDB_SRV_KEY||"").trim();
			const srv_base_local=String(process.env.FDB_SRV_BASE_LOCAL||"").trim();
			const srv_base_rede=String(process.env.FDB_SRV_BASE_REDE||"").trim();
			
			const totaisDia={ok:false,gerencial:0,nfce:0,nfc:0,nfe:0,geral:0,selecionado:0,qtd_gerencial:0,qtd_nfce:0,modelos:[]};
			totaisDia.qtd_gerencial=qtdGeral;
			const rQtdNfce=await query(db,`select count(distinct trim(leading '0' from cast(n.${campoNumeroOut} as varchar(30)))) as QTD from PAGAMENT p join NFCE n on n.data=p.data and trim(leading '0' from cast(p.pedido as varchar(30)))=trim(leading '0' from cast(n.${campoJoinPag} as varchar(30))) where p.data=cast(? as date) and p.valor is not null and substring(p.forma from 1 for 2) not in ('00','13') and n.modelo=65`,[dataISO]);
			const qtdNfce=Number((rQtdNfce.rows&&rQtdNfce.rows[0]?rQtdNfce.rows[0].QTD:0)||0);
			if(!rQtdNfce.e&&Number.isFinite(qtdNfce)&&qtdNfce>=0)totaisDia.qtd_nfce=qtdNfce;

			const rPagTot=await query(db,`select sum(p.valor) as TOTAL from PAGAMENT p where p.data=cast(? as date) and p.valor is not null and substring(p.forma from 1 for 2) not in ('00','13')`,[dataISO]);
			const totalPag=Number((rPagTot.rows&&rPagTot.rows[0]?rPagTot.rows[0].TOTAL:0)||0);
			if(!rPagTot.e&&Number.isFinite(totalPag)&&totalPag>0){
				totaisDia.ok=true;
				totaisDia.selecionado=totalPag;
				totaisDia.geral=totalPag;
				const rPagMod=await query(db,`select n.modelo as MODELO,sum(p.valor) as TOTAL from PAGAMENT p join NFCE n on n.data=p.data and trim(leading '0' from cast(p.pedido as varchar(30)))=trim(leading '0' from cast(n.${campoJoinPag} as varchar(30))) where p.data=cast(? as date) and p.valor is not null and substring(p.forma from 1 for 2) not in ('00','13') group by n.modelo`,[dataISO]);
				if(!rPagMod.e&&rPagMod.rows&&rPagMod.rows.length){
					for(const row of rPagMod.rows){
						const mod=Number(row.MODELO||0),tot=Number(row.TOTAL||0);
						if(!Number.isFinite(mod)||!Number.isFinite(tot))continue;
						if(mod===99)totaisDia.gerencial=tot;
						else if(mod===65)totaisDia.nfce=tot;
						else if(mod===2)totaisDia.nfc=tot;
						else if(mod===55)totaisDia.nfe=tot;
						totaisDia.modelos.push({modelo:mod,total:tot});
					}
				}
			}
const vendTotaisDia=[];
			const rVendTot=await query(db,`select
  p.vendedor as VENDEDOR,
  n.modelo as MODELO,
  sum(p.valor) as TOTAL
from PAGAMENT p
join NFCE n
  on n.data=p.data
 and trim(leading '0' from cast(p.pedido as varchar(30)))=trim(leading '0' from cast(n.${campoJoinPag} as varchar(30)))
where p.data=cast(? as date)
  and p.valor is not null
  and substring(p.forma from 1 for 2) not in ('00','13')
  and n.modelo in (99,65)
group by p.vendedor,n.modelo`,[dataISO]);
			if(!rVendTot.e&&rVendTot.rows&&rVendTot.rows.length){
				const mp=new Map();
				for(const row of rVendTot.rows){
					const nome=String(row.VENDEDOR??"").trim()||"(sem vendedor)";
					const mod=Number(row.MODELO||0);
					const tot=Number(row.TOTAL||0);
					if(!Number.isFinite(tot))continue;
					if(!mp.has(nome))mp.set(nome,{vendedor:nome,gerencial:0,nfce:0,geral:0});
					const it=mp.get(nome);
					if(mod===99)it.gerencial+=tot;
					else if(mod===65)it.nfce+=tot;
				}
				for(const it of mp.values()){
					it.geral=(it.gerencial||0)+(it.nfce||0);
					vendTotaisDia.push(it);
				}
				vendTotaisDia.sort((a,b)=>a.vendedor.localeCompare(b.vendedor,"pt-BR",{sensitivity:"base"}));
			}
const dados = {
				data: dataISO,
				gerado_ts: Date.now(),
				srv_key,
				srv_base_local,
				srv_base_rede,
				totais: {
					qtd: qtdGeral,
					total: totalGeral
				},
				vendedores,
				vendTotaisDia,
				vendas: linhas,
				totaisDia
			};
			const dadosJSON = JSON.stringify(dados).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
			const html = String.raw`<!doctype html><html lang="pt-br"><head><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="icon" href="/favicon.ico"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório Pet World ${escHtml(dataBR)}</title>
<style>
:root {
  color-scheme: dark;
}
* {
  box-sizing: border-box;
}
html,
body {
  height: 100%;
  margin: 0;
  background: #0b0f17;
  color: #e6eaf2;
  overflow: hidden;
}
body {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
}
a {
  color: inherit;
}
.app {
  height: 100%;
  display: grid;
  grid-template-rows: auto 1fr;
}
.top {
  display: grid;
  /* grid-template-columns: 0fr auto; */
  gap: 5px;
  justify-content: center;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0));
}
.top .left {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  align-items: center;
  align-content: center;
  justify-content: space-between;
}
.badge {
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  font-size: 12px;
  opacity: 0.95;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  padding: 11px 5px;
  border-radius: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
span#tQtd,span#tQtdGer,span#tQtdNfce {
	margin: 0 3px;
}
.badge:last-child {
  gap: 2px;
}
.badges {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: nowrap;
  min-width: 0;
  align-content: center;
  justify-content: center;
}
.badgeHora {
  opacity: 0.9;
}
#acoes {
  display: none;
}
.top .right {
  display: flex;
  gap: 5px;
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
}
.input {
  flex: 1 1 auto;
  width: auto;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e6eaf2;
  padding: 10px 12px;
  border-radius: 12px;
  outline: none;
  height: 40px;
}
.radioBusca {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 10px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  white-space: nowrap;
  overflow-x: auto;
}
.radioBusca label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  opacity: 0.95;
}
.radioBusca input {
  margin: 0;
  accent-color: #78b4ff;
}
.input:focus {
  border-color: rgba(120, 180, 255, 0.55);
  box-shadow: 0 0 0 4px rgba(120, 180, 255, 0.12);
}
.btn {
  cursor: pointer;
  user-select: none;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e6eaf2;
  padding: 10px 12px;
  border-radius: 12px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn:hover {
  background: rgba(255, 255, 255, 0.07);
}
#limpar {
  padding: 0 12px;
}
#ajuda {
  min-width: 40px;
  padding: 0 12px;
}
.btnProibidos {
  display: none;
  padding: 0 12px;
}
.badgeGeradoMobile {
  display: none;
}
.main {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
}
.sidebar {
  min-height: 0;
  min-width: 0;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: rgba(255, 255, 255, 0.02);
}
.sb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.sb-title {
  font-size: 13px;
  opacity: 0.85;
  font-weight: 650;
}
.list {
  min-height: 0;
  overflow: auto;
  border-radius: 12px;
  flex: 0 1 auto;
}
.sbResumo .sb-head {
  margin: 7px 0;
}
.sbResumo {
	display: none !important;
	width: 0;
	height: 0;
	opacity: 0;
  /*margin-top: 10px;*/
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  min-height: 0;
  overflow: auto;
  max-height: 45%;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-items: stretch;
  justify-content: center;
  user-select: none;
}
.sbResumo .rv{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding:5px 2px;
}
.sbResumo .rv:hover{
  color: yellow;
}
.sbResumo .rv .n{
  opacity:.92;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.sbResumo .rv .v{
  font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
  opacity:.95;
}
span#tQtd {margin: 0 3px;
}
.item {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  margin-bottom: 8px;
  cursor: pointer;
}
.item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: yellow;
}
.item.sel {
  border-color: rgba(120, 180, 255, 0.55);
  box-shadow: 0 0 0 3px rgba(120, 180, 255, 0.1) inset;
}
.item .nome {
  font-weight: 650;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item .meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.item .qtd {
  font-size: 12px;
  opacity: 0.85;
}
.item .tot {
  font-size: 12px;
  opacity: 0.9;
}
.content {
  min-height: 0;
  min-width: 0;
  padding: 12px 12px 12px 14px;
}
.tableWrap {
  height: 100%;
  min-width: 0;
  min-height: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.tableTop {
  display: flex;
  gap: 15px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-direction: column;
}
.tableTitle {
  opacity: 0.85;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: break-spaces;
}
.count {
  font-size: 12px;
  opacity: 0.85;
  white-space: nowrap;
}
.actions {
  display: flex;
  gap: 15px;
  min-width: 0;
  flex-direction: column;
}
.btns {
  display: flex;
  gap: 8px;  overflow-x: auto;
  width: 100%;
}
.btns .btn {
  flex: 1 1 180px;
  justify-content: center;
  font-size: 13px;
}
.grid {
  min-height: 0;
  min-width: 0;
}
table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  display: block;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  height: 100%;
  --sbw: 0px;
}
thead {
  position: sticky;
  top: 0;
  z-index: 4;
  display: table;
  width: calc(100% - var(--sbw, 0px));
  table-layout: fixed;
  transform: translateX(0);
}
tbody {
  display: table;
  width: 100%;
  table-layout: fixed;
}
table::-webkit-scrollbar {
  width: 6px;
}
table::-webkit-scrollbar-track {
  background: #0f131b;
}
table::-webkit-scrollbar-thumb {
  background: #0f131b;
  border: 1px solid #fff;
  border-radius: 25px 5px;
}
table::-webkit-scrollbar-thumb:hover {
  background: #0f131bdb;
}
thead th {
  position: static;
  background: rgba(11, 15, 23, 0.95);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding: 12px 10px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.9;
  text-align: center;
}
thead th:nth-child(1),
tbody td:nth-child(1) {
  width: 160px;
}
thead th:nth-child(2),
tbody td:nth-child(2) {
  width: 95px;
}
thead th:nth-child(3),
tbody td:nth-child(3) {
  width: 120px;
}
thead th:nth-child(4),
tbody td:nth-child(4) {
  width: 110px;
}
thead th:nth-child(5),
tbody td:nth-child(5) {
  width: 220px;
}
tbody td {
  padding: 12px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  text-align: center;
}
tbody td:nth-child(2),
tbody td:nth-child(3),
tbody td:nth-child(4) {
  white-space: nowrap;
}
tbody td:nth-child(1),
tbody td:nth-child(2),
tbody td:nth-child(5) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
tbody td:nth-child(6) {
  overflow: hidden;
}
tbody tr {
  cursor: pointer;
}
tbody tr:hover {
  background: rgba(255, 255, 255, 0.04);
  color: yellow;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
}
.pill {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  font-size: 12px;
  opacity: 0.95;
}
.ov {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(10px);
  padding: 18px;
  z-index: 9998;
}
.ov.on {
  display: flex;
}
.modal {
  width: min(720px, 94vw);
  max-height: 86vh;
  overflow: auto;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.06),
    rgba(255, 255, 255, 0.03)
  );
  box-shadow: 0 26px 80px rgba(0, 0, 0, 0.55);
  padding: 14px;
}
.mhead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.mtitle {
  font-weight: 800;
  font-size: 14px;
}
.msub {
  font-size: 12px;
  opacity: 0.85;
  margin-top: 4px;
}
.mbody {
  display: grid;
  gap: 10px;
}
.kv {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 8px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
}
.k {
  font-size: 12px;
  opacity: 0.8;
}
.v {
  font-size: 13px;
}

.vendBtn {
  display: none;
  gap: 8px;
  min-width: 0;
  padding: 0 12px;
}
.vendIcon {
  font-weight: 900;
  font-size: 14px;
  line-height: 1;
}
.vendTxt {
  min-width: 0;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
  font-size: 12px;
  opacity: 0.92;
}
.cards {
  display: none;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}
.cardRow {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 14px;
  padding: 12px;
  display: grid;
  gap: 8px;
  margin-bottom: 10px;
  cursor: pointer;
}
.cardRow:hover {
  background: rgba(255, 255, 255, 0.05);
}
.cardHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.cardNum {
  font-weight: 900;
}
.cardTotal {
  font-weight: 900;
  opacity: 0.95;
  white-space: nowrap;
}
.cardMeta {
  font-size: 12px;
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cardPay {
  font-size: 12px;
  opacity: 0.9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cardItens {
  font-size: 12px;
  opacity: 0.9;
  overflow-wrap: anywhere;
  line-height: 1.35;
}
.itensMini {
  margin-top: 8px;
  border-radius: 14px;
  padding: 10px 10px 9px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.32);
}
.itensMiniHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  opacity: 0.92;
  margin-bottom: 8px;
}
.itensMiniHead .sub {
  opacity: 0.78;
  font-weight: 750;
}
.itensChips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 160px;
  overflow: auto;
  padding-right: 2px;
}

.itensMini.big .itensChips {
  max-height: 240px;
}
.itensChip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
  line-height: 1;
}
.itensQtd {
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.10);
  border: 1px solid rgba(255, 255, 255, 0.12);
  font-weight: 900;
}
@media (max-width: 680px) {
  .itensChips {
    max-height: 150px;
  }
}

.vendModal {
  width: min(520px, 94vw);
}
#ovVend {
  z-index: 9997;
}

.mobileBar {
  display: none;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  background: rgba(11, 15, 23, 0.92);
  backdrop-filter: blur(12px);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  gap: 10px;
  z-index: 20;
}
.mobileBar .btn {
  height: 44px;
  font-weight: 850;
  justify-content: center;
  flex: 1 1 0;
}
.mobileBar .mbMais {
  flex: 0 0 auto;
  min-width: 86px;
}
.vendQ {
  height: 38px;
  border-radius: 12px;
  margin-bottom: 10px;
}
.acoesBody {
  display: grid;
  gap: 10px;
}
.btnAcao {
  width: 100%;
  height: 46px;
  justify-content: flex-start;
  padding: 0 14px;
  font-weight: 750;
}
.ov.sheet {
  align-items: flex-end;
}
.ov.sheet .modal {
  width: min(620px, 96vw);
  max-height: 86vh;
}
@media (max-width: 920px) {
  .main {
    grid-template-columns: 1fr;
  }
  .sidebar {
    display: none;
  }
  .vendBtn {
    display: flex;
  }
  #acoes {
    display: inline-flex;
  }
  .top .left {
    height: auto;
    gap: 10px;
  }
  .top .left {
    flex-basis: 100%;
  }
  .top .right {
    flex-basis: 100%;
    justify-content: flex-start;
  }
  .badges {
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 2px;
  }
  .input {
    flex: 1 1 520px;
    min-width: 220px;
    max-width: none;
    width: 100%;
  }
  .radioBusca {
    flex: 1 1 100%;
    justify-content: flex-start;
  }
}

@media (max-width: 680px) {
  .top {
    grid-template-columns: 1fr;
    padding: 10px 12px;
    gap: 8px;
  }
  .top .left {
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 6px;
  }
  .top .right {
    gap: 8px;
    flex-wrap: wrap;
  }
  #acoes {
    display: inline-flex;
  }
  .btnProibidos {
    display: flex;
  }
  .badgeGeradoMobile {
    display: inline-flex;
  }
  .badges {
    flex: 1 1 100%;
    min-width: 0;
  }
  .badges .badgeHora {
    display: none;
  }
  #bDiaBrk {
    display: inline-flex;
  }
  .badge {
    font-size: 11px;
    padding: 5px 8px;
  }
  .input {
    min-width: 0;
    flex: 1 1 auto;
  }
  .radioBusca {
    width: 100%;
    justify-content: space-between;
    gap: 10px;
    overflow-x: auto;
  }
  .tableTop {
    padding: 10px;
    gap: 10px;
  }
  .btns {
    display: none;
  }
  table {
    display: none;
  }
  .cards {
    display: block;
    padding-bottom: calc(86px + env(safe-area-inset-bottom, 0px));
  }
  .mobileBar {
    display: flex;
  }
  .vendQ {
    display: none;
  }
  .cardHead {
    align-items: flex-start;
  }
  .cardNum,
  .cardTotal {
    font-size: 14px;
  }
  .cardMeta,
  .cardPay {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    overflow-wrap: anywhere;
  }
  .cardItens {
    overflow-wrap: anywhere;
  }
  .ov.sheet {
    padding: 12px;
    align-items: center;
  }
  .ov.sheet .modal {
    width: min(620px, 94vw);
    border-radius: 18px;
  }
}
@media (max-width: 420px) {
  .vendTxt {
    max-width: 140px;
  }
  .badges .badgeHora {
    display: none;
  }
  #bDiaBrk {
    display: inline-flex;
  }
  .mobileBar {
    gap: 8px;
    padding: 10px 10px calc(10px + env(safe-area-inset-bottom));
  }
  .mobileBar .btn {
    font-size: 12px;
  }
}
span#tDiaSel,span#tDiaGer,span#tDiaNfce {
  margin: 0 3px;
}
@media (max-width: 900px) {
  .top {
    grid-template-columns: 1fr;
  }
  .top .right {
    justify-content: flex-start;
  }
  .input {
    max-width: fit-content;
    width: 100%;
  }
}
.tdItemsWrap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  justify-content: center;
}
.tdItemChip {
  padding: 6px 7px 3px 7px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.09);
  font-size: 12px;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
.tdItemQtd {
  font-weight: 500;
  opacity: 0.78;
  margin-right: 5px;
  position: relative;
  top: -1px;
}
</style>
</head>
<body>
<div class="app">
<div class="top">
<div class="left">
<button id="btnVend" class="btn vendBtn" type="button" title="Vendedores"><span class="vendIcon">☰</span><span id="vendTopTxt" class="vendTxt">Todos</span></button>
<div class="badge badgeHora badgeGeradoMobile">Gerado em: ${escHtml(diaMesGeradaBR)}/${ano2} às ${escHtml(horaGeradaBR)}</div>
<div class="badges">
<div class="badge" title="Data dos dados desse relatório">Data: ${escHtml(dataBR)}</div>
<div class="badge badgeHora" title="Dia, hora e mês em que esse relatório foi gerado">Gerado em: ${escHtml(diaMesGeradaBR)}/${ano2} às ${escHtml(horaGeradaBR)}</div>
<div class="badge" title="Quantidade de vendas: Gerencial ― NFC-e">Gerencial: <span id="tQtdGer"></span> ― NFC-e: <span id="tQtdNfce"></span></div>
<div class="badge" id="bDiaBrk" title="Soma total de ambos ― Gerencial do dia ― NFC-e do dia">Total: <span id="tDiaSel"></span><span id="tDiaBrkMini"> ― Gerencial: <span id="tDiaGer"></span> ― NFC-e: <span id="tDiaNfce"></span></span></div>
</div>
</div>
<div class="right">
<input id="q" class="input" title="Buscar... Excluir: -termo (1) ou [termo,~contém,=igual,proibidos,-proibidos] (múltiplos)  |  Valor: >100, 10-20, 12*3, 12/3, 12?  |  Múltiplos: +  |  Soma: =151 ou =151*2" placeholder="Buscar... Excluir: -termo (1) ou [termo,~contém,=igual,proibidos,-proibidos] (múltiplos)  |  Valor: >100, 10-20, 12*3, 12/3, 12?  |  Múltiplos: +  |  Soma: =151 ou =151*2" autocomplete="off">
<div class="radioBusca" id="radioBusca" role="radiogroup" aria-label="Tipo da busca"><label><input type="radio" name="tipoBusca" value="todos" checked> Todos</label><label><input type="radio" name="tipoBusca" value="gerencial"> Gerencial</label><label><input type="radio" name="tipoBusca" value="nfce"> NFC-e</label></div>
<button id="acoes" class="btn" type="button" title="Ações">Ações</button>
<button id="ajuda" class="btn" type="button" title="Coringas disponíveis">?</button>
<button id="proibidos" class="btn btnProibidos" type="button">[Proibidos]</button>
<button id="limpar" class="btn" type="button">Limpar</button>
<button id="atualizar" class="btn" type="button" title="Gerar um novo relatório no servidor e atualizar">Atualizar</button>
</div>
</div>
<div class="main">
<div class="sidebar">
<div class="sb-head">
<div class="sb-title">Vendedores</div>
<div class="pill mono" id="vendSel">Todos</div>
</div>
<div class="list" id="lista"></div>
<div class="sbResumo" id="vendResumo"><div class="sb-head"><div class="sb-title">Total por vendedor</div></div><div class="sbResumoBody"></div></div>
</div>
<div class="content">
<div class="tableWrap">
<div class="tableTop">
<div class="tableTitle" id="sub">Todos os vendedores</div>
<div class="actions">
<div class="count" id="count"></div>
<div class="btns">
<div class="btn" id="copiarTudo">Copiar tudo</div>
<div class="btn" id="copiarTudoItens">Copiar tudo+itens</div>
<div class="btn" id="copiarSemDinheiro">Copiar sem dinheiro</div>
<div class="btn" id="copiarGerencial">Copiar só gerencial</div>
<div class="btn" id="editarProibidos">Editar proibidos</div>
</div>
</div>
</div>
<div class="cards" id="cards"></div>
<table>
<thead><tr>
<th>vendedor</th>
<th>tipo</th>
<th>número</th>
<th>total</th>
<th>forma de pagamento</th>
<th>itens</th>
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
<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;font-size: 12px;">
<div class="btn" id="copiarModalGer" style="display:none">Copiar só gerencial</div><div class="btn" id="copiarModalSemItens" style="display:none">Copiar sem itens</div><div class="btn" id="copiarModal" style="display:none">Copiar com itens</div>
<div class="btn" id="fechar">Fechar</div>
</div>
</div>
<div class="mbody" id="mBody"></div>
</div>
</div>
<div class="ov sheet" id="ovVend" aria-hidden="true">
<div class="modal vendModal" role="dialog" aria-modal="true">
<div class="mhead">
<div>
<div class="mtitle">Vendedores</div>
<div class="msub">Toque para filtrar.</div>
</div>
<div class="btn" id="vendFechar">Fechar</div>
</div>
<div class="mbody">
<input id="vendQ" class="input vendQ" placeholder="Buscar vendedor..." autocomplete="off">
<div class="list" id="listaVend"></div>
</div>
</div>
</div>

<div class="ov sheet" id="ovAcoes" aria-hidden="true">
<div class="modal acoesModal" role="dialog" aria-modal="true">
<div class="mhead">
<div>
<div class="mtitle">Ações</div>
<div class="msub">Copiar e ferramentas.</div>
</div>
<div class="btn" id="acoesFechar">Fechar</div>
</div>
<div class="mbody acoesBody">
<button class="btn btnAcao" id="aCopiarTudo" type="button">Copiar tudo</button>
<button class="btn btnAcao" id="aCopiarTudoItens" type="button">Copiar tudo + itens</button>
<button class="btn btnAcao" id="aCopiarSemDinheiro" type="button">Copiar sem dinheiro</button>
<button class="btn btnAcao" id="aCopiarGerencial" type="button">Copiar só gerencial</button>
<button class="btn btnAcao" id="aProibidos" type="button">Editar proibidos</button>
<button class="btn btnAcao" id="aVendedores" type="button">Escolher vendedor</button>
<button class="btn btnAcao" id="aAjuda" type="button">Ajuda / coringas</button>
<button class="btn btnAcao" id="aLimpar" type="button">Limpar filtro</button>
</div>
</div>
</div>
<div class="mobileBar" id="mobileBar">
<button class="btn mbBtn" id="mbCopiar" type="button">Copiar</button>
<button class="btn mbBtn" id="mbItens" type="button">+Itens</button>
<button class="btn mbBtn mbMais" id="mbMais" type="button">Mais</button>
</div>
<script id="dados" type="application/json">${dadosJSON}</script>
<script>
const qs=s=>document.querySelector(s);
const dadosEl=qs("#dados");
const DADOS=dadosEl?JSON.parse(dadosEl.textContent||"{}"):{vendas:[],vendedores:[],vendTotaisDia:[],totais:{qtd:0,total:0},totaisDia:{ok:false,gerencial:0,nfce:0,nfc:0,nfe:0,geral:0,selecionado:0,modelos:[]}};
if(!Array.isArray(DADOS.vendas))DADOS.vendas=[];
if(!Array.isArray(DADOS.vendedores))DADOS.vendedores=[];
if(!Array.isArray(DADOS.vendTotaisDia))DADOS.vendTotaisDia=[];
if(!DADOS.totais||typeof DADOS.totais!=="object")DADOS.totais={qtd:DADOS.vendas.length,total:DADOS.vendas.reduce((a,b)=>a+Number(b?.total||0),0)};
if(typeof DADOS.totais.qtd!=="number")DADOS.totais.qtd=DADOS.vendas.length;
if(typeof DADOS.totais.total!=="number")DADOS.totais.total=DADOS.vendas.reduce((a,b)=>a+Number(b?.total||0),0);
const fmt=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v||0));
const fmtCopia=v=>new Intl.NumberFormat("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false}).format(Number(v||0));
const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const LS_KEY="__cupons_proibidos__";
const LS_KEY_PROIB_IGN="__cupons_proibidos_ignorados__";
const LS_KEY_PROIB_IGN_DIA="__cupons_proibidos_ignorados_alerta_dia__";
const LS_KEY_PROIB_ALERTA_DIA="__cupons_proibidos_alerta_dia__";
const proibidosPadrao=["FARO","BIOFRESH","OPTIMUM","CIBAU","ATACAMA","GOLDEN","PIPICAT","SYNTEC",
"MITZI","ND CAES","ND GATOS","GRANPLUS","PEDIGREE","WHISKAS","PREMIER","GUABI","NATURAL CAES",
"NATURAL GATOS","PUTZ","GRANEL","ELANCO","VET LIFE","VETLIFE","KONIG","SAN REMO","SANREMO",
"FN CAE","FN CAO","FN GATO","FN VET","ORIGENS","FUNNY BUNNY","FUNNY BIRDY","SANOL","KELDOG",
"KDOG","MAGNUS","MAGNO","GENIAL","CANISTER","NATURAL SACHE, FN COOKIES, KITEKAT"];
const normP=v=>String(v||"").trim().toUpperCase().replace(/\s+/g," ");
const PROIB_FIXOS=["DESCONTO","<CANCELADO>","CANCELADO"];
const PROIB_FIXOS_N=new Set(PROIB_FIXOS.map(normP));
const uniq=a=>[...new Set(a)];
const escRe=s=>String(s||"").replace(/[-\/\\^$*+?.()|[\]{}]/g,"\\$&");
const lerProibidos=()=>{
const raw=String(localStorage.getItem(LS_KEY)||"").trim();
if(!raw)return proibidosPadrao.slice();
let arr=[];
if(raw.startsWith("[")){
const ms=raw.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g);
if(ms&&ms.length)arr=ms.map(s=>s.slice(1,-1).replace(/\\\"/g,'"'));
else arr=raw.replace(/[\[\]"]/g,"").split(",");
}else{
arr=raw.split(/\n|,/g);
}
const limpo=uniq(arr.map(normP).filter(Boolean));
return limpo.length?limpo:proibidosPadrao.slice();
};
const NL=String.fromCharCode(10),CR=String.fromCharCode(13),RS=String.fromCharCode(30),US=String.fromCharCode(31);
const hojeStr=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");};
const ordenarLista=a=>uniq((a||[]).map(normP).filter(Boolean)).sort((a,b)=>a.localeCompare(b,"pt-BR"));
const assLista=a=>ordenarLista(a).join(US);
const fazerDiffProib=(local,srv)=>{
const l=ordenarLista(local),s=ordenarLista(srv),setL=new Set(l),setS=new Set(s);
const soLocal=l.filter(v=>!setS.has(v)),soSrv=s.filter(v=>!setL.has(v)),merged=ordenarLista([...l,...s]);
return{local:l,srv:s,soLocal,soSrv,merged,ass:assLista(soLocal)+RS+assLista(soSrv)};
};
const lerProibIgn=()=>{
const raw=String(localStorage.getItem(LS_KEY_PROIB_IGN)||"");
if(!raw)return null;
const p=raw.split(RS);
return{ass:String(p[0]||""),soLocal:String(p[1]||"").split(US).map(normP).filter(Boolean),soSrv:String(p[2]||"").split(US).map(normP).filter(Boolean)};
};
const salvarProibIgn=diff=>localStorage.setItem(LS_KEY_PROIB_IGN,[String(diff&&diff.ass||""),assLista(diff&&diff.soLocal||[]),assLista(diff&&diff.soSrv||[])].join(RS));
const limparProibIgn=()=>{localStorage.removeItem(LS_KEY_PROIB_IGN);localStorage.removeItem(LS_KEY_PROIB_IGN_DIA);};
const jaAlertouProibHoje=()=>String(localStorage.getItem(LS_KEY_PROIB_ALERTA_DIA)||"")===hojeStr();
const marcarAlertaProibHoje=()=>localStorage.setItem(LS_KEY_PROIB_ALERTA_DIA,hojeStr());
const leuAlertaIgnHoje=ass=>String(localStorage.getItem(LS_KEY_PROIB_IGN_DIA)||"")===ass+RS+hojeStr();
const marcarAlertaIgnHoje=ass=>localStorage.setItem(LS_KEY_PROIB_IGN_DIA,ass+RS+hojeStr());
const abrirConflitoProibidos=(diff,onMerge,onKeep)=>{
qs("#ovProibMerge")?.remove();
const bloco=(titulo,arr)=>'<div style="border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px;background:rgba(255,255,255,.03)"><div style="font-weight:700;margin-bottom:6px">'+esc(titulo)+' ('+arr.length+')</div><div style="max-height:160px;overflow:auto;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,&quot;Liberation Mono&quot;,&quot;Courier New&quot;,monospace;font-size:12px">'+esc(arr.length?arr.join(NL):"-")+'</div></div>';
const bg=document.createElement("div");
bg.className="ov on";
bg.id="ovProibMerge";
bg.setAttribute("aria-hidden","false");
bg.innerHTML='<div class="modal" role="dialog" aria-modal="true"><div class="mhead"><div><div class="mtitle">Alterações nos proibidos</div><div class="msub">Foram encontradas diferenças entre esta máquina e o servidor. Você quer dar merge ou deixar como está?</div></div><div class="btn" id="pmFechar">Fechar</div></div><div class="mbody"><div style="display:grid;gap:10px">'+bloco("Só nesta máquina",diff.soLocal)+bloco("Só no servidor",diff.soSrv)+'</div><div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px"><div class="btn" id="pmManter">Deixar como está</div><div class="btn" id="pmMesclar">Dar merge</div></div></div></div>';
document.body.appendChild(bg);
const fechar=()=>bg.remove();
const manter=()=>{fechar();onKeep&&onKeep();};
const mesclar=()=>{fechar();onMerge&&onMerge();};
qs("#pmFechar",bg).addEventListener("click",manter);
qs("#pmManter",bg).addEventListener("click",manter);
qs("#pmMesclar",bg).addEventListener("click",mesclar);
bg.addEventListener("click",e=>{if(e.target===bg)manter();});
document.addEventListener("keydown",function escKey(e){if(e.key==="Escape"){document.removeEventListener("keydown",escKey);manter();}});
};
const avisarProibIgnorado=diff=>{
if(!diff||!diff.ass||jaAlertouProibHoje())return;
marcarAlertaProibHoje();
marcarAlertaIgnHoje(diff.ass);
toast("Proibidos ignorados","Há alterações ignoradas entre esta máquina e o servidor. Abra Proibidos para revisar quando quiser.");
};
let valoresProibidos=lerProibidos();
let reProibidos=new RegExp(valoresProibidos.map(escRe).join("|"),"i");
const setProibidosUser=(lista,semSync)=>{
const limpo=uniq((lista||[]).map(normP).filter(Boolean));
localStorage.setItem(LS_KEY,limpo.join(NL));
valoresProibidos=lerProibidos();
reProibidos=new RegExp(valoresProibidos.map(escRe).join("|"),"i");
if(!semSync)syncProibidos(true);
};
let proibSyncPend=0;
const parseProib=v=>{
let s=Array.isArray(v)?v.join(NL):String(v||"");
if(!s)return [];
s=s.split(CR).join("").split(",").join(NL);
return uniq(s.split(NL).map(normP).filter(Boolean));
};
const postarProibidos=lista=>{
const h={"Content-Type":"text/plain; charset=utf-8"};
const k=String(DADOS&&DADOS.srv_key||"").trim();
if(k)h["x-key"]=k;
const body=ordenarLista(lista).join(NL);
return fetch("/__proibidos",{method:"POST",headers:h,body,cache:"no-store"}).then(r=>r&&r.ok?r.json():null,()=>null).then(j=>parseProib(j&&j.lista),()=>[]);
};
function syncProibidos(push){
if(location.protocol!=="http:"&&location.protocol!=="https:")return;
if(proibSyncPend)return;
proibSyncPend=1;
const local=lerProibidos();
fetch("/__proibidos",{cache:"no-store"}).then(r=>r&&r.ok?r.json():{ok:false,lista:[]},()=>({ok:false,lista:[]})).then(j=>{
const srv=parseProib(j&&j.lista);
const diff=fazerDiffProib(local,srv);
if(!diff.soLocal.length&&!diff.soSrv.length){
limparProibIgn();
proibSyncPend=0;
return;
}
const ign=lerProibIgn();
if(ign&&ign.ass===diff.ass){
avisarProibIgnorado(diff);
proibSyncPend=0;
return;
}
if(jaAlertouProibHoje()){
proibSyncPend=0;
return;
}
marcarAlertaProibHoje();
abrirConflitoProibidos(diff,()=>{
limparProibIgn();
setProibidosUser(diff.merged,true);
postarProibidos(diff.merged).then(srv2=>{
const diff2=fazerDiffProib(diff.merged,srv2);
if(diff2.soLocal.length||diff2.soSrv.length)setProibidosUser(diff2.merged,true);
proibSyncPend=0;
});
},()=>{
salvarProibIgn(diff);
marcarAlertaIgnHoje(diff.ass);
toast("Proibidos","Alterações ignoradas. Vou lembrar novamente amanhã.");
proibSyncPend=0;
});
},()=>{proibSyncPend=0;});
}
syncProibidos(false);
window.addEventListener("focus",()=>syncProibidos(false));
document.addEventListener("visibilitychange",()=>{if(!document.hidden)syncProibidos(false);});
const limparItensVisuais=it=>{
const s=String(it||"");
if(!s)return"";
const linhas=s.split(/\n+/g).map(p=>String(p||"").trim()).filter(Boolean);
const lim=[];
for(let p of linhas){
p=p.replace(/^⤷\s*/,"").replace(/^╰┈/,"").trim();
let linha=p.replace(/^\s+/,"");
const mm=linha.match(/^(\d+[\d,]*x)\s*(.*)$/i);
if(mm)linha=(mm[1]+" "+(mm[2]||"")).trim();
const base=normP(linha.replace(/^\d+[\d,]*x\s*/i,"").trim());
if(PROIB_FIXOS_N.has(base))continue;
lim.push("⤷ "+linha);
}
return lim.join("\n");
};
const itensListaCopia=it=>{
const t=String(limparItensVisuais(it)||"").trim();
if(!t)return"";
const linhas=t.split(/\n+/g).map(s=>String(s||"").replace(/^⤷\s*/,"").trim()).filter(Boolean);
const seen=new Set();
const out=[];
for(let l of linhas){
l=l.replace(/^\d+[\d,]*x\s*/i,"").trim();
if(!l||l==="…"||l==="...")continue;
const k=normP(l);
if(!k||seen.has(k))continue;
seen.add(k);
out.push(l);
}
return out.join("╰─╮");
};
const numQtd=s=>{
s=String(s||"").trim();
if(!s)return 0;
s=s.replace(/\s+/g,"").replace(/\./g,"").replace(",",".");
const n=Number(s);
return Number.isFinite(n)?n:0;
};
const fmtQtdUI=n=>{
const v=Number(n||0);
if(!Number.isFinite(v)||v<=0)return"1";
const r=Math.round(v);
if(Math.abs(v-r)<1e-9)return String(r);
let s=v.toFixed(3);
s=s.replace(/0+$/,"").replace(/\.$/,"");
return s.replace(".",",");
};
const agruparItensUI=it=>{
const t=String(limparItensVisuais(it)||"").trim();
if(!t)return{total:0,unicos:0,itens:[]};
const linhas=t.split(/\n+/g).map(s=>String(s||"").replace(/^⤷\s*/,"").trim()).filter(Boolean);
let total=0;
const mp=new Map();
for(let l of linhas){
if(!l||l==="…"||l==="...")continue;
total++;
let nome=l;
let qtd=1;
const mm=l.match(/^(\d+(?:[\.,]\d+)?)x\s*(.*)$/i);
if(mm){
qtd=numQtd(mm[1]);
nome=String(mm[2]||"").trim()||nome;
if(!qtd)qtd=1;
}
const k=normP(nome);
if(!k)continue;
if(!mp.has(k))mp.set(k,{nome:nome,qtd:0});
mp.get(k).qtd+=qtd;
}
const itens=[...mp.values()].sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR",{sensitivity:"base"})).map(o=>({nome:o.nome,qtd:fmtQtdUI(o.qtd)+"x"}));
return{total:total,unicos:itens.length,itens:itens};
};
const itensMiniHTML=(it,grande)=>{
const g=agruparItensUI(it);
if(!g.itens.length)return"";
let chips="";
for(const x of g.itens)chips+='<span class="itensChip"><span class="itensQtd mono">'+esc(x.qtd)+'</span>'+esc(x.nome)+'</span>';
return'<div class="itensMini'+(grande?' big':'')+'"><div class="itensMiniHead mono"><span>Itens</span><span class="sub">'+esc(g.total+" total • "+g.unicos+" únicos")+'</span></div><div class="itensChips">'+chips+'</div></div>';
};

const linhaCopiaItens=x=>{
const itens=itensListaCopia(x?.itens);
const forma=limparPagamentoCopia(x?.pagamentos||"");
const parts=forma.split("|").map(s=>normP(s)).filter(Boolean);
const extraTab=(parts.includes("DEBITO")||parts.includes("PIX")||parts.includes("DINHEIRO"))?"\t":"";
return String(x?.numero||"")+"\t"+fmtCopia(x?.total||0)+"\t"+forma+"\t"+extraTab+(itens||"");
};
const linhaCopiaSemItens=x=>{
const forma=limparPagamentoCopia(x?.pagamentos||"");
return String(x?.numero||"")+"\t"+fmtCopia(x?.total||0)+"\t"+forma;
};

const vendaTemProibido=x=>{
if(!reProibidos)return false;
const t=String(x?.itens||"");
return reProibidos.test(t);
};
const abrirVendedores=()=>{
const ov=qs("#ovVend");
if(!ov)return;
ov.classList.add("on");
ov.setAttribute("aria-hidden","false");
vendFiltro="";
const q=qs("#vendQ");
if(q){q.value="";if(!window.matchMedia("(max-width:680px)").matches)q.focus();}
};
const fecharVendedores=()=>{
const ov=qs("#ovVend");
if(!ov)return;
ov.classList.remove("on");
ov.setAttribute("aria-hidden","true");
vendFiltro="";
const q=qs("#vendQ");
if(q)q.value="";
};
const abrirAcoes=()=>{
const ov=qs("#ovAcoes");
if(!ov)return;
ov.classList.add("on");
ov.setAttribute("aria-hidden","false");
};
const fecharAcoes=()=>{
const ov=qs("#ovAcoes");
if(!ov)return;
ov.classList.remove("on");
ov.setAttribute("aria-hidden","true");
};
const abrirEditorProibidos=()=>{
qs("#ovProib")?.remove();
const bg=document.createElement("div");
bg.className="ov on";
bg.id="ovProib";
bg.setAttribute("aria-hidden","false");
bg.innerHTML='<div class="modal" role="dialog" aria-modal="true"><div class="mhead"><div><div class="mtitle">Proibidos</div><div class="msub">Um por linha ou separado por vírgula. Salva no localStorage. </div></div><div class="btn" id="prFechar">Fechar</div></div><div class="mbody"><textarea id="prTa" spellcheck="false" style="width:100%;height:260px;resize:vertical;border-radius:14px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);color:#e6eaf2;padding:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,&quot;Liberation Mono&quot;,&quot;Courier New&quot;,monospace;font-size:12px;outline:none"></textarea><div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><div class="btn" id="prCancelar">Restaurar padrão</div><div class="btn" id="prSalvar">Salvar</div></div></div></div>';
document.body.appendChild(bg);
const ta=qs("#prTa",bg);
ta.value=valoresProibidos.join("\n");
const fechar=()=>bg.remove();
qs("#prFechar",bg).addEventListener("click",fechar);
qs("#prCancelar",bg).addEventListener("click",()=>{setProibidosUser(proibidosPadrao);ta.value=proibidosPadrao.join("\n");fechar();renderTabela();toast("Proibidos","Restaurado padrão.");});
qs("#prSalvar",bg).addEventListener("click",()=>{
const lista=String(ta.value||"").split(/\n|,/g).map(normP).filter(Boolean);
setProibidosUser(lista);
fechar();
renderTabela();
toast("Proibidos","Lista atualizada.");
});
bg.addEventListener("click",e=>{if(e.target===bg)fechar();});
document.addEventListener("keydown",function escKey(e){if(e.key==="Escape"){document.removeEventListener("keydown",escKey);fechar();}});
};let vendAtual="",vendFiltro="",qAtual="",qInc="",qIgn=[],qValor=false,tipoBusca="todos",linhaAtual=null,somaSel=null,somaKey="";
const tipoLinhaOk=x=>tipoBusca==="todos"||tipoBusca==="gerencial"&&Number(x&&x.modelo||0)===99||tipoBusca==="nfce"&&Number(x&&x.modelo||0)===65;
const copiarTexto=txt=>{
const fallback=()=>{
const ta=document.createElement("textarea");
ta.value=txt;
ta.setAttribute("readonly","");
ta.style.position="fixed";
ta.style.left="0";
ta.style.top="0";
ta.style.width="1px";
ta.style.height="1px";
ta.style.opacity="0";
ta.style.pointerEvents="none";
document.body.appendChild(ta);
if(ta.focus)ta.focus({preventScroll:true});
ta.select();
ta.setSelectionRange(0,ta.value.length);
document.execCommand("copy");
ta.remove();
};
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).catch(fallback);
else fallback();
};
const __ncToastMsgs=new Set();
const showToast=message=>{
if(!message)return;
const msg=String(message);
if(__ncToastMsgs.has(msg))return;
__ncToastMsgs.add(msg);
const dur=5000;
if(!document.getElementById("__nc_toast_css")){
const st=document.createElement("style");
st.id="__nc_toast_css";
st.textContent=".__nc_toast_box{position:fixed;top:16px;left:16px;z-index:2147483647!important;display:flex;flex-direction:column;gap:10px;max-width:50vw;width:fit-content;pointer-events:none}@media (max-width:720px){.__nc_toast_box{max-width:92vw}}.__nc_toast{pointer-events:auto;z-index:2147483647!important;border: 1px solid rgb(96 139 193 / 64%);background: linear-gradient(180deg, #0b0f17, #0f131b);box-shadow: -2px 1px 15px rgb(92 134 189);color:#e6eaf2;border-radius:14px;padding:10px 34px 16px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;font-weight:650;font-size:13px;line-height:1.35;position:relative;opacity:0;transform:translateX(-18px);transition:opacity .18s ease,transform .18s ease;overflow:hidden;white-space:normal;word-break:break-word;overflow-wrap:anywhere}.__nc_toast.__on{opacity:1;transform:translateX(0)}.__nc_toast_x{position:absolute;top:8px;right:8px;width:18px;height:18px;border-radius:9px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#e6eaf2;font-weight:800;font-size:10px;cursor:pointer;padding:0;display:grid;place-items:center}.__nc_toast_x:hover{background:rgba(255,255,255,.10)}.__nc_toast a{color:rgba(120,180,255,.95);text-decoration:none}.__nc_toast a:hover{text-decoration:underline}.__nc_toast_bar{position:absolute;left:10px;right:10px;bottom:8px;height:3px;border-radius:999px;background:rgba(255,255,255,.10);overflow:hidden}.__nc_toast_bar i{display:block;height:100%;width:100%;background:linear-gradient(90deg,rgba(120,180,255,.85),rgba(120,180,255,.25));transform-origin:left;transform:scaleX(1);animation:__nc_toast_bar var(--dur) linear forwards}@keyframes __nc_toast_bar{to{transform:scaleX(0)}}";
(document.head||document.documentElement).appendChild(st);
}
let box=document.querySelector(".__nc_toast_box");
if(!box){
box=document.createElement("div");
box.className="__nc_toast_box";
(document.body||document.documentElement).appendChild(box);
}
const el=document.createElement("div");
el.className="__nc_toast";
const html=msg.replace(/https?:\/\/[^\s]+/g,u=>'<a href="'+u+'" target="_blank" rel="noreferrer noopener">'+u+'</a>').replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ");
el.style.setProperty("--dur",dur+"ms");
el.innerHTML='<div>'+html+'</div><button class="__nc_toast_x" aria-label="Fechar">✕</button><div class="__nc_toast_bar"><i></i></div>';
const rm=()=>{
if(!el.isConnected)return;
el.remove();
__ncToastMsgs.delete(msg);
};
el.querySelector("button").addEventListener("click",rm);
box.appendChild(el);
requestAnimationFrame(()=>el.classList.add("__on"));
setTimeout(rm,dur);
};
const toast=(titulo,desc)=>{
const t=String(titulo||"").trim();
const d=String(desc||"").trim();
const msg=t&&d?(t+" — "+d):(t||d);
showToast(msg);
};
const semWS=s=>{
let o="";
for(const ch of String(s||"")){
const c=ch.charCodeAt(0);
if((c>32&&c!==160)||ch===","||ch==="."||ch==="-"||ch==="+"||ch==="*"||ch==="/"||ch==="?"||ch==="="||((ch>="0"&&ch<="9")))o+=ch;
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
if((ch>="0"&&ch<="9")||ch==="*"||ch==="/"||ch==="?"||ch===","||ch===".")o+=ch;
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
if((sx.indexOf("*")>=0||sx.indexOf("/")>=0||sx.indexOf("?")>=0)&&temDigito(sx))return true;
const dash=sx.indexOf("-");
if(dash>0&&dash<sx.length-1&&temDigito(sx))return true;
if(/^\d+$/.test(sx)&&sx[0]!=="0"&&sx.length<=4)return true;
return false;
};
const parseBusca=raw=>{
const expandAbrev=s=>s.replace(/\[1p\]/gi,"[proibidos]").replace(/\[-p\]/gi,"[-proibidos]");
const s=expandAbrev(String(raw||"").trim());
if(!s)return{inc:"",ign:[],proibidos:false,proibidosModo:0};
let inc=s,ign=[],proibidos=false,proibidosModo=0;let temColchetes=false;
const rx=/\[([^\]]*)\]/g;
let mm;
const pushTerm=term=>{
let t=String(term||"").trim();
if(!t)return;
t=t.replace(/^"+|"+$/g,"");
if(!t)return;
const n=normP(t);
if(n==="PROIBIDOS"){proibidos=true;proibidosModo=1;return;}if(n==="-PROIBIDOS"){proibidos=false;proibidosModo=2;return;}
let modo="inc";
if(t[0]==="~"){modo="cont";t=t.slice(1).trim();}
else if(t[0]==="="){modo="eq";t=t.slice(1).trim();}
t=normP(t);
if(!t)return;
ign.push({modo,t});
};
while((mm=rx.exec(s))){
temColchetes=true;
const inner=String(mm[1]||"");
for(const part of inner.split(","))pushTerm(part);
}
const sl=s.toLowerCase();if(sl.indexOf("[-proibidos]")>=0){proibidos=false;proibidosModo=2;}else if(sl.indexOf("[proibidos]")>=0){proibidos=true;proibidosModo=1;}
if(temColchetes||proibidosModo)inc=inc.replace(/\[[^\]]*\]/g," ").trim();
const m=inc.match(/^(.*)\((.*)\)\s*$/);
if(m){
inc=String(m[1]||"").trim();
for(const part of String(m[2]||"").split(","))pushTerm(part);
}
return{inc:inc.trim(),ign,proibidos,proibidosModo};
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
const temCoringa=(sx.indexOf("*")>=0||sx.indexOf("/")>=0||sx.indexOf("?")>=0)&&temDigito(sx);
const tStr=fmtCopia(total);
const full=tStr;
const inteiro=full.split(",")[0]||full;
if(temCoringa){
const partes=sx.split("+").map(p=>p.trim()).filter(Boolean);
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
const p=parseSomaQuery(qInc||qAtual);
if(!p){somaSel=null;somaKey="";return;}
const key=(vendAtual||"")+"|"+p.alvo+"|"+p.tol;
if(key===somaKey&&somaSel)return;
somaKey=key;
const itens=[];
for(let i=0;i<DADOS.vendas.length;i++){
const x=DADOS.vendas[i];
if(!tipoLinhaOk(x))continue;
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
if(!tipoLinhaOk(x))return false;
if(vendAtual&&x.vendedor!==vendAtual)return false;
const raw=String(qAtual||"").trim();
if(!raw)return true;
const p=parseBusca(raw);
const q=String(p.inc||"").trim();
const pm=p.proibidosModo||0;if(pm===1&&vendaTemProibido(x))return false;if(pm===2&&!vendaTemProibido(x))return false;
let hayN="",toks=null;
const ign=p.ign||[];
if(ign.length){
hayN=normP((x.vendedor||"")+" "+(x.tipo||"")+" "+(x.pagamentos||"")+" "+(x.itens||"")+" "+(x.caixa||"")+" "+(x.numero||"")+" "+String(x.total||""));
toks=hayN.split(" ").filter(Boolean);
for(const o of ign){
const term=normP(o?.t||"");
if(!term)continue;
if(o.modo==="eq"){
if(hayN===term)return false;
if(toks.includes(term))return false;
if(normP(x.vendedor||"")===term||normP(x.pagamentos||"")===term||normP(x.caixa||"")===term||normP(x.numero||"")===term||normP(String(x.total||""))===term||normP(String(x.itens||""))===term)return false;
}else if(o.modo==="cont"){
if(hayN.indexOf(term)>=0)return false;
}else{
if(toks.includes(term))return false;
}
}
}
if(!q)return true;
if(q.startsWith("="))return !!(somaSel&&somaSel.sel&&somaSel.sel.has(i));const parts=q.split("+").map(v=>String(v||"").trim()).filter(Boolean);
const incParts=[],excParts=[];
for(const part of parts){
if(part[0]==="-"&&part.length>1){excParts.push(part.slice(1).trim());}
else{
let splitIdx=-1;
for(let ci=1;ci<part.length;ci++){if(part[ci]==="-"&&!/\d/.test(part[ci+1]||"")){splitIdx=ci;break;}}
if(splitIdx>0){const base=part.slice(0,splitIdx).trim();const rest=part.slice(splitIdx+1);if(base)incParts.push(base);for(const ex of rest.split("-").map(s=>s.trim()).filter(Boolean))excParts.push(ex);}
else incParts.push(part);
}
}
const camposTxt=((x.vendedor||"")+" "+(x.tipo||"")+" "+(x.pagamentos||"")+" "+(x.itens||"")+" "+(x.caixa||"")+" "+(x.numero||"")).toLowerCase();
const totalNum=Number(x.total||0);
if(excParts.length){
if(!toks){hayN=normP((x.vendedor||"")+" "+(x.tipo||"")+" "+(x.pagamentos||"")+" "+(x.itens||"")+" "+(x.caixa||"")+" "+(x.numero||"")+" "+String(x.total||""));toks=hayN.split(" ").filter(Boolean);}
for(const ex of excParts){
let et=String(ex||"").trim();
if(!et)continue;
let modo="tok";
if(et[0]==="~"){modo="cont";et=et.slice(1).trim();}
else if(et[0]==="="){modo="eq";et=et.slice(1).trim();}
if(!et)continue;
if(consultaPareceValor(et)){
const ok=valorOk(et,totalNum);
if(ok===true)return false;
}else{
const term=normP(et);
if(!term)continue;
if(modo==="eq"){
if(hayN===term)return false;
if(toks.includes(term))return false;
if(normP(x.vendedor||"")===term||normP(x.pagamentos||"")===term||normP(x.caixa||"")===term||normP(x.numero||"")===term||normP(String(x.total||""))===term||normP(String(x.itens||""))===term)return false;
}else if(modo==="cont"){
if(hayN.indexOf(term)>=0)return false;
}else{
if(toks.includes(term))return false;
}
}
}
}
if(!incParts.length)return true;
if(incParts.length>1){
for(const part of incParts){
const ptxt=String(part||"").trim();
if(!ptxt)continue;
if(consultaPareceValor(ptxt)){
const ok=valorOk(ptxt,totalNum);
if(ok!==true)return false;
}else{
const ql=ptxt.toLowerCase();
if(camposTxt.indexOf(ql)<0)return false;
}
}
return true;
}
const q1=String(incParts[0]||"").trim();
if(!q1)return true;
const ql=q1.toLowerCase();
if((x.vendedor||"").toLowerCase().indexOf(ql)>=0||(x.pagamentos||"").toLowerCase().indexOf(ql)>=0||(x.itens||"").toLowerCase().indexOf(ql)>=0||(x.caixa||"").toLowerCase().indexOf(ql)>=0||(!qValor&&(x.numero||"").toLowerCase().indexOf(ql)>=0))return true;
const ok=valorOk(q1,totalNum);
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
const montarTextoCopia=(ignorarDinheiro,ignorarProibidos)=>{
const filtradas=DADOS.vendas.filter((x,i)=>passaFiltro(x,i)).filter(x=>(!ignorarDinheiro||!temDinheiro(x))&&(!ignorarProibidos||!vendaTemProibido(x)));
const montarBloco=(nome,arr)=>{
let out=nome+":\n";
for(const x of arr)out+=String(x.numero||"")+"\t"+fmtCopia(x.total||0)+"\t"+limparPagamentoCopia(x.pagamentos||"")+"\n";
const r=resumo(arr.filter(x=>!ignorarDinheiro||!temDinheiro(x)));
if(r)out+="\n"+r+"\n";
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
for(const v of vendes)out+=montarBloco(v,map.get(v))+"\n\n";
return out.trim();
};
const montarTextoCopiaItens=(ignorarDinheiro,ignorarProibidos)=>{
const filtradas=DADOS.vendas.filter((x,i)=>passaFiltro(x,i)).filter(x=>(!ignorarDinheiro||!temDinheiro(x))&&(!ignorarProibidos||!vendaTemProibido(x)));
const montarBloco=(nome,arr)=>{
let out=nome+":\n";
for(const x of arr)out+=linhaCopiaItens(x)+"\n";
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
for(const v of vendes)out+=montarBloco(v,map.get(v))+"\n\n";
return out.trim();
};

const renderLista=()=>{
const base=DADOS.vendas.filter(tipoLinhaOk);
const porVend=new Map();
let qtdBase=0,totalBase=0;
for(const x of base){
const nome=String(x&&x.vendedor||"").trim()||"(sem vendedor)";
if(!porVend.has(nome))porVend.set(nome,{vendedor:nome,qtd:0,total:0});
const it=porVend.get(nome);
it.qtd++;
it.total+=Number(x&&x.total||0);
qtdBase++;
totalBase+=Number(x&&x.total||0);
}
const vendedores=[...porVend.values()].sort((a,b)=>a.vendedor.localeCompare(b.vendedor,"pt-BR",{sensitivity:"base"}));
const mk=(root,apos,filtro)=>{
if(!root)return;
root.innerHTML="";
const f=String(filtro||"").trim().toLowerCase();
const add=(nome,qtd,total,sel,click)=>{
const div=document.createElement("div");
div.className="item"+(sel?" sel":"");
div.addEventListener("click",()=>{click();if(apos)apos();});
div.innerHTML='<div class="nome">'+esc(nome)+'</div><div class="meta"><div class="qtd">Vendas: '+qtd+'</div><div class="tot">'+esc(fmt(total))+'</div></div>';
root.appendChild(div);
};
add("Todos",qtdBase,totalBase,!vendAtual,()=>{vendAtual="";calcSomaSel();renderTudo();});
for(const v of vendedores){
if(f&&String(v.vendedor||"").toLowerCase().indexOf(f)<0)continue;
add(v.vendedor,v.qtd,v.total,vendAtual===v.vendedor,()=>{vendAtual=v.vendedor;calcSomaSel();renderTudo();});
}
};
mk(qs("#lista"),null,"");
mk(qs("#listaVend"),fecharVendedores,vendFiltro);
};
const renderResumoVend=()=>{
const el=qs("#vendResumo");
if(!el)return;
let head=el.querySelector(".sb-head");
if(!head){
head=document.createElement("div");
head.className="sb-head";
head.innerHTML='<div class="sb-title">Total por vendedor</div>';
el.prepend(head);
}
let body=el.querySelector(".sbResumoBody");
if(!body){
body=document.createElement("div");
body.className="sbResumoBody";
el.appendChild(body);
}
const arr=Array.isArray(DADOS.vendTotaisDia)?DADOS.vendTotaisDia:[];
if(!arr.length){body.innerHTML='<div style="opacity:.75;padding:6px 2px">Sem dados hoje</div>';return;}
let h="";
for(const x of arr){
const nome=String(x&&x.vendedor||"").trim()||"(sem vendedor)";
const g=Number(x&&x.gerencial||0)||0;
const n=Number(x&&x.nfce||0)||0;
const t=(Number(x&&x.geral||0)||0)|| (g+n);
h+='<div class="rv" title="Gerencial: '+esc(fmt(g))+' · NFC-e: '+esc(fmt(n))+'"><div class="n">'+esc(nome)+':</div><div class="v">'+esc(fmt(t))+'</div></div>';
}
body.innerHTML=h;
};
const abrirModal=x=>{
linhaAtual=x;
qs("#mTitulo").textContent="Gerencial "+(x.numero||"");
qs("#mSub").textContent="Vendedor: "+(x.vendedor||"")+(x.caixa?(" | Caixa: "+x.caixa):"");
const body=qs("#mBody");
body.innerHTML="";
const mk=(k,v)=>{
const d=document.createElement("div");
d.className="kv";
const kk=document.createElement("div");
kk.className="k";
kk.textContent=k;
const vv=document.createElement("div");
vv.className="v mono";
vv.textContent=String(v??"");
d.appendChild(kk);
d.appendChild(vv);
return d;
};
body.appendChild(mk("Tipo",String(x.tipo==="nfc-e"?"NFC-e":"Gerencial")));
body.appendChild(mk("Número",String(x.numero||"")));
body.appendChild(mk("Caixa",String(x.caixa||"")));
body.appendChild(mk("Total",fmt(x.total||0)));
body.appendChild(mk("Formas",String(x.pagamentos||"")));
const itensTxt=String(limparItensVisuais(x.itens)||"").trim();
const itensBox=document.createElement("div");
itensBox.innerHTML=itensMiniHTML(x.itens,true);
const kv=document.createElement("div");
kv.className="kv";
const kk=document.createElement("div");
kk.className="k";
kk.textContent="Itens";
const vv=document.createElement("div");
vv.className="v";
vv.appendChild(itensBox);
kv.appendChild(kk);
kv.appendChild(vv);
body.appendChild(kv);
const b=qs("#copiarModal");if(b)b.style.display="flex";const b1=qs("#copiarModalGer");if(b1)b1.style.display="flex";const b2=qs("#copiarModalSemItens");if(b2)b2.style.display="flex";
qs("#ov").classList.add("on");
qs("#ov").setAttribute("aria-hidden","false");
};
const fecharModal=()=>{
qs("#ov").classList.remove("on");
qs("#ov").setAttribute("aria-hidden","true");
const b=qs("#copiarModal");if(b)b.style.display="none";const b1=qs("#copiarModalGer");if(b1)b1.style.display="none";const b2=qs("#copiarModalSemItens");if(b2)b2.style.display="none";
linhaAtual=null;
};
const abrirAjuda=()=>{
linhaAtual=null;
const b=qs("#copiarModal");if(b)b.style.display="none";const b1=qs("#copiarModalGer");if(b1)b1.style.display="none";const b2=qs("#copiarModalSemItens");if(b2)b2.style.display="none";
qs("#mTitulo").textContent="Coringas disponíveis";
qs("#mSub").textContent="Use no campo de busca para filtrar por valor e/ou excluir termos.";
const body=qs("#mBody");
body.innerHTML="";
const add=(k,v)=>{const d=document.createElement("div");d.className="kv";d.innerHTML='<div class="k">'+k+'</div><div class="v">'+v+'</div>';body.appendChild(d);};
add("[proibidos] ou [1p]","Use a tecla Insert ou Capslock + P para adicionar [proibidos] ao buscar e aplicar o filtro para ocultar vendas com itens proibidos");
add("[-proibidos] ou [-p]","Use a tecla Delete para adicionar [-proibidos] ao buscar e aplicar o filtro para mostrar vendas com itens proibidos");
add("[a,~b,=c]","exclusão: a=inclui (token), ~b=contém (substring), =c=igual 100%. Use [proibidos] para ocultar vendas com itens proibidos. Use [-proibidos] para mostrar vendas com itens proibidos, multiplas exclusões separadas por vírgula.");
add("> ou >=","> valores maiores que, >= valores maiores que ou igual, exclusao use - (menos) (ex: >100-pix-credito-debito)");
add("< ou <=","< valores menores que, <= valores menores que ou igual, exclusao use - (menos) (ex: <150-granel-gerencia-cartao)");
add("*","1+ dígitos e/ou vírgula (pode atravessar a vírgula) — casa do começo do valor");
add("/","1+ dígitos (somente antes da vírgula) — procura dentro da parte inteira");
add("?","exatamente 1 dígito (parte inteira) — procura dentro da parte inteira");
add("=151 ou =151*num","combinação aproximada para somar até 151, combinação aproximada para somar até 151 ± adicional opcional");
add("+","múltiplos filtros (ex: >50+CARTAO+-VENDEDOR) use sempre + para multiplas pesquisas");
add("Rádio ao lado da busca","Escolha Todos, Gerencial ou NFC-e para aplicar a pesquisa somente no tipo selecionado");
qs("#ov").classList.add("on");
qs("#ov").setAttribute("aria-hidden","false");
};
const itensTdHTML=itensRaw=>{
const t=String(limparItensVisuais(itensRaw)||"").trim();
if(!t)return{html:"",title:""};
const linhas=t.split(/\n+/g).map(s=>String(s||"").replace(/^⤷\s*/,"").trim()).filter(Boolean);
let html='<div class="tdItemsWrap">';
const tituloPartes=[];
for(const l of linhas){
const mm=l.match(/^(\d+(?:[,\.]\d+)?)x\s+(.+)$/i);
if(mm){
const qtd=mm[1].replace(".",",");
const nome=String(mm[2]||"").trim();
html+='<span class="tdItemChip" title="'+esc(nome)+'"><span class="tdItemQtd mono">'+esc(qtd+"x")+'</span>'+esc(nome)+'</span>';
tituloPartes.push(qtd+"x "+nome);
}else{
html+='<span class="tdItemChip">'+esc(l)+'</span>';
tituloPartes.push(l);
}
}
html+='</div>';
return{html,title:tituloPartes.join(" • ")};
};
const renderTabela=()=>{
const tb=qs("#tb");
if(tb)tb.innerHTML="";
const cards=qs("#cards");
if(cards)cards.innerHTML="";
const filtradas=DADOS.vendas.filter((x,i)=>passaFiltro(x,i));
let soma=0;
for(const x of filtradas)soma+=Number(x.total||0);
const q=String(qAtual||"").trim();
qs("#count").textContent=somaSel&&q.startsWith("=")?(filtradas.length+" vendas ― soma "+fmt(soma)+" ― alvo "+fmt(somaSel.alvo)+(somaSel.tol?(" ± "+fmt(somaSel.tol)):"")):(filtradas.length+" vendas ― "+fmt(soma));
const frag=document.createDocumentFragment();
const fragC=document.createDocumentFragment();
for(const x of filtradas){
if(tb){
const tr=document.createElement("tr");
tr.addEventListener("click",()=>abrirModal(x));
const itensInfo=itensTdHTML(x.itens);
tr.innerHTML='<td>'+esc(x.vendedor||"")+'</td><td>'+esc(x.tipo==="nfc-e"?"NFC-e":"Gerencial")+'</td><td class="mono">'+esc(x.numero||"")+'</td><td class="mono">'+esc(fmt(x.total||0))+'</td><td class="mono">'+esc(x.pagamentos||"")+'</td><td>'+itensInfo.html+'</td>';
frag.appendChild(tr);
}
if(cards){
const c=document.createElement("div");
c.className="cardRow";
c.addEventListener("click",()=>abrirModal(x));
const itensMini=itensMiniHTML(x.itens,false);
let meta="";
if(!vendAtual)meta=String(x.vendedor||"");
meta+=(meta?" | ":"")+(x.tipo==="nfc-e"?"NFC-e":"Gerencial");
if(x.caixa)meta+=(meta?" | ":"")+"Caixa: "+String(x.caixa||"");
c.innerHTML='<div class="cardHead"><div class="cardNum mono">#'+esc(x.numero||"")+'</div><div class="cardTotal mono">'+esc(fmt(x.total||0))+'</div></div>'+(meta?('<div class="cardMeta mono">'+esc(meta)+'</div>'):"")+'<div class="cardPay mono">'+esc(x.pagamentos||"")+'</div>'+itensMini;
fragC.appendChild(c);
}
}
if(tb)tb.appendChild(frag);
if(cards)cards.appendChild(fragC);
const tipoTxt=tipoBusca==="gerencial"?"Gerencial":tipoBusca==="nfce"?"NFC-e":"Todos";
qs("#sub").textContent=(vendAtual?("Vendedor: "+vendAtual):"Todos os vendedores")+" • Tipo: "+tipoTxt;
const vtxt=vendAtual||"Todos";
qs("#vendSel").textContent=vtxt;
const vt=qs("#vendTopTxt");if(vt)vt.textContent=vtxt;
};
const renderTudo=()=>{renderLista();renderResumoVend();renderTabela();};
const qGer=DADOS.vendas.filter(x=>Number(x&&x.modelo||0)===99).length;
const qNfce=DADOS.vendas.filter(x=>Number(x&&x.modelo||0)===65).length;
const elQG=qs("#tQtdGer");if(elQG)elQG.textContent=qGer;
const elQN=qs("#tQtdNfce");if(elQN)elQN.textContent=qNfce;
const td=DADOS.totaisDia;{
const b=qs("#bDiaBrk"),mini=qs("#tDiaBrkMini");
if(td&&td.ok){
qs("#tDiaSel").textContent=fmt(td.selecionado||0);
qs("#tDiaGer").textContent=fmt(td.gerencial||0);
qs("#tDiaNfce").textContent=fmt(td.nfce||0);
if(mini)mini.style.display="inline";
if(!Number(td.selecionado||0)){if(b)b.style.display="none";}
else if(b)b.style.display="inline-flex";
}else{
qs("#tDiaSel").textContent=fmt(DADOS.totais.total||0);
if(mini)mini.style.display="none";
if(b)b.style.display="inline-flex";
}
}
qs("#q").addEventListener("input",e=>{qAtual=String(e.target.value||"").trim();const p=parseBusca(qAtual);qInc=p.inc;qIgn=p.ign;qValor=consultaPareceValor(qInc);calcSomaSel();renderTabela();});
document.querySelectorAll('input[name="tipoBusca"]').forEach(el=>el.addEventListener("change",e=>{tipoBusca=String(e.target&&e.target.value||"todos");if(tipoBusca!=="todos"&&vendAtual&&!DADOS.vendas.some(x=>tipoLinhaOk(x)&&x.vendedor===vendAtual))vendAtual="";calcSomaSel();renderTudo();}));
qs("#limpar").addEventListener("click",()=>{vendAtual="";qAtual="";qInc="";qIgn=[];qValor=false;tipoBusca="todos";qs("#q").value="";const rb=qs('input[name="tipoBusca"][value="todos"]');if(rb)rb.checked=true;calcSomaSel();renderTudo();toast("Filtro limpo","Mostrando todos.");});
qs("#ajuda").addEventListener("click",abrirAjuda);
const btnPro=qs("#proibidos");if(btnPro)btnPro.addEventListener("click",()=>{const inp=qs("#q");if(!inp)return;let v=String(inp.value||"");if(v.toLowerCase().indexOf("[proibidos]")<0)v=(v+" [proibidos]").trim();inp.value=v;qAtual=v.trim();const p=parseBusca(qAtual);qInc=p.inc;qIgn=p.ign;qValor=consultaPareceValor(qInc);calcSomaSel();renderTabela();toast("Filtro","Aplicado [proibidos].");});
qs("#copiarTudo").addEventListener("click",()=>{copiarTexto(montarTextoCopia(false,false));toast("Copiado","Conteúdo completo (com dinheiro).");});
qs("#copiarTudoItens").addEventListener("click",()=>{copiarTexto(montarTextoCopiaItens(false,false));toast("Copiado","Conteúdo completo + itens.");});
qs("#copiarSemDinheiro").addEventListener("click",()=>{copiarTexto(montarTextoCopia(true,false));toast("Copiado","Ignorando vendas com Dinheiro.");});
qs("#copiarGerencial").addEventListener("click",()=>{
const filtradas=DADOS.vendas.map((x,i)=>({x,i})).filter(o=>Number(o.x&&o.x.modelo||0)===99&&passaFiltro(o.x,o.i)).map(o=>o.x);
let out="";
if(vendAtual){
out+=vendAtual+":\n";
for(const x of filtradas)out+=String(x.numero||"")+"\n";
}else{
const map=new Map();
for(const x of filtradas){
const v=x.vendedor||"(sem vendedor)";
if(!map.has(v))map.set(v,[]);
map.get(v).push(x);
}
const vendes=[...map.keys()].sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
for(const v of vendes){
out+=v+":\n";
for(const x of map.get(v))out+=String(x.numero||"")+"\n";
out+="\n";
}
}
copiarTexto(out.trim());
toast("Copiado","Somente números de gerencial.");
});
qs("#editarProibidos").addEventListener("click",abrirEditorProibidos);
const PH_DESK="Buscar... Excluir: -termo (1) ou [termo,~contém,=igual,proibidos,-proibidos] (múltiplos)  |  Valor: >100, 10-20, 12*3, 12/3, 12?  |  Múltiplos: +  |  Soma: =151 ou =151*2";
const PH_MOB="Buscar... (ex: >50+CARTAO+-VENDEDOR+[-proibidos])";
const ajustarPlaceholder=()=>{const q=qs("#q");if(!q)return;q.placeholder=window.matchMedia("(max-width:680px)").matches?PH_MOB:PH_DESK;};
ajustarPlaceholder();
window.addEventListener("resize",ajustarPlaceholder);
const clicar=sel=>{const el=qs(sel);if(el)el.dispatchEvent(new MouseEvent("click",{bubbles:true}));};
const acoes=qs("#acoes");if(acoes)acoes.addEventListener("click",abrirAcoes);
const acoesFechar=qs("#acoesFechar");if(acoesFechar)acoesFechar.addEventListener("click",fecharAcoes);
const ovA=qs("#ovAcoes");if(ovA)ovA.addEventListener("click",e=>{if(e.target===ovA)fecharAcoes();});
const a1=qs("#aCopiarTudo");if(a1)a1.addEventListener("click",()=>{clicar("#copiarTudo");fecharAcoes();});
const a2=qs("#aCopiarTudoItens");if(a2)a2.addEventListener("click",()=>{clicar("#copiarTudoItens");fecharAcoes();});
const a3=qs("#aCopiarSemDinheiro");if(a3)a3.addEventListener("click",()=>{clicar("#copiarSemDinheiro");fecharAcoes();});
const a4=qs("#aCopiarGerencial");if(a4)a4.addEventListener("click",()=>{clicar("#copiarGerencial");fecharAcoes();});
const a5=qs("#aProibidos");if(a5)a5.addEventListener("click",()=>{clicar("#editarProibidos");fecharAcoes();});
const a6=qs("#aVendedores");if(a6)a6.addEventListener("click",()=>{fecharAcoes();renderLista();abrirVendedores();});
const a7=qs("#aAjuda");if(a7)a7.addEventListener("click",()=>{fecharAcoes();abrirAjuda();});
const a8=qs("#aLimpar");if(a8)a8.addEventListener("click",()=>{clicar("#limpar");fecharAcoes();});
const mb1=qs("#mbCopiar");if(mb1)mb1.addEventListener("click",()=>{clicar("#copiarTudo");});
const mb2=qs("#mbItens");if(mb2)mb2.addEventListener("click",()=>{clicar("#copiarTudoItens");});
const mb3=qs("#mbMais");if(mb3)mb3.addEventListener("click",abrirAcoes);
const vendQ=qs("#vendQ");if(vendQ)vendQ.addEventListener("input",e=>{vendFiltro=String(e.target.value||"");renderLista();});
const btnVend=qs("#btnVend");if(btnVend)btnVend.addEventListener("click",()=>{renderLista();abrirVendedores();});
const vendFechar=qs("#vendFechar");if(vendFechar)vendFechar.addEventListener("click",fecharVendedores);
const ovVend=qs("#ovVend");if(ovVend)ovVend.addEventListener("click",e=>{if(e.target===ovVend)fecharVendedores();});
qs("#copiarModal").addEventListener("click",()=>{if(!linhaAtual)return;copiarTexto((linhaAtual.vendedor||"(sem vendedor)")+":\n"+linhaCopiaItens(linhaAtual));toast("Copiado","Linha (com itens).");});
qs("#copiarModalGer").addEventListener("click",()=>{if(!linhaAtual)return;copiarTexto(String(linhaAtual.numero||""));toast("Copiado","Somente gerencial.");});
qs("#copiarModalSemItens").addEventListener("click",()=>{if(!linhaAtual)return;copiarTexto((linhaAtual.vendedor||"(sem vendedor)")+":\n"+linhaCopiaSemItens(linhaAtual));toast("Copiado","Linha (sem itens).");});
qs("#fechar").addEventListener("click",fecharModal);
qs("#ov").addEventListener("click",e=>{if(e.target===qs("#ov"))fecharModal();});
document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;const ova=qs("#ovAcoes");if(ova&&ova.classList.contains("on")){fecharAcoes();return;}const ovv=qs("#ovVend");if(ovv&&ovv.classList.contains("on")){fecharVendedores();return;}fecharModal();});
document.addEventListener("keydown",e=>{const k=String(e.key||"");const isInsert=k==="Insert";const isCapsP=(k.toLowerCase()==="p"&&e.getModifierState&&e.getModifierState("CapsLock"));const isDelete=k==="Delete";if(!isInsert&&!isCapsP&&!isDelete)return;e.preventDefault();const inp=qs("#q");if(!inp)return;let v=String(inp.value||"");if(isDelete){if(v.toLowerCase().indexOf("[-proibidos]")<0)v=(v+" [-proibidos]").trim();inp.value=v;qAtual=v.trim();const p=parseBusca(qAtual);qInc=p.inc;qIgn=p.ign;qValor=consultaPareceValor(qInc);calcSomaSel();renderTabela();toast("Filtro","Aplicado [-proibidos].");}else{if(v.toLowerCase().indexOf("[proibidos]")<0)v=(v+" [proibidos]").trim();inp.value=v;qAtual=v.trim();const p=parseBusca(qAtual);qInc=p.inc;qIgn=p.ign;qValor=consultaPareceValor(qInc);calcSomaSel();renderTabela();toast("Filtro","Aplicado [proibidos].");}});

const fixHead=()=>{
const tbl=qs("table");
if(!tbl)return;
const thead=tbl.querySelector("thead");
if(!thead)return;
const sync=()=>{const sbw=tbl.offsetWidth-tbl.clientWidth;tbl.style.setProperty("--sbw",(sbw>0?sbw:0)+"px");thead.style.transform="translateX("+(-tbl.scrollLeft)+"px)";};
tbl.addEventListener("scroll",sync,{passive:true});
window.addEventListener("resize",sync);
sync();
};
renderTudo();
fixHead();
const LS_KEY_REFRESH_AUTO_HOJE="__relatorio_auto_gerar_hoje__";const LS_KEY_REFRESH_ALERTA_DIA="__relatorio_alerta_dia__";const autoRefresh=(()=>{const MS5=5*60*1000,MS1=1000,MSMAX=2*60*1000;let tm=0;const base=(()=>{if(location.protocol==="http:"||location.protocol==="https:")return"";const l=String(DADOS&&DADOS.srv_base_local||"").trim();const r=String(DADOS&&DADOS.srv_base_rede||"").trim();return r||l||"";})();const key=String(DADOS&&DADOS.srv_key||"").trim();const api=p=>base+p;const hoje=()=>typeof hojeStr==="function"?hojeStr():"";const fechar=()=>{const ov=document.getElementById("ovRefresh");if(ov)ov.remove();};const autoGerarHojeAtivo=()=>String(localStorage.getItem(LS_KEY_REFRESH_AUTO_HOJE)||"")===hoje();const ativarAutoGerarHoje=()=>localStorage.setItem(LS_KEY_REFRESH_AUTO_HOJE,hoje());const jaAlertouHoje=()=>String(localStorage.getItem(LS_KEY_REFRESH_ALERTA_DIA)||"")===hoje();const marcarAlertaHoje=()=>localStorage.setItem(LS_KEY_REFRESH_ALERTA_DIA,hoje());const msAteAmanha=()=>{const n=new Date(),a=new Date(n.getFullYear(),n.getMonth(),n.getDate()+1,0,0,5,0);return Math.max(1000,a.getTime()-n.getTime());};const recarregar=()=>{if(location.protocol==="file:"){location.reload();return;}const u=new URL(location.href);u.hash="";u.searchParams.set("r",Date.now());location.replace(u.toString());};const status=()=>fetch(api("/__status"),{cache:"no-store"}).then(r=>r.json());const esperar=(ate,okPrev)=>new Promise(res=>{const tick=()=>{status().then(st=>{const ok=Number(st&&st.last_ok||0);if(st&&!st.running&&(okPrev?ok>okPrev:true))return res(st);if(Date.now()>=ate)return res(st||null);setTimeout(tick,MS1);}).catch(()=>{if(Date.now()>=ate)res(null);else setTimeout(tick,MS1);});};tick();});const gerar=()=>{if(!key)return Promise.resolve({ok:false,motivo:"sem_key"});return status().then(st0=>{const okPrev=Number(st0&&st0.last_ok||0);return fetch(api("/__gerar"),{method:"POST",headers:{"x-key":key}}).then(r=>r.json().catch(()=>({})).then(j=>({st:r.status,j,okPrev}))).then(o=>{if(o.st===401)return{ok:false,motivo:"unauth"};return esperar(Date.now()+MSMAX,o.okPrev).then(st=>({ok:true,st:st||o.j}));});});};const gerarEAtualizar=({silencioso=false}={})=>{fechar();if((location.protocol==="http:"||location.protocol==="https:")||base){if(!silencioso)toast("Gerando","Gerando um novo relatório no servidor...");gerar().then(r=>{if(!r||r.ok===false){toast("Atualização",silencioso?"Falhou ao gerar automaticamente. Vou tentar de novo depois.":"Não consegui gerar no servidor. Recarregando...");if(silencioso){agendar(MS5);return;}recarregar();return;}if(!silencioso)toast("Atualização","Relatório atualizado.");recarregar();});return;}recarregar();};const agendar=ms=>{clearTimeout(tm);tm=setTimeout(perguntar,ms);};const dispensarHoje=()=>{fechar();toast("Atualização","Ok. Vou perguntar de novo amanhã.");agendar(msAteAmanha());};const autoGerarSemAlertaHoje=()=>{fechar();ativarAutoGerarHoje();toast("Atualização","Hoje não vou alertar. Vou sempre gerar automaticamente.");agendar(MS1);};const perguntar=()=>{if(document.hidden){agendar(MS5);return;}if(autoGerarHojeAtivo()){gerarEAtualizar({silencioso:true});return;}if(jaAlertouHoje()){agendar(msAteAmanha());return;}if(document.getElementById("ovRefresh"))return;marcarAlertaHoje();const bg=document.createElement("div");bg.className="ov on";bg.id="ovRefresh";bg.setAttribute("aria-hidden","false");bg.innerHTML='<div class="modal" role="dialog" aria-modal="true"><div class="mhead"><div><div class="mtitle">Atualizar relatório?</div><div class="msub">A página pode gerar e atualizar a cada 15 minutos. Este alerta aparece só uma vez por dia.</div></div><div class="btn" id="rfFechar">Fechar</div></div><div class="mbody"><div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><div class="btn" id="rfSempreHoje">Não alertar por hoje e sempre gerar</div><div class="btn" id="rfAdiar">Hoje não</div><div class="btn" id="rfAgora">Gerar e atualizar</div></div></div></div>';document.body.appendChild(bg);const onEsc=e=>{if(e.key!=="Escape")return;document.removeEventListener("keydown",onEsc);dispensarHoje();};document.addEventListener("keydown",onEsc);bg.addEventListener("click",e=>{if(e.target===bg){document.removeEventListener("keydown",onEsc);dispensarHoje();}});qs("#rfFechar").addEventListener("click",()=>{document.removeEventListener("keydown",onEsc);dispensarHoje();});qs("#rfAdiar").addEventListener("click",()=>{document.removeEventListener("keydown",onEsc);dispensarHoje();});qs("#rfAgora").addEventListener("click",()=>{document.removeEventListener("keydown",onEsc);gerarEAtualizar();});qs("#rfSempreHoje").addEventListener("click",()=>{document.removeEventListener("keydown",onEsc);autoGerarSemAlertaHoje();});};const parseGerado=()=>{const el=document.querySelector('.badges .badgeHora')||document.querySelector('.badgeGeradoMobile')||document.querySelector('.badgeHora');const t=el?String(el.textContent||""):"";const m=t.match(/Gerado em:\s*(\d{2})\/(\d{2})\/(\d{2,4})\s*às\s*(\d{2}):(\d{2})/i);if(!m)return null;let y=Number(m[3]||0);if(y<100)y+=2000;const dt=new Date(y,Number(m[2])-1,Number(m[1]),Number(m[4]),Number(m[5]),0,0);return Number.isFinite(dt.getTime())?dt:null;};const alinhar=()=>{const g=parseGerado();const now=new Date();let falt=g?((g.getTime()+15*60*1000)-now.getTime()):15*60*1000;if(falt<1000)falt=1000;agendar(falt);};const btn=qs("#atualizar");if(btn)btn.addEventListener("click",()=>gerarEAtualizar());alinhar();return{agendar,gerarEAtualizar};})();
</script>
</body></html>`;
			fs.writeFileSync(saida, html, "utf8");
			db.detach(() => {
				if (tmpCriado) apagarComRetry(tmpCriado, 0);
			});
			console.log("OK: " + saida);
		});
	};
	rodar();
})();