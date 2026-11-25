// Ponte entre o painel do Radar (página) e a extensão.
const VERSAO = chrome.runtime.getManifest().version;
const avisa = () => window.postMessage({radarExt: "ok", versao: VERSAO}, "*");
avisa(); document.addEventListener("DOMContentLoaded", avisa);
window.addEventListener("message", e => {
  if (e.source !== window || !e.data) return;
  if (e.data.radar === "ping") avisa();
  if (e.data.radar === "buscar") chrome.runtime.sendMessage({tipo: "buscar", id: e.data.id, p: e.data.p});
  if (e.data.radar === "notas") chrome.runtime.sendMessage({tipo: "notas", id: e.data.id, nomes: e.data.nomes, destino: e.data.destino});
  if (e.data.radar === "datas") chrome.runtime.sendMessage({tipo: "datas", id: e.data.id, p: e.data.p, datas: e.data.datas});
  if (e.data.radar === "cancelar") chrome.runtime.sendMessage({tipo: "cancelar", id: e.data.id});
});
chrome.runtime.onMessage.addListener(m => { if (m && m.radarExt) window.postMessage(m, "*"); });
