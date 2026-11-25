#!/usr/bin/env python3
"""Viagens monitoradas: voo com data marcada e hoteis de um destino.

Le config.json -> "viagens" e grava data/viagens.json (historico + alertas).
Usa a mesma SerpApi e o mesmo contador mensal do fetch.py (data/state.json).

Uso: SERPAPI_KEY=xxxx python viagens.py
So usa a biblioteca padrao do Python.
"""
import datetime as dt
import json
import os
import sys
import unicodedata
from pathlib import Path
from zoneinfo import ZoneInfo

from fetch import DADOS, RAIZ, buscar, gravar, ler


def norm(t):
    t = unicodedata.normalize("NFD", str(t or "")).encode("ascii", "ignore").decode()
    return t.lower()


def total(prop):
    """Preco total da estadia (com impostos quando o Google informa)."""
    for chave in ("total_rate", "rate_per_night"):
        r = prop.get(chave) or {}
        v = r.get("extracted_lowest") or r.get("extracted_before_taxes_fees")
        if v:
            return round(v), chave == "total_rate"
    return None, False


def passa_filtros(prop, v):
    if prop.get("type") not in (None, "hotel"):
        return False
    est = prop.get("extracted_hotel_class")
    if v.get("estrelas") and est and est not in v["estrelas"]:
        return False
    nota = prop.get("overall_rating")
    if v.get("nota_min") and (nota is None or nota < v["nota_min"]):
        return False
    amen = norm(" ".join(prop.get("amenities") or []) + " " + prop.get("name", ""))
    if v.get("all_inclusive") and "all-inclusive" not in amen and "all inclusive" not in amen \
            and "tudo incluido" not in amen:
        return False
    so_amen = norm(" ".join(prop.get("amenities") or []))
    if v.get("beira_mar") and "praia" not in so_amen and "beach" not in so_amen:
        return False
    return True


def monitorar_hotel(v, dia, item):
    params = {
        "engine": "google_hotels",
        "q": v["q"],
        "check_in_date": v["checkin"],
        "check_out_date": v["checkout"],
        "adults": v.get("adultos", 2),
        "currency": "BRL",
        "gl": "br",
        "hl": "pt-br",
    }
    if v.get("estrelas"):
        params["hotel_class"] = ",".join(str(e) for e in v["estrelas"])
    if v.get("nota_min"):
        # Google: 7 = 3,5+, 8 = 4,0+, 9 = 4,5+
        params["rating"] = 9 if v["nota_min"] >= 4.5 else 8 if v["nota_min"] >= 4.0 else 7
    resp = buscar(params)
    if resp.get("error"):
        return resp["error"]
    hoteis = item.setdefault("hoteis", {})
    noites = (dt.date.fromisoformat(v["checkout"]) - dt.date.fromisoformat(v["checkin"])).days
    destaques = [norm(n) for n in v.get("destaques", [])]
    n = 0
    for p in resp.get("properties") or []:
        if not passa_filtros(p, v):
            continue
        preco, ja_total = total(p)
        if not preco:
            continue
        if not ja_total:
            preco *= noites
        nome = p.get("name", "?")
        h = hoteis.setdefault(nome, {"hist": {}})
        h.update(
            estrelas=p.get("extracted_hotel_class"),
            nota=p.get("overall_rating"),
            avaliacoes=p.get("reviews"),
            link=p.get("link") or "",
            token=p.get("property_token") or "",
            gps=p.get("gps_coordinates"),
            oferta=p.get("deal_description") or p.get("deal") or "",
            destaque=any(d in norm(nome) for d in destaques),
            visto=dia,
        )
        h["hist"][dia] = min(h["hist"].get(dia, preco), preco)
        n += 1
    return f"{n} hotéis"


def monitorar_voo(v, dia, item):
    resp = buscar({
        "engine": "google_flights",
        "departure_id": v["origem"],
        "arrival_id": v["destino"],
        "outbound_date": v["ida"],
        "return_date": v["volta"],
        "adults": v.get("adultos", 1),
        "type": 1,
        "currency": "BRL",
        "gl": "br",
        "hl": "pt-br",
    })
    if resp.get("error"):
        return resp["error"]
    voos = (resp.get("best_flights") or []) + (resp.get("other_flights") or [])
    opcoes = []
    for f in voos:
        if not f.get("price"):
            continue
        trechos = f.get("flights") or []
        opcoes.append({
            "preco": f["price"],
            "cias": sorted({t.get("airline", "") for t in trechos}),
            "paradas": max(0, len(trechos) - 1),
            "duracao": f.get("total_duration"),
        })
    if not opcoes:
        return "sem voos"
    opcoes.sort(key=lambda o: o["preco"])
    item["opcoes"] = opcoes[:5]
    melhor = opcoes[0]["preco"]
    hist = item.setdefault("hist", {})
    hist[dia] = min(hist.get(dia, melhor), melhor)
    pi = resp.get("price_insights") or {}
    if pi.get("price_level"):
        item["google"] = {"nivel": pi["price_level"], "faixa": pi.get("typical_price_range")}
    return f"menor {melhor}"


def alertas_do_dia(v, item, dia):
    """Queda >= queda_alerta contra o menor preco visto antes de hoje."""
    lim = v.get("queda_alerta", 0.05)
    saida = []

    def checa(nome, hist, extra=""):
        hoje = hist.get(dia)
        antes = [p for d, p in hist.items() if d < dia]
        if hoje is None or not antes:
            return
        ref = min(antes)
        if hoje <= ref * (1 - lim):
            saida.append({"viagem": v["nome"], "item": nome, "de": ref, "para": hoje,
                          "queda": round(1 - hoje / ref, 3), "extra": extra})

    if v["tipo"] == "voo":
        checa(f"{v['origem']}–{v['destino']}", item.get("hist", {}))
    else:
        for nome, h in item.get("hoteis", {}).items():
            est = f"{h['estrelas']}★" if h.get("estrelas") else ""
            checa(nome, h["hist"], est)
    return saida


def main(hoje=None):
    if not os.environ.get("SERPAPI_KEY"):
        sys.exit("Falta a variavel SERPAPI_KEY.")
    cfg = ler(RAIZ / "config.json", None) or {}
    hoje = hoje or dt.datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    dia, mes = hoje.isoformat(), hoje.isoformat()[:7]

    estado = ler(DADOS / "state.json", {})
    uso = estado.setdefault("uso", {})
    dados = ler(DADOS / "viagens.json", {"itens": {}})
    itens = dados.setdefault("itens", {})

    ativas = [v for v in cfg.get("viagens", [])
              if v.get("ativo", True) and (v.get("volta") or v.get("checkout") or "9999") >= dia]
    orcamento = cfg.get("orcamento_viagens", 2)
    cursor = estado.get("cursor_viagens", 0)
    fila = [ativas[(cursor + i) % len(ativas)] for i in range(min(orcamento, len(ativas)))] if ativas else []
    estado["cursor_viagens"] = (cursor + len(fila)) % max(1, len(ativas))

    novos = []
    for v in fila:
        if uso.get(mes, 0) >= cfg.get("limite_mensal", 245):
            print("Limite mensal de buscas atingido; parando.")
            break
        item = itens.setdefault(v["id"], {})
        res = monitorar_voo(v, dia, item) if v["tipo"] == "voo" else monitorar_hotel(v, dia, item)
        uso[mes] = uso.get(mes, 0) + 1
        item["atualizado"] = dia
        print(f"{v['id']}: {res}")
        novos += alertas_do_dia(v, item, dia)

    # guarda so os ultimos 120 dias de historico
    for item in itens.values():
        for h in [item] + list(item.get("hoteis", {}).values()):
            if "hist" in h:
                h["hist"] = {d: h["hist"][d] for d in sorted(h["hist"])[-120:]}

    hist_alertas = [a for a in dados.get("alertas", []) if a.get("dia", "") >= (hoje - dt.timedelta(days=30)).isoformat()]
    for a in novos:
        a["dia"] = dia
    dados["alertas"] = novos + hist_alertas
    dados["viagens"] = cfg.get("viagens", [])
    dados["atualizado"] = dt.datetime.now(ZoneInfo("America/Sao_Paulo")).strftime("%Y-%m-%d %H:%M")
    gravar(DADOS / "viagens.json", dados)
    gravar(DADOS / "state.json", estado)
    gravar(DADOS / "alertas_novos.json", novos)
    print(f"{len(novos)} alerta(s) novo(s).")


if __name__ == "__main__":
    main()
