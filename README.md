# Meta Ads Insights (simples)

Software simples em Python para puxar métricas da sua conta de anúncios da Meta e gerar insights automáticos por campanha.

## O que ele faz

- Conecta na Graph API da Meta.
- Descobre sua conta de anúncios automaticamente (ou usa um ID informado).
- Coleta métricas por campanha nos últimos N dias.
- Gera insights rápidos: concentração de verba, CTR, CPC fora do padrão, ROAS, CPL e CPA.

## Requisitos

- Python 3.10+
- Token válido da Meta com acesso à conta de anúncios e permissões de leitura de ads.

## Instalação

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configuração

1. Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

2. Edite `.env` e preencha:

```env
META_ACCESS_TOKEN=SEU_TOKEN
META_AD_ACCOUNT_ID=123456789012345
META_GRAPH_VERSION=v21.0
```

- `META_AD_ACCOUNT_ID` é opcional. Sem ele, o script usa a primeira conta encontrada.

## Uso

```bash
python meta_ads_insights.py --days 7 --top 10
```

Opções:

- `--days`: período em dias (padrão `7`)
- `--account-id`: ID da conta sem `act_`
- `--top`: número de campanhas exibidas na tabela

## Observações

- Se o token não tiver permissões suficientes, a API retorna erro de autorização.
- Para produção, prefira token de sistema/long-lived token e renovação automática.
