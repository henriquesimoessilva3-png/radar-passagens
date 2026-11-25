// Radar de Viagens: abre as buscas em abas de fundo, lê os resultados e devolve ao painel.
importScripts("fontes.js");

const ativos = {};

// Autoatualização: quando a pasta da extensão no computador recebe arquivos novos (git pull automático),
// a extensão percebe que a versão no disco mudou e se recarrega sozinha.
async function versaoNoDisco() {
  try { return (await (await fetch(chrome.runtime.getURL("manifest.json") + "?t=" + Date.now(), {cache: "no-store"})).json()).version; } catch (e) { return null; }
}
async function checarAtualizacao() {
  const v = await versaoNoDisco();
  if (v && v !== chrome.runtime.getManifest().version && !Object.keys(ativos).length) chrome.runtime.reload();
}
chrome.alarms.create("atualiza", {periodInMinutes: 15});
chrome.alarms.onAlarm.addListener(a => { if (a.name === "atualiza") checarAtualizacao(); });
chrome.runtime.onStartup.addListener(checarAtualizacao);
const espera = ms => new Promise(r => setTimeout(r, ms));

async function rodarFonte(f, p, envia, busca) {
  envia({fonte: f.nome, tipo: f.tipo, status: "buscando", url: f.url});
  let tab;
  try {
    tab = await chrome.tabs.create({url: f.url, active: false});
    busca.abas.push(tab.id);
    let itens = [], ultimo = -1, iguais = 0, fim = Date.now() + (f.limite || 40000);
    await espera(3500);
    while (Date.now() < fim && !busca.cancelada) {
      let r;
      try {
        [{result: r}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: LEITORES[f.leitor], args: [p]});
      } catch (e) { r = null; }
      if (r && r.bloqueio) { envia({fonte: f.nome, tipo: f.tipo, status: "erro", erro: r.bloqueio, url: f.url}); return; }
      if (r && r.itens) itens = r.itens;
      if (itens.length && itens.length === ultimo) { if (++iguais >= 2) break; } else iguais = 0;
      ultimo = itens.length;
      envia({fonte: f.nome, tipo: f.tipo, status: "parcial", itens, url: f.url});
      await espera(2000);
    }
    envia({fonte: f.nome, tipo: f.tipo, status: itens.length ? "ok" : "vazio", itens, url: f.url});
  } catch (e) {
    envia({fonte: f.nome, tipo: f.tipo, status: "erro", erro: String(e.message || e), url: f.url});
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((m, sender) => {
  const tabPainel = sender.tab && sender.tab.id;
  if (!tabPainel) return;
  if (m.tipo === "cancelar" && ativos[m.id]) {
    ativos[m.id].cancelada = true;
    ativos[m.id].abas.forEach(t => chrome.tabs.remove(t).catch(() => {}));
    return;
  }
  if (m.tipo === "recarregar") { chrome.runtime.reload(); return; }
  if (m.tipo === "checar") { checarAtualizacao(); return; }
  if (m.tipo === "notas") {
    const envia = d => chrome.tabs.sendMessage(tabPainel, {radarExt: "notaG", id: m.id, ...d}).catch(() => {});
    const fila = [...m.nomes];
    const trab = async () => {
      let tab;
      try {
        while (fila.length) {
          const nome = fila.shift(), url = urlGoogleHotel(nome, m.destino);
          if (!tab) tab = await chrome.tabs.create({url, active: false}); else await chrome.tabs.update(tab.id, {url});
          await espera(2500);
          let r = null;
          for (let i = 0; i < 6 && !(r && r.itens && r.itens.length); i++) {
            try { [{result: r}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: LEITORES.googleUm}); } catch (e) { r = null; }
            if (!(r && r.itens && r.itens.length)) await espera(1200);
          }
          envia({consulta: nome, achado: r && r.itens && r.itens[0] || null});
        }
      } finally { if (tab) chrome.tabs.remove(tab.id).catch(() => {}); }
    };
    Promise.all([trab(), trab()]).then(() => envia({fim: true}));
    return;
  }
  if (m.tipo === "datas") {
    const busca = ativos[m.id] = {cancelada: false, abas: []};
    const envia = d => chrome.tabs.sendMessage(tabPainel, {radarExt: "data", id: m.id, ...d}).catch(() => {});
    const fila = m.datas.map(d => ({...m.p, ...d}));
    const trab = async () => {
      let tab;
      try {
        while (fila.length && !busca.cancelada) {
          const q = fila.shift();
          const url = `https://www.google.com/travel/flights/search?tfs=${tfsGoogle(q)}&hl=pt-BR&curr=BRL`;
          if (!tab) { tab = await chrome.tabs.create({url, active: false}); busca.abas.push(tab.id); } else await chrome.tabs.update(tab.id, {url});
          await espera(3000);
          let r = null, ult = -1;
          for (let i = 0; i < 8; i++) {
            try { [{result: r}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: LEITORES.googleVoos}); } catch (e) { r = null; }
            const n = r && r.itens ? r.itens.length : 0;
            const vazio = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => /Nenhum voo|No flights|Não encontramos/i.test(document.body.innerText)}).then(x => x[0].result).catch(() => false);
            if (vazio && !n) break;
            if (n && n === ult) break;
            ult = n; await espera(1500);
          }
          const it = r && r.itens || [];
          envia({ida: q.ida, volta: q.volta, url, preco: it.length ? it[0].preco : null, cia: it.length ? it[0].cia : "", paradas: it.length ? it[0].paradas : null, dur: it.length ? it[0].dur : "", n: it.length});
        }
      } finally { if (tab) chrome.tabs.remove(tab.id).catch(() => {}); }
    };
    Promise.all([trab(), trab()]).then(() => { envia({fim: true}); delete ativos[m.id]; });
    return;
  }
  if (m.tipo !== "buscar") return;
  const busca = ativos[m.id] = {cancelada: false, abas: []};
  const envia = d => chrome.tabs.sendMessage(tabPainel, {radarExt: "res", id: m.id, ...d}).catch(() => {});
  const fontes = montarFontes(m.p);
  envia({status: "inicio", fontes: fontes.map(f => ({nome: f.nome, tipo: f.tipo, url: f.url}))});
  // no máximo 3 abas ao mesmo tempo
  (async () => {
    const fila = [...fontes];
    const trab = async () => { while (fila.length && !busca.cancelada) await rodarFonte(fila.shift(), m.p, envia, busca); };
    await Promise.all([trab(), trab(), trab()]);
    envia({status: "fim"});
    delete ativos[m.id];
  })();
});
