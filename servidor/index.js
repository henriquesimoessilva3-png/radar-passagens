// Radar de Viagens: busca de voos e hoteis para o celular (Google Voos e Google Hoteis via SerpApi).
// A chave do SerpApi fica no Secret Manager (segredo "serpapi"), nunca no codigo.
const functions = require("@google-cloud/functions-framework");

const ORIGENS = [/^https:\/\/henriquesimoessilva3-png\.github\.io$/, /^http:\/\/localhost(:\d+)?$/];
const LIMITE_DIA = 30; // teto de buscas por dia nesta instancia, para proteger a cota gratis
let chave = null, cont = {dia: "", n: 0};

async function lerChave() {
  if (chave) return chave;
  const md = "http://metadata.google.internal/computeMetadata/v1/";
  const h = {"Metadata-Flavor": "Google"};
  const proj = await (await fetch(md + "project/project-id", {headers: h})).text();
  const tok = (await (await fetch(md + "instance/service-accounts/default/token", {headers: h})).json()).access_token;
  const r = await fetch(`https://secretmanager.googleapis.com/v1/projects/${proj}/secrets/serpapi/versions/latest:access`, {headers: {Authorization: "Bearer " + tok}});
  if (!r.ok) throw new Error("Chave do SerpApi ainda não cadastrada no Secret Manager (segredo 'serpapi').");
  chave = Buffer.from((await r.json()).payload.data, "base64").toString().trim();
  return chave;
}

async function serp(params) {
  const u = new URL("https://serpapi.com/search.json");
  Object.entries({...params, api_key: await lerChave()}).forEach(([k, v]) => v != null && v !== "" && u.searchParams.set(k, v));
  const r = await fetch(u);
  return r.json();
}

const hm = m => m == null ? "" : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}min`;

async function voos(q) {
  const d = await serp({engine: "google_flights", departure_id: q.origem, arrival_id: q.aeroporto, outbound_date: q.ida, return_date: q.volta || undefined,
    type: q.volta ? 1 : 2, adults: q.adultos || 1, currency: "BRL", gl: "br", hl: "pt-br", include_airlines: q.cia || undefined, stops: q.paradas || undefined});
  if (d.error) return {erro: d.error, itens: []};
  const lista = [...(d.best_flights || []), ...(d.other_flights || [])];
  const itens = lista.filter(f => f.price).map(f => {
    const t = f.flights || [];
    return {cia: [...new Set(t.map(x => x.airline))].join(", "), sai: (t[0]?.departure_airport?.time || "").slice(11), chega: (t[t.length - 1]?.arrival_airport?.time || "").slice(11),
      dur: hm(f.total_duration), paradas: Math.max(0, t.length - 1), preco: f.price};
  }).sort((a, b) => a.preco - b.preco);
  return {itens, google: d.price_insights ? {nivel: d.price_insights.price_level, faixa: d.price_insights.typical_price_range} : null};
}

async function hoteis(q) {
  const notaMin = q.notaG ? +q.notaG : null;
  const d = await serp({engine: "google_hotels", q: (q.ai === "1" ? "resorts all inclusive " : "hotéis ") + q.destino, check_in_date: q.ida, check_out_date: q.volta,
    adults: q.adultos || 2, currency: "BRL", gl: "br", hl: "pt-br", hotel_class: q.estrelas || undefined, rating: notaMin ? (notaMin >= 4.5 ? 9 : notaMin >= 4 ? 8 : 7) : undefined, sort_by: 3});
  if (d.error) return {erro: d.error, itens: []};
  const noites = Math.max(1, Math.round((new Date(q.volta) - new Date(q.ida)) / 864e5));
  const itens = (d.properties || []).filter(p => p.type !== "vacation rental").map(p => {
    const tot = p.total_rate?.extracted_lowest || (p.rate_per_night?.extracted_lowest ? p.rate_per_night.extracted_lowest * noites : null);
    const amen = (p.amenities || []).join(" ").toLowerCase();
    return {nome: p.name, preco: tot ? Math.round(tot) : null, notaG: p.overall_rating || null, avG: p.reviews || null, estrelas: p.extracted_hotel_class || null,
      foto: p.images?.[0]?.thumbnail || "", link: p.link || "", ai: /all.inclusive|tudo inclu/.test(amen + " " + p.name.toLowerCase()), praia: /praia|beach/.test(amen)};
  }).filter(h => h.preco).sort((a, b) => a.preco - b.preco);
  return {itens};
}

functions.http("buscar", async (req, res) => {
  const o = req.get("origin") || "";
  if (ORIGENS.some(r => r.test(o))) res.set("Access-Control-Allow-Origin", o);
  res.set("Access-Control-Allow-Methods", "GET");
  if (req.method === "OPTIONS") return res.status(204).send("");
  const hoje = new Date().toISOString().slice(0, 10);
  if (cont.dia !== hoje) cont = {dia: hoje, n: 0};
  if (++cont.n > LIMITE_DIA) return res.status(429).json({erro: "Limite de buscas do dia atingido."});
  const q = req.query;
  try {
    const [v, h] = await Promise.all([
      q.origem && q.aeroporto && q.ida ? voos(q) : Promise.resolve(null),
      q.destino && q.ida && q.volta && q.so !== "voo" ? hoteis(q) : Promise.resolve(null)
    ]);
    res.json({voos: v, hoteis: h});
  } catch (e) {
    res.status(500).json({erro: String(e.message || e)});
  }
});
