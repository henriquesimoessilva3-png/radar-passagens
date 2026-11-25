#!/bin/bash
# Instala a busca do Radar de Viagens no Google Cloud (rodar no Cloud Shell).
set -e
PROJ=${PROJ:-radar-viagens-hss}
BASE=scout-system-2026
REG=southamerica-east1
echo "== Conta de cobrança (a mesma do $BASE)"
CONTA=$(gcloud billing projects describe $BASE --format='value(billingAccountName)' | sed 's#billingAccounts/##')
echo "$CONTA"
echo "== Projeto $PROJ"
gcloud projects describe $PROJ >/dev/null 2>&1 || gcloud projects create $PROJ --name="Radar Viagens"
gcloud billing projects link $PROJ --billing-account=$CONTA >/dev/null
gcloud config set project $PROJ >/dev/null 2>&1
echo "== Ativando serviços (leva 1-2 min)"
gcloud services enable cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com billingbudgets.googleapis.com logging.googleapis.com
PN=$(gcloud projects describe $PROJ --format='value(projectNumber)')
SA=$PN-compute@developer.gserviceaccount.com
for R in roles/cloudbuild.builds.builder roles/logging.logWriter roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding $PROJ --member=serviceAccount:$SA --role=$R --condition=None >/dev/null
done
echo "== Cofre da chave (segredo 'serpapi')"
gcloud secrets describe serpapi >/dev/null 2>&1 || gcloud secrets create serpapi --replication-policy=automatic
gcloud secrets add-iam-policy-binding serpapi --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor >/dev/null
echo "== Publicando a função"
rm -rf /tmp/rp && git clone -q --depth 1 https://github.com/henriquesimoessilva3-png/radar-passagens /tmp/rp
gcloud functions deploy buscar --gen2 --runtime=nodejs22 --region=$REG --source=/tmp/rp/servidor --entry-point=buscar \
  --trigger-http --allow-unauthenticated --memory=256Mi --max-instances=2 --quiet
echo "== Alerta de gasto (R\$ 10/mês)"
gcloud billing budgets create --billing-account=$CONTA --display-name="Radar Viagens" --budget-amount=10BRL \
  --filter-projects=projects/$PROJ --threshold-rule=percent=0.5 --threshold-rule=percent=1.0 >/dev/null 2>&1 \
  && echo "alerta criado" || echo "AVISO: não consegui criar o alerta automaticamente"
echo "== Pronto"
echo "URL: $(gcloud functions describe buscar --region=$REG --gen2 --format='value(serviceConfig.uri)')"
