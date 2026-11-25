# Radar de Viagens (antigo Radar de Passagens)

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

## Viagens monitoradas (voo com data e hotéis)

`viagens.py` acompanha, todo dia, as viagens listadas em `config.json` → `viagens` (2 buscas/dia em rodízio, `orcamento_viagens`):

- **Voo** (`"tipo": "voo"`): origem, destino, ida, volta e adultos. Guarda o menor preço do dia no Google Flights, as 5 melhores opções e o nível de preço do Google.
- **Hotel** (`"tipo": "hotel"`): uma busca do Google Hotéis (`q`), datas, adultos e filtros (`estrelas`, `nota_min` na escala do Google, `all_inclusive`, `beira_mar`). Guarda o preço total da estadia de cada hotel que passa nos filtros. `destaques` marca os hotéis preferidos no topo da tabela.
- **Alerta:** se um voo ou hotel ficar `queda_alerta` (padrão 5%) abaixo do menor preço já visto, aparece no topo da aba **Viagens monitoradas** e o robô abre uma issue no GitHub (a notificação chega pelo app do GitHub).

### Incluir uma viagem sem mexer no código

- No painel: aba **Buscar hotéis** → **Monitorar esta busca**, ou aba **Viagens monitoradas** → **Monitorar este voo**.
- Na extensão do Chrome (pasta `extensao/`): abra a busca no Booking, Google Voos/Hotéis, Hoteis.com, Expedia, Decolar ou Kayak e clique em **Monitorar no Radar**.

Os dois abrem uma issue já preenchida ("Monitorar: …"). Ao criar a issue, a Action `monitorar.yml` inclui a viagem no `config.json` e fecha a issue.

### Extensão do Chrome

1. Chrome → `chrome://extensions` → ligue o **Modo do desenvolvedor**.
2. **Carregar sem compactação** → escolha a pasta `extensao` deste repositório (baixe o repositório como ZIP e descompacte).
3. Para atualizar: baixe o ZIP de novo, substitua a pasta e clique no ícone de recarregar da extensão em `chrome://extensions`.

A partir da versão 2, a extensão também faz a aba **Buscar viagem** do painel funcionar: ao clicar em *Buscar em todos os sites*, ela abre o Google Voos, o Kayak, o Booking e o Hoteis.com em abas de fundo, lê os resultados, fecha as abas e mostra tudo no painel (passagens de um lado, hotéis do outro, com o preço de cada site lado a lado). Os sites das companhias aéreas por enquanto abrem direto, já com rota e datas.

### Orçamento de buscas (plano grátis da SerpApi = 250/mês)

6 buscas/dia de passagens + 2 de viagens monitoradas = 8/dia (`limite_mensal` 245 para no limite). Para monitorar muitas viagens, aumente o plano da SerpApi e o `orcamento_viagens`.
