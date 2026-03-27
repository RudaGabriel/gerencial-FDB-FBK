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
	
	// A MÁGICA: Suporta tanto o modo "1 dia" quanto o "intervalo"
	const dataSingular = pegar("--data");
	const dataInicioRaw = dataSingular || pegar("--data-inicio");
	const dataFimRaw = dataSingular || pegar("--data-fim");

	const parseISO = (s) => {
		const str = String(s || "").trim();
		let m;
		if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
		m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
		if (m) return `${m[3]}-${m[2]}-${m[1]}`;
		return str;
	};

	const dataInicioISO = parseISO(dataInicioRaw);
	const dataFimISO = parseISO(dataFimRaw);

	const saida = pegar("--saida");
	const usuario = pegar("--user") || "SYSDBA";
	const senha = pegar("--pass") || "masterkey";
	const gbak = pegar("--gbak") || "C:\\Program Files (x86)\\Firebird\\Firebird_2_5\\bin\\gbak.exe";

	if ((!fbk && !fdb) || !dataInicioISO || !dataFimISO || !saida) {
		console.log("Uso:\nnode gerar-relatorio-html.js --data 2026-03-01 ...\nou\nnode gerar-relatorio-html.js --data-inicio 2026-03-01 --data-fim 2026-03-23 ...");
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
	const decoder = new TextDecoder("windows-1252");
	const query = (db, sql, params) => new Promise(r => db.query(sql, params || [], (e, rows) => {
		if (rows) {
			for (let i = 0; i < rows.length; i++) {
				for (const key in rows[i]) {
					// Se o dado for um Buffer (bytes puros), nós traduzimos para texto com acentos!
					if (Buffer.isBuffer(rows[i][key])) {
						rows[i][key] = decoder.decode(rows[i][key]);
					}
				}
			}
		}
		r({ e, rows: rows || [] });
	}));
	
	const parseBR = (iso, raw) => {
		let m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (m) return `${m[3]}/${m[2]}/${m[1]}`;
		m = String(raw || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
		if (m) return `${m[1]}/${m[2]}/${m[3]}`;
		return String(raw || iso || "");
	};
	
	const dataInicioBR = parseBR(dataInicioISO, dataInicioRaw);
	const dataFimBR = parseBR(dataFimISO, dataFimRaw);
	const dataBR = dataInicioISO === dataFimISO ? dataInicioBR : `${dataInicioBR} até ${dataFimBR}`;

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
			const validCols = ["NUMERONF", "CONTROLE", "GERENCIAL", "PEDIDO"].filter(c => camposNfce.has(c));
			const colsSelect = validCols.length > 0 ? ", " + validCols.map(c => `cast(n.${c} as varchar(30)) as VAL_${c}`).join(", ") : "";
			const campoVendedorNfce = camposNfce.has("VENDEDOR") ? "cast(n.VENDEDOR as varchar(60))" : "cast(null as varchar(60))";
			const campoCaixa = camposNfce.has("CAIXA") ? "CAIXA" : (camposNfce.has("NUMCAIXA") ? "NUMCAIXA" : "null");
			const selCaixa = campoCaixa !== "null" ? `cast(n.${campoCaixa} as varchar(20))` : `cast('' as varchar(20))`;
			
			const campoCancelado = camposNfce.has("CANCELADO") ? "cast(n.CANCELADO as varchar(1))" : "'N'";
			const campoSituacao = camposNfce.has("SITUACAO") ? "cast(n.SITUACAO as varchar(1))" : "''";
			const campoEmissao = camposNfce.has("EMISSAO") ? "cast(n.EMISSAO as varchar(1))" : "''";

			// ---------------- A MÁGICA DA HORA ----------------
			// Procura qualquer coluna que tenha "HORA" no nome dentro da tabela
			let colHoraReal = Array.from(camposNfce).find(c => c.includes("HORA") || c === "HR");
			let exprHora = "''";
			if (colHoraReal) {
			    exprHora = `cast(n.${colHoraReal} as varchar(8))`;
			} else {
			    // Se não tiver coluna de hora, tenta extrair da própria coluna DATA
			    exprHora = `substring(cast(n.data as varchar(24)) from 12 for 5)`;
			}
			const campoHora = exprHora;
			// --------------------------------------------------

			// 1. Puxa NFCE (A base das vendas, filtrando as canceladas)
			const nfceSql = `
			select
			  n.data as DATA,
			  coalesce(n.modelo, 65) as MODELO,
			  n.total as TOTAL,
			  ${selCaixa} as CAIXA,
			  ${campoVendedorNfce} as VENDEDOR_NFCE,
			  ${campoCancelado} as CANC,
			  ${campoSituacao} as SIT,
			  ${campoEmissao} as EMI,
			  ${campoHora} as HORA
			  ${colsSelect}
			from nfce n
			where n.data between cast(? as date) and cast(? as date)
			  and coalesce(n.modelo, 65) in (99,65)
			`;
			const rNfce = await query(db, nfceSql, [dataInicioISO, dataFimISO]);
			if (rNfce.e) {
				db.detach(() => { if (tmpCriado) apagarComRetry(tmpCriado, 0); });
				console.log("Erro na consulta NFCE: " + String(rNfce.e.message || rNfce.e));
				process.exit(1);
			}

			// 2. Puxa Pagamentos (A verdade financeira para crediários e afins)
			const pagSql = `
			select
			  p.data as DATA,
			  cast(p.pedido as varchar(30)) as PEDIDO,
			  p.vendedor as VENDEDOR,
			  sum(p.valor) as TOTAL,
			  cast(list(
			    iif(
			      substring(trim(p.forma) from 1 for 2) between '00' and '99'
			      and substring(trim(p.forma) from 3 for 1) = ' ',
			      trim(substring(trim(p.forma) from 4)),
			      trim(p.forma)
			    ), ' | '
			  ) as varchar(32765)) as PAGAMENTOS
			from pagament p
			where p.data between cast(? as date) and cast(? as date)
			  and p.valor is not null
			  and substring(p.forma from 1 for 2) not in ('00','13')
			group by p.data, cast(p.pedido as varchar(30)), p.vendedor
			having sum(p.valor) > 0
			`;
			const rPag = await query(db, pagSql, [dataInicioISO, dataFimISO]);
			if (rPag.e) {
				db.detach(() => { if (tmpCriado) apagarComRetry(tmpCriado, 0); });
				console.log("Erro na consulta PAGAMENT: " + String(rPag.e.message || rPag.e));
				process.exit(1);
			}

			const mapVendas = new Map();
			const idIndex = new Map(); // Garante o cruzamento de IDs perfeitos

			// Organiza a Mestra de Notas
			for (const n of rNfce.rows) {
				// Corta as vendas canceladas do Richard e de outros
				if (n.CANC === 'S' || n.CANC === 'T' || n.SIT === 'C' || n.EMI === 'C') continue; 
				
				const totalNum = Number(n.TOTAL || 0);
				if (totalNum <= 0) continue;

				const ids = [];
				for (const c of validCols) {
					const val = String(n["VAL_" + c] || "").trim().replace(/^0+/, "");
					if (val && !ids.includes(val)) ids.push(val);
				}
				if (ids.length === 0) continue;

				const primaryId = ids[0];
				const dt = String(n.DATA);
				const key = dt + "|" + primaryId;

				let caixa = String(n.CAIXA ?? "").trim();
				if (/^\d+$/.test(caixa) && caixa.length > 0 && caixa.length < 3) caixa = caixa.padStart(3, "0");

				mapVendas.set(key, {
					_dtKey: dt,
					vendedor: String(n.VENDEDOR_NFCE || "").trim(),
					modelo: Number(n.MODELO || 65),
					numero: primaryId,
					caixa: caixa,
					hora: String(n.HORA || "").trim(),
					total_nfce: totalNum,
					total_pag: 0,
					formas: []
				});

				for (const id of ids) {
					idIndex.set(dt + "|" + id, key);
				}
			}

			// Cruza com Pagamentos e Identifica "Recebimentos"
			let contadorAvulso = 0;
			for (const p of rPag.rows) {
				const dt = String(p.DATA);
				let ped = String(p.PEDIDO || "").trim().replace(/^0+/, "");
				
				const valor = Number(p.TOTAL || 0);
				if (valor <= 0) continue;

				let vendPag = String(p.VENDEDOR || "").trim();
				const rawPags = String(p.PAGAMENTOS || "").trim().split(" | ").filter(Boolean);

				if (!ped) {
				    // É UM RECEBIMENTO DE CONTA/CREDIÁRIO (Pagamento sem nota fiscal de produtos)
				    contadorAvulso++;
				    ped = "REC-" + contadorAvulso; // Dá um ID único para não sumir do relatório
				}

				const searchKey = dt + "|" + ped;
				const primaryKey = idIndex.get(searchKey);

				if (primaryKey && mapVendas.has(primaryKey)) {
					const v = mapVendas.get(primaryKey);
					v.total_pag += valor;
					v.formas.push(...rawPags);
					if (vendPag && vendPag !== "?") v.vendedor = vendPag;
				} else {
					mapVendas.set(searchKey, {
						_dtKey: dt,
						vendedor: vendPag,
						modelo: 99,
						numero: ped,
						caixa: "",
						total_nfce: 0,
						total_pag: valor,
						formas: rawPags,
						is_recebimento: true
					});
					idIndex.set(searchKey, searchKey);
				}
			}

			const camposAlt = await camposTabela("ALTERACA");
			const campoVendAlt = camposAlt.has("VENDEDOR") ? "cast(VENDEDOR as varchar(60))" : "cast(null as varchar(60))";
			const campoHoraAlt = camposAlt.has("HORA") ? "cast(HORA as varchar(8))" : "cast('' as varchar(8))";

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
			select DATA, cast(PEDIDO as varchar(30)) as PED, cast(CAIXA as varchar(10)) as CX, DESCRICAO, QUANTIDADE, ${campoVendAlt} as VENDEDOR_ALT, ${campoHoraAlt} as HORA_ALT
			from ALTERACA
			where DATA between cast(? as date) and cast(? as date)
			order by DATA, PEDIDO, ITEM
			`, [dataInicioISO, dataFimISO]);

			const altMap = new Map();
			const vendAltMap = new Map();
			const horaAltMap = new Map();

			if (!rrAlt.e && rrAlt.rows && rrAlt.rows.length) {
				for (const row of rrAlt.rows) {
					const ped = String(row.PED ?? "").trim().replace(/^0+/, "");
					if (!ped) continue;
					
					const searchKey = String(row.DATA) + "|" + ped;
					const primaryKey = idIndex.get(searchKey) || searchKey;

					const vAlt = String(row.VENDEDOR_ALT || "").trim();
					if (vAlt && vAlt !== "?" && !vendAltMap.has(primaryKey)) vendAltMap.set(primaryKey, vAlt);

					const hAlt = String(row.HORA_ALT || "").trim();
					if (hAlt && !horaAltMap.has(primaryKey)) horaAltMap.set(primaryKey, hAlt);

					const desc = String(row.DESCRICAO || "").trim();
					if (!desc) continue;
					const qtd = fmtQtd(row.QUANTIDADE);
					if (!altMap.has(primaryKey)) altMap.set(primaryKey, []);
					altMap.get(primaryKey).push(qtd + "x " + desc);
				}
			}

			const linhas = [];
			for (const [key, v] of mapVendas.entries()) {
				// Prioriza o total da nota (venda real). Se for 0 (ex: recebimento avulso), usa o total pago.
				let finalTotal = v.total_nfce > 0 ? v.total_nfce : v.total_pag;
				if (finalTotal <= 0) continue;

				let finalVendedor = v.vendedor;
				if (!finalVendedor || finalVendedor === "?") finalVendedor = vendAltMap.get(key) || "";
				if (!finalVendedor || finalVendedor === "?") finalVendedor = "(sem vendedor)";

				let finalPags = v.formas.length > 0 ? [...new Set(v.formas)].join(" | ") : "NÃO DECLARADO";

				let numeroDisplay = v.numero;
				if (/^\d+$/.test(numeroDisplay) && numeroDisplay.length < 6) numeroDisplay = numeroDisplay.padStart(6, "0");

				let tItens = "";
				if (v.is_recebimento) {
					tItens = "⤷ Recebimento de Título / Conta";
				} else {
					const arrItens = altMap.get(key);
					if (arrItens && arrItens.length) {
						tItens = arrItens.map(i => "⤷ " + i).join("\n");
					}
				}

				let finalHora = v.hora || horaAltMap.get(key) || "";

				linhas.push({
					_dtKey: v._dtKey,
					vendedor: finalVendedor,
					modelo: v.modelo,
					tipo: v.modelo === 65 ? "nfc-e" : "gerencial",
					numero: numeroDisplay,
					caixa: v.caixa,
					hora: finalHora,
					total: finalTotal,
					pagamentos: finalPags,
					itens: tItens
				});
			}
			
			linhas.sort((a, b) => {
				const hA = String(a.hora || "");
				const hB = String(b.hora || "");
				
				// 1. Ordenação principal: Horário em ordem decrescente (mais recente primeiro)
				if (hA > hB) return -1; 
				if (hA < hB) return 1;
				
				// 2. Critérios de desempate (caso duas vendas tenham o exato mesmo minuto)
				const vA = a.vendedor.toLowerCase(), vB = b.vendedor.toLowerCase();
				if (vA < vB) return -1; if (vA > vB) return 1; // Agrupa por vendedor
				if (a.modelo < b.modelo) return -1; if (a.modelo > b.modelo) return 1; // Agrupa por modelo
				if (a.numero > b.numero) return -1; if (a.numero < b.numero) return 1; // Maior número primeiro
				return 0;
			});

			const totaisDia = { ok: true, gerencial: 0, nfce: 0, nfc: 0, nfe: 0, geral: 0, selecionado: 0, qtd_gerencial: 0, qtd_nfce: 0, modelos: [] };
			const mpVend = new Map();

			for (const x of linhas) {
				if (!mpVend.has(x.vendedor)) {
					mpVend.set(x.vendedor, { vendedor: x.vendedor, gerencial: 0, nfce: 0, geral: 0, qtd: 0 });
				}
				const v = mpVend.get(x.vendedor);
				v.qtd++;
				v.geral += x.total;
				if (x.modelo === 99) v.gerencial += x.total;
				else if (x.modelo === 65) v.nfce += x.total;
				
				totaisDia.geral += x.total;
				if (x.modelo === 99) { totaisDia.gerencial += x.total; totaisDia.qtd_gerencial++; }
				else if (x.modelo === 65) { totaisDia.nfce += x.total; totaisDia.qtd_nfce++; }
			}
			
			totaisDia.selecionado = totaisDia.geral;
			if (totaisDia.gerencial > 0) totaisDia.modelos.push({modelo: 99, total: totaisDia.gerencial});
			if (totaisDia.nfce > 0) totaisDia.modelos.push({modelo: 65, total: totaisDia.nfce});

			const vendTotaisDia = [...mpVend.values()].sort((a, b) => a.vendedor.localeCompare(b.vendedor, "pt-BR", { sensitivity: "base" }));
			const vendedores = [...mpVend.values()].map(v => ({ vendedor: v.vendedor, qtd: v.qtd, total: v.geral })).sort((a, b) => a.vendedor.localeCompare(b.vendedor, "pt-BR", { sensitivity: "base" }));

			const totalGeral = totaisDia.geral;
			const qtdGeral = linhas.length;
			const srv_key = String(process.env.FDB_SRV_KEY||"").trim();
			const srv_base_local = String(process.env.FDB_SRV_BASE_LOCAL||"").trim();
			const srv_base_rede = String(process.env.FDB_SRV_BASE_REDE||"").trim();

			const dados = {
				data: dataInicioISO === dataFimISO ? dataInicioISO : `${dataInicioISO} a ${dataFimISO}`,
				gerado_ts: Date.now(),
				srv_key,
				srv_base_local,
				srv_base_rede,
				totais: { qtd: qtdGeral, total: totalGeral },
				vendedores,
				vendTotaisDia,
				vendas: linhas,
				totaisDia
			};
			const dadosJSON = JSON.stringify(dados).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
			const html = String.raw`<!doctype html><html lang="pt-br"><head><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="icon" href="/favicon.png"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório Pet World ${escHtml(dataBR)}</title>
<script>
  (function(){
    const t = localStorage.getItem("fdb_theme") || "ultra-dark";
    document.documentElement.setAttribute("data-theme", t);
  })();
</script>
<style>
:root, [data-theme="dark"] {
  /* TEMA 1: Dark Original (Cinza Azulado) */
  --bg-app: #09090b; --bg-panel: #18181b; --bg-hover: #27272a;
  --border: rgba(255, 255, 255, 0.08); --border-focus: rgba(255, 255, 255, 0.15);
  --text-main: #f4f4f5; --text-muted: #a1a1aa;
  --accent: #3b82f6; --accent-hover: #2563eb; --accent-bg: rgba(59, 130, 246, 0.1);
  --danger: #ef4444; --success: #10b981;
  --top-bg: rgba(24, 24, 27, 0.75); --top-blur: blur(16px);
  --th-bg: rgba(24, 24, 27, 0.95); --mhead-bg: rgba(24, 24, 27, 0.95); --ov-bg: rgba(0, 0, 0, 0.7);
  --chip-bg: transparent; --chip-bg-hover: rgba(255,255,255,0.05);
  --scroll-thumb: rgba(255, 255, 255, 0.15); --scroll-thumb-hover: rgba(255, 255, 255, 0.25);
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05); --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1);
  --shadow-lg: 0 10px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.3);
  --easing: cubic-bezier(0.4, 0, 0.2, 1);
  --transition: all 0.3s var(--easing); --transition-fast: all 0.15s var(--easing);
  color-scheme: dark;
}

[data-theme="ultra-dark"] {
  /* TEMA 2: Ultra Dark (Preto Puro + Efeito Vidro) */
  --bg-app: #000000; --bg-panel: #0a0a0a; --bg-hover: #171717;
  --border: rgba(255, 255, 255, 0.08); --border-focus: rgba(255, 255, 255, 0.15);
  --text-main: #ededed; --text-muted: #a1a1aa;
  --accent: #0ea5e9; --accent-hover: #0284c7; --accent-bg: rgba(14, 165, 233, 0.12);
  --top-bg: rgba(10, 10, 10, 0.65); --top-blur: blur(20px);
  --th-bg: rgba(10, 10, 10, 0.85); --mhead-bg: rgba(10, 10, 10, 0.8); --ov-bg: rgba(0, 0, 0, 0.8);
  --chip-bg: rgba(255,255,255,0.03); --chip-bg-hover: rgba(255,255,255,0.06);
  --scroll-thumb: rgba(255, 255, 255, 0.1); --scroll-thumb-hover: rgba(255, 255, 255, 0.2);
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px;
  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05); --shadow-md: 0 4px 12px rgba(0,0,0,0.3);
  --shadow-lg: 0 20px 40px -10px rgba(0,0,0,0.8), 0 10px 15px -5px rgba(0,0,0,0.4);
  --easing: cubic-bezier(0.16, 1, 0.3, 1);
  color-scheme: dark;
}

[data-theme="light"] {
  /* TEMA 3: Light Vibrante (Branco + Azul Vivo) */
  --bg-app: #f8fafc; --bg-panel: #ffffff; --bg-hover: #f1f5f9;
  --border: rgba(0, 0, 0, 0.1); --border-focus: rgba(0, 0, 0, 0.2);
  --text-main: #0f172a; --text-muted: #64748b;
  --accent: #2563eb; --accent-hover: #1d4ed8; --accent-bg: rgba(37, 99, 235, 0.1);
  --top-bg: rgba(255, 255, 255, 0.75); --top-blur: blur(20px);
  --th-bg: rgba(255, 255, 255, 0.9); --mhead-bg: rgba(255, 255, 255, 0.9); --ov-bg: rgba(0, 0, 0, 0.4);
  --chip-bg: rgba(0,0,0,0.03); --chip-bg-hover: rgba(0,0,0,0.06);
  --scroll-thumb: rgba(0, 0, 0, 0.15); --scroll-thumb-hover: rgba(0, 0, 0, 0.25);
  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05); --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-lg: 0 20px 40px -10px rgba(0,0,0,0.12), 0 10px 15px -5px rgba(0,0,0,0.05);
  --easing: cubic-bezier(0.16, 1, 0.3, 1);
  color-scheme: light;
}

/* Animações e reset básico */
@keyframes fadeSlideUp { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } }
@keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
@keyframes scaleIn { 0% { opacity: 0; transform: scale(0.96); } 100% { opacity: 1; transform: scale(1); } }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; background: var(--bg-app); color: var(--text-main); font-family: 'Inter', sans-serif; overflow: hidden; -webkit-font-smoothing: antialiased; }
.mono { font-family: 'JetBrains Mono', Consolas, monospace; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }

/* Scrollbars */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--scroll-thumb); border-radius: 10px; border: 2px solid var(--bg-app); }
::-webkit-scrollbar-thumb:hover { background: var(--scroll-thumb-hover); }

.app { height: 100%; display: grid; grid-template-rows: auto 1fr; animation: fadeIn 0.5s var(--easing); }

/* Top Bar */
.top { display: grid; gap: 16px; padding: 16px 28px; background: var(--top-bg); backdrop-filter: var(--top-blur); -webkit-backdrop-filter: var(--top-blur); border-bottom: 1px solid var(--border); z-index: 50; box-shadow: var(--shadow-sm); }
.top .left { display: flex; flex-wrap: nowrap; gap: 14px; align-items: center; justify-content: space-between; }
.badges { display: flex; gap: 10px; align-items: center; flex-wrap: nowrap; min-width: 0; }
.badge { display: inline-flex; align-items: center; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); background: var(--bg-panel); border: 1px solid var(--border); padding: 6px 12px; border-radius: 99px; white-space: nowrap; transition: var(--transition); box-shadow: var(--shadow-sm); }
.badge:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-1px); }
.badgeHora { background: transparent; border-color: transparent; box-shadow: none; }
.top .right { display: flex; gap: 10px; align-items: center; }

/* Inputs e Botões */
.input { flex: 1 1 auto; background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-main); padding: 10px 16px; font-size: 13px; border-radius: var(--radius-md); outline: none; transition: var(--transition-fast); }
.input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
.radioBusca { display: flex; align-items: center; gap: 6px; background: var(--bg-panel); padding: 4px; border-radius: 99px; border: 1px solid var(--border); }
.radioBusca .radio { user-select: none; display: inline-flex; align-items: center; padding: 6px 16px; border-radius: 99px; background: transparent; cursor: pointer; transition: var(--transition-fast); margin: 0; }
.radioBusca .radio input { display: none; }
.radioBusca .radio span { font-size: 12px; font-weight: 600; color: var(--text-muted); transition: var(--transition-fast); }
.radioBusca .radio:hover:not(:has(input:checked)) { background: var(--bg-hover); }
.radioBusca .radio:has(input:checked) { background: var(--bg-hover); box-shadow: var(--shadow-sm); }
.radioBusca .radio:has(input:checked) span { color: var(--text-main); }

.btn { cursor: pointer; background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-main); font-weight: 500; font-size: 13px; padding: 0 18px; border-radius: var(--radius-md); height: 38px; display: inline-flex; align-items: center; justify-content: center; transition: var(--transition-fast); white-space: nowrap; box-shadow: var(--shadow-sm); }
.btn:hover { background: var(--bg-hover); border-color: var(--text-muted); transform: translateY(-2px); box-shadow: var(--shadow-md); }
.btn:active { transform: translateY(0); }
#btnModalPeriodo { background: var(--text-main); color: var(--bg-app); border-color: var(--text-main); font-weight: 700; }
#btnModalPeriodo:hover { opacity: 0.9; box-shadow: 0 4px 14px var(--border-focus); }
.btnProibidos { display: none; } .badgeGeradoMobile { display: none; }

/* Layout e Sidebar */
.main { min-height: 0; display: grid; grid-template-columns: 280px 1fr; animation: fadeSlideUp 0.6s var(--easing) forwards; }
.sidebar { min-height: 0; border-right: 1px solid var(--border); padding: 24px 20px; display: flex; flex-direction: column; background: var(--bg-app); }
.sb-head { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; margin-bottom: 12px; }
.sb-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); font-weight: 700; }
.list { min-height: 0; overflow-y: auto; flex: 1 1 50%; padding-right: 4px; margin-bottom: 20px; }
.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px;
  background: transparent;
  border-radius: var(--radius-md);
  margin-bottom: 5px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: var(--transition);
}
.item:hover { background: var(--bg-panel); border-color: var(--border); }
.item.sel { background: var(--bg-panel); border-color: var(--border-focus); box-shadow: var(--shadow-md); }
.item .nome { font-weight: 500; font-size: 13px; color: var(--text-muted); transition: var(--transition-fast); }
.item.sel .nome, .item:hover .nome { color: var(--text-main); font-weight: 600; }
.item .meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.item .qtd { font-size: 11px; color: var(--text-muted); }
.item .tot { font-size: 13px; font-weight: 600; color: var(--text-main); font-family: 'JetBrains Mono', monospace; }

/* Total por Vendedor (Resumo) */
.sbResumo { display: flex; flex-direction: column; flex: 0 100 50%; min-height: 0; border-top: 1px solid var(--border); padding-top: 20px; }
.sbResumoBody {
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-left: -12px;
}
.rv { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: transparent; border-radius: var(--radius-md); transition: var(--transition-fast); }
.rv:hover { background: var(--bg-panel); box-shadow: var(--shadow-sm); }
.rv .n { font-size: 13px; font-weight: 500; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 65%; }
.rv .v { font-size: 13px; font-weight: 600; color: var(--text-main); font-family: 'JetBrains Mono', Consolas, monospace; }

/* Tabela */
.content { min-height: 0; padding: 20px; background: var(--bg-app); }
.tableWrap { height: 100%; display: flex; flex-direction: column; background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); overflow: hidden; }
.tableTop {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 19px 23px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.tableTitle { font-size: 20px; font-weight: 700; color: var(--text-main); letter-spacing: -0.02em; }
.count { font-size: 13px; color: var(--text-muted); font-weight: 500; margin: 7px 4px; }
.btns { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; padding-top: 6px; }
.itensMiniHead {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin: 0 0 10px 0;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--border-focus);
  font-size: 11px;
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
/* O subtítulo (Total • Únicos) no formato de uma mini-tag */
.itensMiniHead .sub {
  font-size: 10px;
  color: var(--text-main);
  background: var(--bg-panel);
  padding: 3px 8px;
  border-radius: 99px;
  border: 1px solid var(--border-focus);
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: none;
}
/* Agrupador dos chips em formato de grade fluida (tags) */
.itensChips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex-direction: column;
}

/* Estilo individual de cada Chip (Tag) */
.itensChip {
  display: inline-flex;
  align-items: center;
  background: var(--chip-bg);
  border: 1px solid var(--border-focus);
  padding: 4px 10px 4px 4px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  transition: var(--transition-fast);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* O fundo do chip ganha destaque quando passamos o mouse no Card */
.cardRow:hover .itensChip, .kv:hover .itensChip { 
  border-color: var(--text-muted); 
  color: var(--text-main); 
  background: var(--chip-bg-hover); 
}
/* A quantidade dentro do chip vira uma "bolinha" em destaque */
.itensQtd {
  color: var(--text-main);
  background: var(--accent);
  margin-right: 6px;
  padding: 2px 6px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 700;
  font-family: 'JetBrains Mono', Consolas, monospace;
  box-shadow: var(--shadow-sm);
  letter-spacing: 1px;
}

span#vendTopTxt {
  margin-top: 2px;
}
span#tDiaSel {
  margin-right: 3px;
}
.badge[title="Data dos dados desse relatório"],.badge[title="Dia, hora e mês em que esse relatório foi gerado"] {
  letter-spacing: 1px;
}
span#tQtdGer, span#tQtdNfce {
  margin: 0 5px;
}
div#vendSel {
  margin-right: 5px;
}

table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; display: block; flex: 1 1 auto; overflow: auto; --sbw: 0px; }
thead { position: sticky; top: 0; z-index: 10; display: table; width: calc(100%/* - var(--sbw, 0px)*/); table-layout: fixed; }
tbody { display: table; width: 100%; table-layout: fixed; padding: 8px; }
thead th { background: var(--th-bg); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); color: var(--text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; padding: 14px 24px; border-bottom: 1px solid var(--border); text-align: center; }
tbody tr { background: transparent; transition: var(--transition); cursor: pointer; border-radius: var(--radius-md); }
tbody td { padding: 16px 8px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--text-muted); vertical-align: middle; transition: var(--transition-fast); }
tbody tr:hover { background: var(--bg-hover); transform: translateY(-2px) scale(1.002); box-shadow: var(--shadow-md); position: relative; z-index: 5; }
tbody tr:hover td { border-bottom-color: transparent; color: var(--text-main); }
tbody tr:hover td:first-child { border-top-left-radius: var(--radius-md); border-bottom-left-radius: var(--radius-md); }
tbody tr:hover td:last-child { border-top-right-radius: var(--radius-md); border-bottom-right-radius: var(--radius-md); }
thead th:nth-child(1), tbody td:nth-child(1) { width: auto; font-weight: 600; text-align: center; }
thead th:nth-child(2), tbody td:nth-child(2) { width: 90px; text-align: center; }
thead th:nth-child(3), tbody td:nth-child(3) { width: 90px; color: var(--text-muted); text-align: center; }
thead th:nth-child(4), tbody td:nth-child(4) { width: 70px; text-align: center; }
thead th:nth-child(5), tbody td:nth-child(5) { width: 145px; font-weight: 700; color: var(--text-main); text-align: center; }
thead th:nth-child(6), tbody td:nth-child(6) { width: auto; text-align: center; }
thead tr {
  user-select: none;
}
thead th:nth-child(4) {
    padding: 0 22px;
}
thead th:nth-child(5) {
    padding: 0 55px;
}
tr th:first-child {
  transform: translateX(7px);
}
tr th:nth-child(2) {
  transform: translateX(3px);
}

/* Chips */
.tdItemsWrap { display: flex; flex-wrap: wrap; gap: 8px; }
.tdItemChip {
  display: block;
  align-items: center;
  background: var(--chip-bg);
  border: 1px solid var(--border-focus);
  padding: 6px 12px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  transition: var(--transition-fast);
  width: 100%;
  text-align: center;
}
tbody tr:hover .tdItemChip { border-color: var(--text-muted); color: var(--text-main); background: var(--chip-bg-hover); }
.tdItemQtd { color: var(--accent); font-weight: 700; margin-right: 6px; font-family: 'JetBrains Mono', monospace; }

/* Modals */
.ov { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: var(--ov-bg); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); z-index: 9998; padding: 20px; opacity: 0; transition: opacity 0.3s var(--easing); }
.ov.on { display: flex; opacity: 1; } .ov.on .modal { animation: scaleIn 0.3s var(--easing) forwards; }
.modal { width: min(720px, 100%); max-height: 90vh; display: flex; flex-direction: column; background: var(--bg-panel); border: 1px solid var(--border-focus); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); overflow: hidden; }
.mhead {
  display: flex;
  padding: 24px;
  background: var(--mhead-bg);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 10;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
}
.mtitle { font-size: 22px; font-weight: 700; color: var(--text-main); letter-spacing: -0.02em; }
.msub { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
.mbody { display: grid; gap: 5px; padding: 24px; overflow-y: auto; }
.kv { display: grid; grid-template-columns: 140px 1fr; gap: 16px; align-items: flex-start; background: var(--bg-app); border: 1px solid var(--border); padding: 16px 20px; border-radius: var(--radius-md); transition: var(--transition-fast); }
.kv:hover { border-color: var(--border-focus); background: var(--bg-hover); }
.k { font-size: 12px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }
.v { font-size: 14px; font-weight: 500; color: var(--text-main); }

/* Mobile */
.cards { display: none; padding: 16px; overflow-y: auto; }
.cardRow { background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 16px; cursor: pointer; transition: var(--transition); box-shadow: var(--shadow-sm); }
.cardRow:hover { border-color: var(--border-focus); transform: translateY(-4px) scale(1.01); box-shadow: var(--shadow-lg); background: var(--bg-hover); }
.cardHead { display: flex; justify-content: space-between; margin-bottom: 12px; align-items: center;}
.cardNum { font-family: 'JetBrains Mono', monospace; color: var(--text-muted); font-size: 14px; font-weight: 600; }
.cardTotal { font-weight: 700; color: var(--accent); font-size: 20px; }
.cardMeta, .cardPay { font-size: 13px; color: var(--text-main); margin-bottom: 6px; font-weight: 500; }
.cardPay { color: var(--text-muted); }

@media (max-width: 1024px) { .top { grid-template-columns: 1fr; padding: 16px 20px; } .top .right { justify-content: flex-start; flex-wrap: wrap; } .content { padding: 20px; } }
@media (max-width: 920px) { .main { grid-template-columns: 1fr; } .sidebar { display: none; } .vendBtn { display: flex; } #acoes { display: inline-flex; } .radioBusca { flex: 1 1 100%; justify-content: space-between; } }
@media (max-width: 680px) {
  .content { padding: 12px; } .tableTop { padding: 20px; } table { display: none; } .cards { display: block; padding-bottom: 100px; }
  .mobileBar { display: flex; position: fixed; bottom: 0; left: 0; right: 0; background: var(--top-bg); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); padding: 16px 20px 24px 20px; gap: 12px; border-top: 1px solid var(--border); z-index: 50; box-shadow: 0 -10px 40px rgba(0,0,0,0.5); }
  .mobileBar .btn { flex: 1; height: 48px; font-weight: 600; border-radius: var(--radius-lg); }
  .ov.sheet { align-items: flex-end; padding: 12px; } .ov.sheet .modal { border-radius: 24px 24px 12px 12px; padding: 24px; animation: fadeSlideUp 0.4s var(--easing) forwards;} .badges .badgeHora { display: none; }
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
<div class="radioBusca" id="radioBusca" role="radiogroup" aria-label="Tipo da busca"><label class="radio"><input type="radio" name="tipoBusca" value="todos" checked><span>Todos</span></label><label class="radio"><input type="radio" name="tipoBusca" value="gerencial"><span>Gerencial</span></label><label class="radio"><input type="radio" name="tipoBusca" value="nfce"><span>NFC-e</span></label></div>
<button id="acoes" class="btn" type="button" title="Ações">Ações</button>
<button id="ajuda" class="btn" type="button" title="Coringas disponíveis">?</button>
<button id="proibidos" class="btn btnProibidos" type="button">[Proibidos]</button>
<button id="limpar" class="btn" type="button">Limpar</button>
<button id="atualizar" class="btn" type="button" title="Gerar um novo relatório no servidor e atualizar">Atualizar</button>
<button id="btnTema" class="btn" type="button" title="Alterar cores da tela">🎨 Tema</button>
<button id="btnModalPeriodo" class="btn" type="button" title="Gerar relatório de um período específico">Gerar por período</button>
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
<thead>
<tr>
	<th>vendedor</th>
	<th>tipo</th>
	<th>número</th>
	<th>hora</th>
	<th>total</th>
	<th>forma de pagamento</th>
	<th>itens</th>
</tr>
</thead>
<tbody id="tb"></tbody>
</table>
</div>
</div>
</div>
</div>
</div>
<div class="ov" id="ovPeriodo" aria-hidden="true">
<div class="modal" role="dialog" aria-modal="true" style="width: min(400px, 94vw);">
<div class="mhead">
<div><div class="mtitle">Gerar por Período</div><div class="msub">Selecione o intervalo de datas.</div></div>
<div class="btn" id="fecharPeriodo">Fechar</div>
</div>
<div class="mbody" style="display: grid; gap: 15px;">
<div><label style="font-size: 12px; opacity: 0.85; margin-bottom: 5px; display: block;">Data Inicial</label><input type="date" id="dataInicioInp" class="input" style="width: 100%;"></div>
<div><label style="font-size: 12px; opacity: 0.85; margin-bottom: 5px; display: block;">Data Final</label><input type="date" id="dataFimInp" class="input" style="width: 100%;"></div>
<button id="btnGerarPeriodo" class="btn" style="background: rgba(120, 180, 255, 0.15); color: #78b4ff; font-weight: bold; width: 100%;">Gerar Relatório</button>
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

const temasOpcoes = ["ultra-dark", "dark", "light"];
const btnTema = qs("#btnTema");
if(btnTema) {
    btnTema.addEventListener("click", () => {
        let temaAtual = localStorage.getItem("fdb_theme") || "ultra-dark";
        let proximoTema = temasOpcoes[(temasOpcoes.indexOf(temaAtual) + 1) % temasOpcoes.length];
        localStorage.setItem("fdb_theme", proximoTema);
        document.documentElement.setAttribute("data-theme", proximoTema);
        toast("Tema Alterado", proximoTema === "light" ? "Modo Claro" : (proximoTema === "dark" ? "Modo Dark Original" : "Modo Ultra Dark"));
    });
}

const rmAcento=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const normP=v=>rmAcento(v).trim().toUpperCase().replace(/\s+/g," ");

// PRÉ-PROCESSAMENTO DE ALTA PERFORMANCE (Evita recálculos na busca)
for(let i=0; i<DADOS.vendas.length; i++){
    const x = DADOS.vendas[i];
    x._idx = i;
    x._busca = rmAcento((x.vendedor||"")+" "+(x.tipo||"")+" "+(x.pagamentos||"")+" "+(x.itens||"")+" "+(x.caixa||"")+" "+(x.numero||"")).toLowerCase();
}

const LS_KEY="__cupons_proibidos__";
const LS_KEY_PROIB_IGN="__cupons_proibidos_ignorados__";
const LS_KEY_PROIB_IGN_DIA="__cupons_proibidos_ignorados_alerta_dia__";
const LS_KEY_PROIB_ALERTA_DIA="__cupons_proibidos_alerta_dia__";
const proibidosPadrao=["FARO","BIOFRESH","OPTIMUM","CIBAU","ATACAMA","GOLDEN","PIPICAT","SYNTEC","MITZI","ND CAES","ND GATOS","GRANPLUS","PEDIGREE","WHISKAS","PREMIER","GUABI","NATURAL CAES","NATURAL GATOS","PUTZ","GRANEL","ELANCO","VET LIFE","VETLIFE","KONIG","SAN REMO","SANREMO","FN CAE","FN CAO","FN GATO","FN VET","ORIGENS","FUNNY BUNNY","FUNNY BIRDY","SANOL","KELDOG","KDOG","MAGNUS","MAGNO","GENIAL","CANISTER","NATURAL SACHE, FN COOKIES, KITEKAT"];
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
    const bg=document.createElement("div");
    bg.className="ov on";
    bg.id="ovProibMerge";
    bg.setAttribute("aria-hidden","false");
    bg.innerHTML='<div class="modal" role="dialog" aria-modal="true"><div class="mhead"><div><div class="mtitle">Alterações nos proibidos</div><div class="msub">Foram encontradas diferenças entre esta máquina e o servidor.</div></div><div class="btn" id="pmFechar">Fechar</div></div><div class="mbody"><div style="display:grid;gap:10px"><div style="border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px;background:rgba(255,255,255,.03)"><div style="font-weight:700;margin-bottom:6px">Só nesta máquina ('+diff.soLocal.length+')</div><div style="max-height:160px;overflow:auto;white-space:pre-wrap;font-size:12px">'+esc(diff.soLocal.length?diff.soLocal.join(NL):"-")+'</div></div><div style="border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px;background:rgba(255,255,255,.03)"><div style="font-weight:700;margin-bottom:6px">Só no servidor ('+diff.soSrv.length+')</div><div style="max-height:160px;overflow:auto;white-space:pre-wrap;font-size:12px">'+esc(diff.soSrv.length?diff.soSrv.join(NL):"-")+'</div></div></div><div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px"><div class="btn" id="pmIgnorarSempre" style="border-color:#ef4444;color:#ef4444">Não mostrar novamente para este item</div><div class="btn" id="pmManter">Deixar como está</div><div class="btn" id="pmMesclar">Dar merge</div></div></div></div>';
    document.body.appendChild(bg);
    
    const manter=()=>{bg.remove();onKeep&&onKeep();};
    const mesclar=()=>{bg.remove();onMerge&&onMerge();};
    const ignorarSempre=()=>{
        bg.remove();
        const list = String(localStorage.getItem("__cpi_perm__")||"").split("||").filter(Boolean);
        if(!list.includes(diff.ass)) list.push(diff.ass);
        localStorage.setItem("__cpi_perm__", list.join("||"));
        toast("Proibidos", "Ocultado permanentemente para esta diferença.");
        proibSyncPend=0;
    };
    
    qs("#pmFechar",bg).addEventListener("click",manter);
    qs("#pmManter",bg).addEventListener("click",manter);
    qs("#pmIgnorarSempre",bg).addEventListener("click",ignorarSempre);
    qs("#pmMesclar",bg).addEventListener("click",mesclar);
    bg.addEventListener("click",e=>{if(e.target===bg)manter();});
};

function syncProibidos(push){
    if(location.protocol!=="http:"&&location.protocol!=="https:")return;
    if(proibSyncPend)return;
    proibSyncPend=1;
    const local=lerProibidos();
    fetch("/__proibidos",{cache:"no-store"}).then(r=>r&&r.ok?r.json():{ok:false,lista:[]},()=>({ok:false,lista:[]})).then(j=>{
        const srv=parseProib(j&&j.lista);
        const diff=fazerDiffProib(local,srv);
        if(!diff.soLocal.length&&!diff.soSrv.length){ limparProibIgn(); proibSyncPend=0; return; }
        
        // Verifica se foi ignorado permanentemente
        const ignPerm = String(localStorage.getItem("__cpi_perm__")||"").split("||");
        if(ignPerm.includes(diff.ass)) { proibSyncPend=0; return; }
        
        const ign=lerProibIgn();
        if(ign&&ign.ass===diff.ass){ avisarProibIgnorado(diff); proibSyncPend=0; return; }
        if(jaAlertouProibHoje()){ proibSyncPend=0; return; }
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
            toast("Proibidos","Alterações ignoradas.");
            proibSyncPend=0;
        });
    },()=>{proibSyncPend=0;});
}
const avisarProibIgnorado=diff=>{
    if(!diff||!diff.ass||jaAlertouProibHoje())return;
    marcarAlertaProibHoje();
    marcarAlertaIgnHoje(diff.ass);
    toast("Proibidos ignorados","Há alterações ignoradas entre esta máquina e o servidor.");
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
        if(!diff.soLocal.length&&!diff.soSrv.length){ limparProibIgn(); proibSyncPend=0; return; }
        const ign=lerProibIgn();
        if(ign&&ign.ass===diff.ass){ avisarProibIgnorado(diff); proibSyncPend=0; return; }
        if(jaAlertouProibHoje()){ proibSyncPend=0; return; }
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
            toast("Proibidos","Alterações ignoradas.");
            proibSyncPend=0;
        });
    },()=>{proibSyncPend=0;});
}
syncProibidos(false);

const __ncToastMsgs=new Set();
const showToast=msg=>{
    if(!msg||__ncToastMsgs.has(msg))return;
    __ncToastMsgs.add(msg);
    if(!document.getElementById("__nc_toast_css")){
        const st=document.createElement("style");
        st.id="__nc_toast_css";
        st.textContent=".__nc_toast_box{position:fixed;top:16px;left:16px;z-index:2147483647!important;display:flex;flex-direction:column;gap:10px;pointer-events:none} .__nc_toast{pointer-events:auto;background:var(--bg-panel);border:1px solid var(--border-focus);box-shadow:var(--shadow-lg);color:var(--text-main);border-radius:var(--radius-md);padding:12px 34px 12px 14px;font-family:'Inter',sans-serif;font-weight:600;font-size:13px;opacity:0;transform:translateY(-10px);transition:all .3s ease;overflow:hidden;position:relative} .__nc_toast.__on{opacity:1;transform:translateY(0)} .__nc_toast_x{position:absolute;top:10px;right:10px;width:20px;height:20px;border-radius:10px;background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-weight:bold} .__nc_toast_x:hover{color:var(--text-main);background:var(--border)} .__nc_toast_bar{position:absolute;left:0;bottom:0;height:3px;width:100%;background:linear-gradient(90deg,var(--accent),#0ea5e9);transform-origin:left;animation:__nc_toast_bar 5s linear forwards} @keyframes __nc_toast_bar{to{transform:scaleX(0)}}";
        document.head.appendChild(st);
    }
    let box=qs(".__nc_toast_box");
    if(!box){box=document.createElement("div");box.className="__nc_toast_box";document.body.appendChild(box);}
    const el=document.createElement("div");
    el.className="__nc_toast";
    el.innerHTML='<div>'+msg+'</div><button class="__nc_toast_x">✕</button><div class="__nc_toast_bar"></div>';
    const rm=()=>{if(el.isConnected){el.remove();__ncToastMsgs.delete(msg);}};
    el.querySelector("button").addEventListener("click",rm);
    box.appendChild(el);
    requestAnimationFrame(()=>el.classList.add("__on"));
    setTimeout(rm,5000);
};
const toast=(titulo,desc)=>{ showToast(titulo&&desc?(titulo+" — "+desc):(titulo||desc)); };

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

const numQtd=s=>{
    s=String(s||"").trim().replace(/\s+/g,"").replace(/\./g,"").replace(",",".");
    const n=Number(s);
    return Number.isFinite(n)?n:0;
};
const fmtQtdUI=n=>{
    const v=Number(n||0);
    if(!Number.isFinite(v)||v<=0)return"1";
    const r=Math.round(v);
    if(Math.abs(v-r)<1e-9)return String(r);
    let s=v.toFixed(3).replace(/0+$/,"").replace(/\.$/,"");
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
        let nome=l;
        let qtd=1;
        const mm=l.match(/^(\d+(?:[\.,]\d+)?)x\s*(.*)$/i);
        if(mm){
            qtd=numQtd(mm[1]);
            nome=String(mm[2]||"").trim()||nome;
            if(!qtd)qtd=1;
        }
        total += qtd;
        const k=normP(nome);
        if(!k)continue;
        if(!mp.has(k))mp.set(k,{nome:nome,qtd:0});
        mp.get(k).qtd+=qtd;
    }
    const itens=[...mp.values()].sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR",{sensitivity:"base"})).map(o=>({nome:o.nome,qtd:fmtQtdUI(o.qtd)+"x"}));
    return{total:fmtQtdUI(total),unicos:itens.length,itens:itens};
};

const itensMiniHTML=(it,grande)=>{
    const g=agruparItensUI(it);
    if(!g.itens.length)return"";
    let chips="";
    for(const x of g.itens)chips+='<span class="itensChip"><span class="itensQtd mono">'+esc(x.qtd)+'</span>'+esc(x.nome)+'</span>';
    return '<div class="itensMini'+(grande?' big':'')+'"><div class="itensMiniHead mono"><span>Itens</span><span class="sub">'+esc(g.total+" total • "+g.unicos+" únicos")+'</span></div><div class="itensChips">'+chips+'</div></div>';
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

const semWS=s=>{
    let o="";
    for(const ch of String(s||"")){
        const c=ch.charCodeAt(0);
        if((c>32&&c!==160)||ch===","||ch==="."||ch==="-"||ch==="+"||ch==="*"||ch==="/"||ch==="?"||ch==="="||((ch>="0"&&ch<="9")))o+=ch;
    }
    return o;
};
const soNumeroBr=raw=>{
    let t=semWS(raw||"").toUpperCase();
    if(t.startsWith("R$"))t=t.slice(2);
    let x="";
    for(const ch of t)if((ch>="0"&&ch<="9")||ch===","||ch==="."||ch==="-")x+=ch;
    if(!x)return null;
    if(x.indexOf(",")>=0){ x=x.split(".").join("").replace(",","."); }
    else{ const p=x.split("."); if(p.length>1){ const l=p[p.length-1]||""; if(p.length>2||l.length===3)x=p.join(""); } }
    const n=Number(x); return Number.isFinite(n)?n:null;
};
const limparPadraoValor=p=>{ let o=""; for(const ch of semWS(p)){ if((ch>="0"&&ch<="9")||ch==="*"||ch==="/"||ch==="?"||ch===","||ch===".")o+=ch; } return o.split(".").join(""); };
const temDigito=s=>{ for(const ch of s)if(ch>="0"&&ch<="9")return true; return false; };
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
    const s=String(raw||"").trim().replace(/\[1p\]/gi,"[proibidos]").replace(/\[-p\]/gi,"[-proibidos]");
    if(!s)return{inc:"",ign:[],proibidos:false,proibidosModo:0};
    let inc=s,ign=[],proibidos=false,proibidosModo=0,temColchetes=false,mm;
    const rx=/\[([^\]]*)\]/g;
    const pushTerm=t=>{
        t=String(t||"").trim().replace(/^"+|"+$/g,""); if(!t)return;
        const n=normP(t);
        if(n==="PROIBIDOS"){proibidos=true;proibidosModo=1;return;}
        if(n==="-PROIBIDOS"){proibidos=false;proibidosModo=2;return;}
        let modo="inc"; if(t[0]==="~"){modo="cont";t=t.slice(1).trim();}else if(t[0]==="="){modo="eq";t=t.slice(1).trim();}
        t=normP(t); if(t)ign.push({modo,t});
    };
    while((mm=rx.exec(s))){ temColchetes=true; for(const p of String(mm[1]||"").split(","))pushTerm(p); }
    const sl=s.toLowerCase(); if(sl.indexOf("[-proibidos]")>=0){proibidos=false;proibidosModo=2;}else if(sl.indexOf("[proibidos]")>=0){proibidos=true;proibidosModo=1;}
    if(temColchetes||proibidosModo)inc=inc.replace(/\[[^\]]*\]/g," ").trim();
    const m=inc.match(/^(.*)\((.*)\)\s*$/);
    if(m){ inc=String(m[1]||"").trim(); for(const p of String(m[2]||"").split(","))pushTerm(p); }
    return{inc:inc.trim(),ign,proibidos,proibidosModo};
};

const isDig=ch=>ch>="0"&&ch<="9";
const matchInicioFull=(pat,full)=>{
    const p=limparPadraoValor(pat); if(!p||!temDigito(p))return false;
    const s=String(full||""), comma=s.indexOf(",");
    const memo=new Map();
    const rec=(pi,si)=>{
        const key=pi+"|"+si; if(memo.has(key))return memo.get(key);
        if(pi>=p.length)return true; if(si>=s.length)return false;
        const ch=p[pi]; let ok=false;
        if(ch==="*"){
            let k=si; if(k<s.length&&(isDig(s[k])||s[k]===",")){ for(;k<s.length&&(isDig(s[k])||s[k]===",");k++)if(rec(pi+1,k+1)){ok=true;break;} }
        }else if(ch==="/"){
            if(!(comma>=0&&si>=comma)){ if(si<s.length&&isDig(s[si])){ let end=si; for(;end<s.length&&isDig(s[end])&&(comma<0||end<comma);end++){} for(let e=si+1;e<=end;e++)if(rec(pi+1,e)){ok=true;break;} } }
        }else if(ch==="?"){
            if(isDig(s[si])&&(comma<0||si<comma))ok=rec(pi+1,si+1);
        }else if(isDig(ch)||ch===","){
            if(s[si]===ch)ok=rec(pi+1,si+1);
        }else ok=rec(pi+1,si);
        memo.set(key,ok); return ok;
    };
    return rec(0,0);
};
const matchDentroInteiro=(pat,inteiro)=>{
    const p=limparPadraoValor(pat); if(!p||!temDigito(p))return false;
    let toks=""; for(const ch of p)if(isDig(ch)||ch==="/"||ch==="?")toks+=ch; if(!toks)return false;
    const s=String(inteiro||""); const memo=new Map();
    const rec=(pi,si)=>{
        const key=pi+"|"+si; if(memo.has(key))return memo.get(key);
        if(pi>=toks.length)return true; if(si>=s.length)return false;
        const ch=toks[pi]; let ok=false;
        if(ch==="/"){ let end=si; for(;end<s.length&&isDig(s[end]);end++){} for(let e=si+1;e<=end;e++)if(rec(pi+1,e)){ok=true;break;} }
        else if(ch==="?"){ ok=isDig(s[si])?rec(pi+1,si+1):false; }
        else{ ok=s[si]===ch?rec(pi+1,si+1):false; }
        memo.set(key,ok); return ok;
    };
    for(let start=0;start<s.length;start++)if(rec(0,start))return true;
    return false;
};

const valorOk=(q,total)=>{
    if(!Number.isFinite(total))return null;
    const raw=String(q||"").trim(); if(!raw)return null;
    const sx=semWS(raw).toUpperCase(); if(!sx||sx.startsWith("="))return null;
    const temCoringa=(sx.indexOf("*")>=0||sx.indexOf("/")>=0||sx.indexOf("?")>=0)&&temDigito(sx);
    const tStr=fmtCopia(total); const full=tStr, inteiro=full.split(",")[0]||full;
    if(temCoringa){
        const partes=sx.split("+").map(p=>p.trim()).filter(Boolean);
        for(const p of partes){
            if(p.indexOf("*")>=0){ if(matchInicioFull(p,full))return true; }
            else{ if(matchDentroInteiro(p,inteiro))return true; }
        }
        return false;
    }
    if(!temDigito(sx))return null;
    const ops=[">=","<=",">","<"];
    for(const op of ops)if(sx.startsWith(op)){
        const n=soNumeroBr(sx.slice(op.length)); if(n===null)return null;
        if(op===">")return total>n; if(op==="<")return total<n;
        if(op===">=")return total>=n; return total<=n;
    }
    const dash=sx.indexOf("-");
    if(dash>0&&dash<sx.length-1){
        const a=soNumeroBr(sx.slice(0,dash)), b=soNumeroBr(sx.slice(dash+1));
        if(a===null||b===null)return null;
        return total>=Math.min(a,b)&&total<=Math.max(a,b);
    }
    let qv=sx.startsWith("R$")?sx.slice(2):sx;
    qv=qv.replace(/[\.,]/g,""); const tv=tStr.replace(/[\.,]/g,"");
    if(!qv)return null; return tv.indexOf(qv)>=0;
};

const parseSomaQuery=raw=>{
    const s=semWS(String(raw||"")); if(!s.startsWith("="))return null;
    const body=s.slice(1); if(!body||body==="*")return null;
    const parts=body.split("*");
    const alvo=soNumeroBr(parts[0]); if(alvo===null)return null;
    const tol=parts.length>1?(soNumeroBr(parts[1])??0):0;
    return{alvo,tol};
};

let vendAtual="",vendFiltro="",qAtual="",qInc="",qIgn=[],qValor=false,tipoBusca="todos",linhaAtual=null,somaSel=null,somaKey="";
const tipoLinhaOk=x=>tipoBusca==="todos"||tipoBusca==="gerencial"&&Number(x&&x.modelo||0)===99||tipoBusca==="nfce"&&Number(x&&x.modelo||0)===65;
const vendaTemProibido=x=>reProibidos?reProibidos.test(String(x?.itens||"")):false;

const calcSomaSel=()=>{
    const p=parseSomaQuery(qInc||qAtual);
    if(!p){somaSel=null;somaKey="";return;}
    const key=(vendAtual||"")+"|"+p.alvo+"|"+p.tol;
    if(key===somaKey&&somaSel)return;
    somaKey=key;
    const itens=[];
    for(let i=0;i<DADOS.vendas.length;i++){
        const x=DADOS.vendas[i];
        if(!tipoLinhaOk(x)||(vendAtual&&x.vendedor!==vendAtual))continue;
        const v=Number(x.total||0); if(!Number.isFinite(v)||v<=0)continue;
        itens.push({i,v});
    }
    itens.sort((a,b)=>b.v-a.v);
    const sel=new Set(); let soma=0;
    const ex=itens.find(it=>Math.abs(it.v-p.alvo)<0.005);
    if(ex){sel.add(ex.i);soma=ex.v;}
    else{ const lim=p.alvo+p.tol+0.005; for(const it of itens)if(soma+it.v<=lim){soma+=it.v;sel.add(it.i);} }
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
    const camposTxt=x._busca; 

    if(ign.length){
        hayN=normP(x._busca+" "+String(x.total||""));
        toks=hayN.split(" ").filter(Boolean);
        for(const o of ign){
            const term=normP(o?.t||""); if(!term)continue;
            if(o.modo==="eq"){ if(hayN===term||toks.includes(term)||normP(x.vendedor||"")===term||normP(x.pagamentos||"")===term||normP(x.caixa||"")===term||normP(x.numero||"")===term||normP(String(x.total||""))===term||normP(String(x.itens||""))===term)return false; }
            else if(o.modo==="cont"){ if(hayN.indexOf(term)>=0)return false; }
            else{ if(toks.includes(term))return false; }
        }
    }
    if(!q)return true;
    if(q.startsWith("="))return !!(somaSel&&somaSel.sel&&somaSel.sel.has(i));
    const parts=q.split("+").map(v=>String(v||"").trim()).filter(Boolean);
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
    const totalNum=Number(x.total||0);
    if(excParts.length){
        if(!toks){hayN=normP(x._busca+" "+String(x.total||""));toks=hayN.split(" ").filter(Boolean);}
        for(const ex of excParts){
            let et=String(ex||"").trim(); if(!et)continue;
            let modo="tok"; if(et[0]==="~"){modo="cont";et=et.slice(1).trim();}else if(et[0]==="="){modo="eq";et=et.slice(1).trim();}
            if(!et)continue;
            if(consultaPareceValor(et)){ if(valorOk(et,totalNum)===true)return false; }
            else{
                const term=normP(et); if(!term)continue;
                if(modo==="eq"){ if(hayN===term||toks.includes(term)||normP(x.vendedor||"")===term||normP(x.pagamentos||"")===term||normP(x.caixa||"")===term||normP(x.numero||"")===term||normP(String(x.total||""))===term||normP(String(x.itens||""))===term)return false; }
                else if(modo==="cont"){ if(hayN.indexOf(term)>=0)return false; }
                else{ if(toks.includes(term))return false; }
            }
        }
    }
    if(!incParts.length)return true;
    if(incParts.length>1){
        for(const part of incParts){
            const ptxt=String(part||"").trim(); if(!ptxt)continue;
            if(consultaPareceValor(ptxt)){ if(valorOk(ptxt,totalNum)!==true)return false; }
            else{ if(camposTxt.indexOf(rmAcento(ptxt).toLowerCase())<0)return false; }
        }
        return true;
    }
    const q1=String(incParts[0]||"").trim();
    if(!q1)return true;
    const ql=rmAcento(q1).toLowerCase();
    if(camposTxt.indexOf(ql)>=0){
        if(qValor){
            if(rmAcento(x.vendedor||"").toLowerCase().indexOf(ql)>=0||rmAcento(x.pagamentos||"").toLowerCase().indexOf(ql)>=0||rmAcento(x.itens||"").toLowerCase().indexOf(ql)>=0||rmAcento(x.caixa||"").toLowerCase().indexOf(ql)>=0) return true;
        }else return true;
    }
    return valorOk(q1,totalNum)===true;
};

const norm=s=>{
    let t=rmAcento(s).toUpperCase(), o="", sp=false;
    for(const ch of t){
        const c=ch.charCodeAt(0);
        if(c<=32||c===160){ if(!sp&&o){o+=" ";sp=true;} }else{ o+=ch;sp=false; }
    }
    return o.trim();
};

const limparPagamentoCopia=p=>String(p||"").split("|").map(s=>s.trim().replace(/^cartao(?: +|$)/i,"").trim()).filter(Boolean).join(" | ");
const formasDe=x=>limparPagamentoCopia(x.pagamentos||"").split("|").map(s=>norm(s)).filter(Boolean);
const temDinheiro=x=>formasDe(x).includes("DINHEIRO");
const resumo=arr=>{
    const soma=new Map();
    for(const x of arr){
        const fs=formasDe(x); if(!fs.length)continue;
        const share=Number(x.total||0)/fs.length;
        for(const f of fs)soma.set(f,(soma.get(f)||0)+share);
    }
    if(!soma.size)return"";
    const base=["DEBITO","CREDITO","PIX","DINHEIRO"];
    const extras=[...soma.keys()].filter(k=>base.indexOf(k)<0).sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
    let out=""; for(const k of base.concat(extras))if(soma.has(k))out+=k+"\t"+fmtCopia(soma.get(k))+"\n";
    return out.trim();
};

const montarTextoCopia=(ignorarDinheiro,ignorarProibidos)=>{
    const filtradas=DADOS.vendas.filter((x,i)=>passaFiltro(x,i)).filter(x=>(!ignorarDinheiro||!temDinheiro(x))&&(!ignorarProibidos||!vendaTemProibido(x)));
    const montarBloco=(nome,arr)=>{
        let out=nome+":\n";
        for(const x of arr)out+=String(x.numero||"")+"\t"+fmtCopia(x.total||0)+"\t"+limparPagamentoCopia(x.pagamentos||"")+"\n";
        return out.trim();
    };
    if(vendAtual)return montarBloco(vendAtual,filtradas);
    const map=new Map();
    for(const x of filtradas){ const v=x.vendedor||"(sem vendedor)"; if(!map.has(v))map.set(v,[]); map.get(v).push(x); }
    const vendes=[...map.keys()].sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
    let out=""; for(const v of vendes)out+=montarBloco(v,map.get(v))+"\n\n";
    return out.trim();
};

const linhaCopiaItens=x=>{
    const t=String(limparItensVisuais(x?.itens)||"").trim();
    let itens="";
    if(t){
        const linhas=t.split(/\n+/g).map(s=>String(s||"").replace(/^⤷\s*/,"").trim()).filter(Boolean);
        const seen=new Set(), out=[];
        for(let l of linhas){ l=l.replace(/^\d+[\d,]*x\s*/i,"").trim(); if(!l||l==="…"||l==="...")continue; const k=normP(l); if(!k||seen.has(k))continue; seen.add(k); out.push(l); }
        itens=out.join("╰─╮");
    }
    const forma=limparPagamentoCopia(x?.pagamentos||""), parts=forma.split("|").map(s=>normP(s)).filter(Boolean);
    const extraTab=(parts.includes("DEBITO")||parts.includes("PIX")||parts.includes("DINHEIRO"))?"\t":"";
    return String(x?.numero||"")+"\t"+fmtCopia(x?.total||0)+"\t"+forma+"\t"+extraTab+(itens||"");
};

const montarTextoCopiaItens=(ignorarDinheiro,ignorarProibidos)=>{
    const filtradas=DADOS.vendas.filter((x,i)=>passaFiltro(x,i)).filter(x=>(!ignorarDinheiro||!temDinheiro(x))&&(!ignorarProibidos||!vendaTemProibido(x)));
    const montarBloco=(nome,arr)=>{ let out=nome+":\n"; for(const x of arr)out+=linhaCopiaItens(x)+"\n"; return out.trim(); };
    if(vendAtual)return montarBloco(vendAtual,filtradas);
    const map=new Map();
    for(const x of filtradas){ const v=x.vendedor||"(sem vendedor)"; if(!map.has(v))map.set(v,[]); map.get(v).push(x); }
    const vendes=[...map.keys()].sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
    let out=""; for(const v of vendes)out+=montarBloco(v,map.get(v))+"\n\n";
    return out.trim();
};

const copiarTexto=txt=>{
    const fallback=()=>{
        const ta=document.createElement("textarea"); ta.value=txt; ta.setAttribute("readonly","");
        ta.style.cssText="position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
        document.body.appendChild(ta); if(ta.focus)ta.focus({preventScroll:true}); ta.select(); ta.setSelectionRange(0,ta.value.length);
        document.execCommand("copy"); ta.remove();
    };
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).catch(fallback); else fallback();
};

// RENDERIZAÇÃO EM LOTE PARA ALTA PERFORMANCE
const renderTabela=()=>{
    const tb=qs("#tb");
    const cards=qs("#cards");
    const filtradas=DADOS.vendas.filter((x,i)=>passaFiltro(x,i));
    let soma=0;
    for(const x of filtradas)soma+=Number(x.total||0);
    const q=String(qAtual||"").trim();
    qs("#count").textContent=somaSel&&q.startsWith("=")?(filtradas.length+" vendas ― soma "+fmt(soma)+" ― alvo "+fmt(somaSel.alvo)+(somaSel.tol?(" ± "+fmt(somaSel.tol)):"")):(filtradas.length+" vendas ― "+fmt(soma));
    
    let htmlTb = "";
    let htmlCards = "";

    for(const x of filtradas){
        if(tb){
            const itensInfo=itensTdHTML(x.itens);
            let horaFormatada = x.hora ? String(x.hora).substring(0, 5) : "";
            htmlTb += '<tr data-idx="'+x._idx+'"><td>'+esc(x.vendedor||"")+'</td><td>'+esc(x.tipo==="nfc-e"?"NFC-e":"Gerencial")+'</td><td class="mono">'+esc(x.numero||"")+'</td><td class="mono">'+esc(horaFormatada)+'</td><td class="mono">'+esc(fmt(x.total||0))+'</td><td class="mono">'+esc(x.pagamentos||"")+'</td><td>'+itensInfo.html+'</td></tr>';
        }
        if(cards){
            const itensMini=itensMiniHTML(x.itens,false);
            let meta=""; if(!vendAtual)meta=String(x.vendedor||"");
            meta+=(meta?" | ":"")+(x.tipo==="nfc-e"?"NFC-e":"Gerencial");
            if(x.hora)meta+=(meta?" | ":"")+"Hora: "+String(x.hora||"").substring(0, 5);
            if(x.caixa)meta+=(meta?" | ":"")+"Caixa: "+String(x.caixa||"");
            htmlCards += '<div class="cardRow" data-idx="'+x._idx+'"><div class="cardHead"><div class="cardNum mono">#'+esc(x.numero||"")+'</div><div class="cardTotal mono">'+esc(fmt(x.total||0))+'</div></div>'+(meta?('<div class="cardMeta mono">'+esc(meta)+'</div>'):"")+'<div class="cardPay mono">'+esc(x.pagamentos||"")+'</div>'+itensMini+'</div>';
        }
    }
    
    if(tb) tb.innerHTML = htmlTb;
    if(cards) cards.innerHTML = htmlCards;

    const tipoTxt=tipoBusca==="gerencial"?"Gerencial":tipoBusca==="nfce"?"NFC-e":"Todos";
    qs("#sub").textContent=(vendAtual?("Vendedor: "+vendAtual):"Todos os vendedores")+" • Tipo: "+tipoTxt;
    const vtxt=vendAtual||"Todos";
    qs("#vendSel").textContent=vtxt;
    const vt=qs("#vendTopTxt");if(vt)vt.textContent=vtxt;
};

const atualizarSelecaoVendedores=()=>{
    document.querySelectorAll('.item').forEach(el => {
        const nome = el.querySelector('.nome')?.textContent;
        if((!vendAtual && nome === "Todos") || (vendAtual && nome === vendAtual)) el.classList.add('sel');
        else el.classList.remove('sel');
    });
};

const renderLista=()=>{
    const base=DADOS.vendas.filter(tipoLinhaOk);
    const porVend=new Map();
    let qtdBase=0,totalBase=0;
    for(const x of base){
        const nome=String(x&&x.vendedor||"").trim()||"(sem vendedor)";
        if(!porVend.has(nome))porVend.set(nome,{vendedor:nome,qtd:0,total:0});
        const it=porVend.get(nome);
        it.qtd++; it.total+=Number(x&&x.total||0);
        qtdBase++; totalBase+=Number(x&&x.total||0);
    }
    const vendedores=[...porVend.values()].sort((a,b)=>a.vendedor.localeCompare(b.vendedor,"pt-BR",{sensitivity:"base"}));
    const mk=(root,apos,filtro)=>{
        if(!root)return;
        root.innerHTML="";
        const f=String(filtro||"").trim().toLowerCase();
        const add=(nome,qtd,total,sel,click)=>{
            const div=document.createElement("div");
            div.className="item"+(sel?" sel":"");
            div.addEventListener("click",()=>{click();if(apos)apos(); atualizarSelecaoVendedores();});
            div.innerHTML='<div class="nome">'+esc(nome)+'</div><div class="meta"><div class="qtd">Vendas: '+qtd+'</div><div class="tot">'+esc(fmt(total))+'</div></div>';
            root.appendChild(div);
        };
        add("Todos",qtdBase,totalBase,!vendAtual,()=>{vendAtual="";calcSomaSel();renderTabela();});
        for(const v of vendedores){
            if(f&&rmAcento(String(v.vendedor||"")).toLowerCase().indexOf(rmAcento(f))<0)continue;
            add(v.vendedor,v.qtd,v.total,vendAtual===v.vendedor,()=>{vendAtual=v.vendedor;calcSomaSel();renderTabela();});
        }
    };
    mk(qs("#lista"),null,"");
    mk(qs("#listaVend"),fecharVendedores,vendFiltro);
};

const renderResumoVend=()=>{
    const el=qs("#vendResumo"); if(!el)return;
    let head=el.querySelector(".sb-head");
    if(!head){ head=document.createElement("div"); head.className="sb-head"; head.innerHTML='<div class="sb-title">Total por vendedor</div>'; el.prepend(head); }
    let body=el.querySelector(".sbResumoBody");
    if(!body){ body=document.createElement("div"); body.className="sbResumoBody"; el.appendChild(body); }
    const arr=Array.isArray(DADOS.vendTotaisDia)?DADOS.vendTotaisDia:[];
    if(!arr.length){body.innerHTML='<div style="opacity:.75;padding:6px 2px">Sem dados hoje</div>';return;}
    let h="";
    for(const x of arr){
        const nome=String(x&&x.vendedor||"").trim()||"(sem vendedor)";
        const g=Number(x&&x.gerencial||0)||0, n=Number(x&&x.nfce||0)||0, t=(Number(x&&x.geral||0)||0)|| (g+n);
        h+='<div class="rv" title="Gerencial: '+esc(fmt(g))+' · NFC-e: '+esc(fmt(n))+'"><div class="n">'+esc(nome)+':</div><div class="v">'+esc(fmt(t))+'</div></div>';
    }
    body.innerHTML=h;
};
const renderTudo=()=>{renderLista();renderResumoVend();renderTabela();};

const abrirModal=x=>{
    linhaAtual=x;
    qs("#mTitulo").textContent="Gerencial "+(x.numero||"");
    qs("#mSub").textContent="Vendedor: "+(x.vendedor||"")+(x.caixa?(" | Caixa: "+x.caixa):"");
    const body=qs("#mBody"); body.innerHTML="";
    const mk=(k,v)=>{const d=document.createElement("div");d.className="kv";d.innerHTML='<div class="k">'+k+'</div><div class="v mono">'+String(v??"")+'</div>';return d;};
    body.appendChild(mk("Tipo",String(x.tipo==="nfc-e"?"NFC-e":"Gerencial")));
    body.appendChild(mk("Número",String(x.numero||"")));
    body.appendChild(mk("Caixa",String(x.caixa||"")));
    body.appendChild(mk("Total",fmt(x.total||0)));
    body.appendChild(mk("Formas",String(x.pagamentos||"")));
    const itensBox=document.createElement("div"); itensBox.innerHTML=itensMiniHTML(x.itens,true);
    const kv=document.createElement("div"); kv.className="kv"; kv.innerHTML='<div class="k">Itens</div><div class="v"></div>'; kv.lastChild.appendChild(itensBox);
    body.appendChild(kv);
    const b=qs("#copiarModal");if(b)b.style.display="flex";const b1=qs("#copiarModalGer");if(b1)b1.style.display="flex";const b2=qs("#copiarModalSemItens");if(b2)b2.style.display="flex";
    qs("#ov").classList.add("on"); qs("#ov").setAttribute("aria-hidden","false");
};

// DELEGAÇÃO DE EVENTOS: Extremamente rápido, cria apenas 1 listener pra todos os cliques!
const handleModalClick = e => {
    const el = e.target.closest('[data-idx]');
    if(!el) return;
    const idx = Number(el.getAttribute('data-idx'));
    if(DADOS.vendas[idx]) abrirModal(DADOS.vendas[idx]);
};
const tbEl = qs("#tb"); if(tbEl) tbEl.addEventListener("click", handleModalClick);
const cardsEl = qs("#cards"); if(cardsEl) cardsEl.addEventListener("click", handleModalClick);

const fecharModal=()=>{
    qs("#ov").classList.remove("on"); qs("#ov").setAttribute("aria-hidden","true");
    const b=qs("#copiarModal");if(b)b.style.display="none";const b1=qs("#copiarModalGer");if(b1)b1.style.display="none";const b2=qs("#copiarModalSemItens");if(b2)b2.style.display="none";
    linhaAtual=null;
};

const abrirAjuda=()=>{
    linhaAtual=null;
    const b=qs("#copiarModal");if(b)b.style.display="none";const b1=qs("#copiarModalGer");if(b1)b1.style.display="none";const b2=qs("#copiarModalSemItens");if(b2)b2.style.display="none";
    qs("#mTitulo").textContent="Coringas disponíveis";
    qs("#mSub").textContent="Use no campo de busca para filtrar por valor e/ou excluir termos.";
    const body=qs("#mBody"); body.innerHTML="";
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
    add("+ (opcional)","múltiplos filtros (ex: >50+carto+-vendedor) o uso do + é opcional para multiplas pesquisas (ex: [-proibidos,dinheiro]>150-entregas) também é válido");
    add("Rádio ao lado da busca","Escolha Todos, Gerencial ou NFC-e para aplicar a pesquisa somente no tipo selecionado");
    qs("#ov").classList.add("on"); qs("#ov").setAttribute("aria-hidden","false");
};

const abrirVendedores=()=>{
    const ov=qs("#ovVend"); if(!ov)return;
    ov.classList.add("on"); ov.setAttribute("aria-hidden","false"); vendFiltro="";
    const q=qs("#vendQ"); if(q){q.value="";if(!window.matchMedia("(max-width:680px)").matches)q.focus();}
};
const fecharVendedores=()=>{ const ov=qs("#ovVend"); if(ov){ov.classList.remove("on"); ov.setAttribute("aria-hidden","true");} vendFiltro=""; const q=qs("#vendQ"); if(q)q.value=""; };
const abrirAcoes=()=>{ const ov=qs("#ovAcoes"); if(ov){ov.classList.add("on"); ov.setAttribute("aria-hidden","false");} };
const fecharAcoes=()=>{ const ov=qs("#ovAcoes"); if(ov){ov.classList.remove("on"); ov.setAttribute("aria-hidden","true");} };

const abrirEditorProibidos=()=>{
    qs("#ovProib")?.remove();
    const bg=document.createElement("div"); bg.className="ov on"; bg.id="ovProib"; bg.setAttribute("aria-hidden","false");
    bg.innerHTML='<div class="modal" role="dialog" aria-modal="true"><div class="mhead"><div><div class="mtitle">Proibidos</div><div class="msub">Um por linha ou separado por vírgula. Salva no localStorage.</div></div><div class="btn" id="prFechar">Fechar</div></div><div class="mbody"><textarea id="prTa" spellcheck="false" style="width:100%;height:260px;resize:vertical;border-radius:14px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);color:#e6eaf2;padding:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,&quot;Liberation Mono&quot;,&quot;Courier New&quot;,monospace;font-size:12px;outline:none"></textarea><div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><div class="btn" id="prCancelar">Restaurar padrão</div><div class="btn" id="prSalvar">Salvar</div></div></div></div>';
    document.body.appendChild(bg);
    const ta=qs("#prTa",bg); ta.value=valoresProibidos.join("\n");
    const fechar=()=>bg.remove();
    qs("#prFechar",bg).addEventListener("click",fechar);
    qs("#prCancelar",bg).addEventListener("click",()=>{setProibidosUser(proibidosPadrao);ta.value=proibidosPadrao.join("\n");fechar();renderTabela();toast("Proibidos","Restaurado padrão.");});
    qs("#prSalvar",bg).addEventListener("click",()=>{const lista=String(ta.value||"").split(/\n|,/g).map(normP).filter(Boolean);setProibidosUser(lista);fechar();renderTabela();toast("Proibidos","Lista atualizada.");});
    bg.addEventListener("click",e=>{if(e.target===bg)fechar();});
    document.addEventListener("keydown",function escKey(e){if(e.key==="Escape"){document.removeEventListener("keydown",escKey);fechar();}});
};

// PREENCHIMENTO DO TOP BAR
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
        if(!Number(td.selecionado||0)){if(b)b.style.display="none";}else if(b)b.style.display="inline-flex";
    }else{
        qs("#tDiaSel").textContent=fmt(DADOS.totais.total||0);
        if(mini)mini.style.display="none";
        if(b)b.style.display="inline-flex";
    }
}

// DEBOUNCE NA BUSCA: O Segredo de não travar o teclado!
let debounceBusca;
qs("#q").addEventListener("input",e=>{
    clearTimeout(debounceBusca);
    debounceBusca = setTimeout(() => {
        qAtual=String(e.target.value||"").trim();
        const p=parseBusca(qAtual); qInc=p.inc; qIgn=p.ign; qValor=consultaPareceValor(qInc);
        calcSomaSel();
        renderTabela();
    }, 150); // Só roda a busca 150ms depois de parar de digitar
});

document.querySelectorAll('input[name="tipoBusca"]').forEach(el=>el.addEventListener("change",e=>{tipoBusca=String(e.target&&e.target.value||"todos");if(tipoBusca!=="todos"&&vendAtual&&!DADOS.vendas.some(x=>tipoLinhaOk(x)&&x.vendedor===vendAtual)){vendAtual=""; atualizarSelecaoVendedores();}calcSomaSel();renderTabela();}));
qs("#limpar").addEventListener("click",()=>{vendAtual="";qAtual="";qInc="";qIgn=[];qValor=false;tipoBusca="todos";qs("#q").value="";const rb=qs('input[name="tipoBusca"][value="todos"]');if(rb)rb.checked=true;calcSomaSel();renderTabela();atualizarSelecaoVendedores();toast("Filtro limpo","Mostrando todos.");});
qs("#ajuda").addEventListener("click",abrirAjuda);
const btnPro=qs("#proibidos");if(btnPro)btnPro.addEventListener("click",()=>{const inp=qs("#q");if(!inp)return;let v=String(inp.value||"");if(v.toLowerCase().indexOf("[proibidos]")<0)v=(v+" [proibidos]").trim();inp.value=v;qAtual=v.trim();const p=parseBusca(qAtual);qInc=p.inc;qIgn=p.ign;qValor=consultaPareceValor(qInc);calcSomaSel();renderTabela();toast("Filtro","Aplicado [proibidos].");});

qs("#copiarTudo").addEventListener("click",()=>{copiarTexto(montarTextoCopia(false,false));toast("Copiado","Conteúdo completo (com dinheiro).");});
qs("#copiarTudoItens").addEventListener("click",()=>{copiarTexto(montarTextoCopiaItens(false,false));toast("Copiado","Conteúdo completo + itens.");});
qs("#copiarSemDinheiro").addEventListener("click",()=>{copiarTexto(montarTextoCopia(true,false));toast("Copiado","Ignorando vendas com Dinheiro.");});
qs("#copiarGerencial").addEventListener("click",()=>{
    const filtradas=DADOS.vendas.map((x,i)=>({x,i})).filter(o=>Number(o.x&&o.x.modelo||0)===99&&passaFiltro(o.x,o.i)).map(o=>o.x);
    let out="";
    if(vendAtual){ out+=vendAtual+":\n"; for(const x of filtradas)out+=String(x.numero||"")+"\n"; }
    else{
        const map=new Map();
        for(const x of filtradas){ const v=x.vendedor||"(sem vendedor)"; if(!map.has(v))map.set(v,[]); map.get(v).push(x); }
        const vendes=[...map.keys()].sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
        for(const v of vendes){ out+=v+":\n"; for(const x of map.get(v))out+=String(x.numero||"")+"\n"; out+="\n"; }
    }
    copiarTexto(out.trim()); toast("Copiado","Somente números de gerencial.");
});

qs("#editarProibidos").addEventListener("click",abrirEditorProibidos);
const PH_DESK="Buscar... Excluir: -termo (1) ou [termo,~contém,=igual,proibidos,-proibidos] (múltiplos)  |  Valor: >100, 10-20, 12*3, 12/3, 12?  |  Múltiplos: +  |  Soma: =151 ou =151*2";
const PH_MOB="Buscar... (ex: >50+CARTAO+-VENDEDOR+[-proibidos])";
const ajustarPlaceholder=()=>{const q=qs("#q");if(!q)return;q.placeholder=window.matchMedia("(max-width:680px)").matches?PH_MOB:PH_DESK;};
ajustarPlaceholder(); window.addEventListener("resize",ajustarPlaceholder);

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

document.addEventListener("keydown",e=>{
    if(e.key==="Escape"){
        const ova=qs("#ovAcoes");if(ova&&ova.classList.contains("on")){fecharAcoes();return;}
        const ovv=qs("#ovVend");if(ovv&&ovv.classList.contains("on")){fecharVendedores();return;}
        fecharModal();
    }
});

document.addEventListener("keydown",e=>{
    const k=String(e.key||""); const isInsert=k==="Insert"; const isCapsP=(k.toLowerCase()==="p"&&e.getModifierState&&e.getModifierState("CapsLock")); const isDelete=k==="Delete";
    if(!isInsert&&!isCapsP&&!isDelete)return;
    e.preventDefault(); const inp=qs("#q"); if(!inp)return;
    let v=String(inp.value||"");
    if(isDelete){
        if(v.toLowerCase().indexOf("[-proibidos]")<0)v=(v+" [-proibidos]").trim();
        inp.value=v; qAtual=v.trim(); const p=parseBusca(qAtual); qInc=p.inc; qIgn=p.ign; qValor=consultaPareceValor(qInc); calcSomaSel(); renderTabela(); toast("Filtro","Aplicado [-proibidos].");
    }else{
        if(v.toLowerCase().indexOf("[proibidos]")<0)v=(v+" [proibidos]").trim();
        inp.value=v; qAtual=v.trim(); const p=parseBusca(qAtual); qInc=p.inc; qIgn=p.ign; qValor=consultaPareceValor(qInc); calcSomaSel(); renderTabela(); toast("Filtro","Aplicado [proibidos].");
    }
});

// LÓGICA DO MODAL POR PERÍODO
const btnModalPeriodo = qs("#btnModalPeriodo");
const ovPeriodo = qs("#ovPeriodo");
const fecharPeriodo = qs("#fecharPeriodo");
const btnGerarPeriodo = qs("#btnGerarPeriodo");
const dataInicioInp = qs("#dataInicioInp");
const dataFimInp = qs("#dataFimInp");

if(btnModalPeriodo && ovPeriodo) {
    btnModalPeriodo.addEventListener("click", () => {
        const hoje = new Date().toISOString().split('T')[0];
        if(!dataInicioInp.value) dataInicioInp.value = hoje;
        if(!dataFimInp.value) dataFimInp.value = hoje;
        ovPeriodo.classList.add("on"); ovPeriodo.setAttribute("aria-hidden", "false");
    });
    
    fecharPeriodo.addEventListener("click", () => { ovPeriodo.classList.remove("on"); ovPeriodo.setAttribute("aria-hidden", "true"); });
    ovPeriodo.addEventListener("click", e => { if(e.target === ovPeriodo) { ovPeriodo.classList.remove("on"); ovPeriodo.setAttribute("aria-hidden", "true"); } });
    
    btnGerarPeriodo.addEventListener("click", () => {
        const di = dataInicioInp.value; const df = dataFimInp.value;
        if(!di || !df) return toast("Atenção", "Preencha as duas datas.");
        if(di > df) return toast("Atenção", "Data inicial maior que a final.");
        
        // CORREÇÃO: Define dinamicamente a rota correta (relativa na web, absoluta no arquivo local)
        const isWeb = location.protocol === "http:" || location.protocol === "https:";
        const base = isWeb ? "" : String(DADOS && DADOS.srv_base_rede || DADOS && DADOS.srv_base_local || "").trim();
        
        if(!base && !isWeb) return toast("Atenção", "Abra o link do servidor web para usar isso.");
        
        ovPeriodo.classList.remove("on"); ovPeriodo.setAttribute("aria-hidden", "true");
        toast("Gerando", "Solicitando relatório do período ao servidor...");
        
        const key = String(DADOS && DADOS.srv_key || "").trim(); 
        const url = base + "/__gerar";
        
        fetch(url, { method: "POST", headers: { "x-key": key, "x-data-inicio": di, "x-data-fim": df } })
        .then(r => r.json()).then(res => { 
            if(res && res.ok) { 
                toast("Sucesso", "Relatório de período gerado! Recarregando..."); 
                setTimeout(() => location.reload(), 1500); 
            } else { 
                toast("Erro", "Falha ao gerar: " + (res.erro || res.estado || "Desconhecido")); 
            } 
        })
        .catch(e => toast("Erro", "Erro de conexão ao gerar período."));
    });
}

const fixHead=()=>{
    const tbl=qs("table"); if(!tbl)return;
    const thead=tbl.querySelector("thead"); if(!thead)return;
    const sync=()=>{const sbw=tbl.offsetWidth-tbl.clientWidth;tbl.style.setProperty("--sbw",(sbw>0?sbw:0)+"px");thead.style.transform="translateX("+(-tbl.scrollLeft)+"px)";};
    tbl.addEventListener("scroll",sync,{passive:true}); window.addEventListener("resize",sync); sync();
};

renderTudo();
fixHead();

const LS_KEY_REFRESH_AUTO_HOJE="__relatorio_auto_gerar_hoje__";
const LS_KEY_REFRESH_ALERTA_DIA="__relatorio_alerta_dia__";

const autoUpdater = (() => {
    // Verifica se é um relatório de período (ex: 01/03 a 10/03)
    const isPeriodo = String(DADOS?.data || "").includes(" a ");

    const isWeb = location.protocol === "http:" || location.protocol === "https:";
    const base = isWeb ? "" : String(DADOS && DADOS.srv_base_rede || DADOS && DADOS.srv_base_local || "").trim();
    const key = String(DADOS && DADOS.srv_key || "").trim();
    const api = p => base + p;
    
    let currQtd = DADOS.totais ? (DADOS.totais.qtd || 0) : 0;
    let currTotal = DADOS.totais ? (DADOS.totais.total || 0) : 0;
    let lastReload = Date.now();
    let lastOkMemo = 0; // Guarda a versão do servidor para evitar loop falso
    
    // ========================================================================
    // TEMPO DE CHECAGEM AUTOMÁTICA
    // ========================================================================
    // -> Para testar a cada 5 segundos, altere para: const MS_CHECK = 5 * 1000;
    // -> Para voltar para 10 segundos, use: const MS_CHECK = 10 * 1000;
    const MS_CHECK = 5 * 1000; 
    const MS_FORCE = 30 * 60 * 1000; 

    const recarregar = () => {
        if(!isWeb) { location.reload(); return; }
        const u = new URL(location.href);
        u.hash = ""; u.searchParams.set("r", Date.now());
        location.replace(u.toString());
    };

    const gerarEAtualizar = async (silencioso = false) => {
        if(!key || (!base && !isWeb)) {
            if(!silencioso) recarregar();
            return;
        }
        
        try {
            if(!silencioso) {
                // Usuário clicou em Atualizar manualmente
                toast("Gerando", "Solicitando novo relatório no servidor...");
                await fetch(api("/__gerar"), { method: "POST", headers: { "x-key": key } });
                
                let isRunning = true;
                while(isRunning) {
                    await new Promise(r => setTimeout(r, 1000));
                    const st = await fetch(api("/__status"), {cache: "no-store"}).then(r=>r.json());
                    isRunning = st.running;
                }
                toast("Sucesso", "Novo relatório gerado, atualizando...");
                setTimeout(recarregar, 800);
                return;
            } else {
                // Modo silencioso: Solicita uma nova geração no background
                fetch(api("/__gerar"), { method: "POST", headers: { "x-key": key } }).catch(()=>{});
                
                // Checa o status
                const st = await fetch(api("/__status"), {cache: "no-store"}).then(r=>r.json());
                
                if (st && st.last_ok) {
                    // Se for a primeira vez rodando, apenas memoriza o tempo
                    if (lastOkMemo === 0) {
                        lastOkMemo = st.last_ok;
                    } 
                    // Se o servidor tiver um arquivo de fato mais novo...
                    else if (st.last_ok !== lastOkMemo) {
                        lastOkMemo = st.last_ok;
                        
                        // Baixa o HTML silenciosamente para VER SE OS TOTAIS MUDARAM
                        const urlBusca = api("/relatorio_atual.html?t=" + Date.now());
                        const res = await fetch(urlBusca, {cache: "no-store"});
                        const html = await res.text();
                        const match = html.match(/<script id="dados" type="application\/json">([\s\S]*?)<\/script>/i);
                        
                        if(match && match[1]) {
                            const newDados = JSON.parse(match[1]);
                            const newQtd = newDados.totais ? (newDados.totais.qtd || 0) : 0;
                            const newTotal = newDados.totais ? (newDados.totais.total || 0) : 0;
                            
                            // Compara estritamente os valores. Acaba com o falso positivo!
                            if(newQtd !== currQtd || newTotal !== currTotal) {
                                toast("Atualização", "Nova venda detectada! Atualizando painel...");
                                setTimeout(recarregar, 2000);
                                return;
                            }
                        }
                    }
                }
            }
        } catch(e) {
            if(!silencioso) toast("Erro", "Falha de conexão com o servidor.");
        }

        if(silencioso && (Date.now() - lastReload >= MS_FORCE)) {
            recarregar();
        }
    };

    // LOOP PROTEGIDO: O robô roda se NÃO for um relatório de período
    if (!isPeriodo) {
        const iniciarLoop = () => {
            setTimeout(async () => {
                if(!document.hidden) {
                    await gerarEAtualizar(true);
                }
                iniciarLoop();
            }, MS_CHECK);
        };
        iniciarLoop();
    }

    const btn = qs("#atualizar");
    if(btn) btn.addEventListener("click", () => gerarEAtualizar(false));

    return { gerarEAtualizar };
})();
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