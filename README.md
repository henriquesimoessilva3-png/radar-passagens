# Radar de Passagens

Robô diário que consulta o Google Flights (via SerpApi), guarda o histórico de preços e mostra, mês a mês, as passagens com preço bom saindo de Belo Horizonte (foco) e de Rio, São Paulo e Campinas (rodízio).

## Como colocar no ar

1. Crie uma conta gratuita em https://serpapi.com e copie a sua API key (250 buscas/mês grátis).
2. Crie um repositório no GitHub e envie todos estes arquivos (incluindo a pasta `.github`).
3. No repositório: Settings → Secrets and variables → Actions → New repository secret. Nome `SERPAPI_KEY`, valor = a chave.
4. Settings → Pages → Source: "Deploy from a branch", branch `main`, pasta `/ (root)`.
5. Aba Actions → "Radar de passagens" → Run workflow (primeira execução). Depois roda sozinho todo dia às 06:17.

## Como funciona

- 7 buscas por dia: 2 gerais de BH (Brasil e mundo), 2 de BH em um mês específico (rodízio pelos próximos 6 meses), 1 de origem secundária (rodízio) e 2 confirmações de nível de preço no Google Flights.
- "Preço bom" = 15% ou mais abaixo da mediana do histórico da rota (30% = ótimo), ou classificado como "baixo" pelo Google Flights. O histórico precisa de 5 dias por rota; até lá a oferta aparece como "em observação".
- Cada oferta tem botões que abrem a mesma busca no Google Flights, Kayak, Momondo, Skyscanner e Booking para conferir.

Ajustes (origens, limites, duração da viagem) ficam em `config.json`.

## Histórico

- **Google Flights, últimos ~60 dias:** nas ofertas que o robô confirma no Google Flights (2 por dia), o cartão mostra a curva de preço recente.
- **ANAC (`anac.py`):** baixa os microdados mensais de tarifas domésticas vendidas (48 meses, aos poucos nas primeiras execuções; não usa a SerpApi) e mostra, por rota e por companhia, em que meses do ano a passagem costuma ser vendida mais barata. Vale para voos nacionais, tarifa por trecho, e o mês é o da compra, não o da viagem. Aparece nos cartões e na aba "Histórico por destino".
