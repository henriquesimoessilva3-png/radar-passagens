// Endereços de busca e leitores de cada site. Os leitores rodam DENTRO da página do site.

function tfsGoogle(p) {
  const vi = n => { const o = []; while (n > 127) { o.push((n & 127) | 128); n >>>= 7; } o.push(n); return o; };
  const ld = (f, b) => [...vi(f << 3 | 2), ...vi(b.length), ...b];
  const vr = (f, n) => [...vi(f << 3), ...vi(n)];
  const s = t => [...new TextEncoder().encode(t)];
  const leg = (d, a, b) => [...ld(2, s(d)), ...ld(13, ld(2, s(a))), ...ld(14, ld(2, s(b)))];
  let m = [...ld(3, leg(p.ida, p.origem, p.aeroporto))];
  if (p.volta) m = m.concat(ld(3, leg(p.volta, p.aeroporto, p.origem)));
  for (let i = 0; i < (+p.adultos || 1); i++) m = m.concat(vr(8, 1));
  m = m.concat(vr(9, 1), vr(19, p.volta ? 1 : 2));
  return btoa(String.fromCharCode(...m)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function montarFontes(p) {
  const d = encodeURIComponent(p.destino), ad = +p.adultos || 2, F = [];
  const quer = n => !p.fontes || p.fontes.includes(n);
  if (p.origem && p.aeroporto && p.ida) {
    if (quer("Google Voos")) F.push({nome: "Google Voos", tipo: "voo", leitor: "googleVoos",
      url: `https://www.google.com/travel/flights/search?tfs=${tfsGoogle(p)}&hl=pt-BR&curr=BRL`});
    if (quer("Kayak")) F.push({nome: "Kayak", tipo: "voo", leitor: "kayakVoos", limite: 45000,
      url: `https://www.kayak.com.br/flights/${p.origem}-${p.aeroporto}/${p.ida}${p.volta ? "/" + p.volta : ""}/${ad}adults?sort=price_a`});
  }
  if (p.destino && p.ida && p.volta) {
    const nf = [];
    if (p.ai) nf.push("mealplan=4");
    (p.estrelas || []).forEach(e => nf.push("class=" + e));
    if (p.nota) nf.push("review_score=" + p.nota * 10);
    if (p.praia) nf.push("ht_beach=1");
    if (quer("Booking")) F.push({nome: "Booking", tipo: "hotel", leitor: "booking",
      url: `https://www.booking.com/searchresults.pt-br.html?ss=${d}&checkin=${p.ida}&checkout=${p.volta}&group_adults=${ad}&no_rooms=1&group_children=0&selected_currency=BRL&order=price&nflt=${encodeURIComponent(nf.join(";"))}`});
    const est = (p.estrelas || []).map(e => "&star=" + e * 10).join("");
    const gr = p.nota ? "&guestRating=" + ({7: 35, 8: 40, 9: 45}[p.nota] || 40) : "";
    if (quer("Hoteis.com")) F.push({nome: "Hoteis.com", tipo: "hotel", leitor: "hoteiscom",
      url: `https://www.hoteis.com/Hotel-Search?destination=${d}&startDate=${p.ida}&endDate=${p.volta}&adults=${ad}&rooms=1${p.ai ? "&mealPlan=ALL_INCLUSIVE" : ""}${est}${gr}&sort=PRICE_LOW_TO_HIGH`});
  }
  return F;
}

const LEITORES = {
  googleVoos: function () {
    const num = t => +String(t).replace(/[^\d]/g, "");
    const vistos = new Set(), itens = [];
    document.querySelectorAll("li").forEach(li => {
      const t = li.innerText;
      if (!/R\$\s?[\d.]+/.test(t) || !/\d{1,2}:\d{2}/.test(t)) return;
      const L = t.split("\n").map(x => x.trim()).filter(Boolean);
      const iSai = L.findIndex(x => /^\d{1,2}:\d{2}$/.test(x));
      const iChega = L.findIndex((x, i) => i > iSai && /^\d{1,2}:\d{2}(\+\d)?$/.test(x));
      const cia = iChega >= 0 ? L[iChega + 1] : "";
      const dur = L.find(x => /^\d+\s?h(\s?\d+\s?min)?$/.test(x)) || "";
      const par = L.find(x => /parada|Sem escalas|Direto/i.test(x)) || "";
      const precos = t.match(/R\$\s?[\d.]+/g) || [];
      const preco = num(precos[precos.length - 1]);
      const k = [L[iSai], L[iChega], cia, preco].join("|");
      if (!preco || iSai < 0 || iChega < 0 || !cia || L.length > 40 || vistos.has(k)) return; vistos.add(k);
      itens.push({cia, sai: L[iSai], chega: L[iChega], dur, paradas: /Sem escalas|Direto/i.test(par) ? 0 : +((par.match(/(\d+)\s*parada/) || [])[1]) || null, rota: L.find(x => /^[A-Z]{3}–[A-Z]{3}$/.test(x)) || "", preco, total: true});
    });
    return {itens: itens.sort((a, b) => a.preco - b.preco).slice(0, 20)};
  },
  kayakVoos: function (p) {
    if (/captcha|robô|robot/i.test(document.title + (document.querySelector("h1") || {}).innerText)) return {bloqueio: "Kayak pediu verificação"};
    const num = t => +String(t).replace(/[^\d]/g, "");
    const vistos = new Set(), itens = [];
    document.querySelectorAll('div[role="group"]').forEach(g => {
      const t = g.innerText;
      const tot = t.match(/R\$\s?([\d.]+)\s*no total/);
      if (!tot) return;
      const L = t.split("\n").map(x => x.trim()).filter(Boolean);
      const hor = L.find(x => /^\d{1,2}:\d{2}\s*–\s*\d{1,2}:\d{2}/.test(x)) || "";
      const iP = L.findIndex(x => /^R\$\s?[\d.]+$/.test(x));
      const cia = iP > 0 ? L[iP - 1] : "";
      const esc = L.find(x => /escala|Direto/i.test(x)) || "";
      const dur = L.find(x => /^\d+h\s?\d*min$/.test(x)) || "";
      const preco = num(tot[1]);
      const k = hor + cia + preco;
      if (!hor || vistos.has(k)) return; vistos.add(k);
      const [sai, chega] = hor.split("–").map(x => x.trim());
      itens.push({cia, sai, chega, dur, paradas: /Direto/i.test(esc) ? 0 : +((esc.match(/(\d+)\s*escala/) || [])[1]) || null, preco, total: true});
    });
    return {itens: itens.sort((a, b) => a.preco - b.preco).slice(0, 20)};
  },
  booking: function () {
    const num = t => +String(t || "").replace(/[^\d]/g, "");
    const itens = [...document.querySelectorAll('[data-testid="property-card"]')].map(c => {
      const q = s => c.querySelector(s);
      const t = c.innerText;
      const nota = (t.match(/Com nota (\d+,\d)/) || [])[1];
      const img = q('img[data-testid="image"]');
      return {
        nome: (q('[data-testid="title"]') || {}).innerText || "",
        preco: num((q('[data-testid="price-and-discounted-price"]') || {}).innerText) + num((q('[data-testid="taxes-and-charges"]') || {}).innerText),
        nota: nota ? +nota.replace(",", ".") : null,
        avaliacoes: num((t.match(/([\d.]+) avaliaç/) || [])[1]) || null,
        estrelas: c.querySelectorAll('[data-testid="rating-stars"] > span, [data-testid="rating-squares"] > span').length || null,
        local: (q('[data-testid="address"]') || {}).innerText || "",
        oferta: (t.match(/Oferta de Black Friday|Oferta por tempo limitado|Oferta antecipada[^\n]*|Oferta[^\n]{0,30}/) || [""])[0],
        original: num((t.match(/Preço original: R\$\s?([\d.]+)/) || [])[1]) || null,
        ai: /All inclusive|Tudo incluído/i.test(t),
        foto: img ? img.src : "",
        link: (q('a[data-testid="title-link"]') || {}).href || ""
      };
    }).filter(x => x.nome && x.preco);
    return {itens};
  },
  hoteiscom: function () {
    window.scrollBy(0, 1500);
    const num = t => +String(t || "").replace(/[^\d]/g, "");
    const itens = [...document.querySelectorAll('[data-stid="lodging-card-responsive"]')].map(c => {
      const t = c.innerText;
      const nome = ((t.match(/Mais informações sobre (.+?),? abre/) || [])[1] || ((c.querySelector("h3") || {}).innerText || "").replace(/^Galeria de fotos de /, "")).trim();
      const nota = (t.match(/(\d+,\d) de 10/) || [])[1];
      const img = c.querySelector("img");
      const a = c.querySelector('a[data-stid="open-product-information"], a[data-stid="open-hotel-information"]');
      return {
        nome, preco: num((t.match(/Total:\s*R\$\s?([\d.]+)/) || [])[1]),
        nota: nota ? +nota.replace(",", ".") : null,
        avaliacoes: num((t.match(/([\d.]+) avaliaç/) || [])[1]) || null,
        local: (t.match(/\n(A \d+ min[^\n]*|Na praia)\n/) || [])[1] || "",
        oferta: (t.match(/Black Friday: \d+% OFF|\d+% OFF/) || [""])[0],
        ai: /Tudo incluído|All inclusive/i.test(t),
        foto: img ? img.src : "", link: a ? a.href : ""
      };
    }).filter(x => x.nome && x.preco);
    return {itens};
  }
};
