#!/usr/bin/env python3
"""Historico oficial de tarifas domesticas (microdados da ANAC) -> data/anac.json.

Baixa os arquivos mensais de tarifas aereas domesticas comercializadas, guarda so as
rotas que saem das origens do config.json e calcula a sazonalidade por rota e por
companhia: em que meses do ano a passagem costuma ser VENDIDA mais barata.

Uso: python anac.py     (nao precisa de chave; so biblioteca padrao)
"""
import csv
import datetime as dt
import io
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

RAIZ = Path(__file__).resolve().parent
DADOS = RAIZ / "data"
URL = "https://sas.anac.gov.br/sas/tarifadomestica/{ano}/{ano}{mes:02d}.{ext}"
CIAS = {"AZU": "Azul", "GLO": "Gol", "TAM": "Latam", "PTB": "Voepass", "ACN": "Azul Conecta",
        "ABJ": "Abaeté", "MAP": "MAP", "TTL": "Total", "ONE": "Avianca Brasil", "PAM": "MAP"}
PADRAO = {"meses": 48, "minutos_por_execucao": 15, "assentos_minimos_mes": 30,
          "assentos_minimos_ano": 500, "dias_entre_checagens": 7}


def ler(caminho, padrao):
    try:
        return json.loads(Path(caminho).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return padrao


def gravar(caminho, obj, **kw):
    Path(caminho).parent.mkdir(parents=True, exist_ok=True)
    Path(caminho).write_text(json.dumps(obj, ensure_ascii=False, sort_keys=True, **kw),
                             encoding="utf-8")


def abrir(ano, mes):
    """Devolve um iterador de linhas (listas) do CSV do mes, ou None se nao publicado."""
    for ext in ("csv", "CSV"):
        req = urllib.request.Request(URL.format(ano=ano, mes=mes, ext=ext),
                                     headers={"User-Agent": "Mozilla/5.0 (radar-passagens)"})
        for tentativa in range(3):
            try:
                resp = urllib.request.urlopen(req, timeout=180)
                texto = io.TextIOWrapper(resp, encoding="latin-1", newline="")
                return csv.reader(texto, delimiter=";")
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    break
                time.sleep(5 * (tentativa + 1))
            except Exception:
                time.sleep(5 * (tentativa + 1))
    return None


def num(txt):
    return float(txt.strip().replace(".", "").replace(",", ".")) if "," in txt else float(txt)


def processar(linhas, icao_origem):
    """Soma valor e assentos por (origem, destino ICAO, companhia). icao_origem: ICAO -> id."""
    cab = [c.strip().lstrip("﻿").upper() for c in next(linhas)]

    def col(nome):
        if nome in cab:
            return cab.index(nome)
        achados = [i for i, c in enumerate(cab) if nome in c]
        return achados[0] if achados else None

    idx = {n: col(n) for n in ("EMPRESA", "ORIGEM", "DESTINO", "TARIFA", "ASSENTOS")}
    if None in idx.values():
        raise ValueError(f"cabecalho inesperado: {cab}")
    soma = {}
    for lin in linhas:
        try:
            origem = icao_origem.get(lin[idx["ORIGEM"]].strip().upper())
            if not origem:
                continue
            tarifa, assentos = num(lin[idx["TARIFA"]]), num(lin[idx["ASSENTOS"]])
        except (IndexError, ValueError):
            continue
        if tarifa <= 0 or assentos <= 0:
            continue
        chave = f"{origem}|{lin[idx['DESTINO']].strip().upper()}|{lin[idx['EMPRESA']].strip().upper()}"
        s = soma.setdefault(chave, [0.0, 0.0])
        s[0] += tarifa * assentos
        s[1] += assentos
    return {k: [round(v[0], 2), round(v[1])] for k, v in soma.items()}


def lista_meses(hoje, n):
    ano, mes, out = hoje.year, hoje.month, []
    for _ in range(n):
        mes -= 1
        if mes == 0:
            ano, mes = ano - 1, 12
        out.append((ano, mes))
    return out  # do mais recente para o mais antigo


def sazonalidade(serie, meses, minimo):
    """serie: 'aaaamm' -> [valor, assentos]. Indice por mes do ano (1.0 = media do periodo)."""
    tarifas = []
    for a, m in meses:
        v = serie.get(f"{a}{m:02d}")
        tarifas.append(v[0] / v[1] if v and v[1] >= minimo else None)
    razoes = {m: [] for m in range(1, 13)}
    for i, (a, m) in enumerate(meses):
        if tarifas[i] is None or i < 6 or i + 5 >= len(meses):
            continue
        janela = [t for t in tarifas[i - 6:i + 6] if t is not None]
        if len(janela) >= 10:
            razoes[m].append(tarifas[i] / statistics.mean(janela))
    saz = [round(statistics.median(razoes[m]), 3) if len(razoes[m]) >= 2 else None
           for m in range(1, 13)]
    if sum(v is not None for v in saz) < 9:
        return None
    return saz


def resumo(serie, meses, cfg):
    ult = [serie.get(f"{a}{m:02d}") for a, m in meses[-12:]]
    valor = sum(v[0] for v in ult if v)
    assentos = sum(v[1] for v in ult if v)
    if assentos < cfg["assentos_minimos_ano"]:
        return None
    r = {"tarifa12": round(valor / assentos), "assentos12": round(assentos),
         "saz": sazonalidade(serie, meses, cfg["assentos_minimos_mes"])}
    if r["saz"]:
        validos = [(v, i) for i, v in enumerate(r["saz"]) if v is not None]
        r["barato"], r["caro"] = min(validos)[1] + 1, max(validos)[1] + 1
    return r


def main(hoje=None):
    cfg_geral = ler(RAIZ / "config.json", None)
    if not cfg_geral:
        sys.exit("config.json nao encontrado ou invalido.")
    cfg = {**PADRAO, **cfg_geral.get("anac", {})}
    hoje = hoje or dt.datetime.now(ZoneInfo("America/Sao_Paulo")).date()

    aeroportos = ler(RAIZ / "aeroportos_br.json", {})          # ICAO -> [IATA, cidade]
    iata_icao = {v[0]: k for k, v in aeroportos.items()}
    icao_origem = {}
    for o in cfg_geral["origens"]:
        for iata in o["aeroportos"].split(","):
            if iata.strip() in iata_icao:
                icao_origem[iata_icao[iata.strip()]] = o["id"]

    cache = ler(DADOS / "anac_cache.json", {"meses": {}, "ausentes": {}})
    alvo = lista_meses(hoje, cfg["meses"])
    recente = (hoje - dt.timedelta(days=cfg["dias_entre_checagens"])).isoformat()
    pendentes = [(a, m) for a, m in alvo
                 if f"{a}{m:02d}" not in cache["meses"]
                 and cache["ausentes"].get(f"{a}{m:02d}", "") < recente]

    inicio, baixados = time.time(), 0
    for a, m in pendentes:
        if time.time() - inicio > cfg["minutos_por_execucao"] * 60:
            print("Tempo da execucao esgotado; o restante fica para a proxima.")
            break
        chave = f"{a}{m:02d}"
        linhas = abrir(a, m)
        if linhas is None:
            cache["ausentes"][chave] = hoje.isoformat()
            print(f"{chave}: nao disponivel")
            continue
        try:
            cache["meses"][chave] = processar(linhas, icao_origem)
        except Exception as e:
            cache["ausentes"][chave] = hoje.isoformat()
            print(f"{chave}: falha ao ler ({e})")
            continue
        cache["ausentes"].pop(chave, None)
        baixados += 1
        print(f"{chave}: {len(cache['meses'][chave])} combinacoes rota/companhia")

    validos = {f"{a}{m:02d}" for a, m in alvo}
    cache["meses"] = {k: v for k, v in cache["meses"].items() if k in validos}
    cache["ausentes"] = {k: v for k, v in cache["ausentes"].items() if k in validos}
    gravar(DADOS / "anac_cache.json", cache, separators=(",", ":"))
    if not cache["meses"]:
        print("Nenhum mes da ANAC disponivel ainda.")
        return
    if not baixados and (DADOS / "anac.json").exists():
        print("ANAC: nada novo.")
        return

    # ---------- series por rota e por rota+companhia ----------
    meses = sorted(alvo)
    com_dado = sorted(cache["meses"])
    por_rota, por_cia = {}, {}
    for am, combos in cache["meses"].items():
        for chave, (valor, assentos) in combos.items():
            origem, dest, cia = chave.split("|")
            for d, k in ((por_rota, (origem, dest)), (por_cia, (origem, dest, cia))):
                s = d.setdefault(k, {}).setdefault(am, [0.0, 0.0])
                s[0] += valor
                s[1] += assentos

    rotas = {}
    for (origem, dest), serie in por_rota.items():
        info = aeroportos.get(dest)
        r = resumo(serie, meses, cfg)
        if not info or not r:
            continue
        r.update(iata=info[0], destino=info[1], cias=[],
                 serie=[[am, round(serie[am][0] / serie[am][1])] for am in com_dado[-24:]
                        if am in serie and serie[am][1] >= cfg["assentos_minimos_mes"]])
        for (o2, d2, cia), s2 in por_cia.items():
            if (o2, d2) != (origem, dest):
                continue
            rc = resumo(s2, meses, cfg)
            if rc:
                rc.update(cod=cia, nome=CIAS.get(cia, cia),
                          fatia=round(rc["assentos12"] / r["assentos12"], 3))
                r["cias"].append(rc)
        r["cias"].sort(key=lambda c: -c["assentos12"])
        rotas[f"{origem}|{info[0]}"] = r

    gravar(DADOS / "anac.json", {
        "atualizado": hoje.isoformat(),
        "periodo": [com_dado[0], com_dado[-1]],
        "meses_carregados": len(com_dado),
        "meses_alvo": cfg["meses"],
        "rotas": rotas,
    }, separators=(",", ":"))
    print(f"ANAC: {len(rotas)} rotas, {len(com_dado)} de {cfg['meses']} meses carregados.")


if __name__ == "__main__":
    main()
