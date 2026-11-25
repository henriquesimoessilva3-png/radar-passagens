const $ = id => document.getElementById(id);
const PADRAO = "henriquesimoessilva3-png/radar-passagens";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function ler(url, titulo) {
  const u = new URL(url), p = u.searchParams, h = u.hostname, r = {site: h.replace(/^www\./, "")};
  const q = p.get("q") || "";
  if (h.includes("booking.com")) {
    r.tipo = "hotel";
    r.q = p.get("ss") || titulo.replace(/\s*[-|–].*$/, "");
    r.checkin = p.get("checkin"); r.checkout = p.get("checkout"); r.adultos = p.get("group_adults");
    const nf = p.get("nflt") || "";
    r.ai = nf.includes("mealplan=4"); r.praia = nf.includes("ht_beach=1");
  } else if (h.includes("google.") && u.pathname.includes("/travel/flights")) {
    r.tipo = "voo";
    const m = q.match(/from\s+([A-Z]{3}).*?to\s+([A-Z]{3}).*?on\s+(\d{4}-\d{2}-\d{2})(?:.*?through\s+(\d{4}-\d{2}-\d{2}))?/i);
    if (m) Object.assign(r, {origem: m[1].toUpperCase(), destino: m[2].toUpperCase(), ida: m[3], volta: m[4]});
  } else if (h.includes("google.") && u.pathname.includes("/travel")) {
    r.tipo = "hotel"; r.q = q || titulo.replace(/\s*[-:|].*$/, "");
  } else if (/hoteis\.com|hotels\.com|expedia/.test(h)) {
    r.tipo = "hotel"; r.q = p.get("destination") || titulo.replace(/\s*[-|].*$/, "");
    r.checkin = p.get("startDate") || p.get("chkin"); r.checkout = p.get("endDate") || p.get("chkout");
    r.adultos = p.get("adults"); r.ai = (p.get("mealPlan") || "").includes("ALL_INCLUSIVE");
  } else if (h.includes("kayak") || h.includes("momondo")) {
    const f = u.pathname.match(/flights\/([A-Z]{3})[^-/]*-([A-Z]{3})[^/]*\/(\d{4}-\d{2}-\d{2})\/?(\d{4}-\d{2}-\d{2})?/i);
    const hh = u.pathname.match(/hotels\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})/);
    if (f) Object.assign(r, {tipo: "voo", origem: f[1].toUpperCase(), destino: f[2].toUpperCase(), ida: f[3], volta: f[4]});
    else if (hh) Object.assign(r, {tipo: "hotel", q: decodeURIComponent(hh[1]).replace(/[-,]+/g, " "), checkin: hh[2], checkout: hh[3]});
  } else if (h.includes("decolar")) {
    const f = u.pathname.match(/roundtrip\/([A-Z]{3})\/([A-Z]{3})\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})/i);
    if (f) Object.assign(r, {tipo: "voo", origem: f[1].toUpperCase(), destino: f[2].toUpperCase(), ida: f[3], volta: f[4]});
    else Object.assign(r, {tipo: "hotel", q: titulo.replace(/\s*[-|].*$/, "")});
  } else {
    r.tipo = "hotel"; r.q = titulo;
  }
  return r;
}

function tipo() { $("w").className = "w tipo-" + $("tipo").value; }

chrome.storage.sync.get({repo: PADRAO}, ({repo}) => {
  $("repo").value = repo;
  const [dono, nome] = repo.split("/");
  $("painel").href = `https://${dono}.github.io/${nome}/#viagens`;
});
$("repo").addEventListener("change", () => chrome.storage.sync.set({repo: $("repo").value.trim() || PADRAO}));
$("tipo").addEventListener("change", tipo);

chrome.tabs.query({active: true, currentWindow: true}, ([aba]) => {
  let r = {};
  try { r = ler(aba.url, aba.title || ""); } catch (e) {}
  $("site").textContent = r.site ? `Página: ${r.site}` : "Não reconheci a página: preencha à mão.";
  $("tipo").value = r.tipo || "hotel";
  for (const k of ["q", "checkin", "checkout", "origem", "destino", "ida", "volta", "adultos"]) if (r[k]) $(k).value = r[k];
  $("ai").checked = !!r.ai; $("praia").checked = !!r.praia;
  $("nome").value = r.tipo === "voo" && r.origem ? `${r.origem} → ${r.destino}` : (r.q || "");
  tipo();
});

$("go").addEventListener("click", () => {
  const t = $("tipo").value, v = {tipo: t, nome: $("nome").value.trim(), adultos: +$("adultos").value || 2, queda_alerta: +$("queda").value};
  if (t === "voo") {
    Object.assign(v, {origem: $("origem").value.toUpperCase(), destino: $("destino").value.toUpperCase(), ida: $("ida").value, volta: $("volta").value});
    if (!/^[A-Z]{3}$/.test(v.origem) || !/^[A-Z]{3}$/.test(v.destino) || !ISO.test(v.ida) || !ISO.test(v.volta)) return alert("Preencha origem, destino (código de 3 letras), ida e volta.");
  } else {
    Object.assign(v, {q: $("q").value.trim(), checkin: $("checkin").value, checkout: $("checkout").value, all_inclusive: $("ai").checked, beira_mar: $("praia").checked});
    if ($("nota").value) v.nota_min = +$("nota").value;
    if ($("est").value) v.estrelas = $("est").value.split(",").map(Number);
    if (!v.q || !ISO.test(v.checkin) || !ISO.test(v.checkout)) return alert("Preencha a busca, o check-in e o check-out.");
  }
  if (!v.nome) v.nome = t === "voo" ? `${v.origem} → ${v.destino}` : v.q;
  const repo = $("repo").value.trim() || PADRAO;
  const corpo = "Enviado pela extensão do Radar.\n\n```json\n" + JSON.stringify(v, null, 2) + "\n```";
  chrome.tabs.create({url: `https://github.com/${repo}/issues/new?title=${encodeURIComponent("Monitorar: " + v.nome)}&body=${encodeURIComponent(corpo)}`});
});
