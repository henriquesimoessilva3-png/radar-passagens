// Radar de Viagens: abre as buscas em abas de fundo, lê os resultados e devolve ao painel.
importScripts("fontes.js");

const ativos = {};
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
