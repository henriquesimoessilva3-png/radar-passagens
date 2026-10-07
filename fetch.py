#!/usr/bin/env python3
"""Radar de passagens: busca diaria no Google Flights (via SerpApi) e gera data/deals.json.

Uso: SERPAPI_KEY=xxxx python fetch.py
So usa a biblioteca padrao do Python.
"""
import datetime as dt
import json
import os
import statistics
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

RAIZ = Path(__file__).resolve().parent
DADOS = RAIZ / "data"
API = "https://serpapi.com/search.json"


def ler(caminho, padrao):
    try:
        return json.loads(Path(caminho).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return padrao


def gravar(caminho, obj):
    Path(caminho).parent.mkdir(parents=True, exist_ok=True)
    Path(caminho).write_text(
        json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8"
    )


def buscar(params):
    """Uma chamada a SerpApi. Devolve o JSON ou {'error': ...}."""
    consulta = {**params, "api_key": os.environ["SERPAPI_KEY"]}
    url = API + "?" + urllib.parse.urlencode(consulta)
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return json.load(e)
        except Exception:
            return {"error": f"HTTP {e.code}"}
    except Exception as e:  # rede, timeout
        return {"error": type(e).__name__}


def proximos_meses(hoje, n):
    meses, ano, mes = [], hoje.year, hoje.month
    for _ in range(n):
        meses.append(mes)
        mes += 1
        if mes > 12:
            mes, ano = 1, ano + 1
    return meses


def rodizio(lista, cursor, n):
    if not lista or n <= 0:
        return [], cursor
    escolhidas = [lista[(cursor + i) % len(lista)] for i in range(min(n, len(lista)))]
    return escolhidas, (cursor + len(escolhidas)) % len(lista)


def planejar(cfg, estado, hoje):
    """Tarefas do dia: BH sempre (geral), BH mes a mes em rodizio, demais origens em rodizio."""
    principais = [o for o in cfg["origens"] if o.get("principal")]
    secundarias = [o for o in cfg["origens"] if not o.get("principal")]
    areas = cfg["areas"]
    meses = proximos_meses(hoje, cfg["meses_a_frente"])

    fixas = [(o, a, 0) for o in principais for a in areas]
    detalhe = [(o, a, m) for o in principais for m in meses for a in areas]
    outras = [(o, a, 0) for o in secundarias for a in areas]

    explorar = max(0, cfg["orcamento_diario"] - cfg["confirmacoes_google"])
    fixas = fixas[:explorar]
    resto = explorar - len(fixas)
    n_outras = min(len(outras), max(1, resto // 3)) if resto > 0 else 0
    n_detalhe = max(0, resto - n_outras)

    det, estado["cursor_detalhe"] = rodizio(detalhe, estado.get("cursor_detalhe", 0), n_detalhe)
    out, estado["cursor_outras"] = rodizio(outras, estado.get("cursor_outras", 0), n_outras)
    return fixas + det + out


def extrair(resp):
    for d in resp.get("destinations") or []:
        ap = d.get("destination_airport") or {}
        cod, preco, ini = ap.get("code"), d.get("flight_price"), d.get("start_date")
        if not (cod and preco and ini):
            continue
        yield {
            "codigo": cod,
            "destino": ap.get("location") or d.get("name") or cod,
            "pais": d.get("country") or "",
            "preco": preco,
            "ida": ini,
            "volta": d.get("end_date"),
            "cia": d.get("airline") or "",
            "paradas": d.get("number_of_stops"),
            "duracao": d.get("flight_duration"),
        }


def main(hoje=None):
    if not os.environ.get("SERPAPI_KEY"):
        sys.exit("Falta a variavel SERPAPI_KEY.")
    cfg = ler(RAIZ / "config.json", None)
    if not cfg:
        sys.exit("config.json nao encontrado ou invalido.")

    hoje = hoje or dt.datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    dia, mes_atual = hoje.isoformat(), hoje.isoformat()[:7]

    estado = ler(DADOS / "state.json", {})
    ofertas = ler(DADOS / "offers.json", {})
    hist = ler(DADOS / "history.json", {})
    uso = estado.setdefault("uso", {})
    usadas_antes = uso.get(mes_atual, 0)

    def pode():
        return uso.get(mes_atual, 0) < cfg["limite_mensal"]

    def contar():
        uso[mes_atual] = uso.get(mes_atual, 0) + 1

    # ---------- 1) Explorar destinos ----------
    ok = falhas = 0
    for origem, area, mes in planejar(cfg, estado, hoje):
        if not pode():
            print("Limite mensal de buscas atingido; parando.")
            break
        params = {
            "engine": "google_travel_explore",
            "departure_id": origem["aeroportos"],
            "type": 1,
            "month": mes,
            "travel_duration": cfg["duracao_viagem"],
            "currency": cfg["moeda"],
            "gl": "br",
            "hl": "pt-br",
        }
        if area.get("kgmid"):
            params["arrival_area_id"] = area["kgmid"]
        resp = buscar(params)
        contar()
        rotulo = f"{origem['id']} -> {area['nome']} (mes {mes or 'todos'})"
        if resp.get("error"):
            falhas += 1
            print(f"FALHA {rotulo}: {resp['error']}")
            continue
        n = 0
        for of in extrair(resp):
            if of["ida"] < dia:
                continue
            n += 1
            rota = f"{origem['id']}|{of['codigo']}"
            chave = f"{rota}|{of['ida'][:7]}"
            antiga = ofertas.get(chave)
            if antiga and antiga.get("visto") == dia and antiga["preco"] <= of["preco"]:
                continue
            of.update(origem=origem["id"], visto=dia,
                      nacional=of["pais"] in cfg["pais_local"])
            if antiga and antiga.get("google") and antiga.get("ida") == of["ida"]:
                of["google"] = antiga["google"]
            ofertas[chave] = of
            h = hist.setdefault(rota, {})
            h[dia] = min(h.get(dia, of["preco"]), of["preco"])
        ok += 1
        print(f"ok    {rotulo}: {n} destinos")

    # ---------- 2) Limpeza ----------
    limite_visto = (hoje - dt.timedelta(days=8)).isoformat()
    ofertas = {k: v for k, v in ofertas.items()
               if v["ida"] >= dia and v["visto"] >= limite_visto}
    for rota in list(hist):
        datas = sorted(hist[rota])[-180:]
        hist[rota] = {d: hist[rota][d] for d in datas}

    # ---------- 3) Referencia historica ----------
    def avaliar(of):
        h = hist.get(f"{of['origem']}|{of['codigo']}", {})
        anteriores = [p for d, p in h.items() if d < dia]
        of["dias_hist"] = len(anteriores)
        of["ref"] = of["desconto"] = None
        if len(anteriores) >= cfg["dias_minimos_historico"]:
            ref = statistics.median(anteriores)
            of["ref"] = round(ref)
            of["desconto"] = round(1 - of["preco"] / ref, 3)

    for of in ofertas.values():
        avaliar(of)

    # ---------- 4) Confirmar as melhores no Google Flights ----------
    principais = {o["id"]: o for o in cfg["origens"] if o.get("principal")}
    recente = (hoje - dt.timedelta(days=7)).isoformat()
    candidatas = [o for o in ofertas.values()
                  if o["origem"] in principais and o.get("volta")
                  and (o.get("google") or {}).get("data", "") < recente]
    candidatas.sort(key=lambda o: (-(o["desconto"] or 0), o["preco"]))
    escolhidas, vistos = [], set()
    for nac in (True, False) * cfg["confirmacoes_google"]:
        if len(escolhidas) >= cfg["confirmacoes_google"]:
            break
        for o in candidatas:
            if o["nacional"] == nac and id(o) not in vistos:
                escolhidas.append(o)
                vistos.add(id(o))
                break
    for of in escolhidas:
        if not pode():
            break
        resp = buscar({
            "engine": "google_flights",
            "departure_id": principais[of["origem"]]["aeroportos"],
            "arrival_id": of["codigo"],
            "outbound_date": of["ida"],
            "return_date": of["volta"],
            "type": 1,
            "currency": cfg["moeda"],
            "gl": "br",
            "hl": "pt-br",
        })
        contar()
        pi = resp.get("price_insights") or {}
        if resp.get("error") or not pi.get("price_level"):
            print(f"sem insight {of['origem']}->{of['codigo']}: {resp.get('error', 'sem price_insights')}")
            continue
        faixa = pi.get("typical_price_range") or [None, None]
        curva = [[p[0], p[1]] for p in (pi.get("price_history") or [])
                if isinstance(p, list) and len(p) == 2][-60:]
        of["google"] = {"nivel": pi["price_level"], "min": faixa[0], "max": faixa[1],
                        "preco": pi.get("lowest_price"), "data": dia, "hist": curva}
        print(f"google {of['origem']}->{of['codigo']}: {pi['price_level']}")

    # ---------- 5) Classificar ----------
    def classificar(of):
        nivel, motivo = "observacao", "Ainda formando histórico desta rota"
        d = of["desconto"]
        if d is not None:
            if d >= cfg["desconto_otimo"]:
                nivel, motivo = "otimo", "Muito abaixo da mediana do histórico"
            elif d >= cfg["desconto_bom"]:
                nivel, motivo = "bom", "Abaixo da mediana do histórico"
            else:
                nivel, motivo = "normal", "Dentro do normal para a rota"
        g = of.get("google")
        if g:
            if g["nivel"] == "low" and nivel not in ("otimo",):
                barato = g.get("min") and of["preco"] <= 0.8 * g["min"]
                nivel = "otimo" if barato else "bom"
                motivo = "Google Flights classifica como preço baixo"
            elif g["nivel"] == "high" and nivel == "observacao":
                nivel, motivo = "normal", "Google Flights classifica como preço alto"
            elif g["nivel"] == "typical" and nivel == "observacao":
                nivel, motivo = "normal", "Google Flights classifica como preço típico"
        of["nivel"], of["motivo"] = nivel, motivo

    for of in ofertas.values():
        classificar(of)

    # ---------- 6) Gravar ----------
    lista = sorted(ofertas.values(), key=lambda o: (o["origem"], o["ida"][:7], o["preco"]))
    gravar(DADOS / "offers.json", ofertas)
    gravar(DADOS / "history.json", hist)
    gravar(DADOS / "state.json", estado)
    gravar(DADOS / "deals.json", {
        "atualizado": dt.datetime.now(ZoneInfo("America/Sao_Paulo")).strftime("%Y-%m-%d %H:%M"),
        "dia": dia,
        "moeda": cfg["moeda"],
        "origens": [{k: o[k] for k in ("id", "nome", "principal", "kayak", "skyscanner", "booking")}
                    for o in cfg["origens"]],
        "buscas_no_mes": uso.get(mes_atual, 0),
        "limite_mensal": cfg["limite_mensal"],
        "dias_minimos_historico": cfg["dias_minimos_historico"],
        "ofertas": lista,
    })
    bons = sum(1 for o in lista if o["nivel"] in ("bom", "otimo"))
    print(f"{len(lista)} ofertas, {bons} com preço bom; "
          f"buscas hoje: {uso.get(mes_atual, 0) - usadas_antes}, no mês: {uso.get(mes_atual, 0)}")
    if ok == 0 and falhas:
        sys.exit(1)


if __name__ == "__main__":
    main()
