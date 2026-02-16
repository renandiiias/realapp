#!/usr/bin/env python3
import argparse
import json
import os
import statistics
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv


API_BASE = "https://graph.facebook.com"


@dataclass
class CampaignMetrics:
    campaign_name: str
    spend: float
    impressions: int
    clicks: int
    ctr: float
    cpc: float
    cpm: float
    leads: float
    purchases: float
    purchase_value: float

    @property
    def roas(self) -> Optional[float]:
        if self.spend <= 0:
            return None
        if self.purchase_value <= 0:
            return None
        return self.purchase_value / self.spend


def safe_float(value: Optional[str]) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def safe_int(value: Optional[str]) -> int:
    if value in (None, ""):
        return 0
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def extract_action_value(actions: Optional[List[Dict]], keys: Tuple[str, ...]) -> float:
    if not actions:
        return 0.0
    total = 0.0
    for item in actions:
        action_type = item.get("action_type", "")
        if action_type in keys:
            total += safe_float(item.get("value"))
    return total


def meta_get(path: str, token: str, params: Optional[Dict] = None) -> Dict:
    url = f"{API_BASE}{path}"
    query = params.copy() if params else {}
    query["access_token"] = token

    response = requests.get(url, params=query, timeout=30)
    if response.status_code >= 400:
        raise RuntimeError(
            f"Erro na Meta API ({response.status_code}): {response.text}"
        )
    return response.json()


def list_ad_accounts(token: str, graph_version: str) -> List[Dict]:
    data = meta_get(
        f"/{graph_version}/me/adaccounts",
        token,
        params={
            "fields": "id,name,account_id,account_status,currency",
            "limit": 50,
        },
    )
    return data.get("data", [])


def fetch_campaign_insights(
    token: str,
    graph_version: str,
    ad_account_id: str,
    days: int,
) -> List[CampaignMetrics]:
    today = date.today()
    since = today - timedelta(days=max(days - 1, 0))
    time_range = {"since": since.isoformat(), "until": today.isoformat()}

    params = {
        "level": "campaign",
        "time_increment": "all_days",
        "fields": "campaign_name,spend,impressions,clicks,ctr,cpc,cpm,actions,action_values",
        "time_range": json.dumps(time_range),
        "limit": 200,
    }

    all_rows: List[Dict] = []
    path = f"/{graph_version}/act_{ad_account_id}/insights"

    while True:
        payload = meta_get(path, token, params=params)
        all_rows.extend(payload.get("data", []))

        paging = payload.get("paging", {})
        next_url = paging.get("next")
        if not next_url:
            break

        response = requests.get(next_url, timeout=30)
        if response.status_code >= 400:
            raise RuntimeError(
                f"Erro na paginação ({response.status_code}): {response.text}"
            )
        payload = response.json()
        all_rows.extend(payload.get("data", []))

        while payload.get("paging", {}).get("next"):
            response = requests.get(payload["paging"]["next"], timeout=30)
            if response.status_code >= 400:
                raise RuntimeError(
                    f"Erro na paginação ({response.status_code}): {response.text}"
                )
            payload = response.json()
            all_rows.extend(payload.get("data", []))

        break

    campaigns: List[CampaignMetrics] = []
    for row in all_rows:
        actions = row.get("actions") or []
        action_values = row.get("action_values") or []

        campaigns.append(
            CampaignMetrics(
                campaign_name=row.get("campaign_name", "(sem nome)"),
                spend=safe_float(row.get("spend")),
                impressions=safe_int(row.get("impressions")),
                clicks=safe_int(row.get("clicks")),
                ctr=safe_float(row.get("ctr")),
                cpc=safe_float(row.get("cpc")),
                cpm=safe_float(row.get("cpm")),
                leads=extract_action_value(
                    actions,
                    (
                        "lead",
                        "onsite_conversion.lead_grouped",
                        "offsite_conversion.fb_pixel_lead",
                    ),
                ),
                purchases=extract_action_value(
                    actions,
                    (
                        "purchase",
                        "offsite_conversion.fb_pixel_purchase",
                        "omni_purchase",
                    ),
                ),
                purchase_value=extract_action_value(
                    action_values,
                    (
                        "purchase",
                        "offsite_conversion.fb_pixel_purchase",
                        "omni_purchase",
                    ),
                ),
            )
        )

    return campaigns


def generate_insights(campaigns: List[CampaignMetrics]) -> List[str]:
    if not campaigns:
        return ["Nenhuma campanha com dados no período selecionado."]

    insights: List[str] = []

    total_spend = sum(c.spend for c in campaigns)
    total_impressions = sum(c.impressions for c in campaigns)
    total_clicks = sum(c.clicks for c in campaigns)
    total_leads = sum(c.leads for c in campaigns)
    total_purchases = sum(c.purchases for c in campaigns)
    total_revenue = sum(c.purchase_value for c in campaigns)

    overall_ctr = (total_clicks / total_impressions * 100) if total_impressions > 0 else 0
    overall_cpc = (total_spend / total_clicks) if total_clicks > 0 else 0

    insights.append(
        f"Resumo: gasto total {total_spend:.2f}, impressões {total_impressions}, cliques {total_clicks}, CTR médio {overall_ctr:.2f}%, CPC médio {overall_cpc:.2f}."
    )

    top_spend = sorted(campaigns, key=lambda c: c.spend, reverse=True)
    if top_spend and total_spend > 0:
        lead = top_spend[0]
        share = lead.spend / total_spend * 100
        insights.append(
            f"Maior concentração de verba: '{lead.campaign_name}' consumiu {share:.1f}% do investimento ({lead.spend:.2f})."
        )

    high_volume = [c for c in campaigns if c.impressions >= 1000]
    if high_volume:
        best_ctr = max(high_volume, key=lambda c: c.ctr)
        insights.append(
            f"Melhor CTR (com >=1000 impressões): '{best_ctr.campaign_name}' com {best_ctr.ctr:.2f}%."
        )

    valid_cpc = [c.cpc for c in campaigns if c.cpc > 0]
    if valid_cpc:
        median_cpc = statistics.median(valid_cpc)
        expensive = [c for c in campaigns if c.cpc > median_cpc * 1.5 and c.clicks >= 20]
        if expensive:
            names = ", ".join(f"{c.campaign_name} ({c.cpc:.2f})" for c in expensive[:3])
            insights.append(
                f"Campanhas com CPC acima do esperado (>{median_cpc*1.5:.2f}): {names}."
            )

    low_ctr = [c for c in campaigns if c.impressions >= 1000 and c.ctr < 1.0]
    if low_ctr:
        names = ", ".join(f"{c.campaign_name} ({c.ctr:.2f}%)" for c in low_ctr[:3])
        insights.append(
            f"CTR baixo (<1.0%) em campanhas relevantes: {names}. Considere trocar criativo/gancho e segmentação."
        )

    if total_revenue > 0 and total_spend > 0:
        roas = total_revenue / total_spend
        insights.append(
            f"ROAS agregado: {roas:.2f} (receita {total_revenue:.2f} / gasto {total_spend:.2f})."
        )
    else:
        insights.append(
            "Não foi possível calcular ROAS (sem `purchase_value` rastreado no período)."
        )

    if total_leads > 0 and total_spend > 0:
        cpl = total_spend / total_leads
        insights.append(f"CPL médio estimado: {cpl:.2f} com {total_leads:.0f} leads.")

    if total_purchases > 0 and total_spend > 0:
        cpa = total_spend / total_purchases
        insights.append(f"CPA médio estimado: {cpa:.2f} com {total_purchases:.0f} compras.")

    return insights


def print_table(campaigns: List[CampaignMetrics], limit: int = 10) -> None:
    headers = [
        "Campanha",
        "Spend",
        "Imp.",
        "Cliques",
        "CTR%",
        "CPC",
        "CPM",
        "Leads",
        "Compras",
        "ROAS",
    ]
    print("\n" + " | ".join(headers))
    print("-" * 120)
    for c in sorted(campaigns, key=lambda x: x.spend, reverse=True)[:limit]:
        roas = f"{c.roas:.2f}" if c.roas is not None else "-"
        row = [
            c.campaign_name,
            f"{c.spend:.2f}",
            str(c.impressions),
            str(c.clicks),
            f"{c.ctr:.2f}",
            f"{c.cpc:.2f}",
            f"{c.cpm:.2f}",
            f"{c.leads:.0f}",
            f"{c.purchases:.0f}",
            roas,
        ]
        print(" | ".join(row))


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="Coleta dados da Meta Ads e gera insights automáticos."
    )
    parser.add_argument("--days", type=int, default=7, help="Período em dias (padrão: 7)")
    parser.add_argument(
        "--account-id",
        type=str,
        default=os.getenv("META_AD_ACCOUNT_ID", "").strip(),
        help="ID da conta de anúncios (sem act_).",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=10,
        help="Quantidade de campanhas para mostrar na tabela.",
    )
    args = parser.parse_args()

    token = os.getenv("META_ACCESS_TOKEN", "").strip()
    if not token:
        raise SystemExit("Defina META_ACCESS_TOKEN no ambiente ou no arquivo .env")

    graph_version = os.getenv("META_GRAPH_VERSION", "v21.0").strip()

    ad_account_id = args.account_id
    if not ad_account_id:
        accounts = list_ad_accounts(token, graph_version)
        if not accounts:
            raise SystemExit("Nenhuma conta de anúncios encontrada para este token.")
        selected = accounts[0]
        ad_account_id = selected.get("account_id") or selected.get("id", "").replace("act_", "")
        print(
            f"Usando a primeira conta encontrada: {selected.get('name', '(sem nome)')} (act_{ad_account_id})"
        )

    campaigns = fetch_campaign_insights(
        token=token,
        graph_version=graph_version,
        ad_account_id=ad_account_id,
        days=args.days,
    )

    print(f"\nConta: act_{ad_account_id} | Período: últimos {args.days} dias")
    print(f"Campanhas encontradas: {len(campaigns)}")

    print_table(campaigns, limit=args.top)

    insights = generate_insights(campaigns)
    print("\nInsights automáticos:")
    for i, item in enumerate(insights, start=1):
        print(f"{i}. {item}")


if __name__ == "__main__":
    main()
