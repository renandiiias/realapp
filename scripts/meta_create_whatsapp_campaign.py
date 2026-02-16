#!/usr/bin/env python3
"""
Create a Click-to-WhatsApp campaign via Meta Marketing API by cloning a working
template (campaign + adset + ad creative). This avoids guessing undocumented
fields that vary across accounts and objective variants.

Safety:
  - Defaults to creating everything PAUSED unless --activate is passed.
  - Requires META_ACCESS_TOKEN to be set in the environment (do not paste in chat).

Environment:
  - META_ACCESS_TOKEN (required)
  - META_AD_ACCOUNT_ID (optional, without act_; default: 1076578477997478)
  - META_GRAPH_VERSION (optional, default: v21.0)
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple

import requests
from dotenv import load_dotenv


API_BASE = "https://graph.facebook.com"


def _die(msg: str) -> None:
    raise SystemExit(msg)


def _now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _parse_version(v: str) -> str:
    v = (v or "").strip()
    if not v:
        return "v21.0"
    if not v.startswith("v"):
        return f"v{v}"
    return v


def _json_compact(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _graph_get(version: str, path: str, token: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    url = f"{API_BASE}/{version}/{path.lstrip('/')}"
    q = dict(params or {})
    q["access_token"] = token
    r = requests.get(url, params=q, timeout=45)
    if r.status_code >= 400:
        _die(f"[Meta API GET {path}] {r.status_code}: {r.text}")
    return r.json()


def _graph_post(
    version: str,
    path: str,
    token: str,
    data: Optional[Dict[str, Any]] = None,
    files: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    url = f"{API_BASE}/{version}/{path.lstrip('/')}"
    payload = dict(data or {})
    payload["access_token"] = token
    r = requests.post(url, data=payload, files=files, timeout=90)
    if r.status_code >= 400:
        _die(f"[Meta API POST {path}] {r.status_code}: {r.text}")
    return r.json()


def _pick_first(items: Iterable[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for it in items:
        return it
    return None


def _contains_any(name: str, needles: Iterable[str]) -> bool:
    n = (name or "").casefold()
    return any(x.casefold() in n for x in needles)


def _clean_targeting(targeting: Dict[str, Any]) -> Dict[str, Any]:
    # Remove detailed targeting keys that can overly restrict a low-budget test.
    drop = {
        "flexible_spec",
        "interests",
        "behaviors",
        "life_events",
        "industries",
        "income",
        "family_statuses",
        "work_employers",
        "work_positions",
        "education_schools",
        "education_majors",
        "education_statuses",
        "fields_of_study",
        "relationship_statuses",
        "user_adclusters",
        "user_device",
        "user_os",
        "user_agent",
    }
    out = dict(targeting or {})
    for k in list(out.keys()):
        if k in drop:
            out.pop(k, None)
    return out


def _targeting_has_custom_location(targeting: Dict[str, Any]) -> bool:
    geo = (targeting or {}).get("geo_locations") or {}
    cl = geo.get("custom_locations") or []
    if not (isinstance(cl, list) and cl):
        return False
    first = cl[0]
    if not isinstance(first, dict):
        return False
    return (first.get("latitude") is not None) and (first.get("longitude") is not None)


@dataclass
class Template:
    campaign: Dict[str, Any]
    adset: Dict[str, Any]
    ad: Dict[str, Any]
    creative: Dict[str, Any]


def _find_template(version: str, token: str, ad_account_id: str) -> Template:
    # Prefer a WhatsApp ad set with a custom location already configured (so we can safely set radius=4km).
    adsets = _graph_get(
        version,
        f"act_{ad_account_id}/adsets",
        token,
        params={
            "fields": "id,name,effective_status,destination_type,campaign_id,targeting",
            "limit": 200,
        },
    ).get("data", [])

    if not adsets:
        _die("Nenhum conjunto de anuncios encontrado na conta de anuncios.")

    def score(a: Dict[str, Any]) -> int:
        name = str(a.get("name") or "")
        n = name.casefold()
        eff = str(a.get("effective_status") or "").upper()
        dest = str(a.get("destination_type") or "").upper()
        targeting = a.get("targeting") or {}

        s = 0
        if dest == "WHATSAPP":
            s += 50
        if _targeting_has_custom_location(targeting):
            s += 30
        if "2km" in n or "2 km" in n:
            s += 25
        if "clinica" in n:
            s += 10
        if "rio preto" in n or "sj" in n:
            s += 5
        if "remarketing" in n:
            s -= 15
        if eff == "ACTIVE":
            s += 5
        elif eff == "PAUSED":
            s += 2
        elif eff == "CAMPAIGN_PAUSED":
            s += 1
        return s

    candidates = [
        a
        for a in adsets
        if str(a.get("destination_type") or "").upper() == "WHATSAPP"
        and str(a.get("effective_status") or "").upper() in {"ACTIVE", "PAUSED", "CAMPAIGN_PAUSED"}
    ]
    if not candidates:
        _die("Nao achei nenhum conjunto de anuncios WHATSAPP (ACTIVE/PAUSED) para usar como template.")

    best = max(candidates, key=score)
    adset_id = str(best["id"])
    camp_id = str(best.get("campaign_id") or "")
    if not camp_id:
        _die("Template adset nao retornou campaign_id.")

    # Fetch full objects for cloning.
    camp_full = _graph_get(
        version,
        camp_id,
        token,
        params={"fields": "id,name,objective,buying_type,special_ad_categories,daily_budget,lifetime_budget"},
    )
    adset_full = _graph_get(
        version,
        adset_id,
        token,
        params={
            "fields": ",".join(
                [
                    "id",
                    "name",
                    "billing_event",
                    "optimization_goal",
                    "bid_strategy",
                    "bid_amount",
                    "daily_budget",
                    "promoted_object",
                    "destination_type",
                    "targeting",
                    "attribution_spec",
                ]
            )
        },
    )

    ads = _graph_get(
        version,
        f"{adset_id}/ads",
        token,
        params={
            "fields": "id,name,status,effective_status,creative{id,name,object_story_spec,asset_feed_spec,instagram_actor_id,actor_id}",
            "limit": 50,
        },
    ).get("data", [])
    if not ads:
        _die(f"Conjunto template '{adset_full.get('name')}' nao tem anuncios.")
    ads_ok = [a for a in ads if (a.get("effective_status") or "").upper() in {"ACTIVE", "PAUSED"}]
    ad = _pick_first(ads_ok) or ads[0]
    creative = ad.get("creative") or {}
    if not creative:
        _die("Anuncio template nao retornou creative.")

    creative_full = _graph_get(
        version,
        str(creative["id"]),
        token,
        params={"fields": "id,name,object_story_spec,asset_feed_spec,instagram_actor_id,actor_id"},
    )
    return Template(campaign=camp_full, adset=adset_full, ad=ad, creative=creative_full)


def _upload_image(version: str, token: str, ad_account_id: str, path: str) -> str:
    if not os.path.exists(path):
        _die(f"Imagem nao encontrada: {path}")
    with open(path, "rb") as f:
        res = _graph_post(
            version,
            f"act_{ad_account_id}/adimages",
            token,
            data={"filename": os.path.basename(path)},
            files={"file": f},
        )
    images = res.get("images") or {}
    if not images:
        _die(f"Upload de imagem falhou: {res}")
    # images is a map; take the first entry.
    first = next(iter(images.values()))
    h = first.get("hash")
    if not h:
        _die(f"Nao retornou hash de imagem: {res}")
    return str(h)


def _set_copy_in_spec(spec: Dict[str, Any], primary: str, headline: str, desc: str, prefill: str) -> Dict[str, Any]:
    # Works for most creative variants:
    # - object_story_spec.link_data.{message,name,description}
    # - asset_feed_spec.{bodies,titles,descriptions}
    out = json.loads(json.dumps(spec))  # deep copy via json

    if "object_story_spec" in out and isinstance(out.get("object_story_spec"), dict):
        oss = out["object_story_spec"]
        ld = oss.get("link_data")
        if isinstance(ld, dict):
            ld["message"] = primary
            ld["name"] = headline
            ld["description"] = desc
            # WhatsApp prefill: only touch known existing keys to avoid invalid params.
            cta = ld.get("call_to_action")
            if isinstance(cta, dict):
                val = cta.get("value")
                if isinstance(val, dict):
                    if "message" in val:
                        val["message"] = prefill
                    if "whatsapp_message" in val:
                        val["whatsapp_message"] = prefill
            # Some variants use "whatsapp_message" as key.
            if "whatsapp_message" in ld:
                ld["whatsapp_message"] = prefill

    if "asset_feed_spec" in out and isinstance(out.get("asset_feed_spec"), dict):
        afs = out["asset_feed_spec"]
        if isinstance(afs.get("bodies"), list) and afs["bodies"]:
            afs["bodies"][0]["text"] = primary
        elif isinstance(afs.get("bodies"), list):
            afs["bodies"] = [{"text": primary}]
        if isinstance(afs.get("titles"), list) and afs["titles"]:
            afs["titles"][0]["text"] = headline
        elif isinstance(afs.get("titles"), list):
            afs["titles"] = [{"text": headline}]
        if isinstance(afs.get("descriptions"), list) and afs["descriptions"]:
            afs["descriptions"][0]["text"] = desc
        elif isinstance(afs.get("descriptions"), list):
            afs["descriptions"] = [{"text": desc}]

        # Try to set WhatsApp prefill when the template uses "call_to_action" under afs.
        if isinstance(afs.get("call_to_action_types"), list) and afs["call_to_action_types"]:
            pass
        if isinstance(afs.get("link_urls"), list) and afs["link_urls"]:
            # Keep template link urls; WhatsApp ads may not rely on a public URL.
            pass

    return out


def _set_image_in_creative(creative: Dict[str, Any], image_hash_primary: str) -> Tuple[Dict[str, Any], str]:
    """
    Return (creative_payload_fields, mode) where mode is 'object_story_spec' or 'asset_feed_spec'.
    """
    if isinstance(creative.get("asset_feed_spec"), dict):
        afs = json.loads(json.dumps(creative["asset_feed_spec"]))
        # Replace the first image hash if present, otherwise add one.
        if isinstance(afs.get("images"), list) and afs["images"]:
            afs["images"][0]["hash"] = image_hash_primary
        else:
            afs["images"] = [{"hash": image_hash_primary}]
        return {"asset_feed_spec": _json_compact(afs)}, "asset_feed_spec"

    oss = creative.get("object_story_spec")
    if isinstance(oss, dict):
        oss2 = json.loads(json.dumps(oss))
        ld = oss2.get("link_data")
        if isinstance(ld, dict):
            ld["image_hash"] = image_hash_primary
        return {"object_story_spec": _json_compact(oss2)}, "object_story_spec"

    _die("Creative template nao possui object_story_spec nem asset_feed_spec.")


def main() -> int:
    load_dotenv()
    # Reuse the Meta token already stored for the local skill (if present).
    skill_env = Path.home() / ".codex" / "skills" / "meta-ads-insights" / ".env"
    if skill_env.exists():
        load_dotenv(skill_env, override=False)

    ap = argparse.ArgumentParser(description="Criar campanha Click-to-WhatsApp via Meta API (clonando template).")
    ap.add_argument("--ad-account-id", default=os.getenv("META_AD_ACCOUNT_ID", "1076578477997478").strip(), help="Conta de anuncios (sem act_).")
    ap.add_argument("--graph-version", default=os.getenv("META_GRAPH_VERSION", "v21.0").strip(), help="Versao Graph API, ex: v21.0")
    ap.add_argument("--activate", action="store_true", help="Criar campanha/adset/ad como ACTIVE (senao fica PAUSED).")
    ap.add_argument("--dry-run", action="store_true", help="Nao cria nada; apenas resolve template e imprime payloads.")
    ap.add_argument("--name", default="WA | Botox 3 Regioes | SJRPreto Centro 4km | 12-14fev | R$10d", help="Nome base.")
    args = ap.parse_args()

    token = (os.getenv("META_ACCESS_TOKEN") or "").strip()
    if not token:
        _die("META_ACCESS_TOKEN ausente no ambiente. Exporte a variavel e rode novamente.")

    version = _parse_version(args.graph_version)
    ad_account_id = (args.ad_account_id or "").strip().replace("act_", "")
    if not re.fullmatch(r"\d+", ad_account_id):
        _die(f"ad-account-id invalido: {args.ad_account_id!r}")

    acct = _graph_get(version, f"act_{ad_account_id}", token, params={"fields": "id,name,currency,timezone_name,timezone_offset_hours_utc"})
    print(f"Conta: act_{ad_account_id} | {acct.get('name')} | moeda={acct.get('currency')} tz={acct.get('timezone_name')} offset={acct.get('timezone_offset_hours_utc')}")

    perms = _graph_get(version, "me/permissions", token).get("data") or []
    granted = {p.get("permission") for p in perms if str(p.get("status") or "").lower() == "granted"}
    if not args.dry_run and "ads_management" not in granted:
        _die(
            "Token nao tem permissao 'ads_management' (somente leitura). "
            "Gere um novo token com ads_management e substitua META_ACCESS_TOKEN."
        )

    template = _find_template(version, token, ad_account_id)
    print(f"Template campaign: {template.campaign.get('name')} ({template.campaign.get('id')})")
    print(f"Template adset: {template.adset.get('name')} ({template.adset.get('id')})")
    print(f"Template ad: {template.ad.get('name')} ({template.ad.get('id')}) creative=({template.creative.get('id')})")

    # Targeting: use the template ad set custom location (clinic pin) and adjust radius to 4 km.
    targeting = dict(template.adset.get("targeting") or {})
    targeting = _clean_targeting(targeting)
    targeting["age_min"] = 25
    targeting["age_max"] = 55
    targeting["genders"] = [2]  # 2=female in Meta targeting
    geo = targeting.get("geo_locations") or {}
    cl = geo.get("custom_locations") or []
    if not (isinstance(cl, list) and cl and isinstance(cl[0], dict)):
        _die("Template WHATSAPP nao possui geo_locations.custom_locations; nao consigo aplicar raio 4km via API.")
    first = dict(cl[0])
    if first.get("latitude") is None or first.get("longitude") is None:
        _die("Template WHATSAPP custom_locations nao tem latitude/longitude; nao consigo aplicar raio 4km via API.")
    first["radius"] = 4
    first["distance_unit"] = "kilometer"
    geo["custom_locations"] = [first]
    geo["location_types"] = geo.get("location_types") or ["home", "recent"]
    targeting["geo_locations"] = geo
    print(f"Geo escolhido: custom_location do template ({float(first['latitude']):.6f},{float(first['longitude']):.6f}) raio=4km")

    # Schedule: start ASAP (5 min from now), end fixed 14/02/2026 12:00 BRT unless already past.
    # Note: API expects ISO8601 with timezone offset.
    start = _now_utc() + dt.timedelta(minutes=5)
    end_fixed = dt.datetime(2026, 2, 14, 15, 0, tzinfo=dt.timezone.utc)  # 12:00 BRT == 15:00 UTC
    end = end_fixed
    if end <= start:
        end = start + dt.timedelta(days=2)

    status = "ACTIVE" if args.activate else "PAUSED"

    # Budget: daily budget in cents.
    daily_budget = 1000  # R$10.00
    campaign_budget_field: str | None = None
    campaign_budget_value: int | None = None
    if template.campaign.get("daily_budget"):
        # Template is using Advantage campaign budget (CBO): budget is set at campaign level.
        campaign_budget_field = "daily_budget"
        campaign_budget_value = daily_budget
    elif template.campaign.get("lifetime_budget"):
        # Match template type: 2 days * R$10/day => R$20 lifetime.
        campaign_budget_field = "lifetime_budget"
        campaign_budget_value = daily_budget * 2

    primary_text = (
        'Botox 3 regiões por R$ 799 em até 12x sem juros. Atendimento no Centro de São José do Rio Preto. '
        'Clique em “Enviar mensagem” e agende sua avaliação. Sujeito à avaliação profissional.'
    )
    headline = "Botox 3 regiões | R$ 799"
    desc = "Agende pelo WhatsApp"
    prefill = "Oi! Tenho interesse no Botox 3 regiões (R$ 799 em 12x). Quero agendar uma avaliação."

    # Upload creatives
    img_45 = "/Users/renandiasoliveira/Desktop/real/tmp/ads_creatives/wa_botox_3regioes_1080x1350.png"
    img_916 = "/Users/renandiasoliveira/Desktop/real/tmp/ads_creatives/wa_botox_3regioes_1080x1920.png"

    if args.dry_run:
        print("[DRY-RUN] Nao vou criar nada nem fazer upload de imagens.")
        print("[DRY-RUN] Imagens previstas:")
        print(f"  - {img_45}")
        print(f"  - {img_916}")
        return 0

    hash_45 = _upload_image(version, token, ad_account_id, img_45)
    # Upload 9:16 too (may be used if template supports asset_feed_spec rules)
    hash_916 = _upload_image(version, token, ad_account_id, img_916)
    print(f"Upload imagem 4:5 hash={hash_45}")
    print(f"Upload imagem 9:16 hash={hash_916}")

    # Campaign create
    campaign_bid_strategy = "LOWEST_COST_WITHOUT_CAP"
    camp_payload = {
        "name": args.name,
        "status": status,
        "objective": template.campaign.get("objective"),
        "buying_type": template.campaign.get("buying_type") or "AUCTION",
        "bid_strategy": campaign_bid_strategy,
        "special_ad_categories": _json_compact(template.campaign.get("special_ad_categories") or []),
    }
    if campaign_budget_field and campaign_budget_value is not None:
        camp_payload[campaign_budget_field] = str(campaign_budget_value)
    camp_res = _graph_post(version, f"act_{ad_account_id}/campaigns", token, data=camp_payload)
    new_camp_id = str(camp_res.get("id"))
    if not new_camp_id:
        _die(f"Falha criando campanha: {camp_res}")
    print(f"Criada campanha: {new_camp_id}")

    # Adset create (clone core fields)
    template_bid_strategy = str(template.adset.get("bid_strategy") or "").strip()
    template_bid_amount = template.adset.get("bid_amount")
    bid_strategy = "LOWEST_COST_WITHOUT_CAP"
    if template_bid_strategy and template_bid_strategy not in {"LOWEST_COST_WITH_BID_CAP", "TARGET_COST"}:
        bid_strategy = template_bid_strategy
    # Some templates use strategies that require bid_amount; fallback for low-budget tests.
    if template_bid_strategy in {"LOWEST_COST_WITH_BID_CAP", "TARGET_COST"} and not template_bid_amount:
        bid_strategy = "LOWEST_COST_WITHOUT_CAP"
        print(
            f"[WARN] Template bid_strategy '{template_bid_strategy}' exige bid_amount; "
            "usando fallback LOWEST_COST_WITHOUT_CAP."
        )

    adset_payload: Dict[str, Any] = {
        "name": args.name,
        "campaign_id": new_camp_id,
        "status": status,
        "billing_event": template.adset.get("billing_event"),
        "optimization_goal": template.adset.get("optimization_goal"),
        "destination_type": template.adset.get("destination_type"),
        "promoted_object": _json_compact(template.adset.get("promoted_object") or {}),
        "targeting": _json_compact(targeting),
        "start_time": start.isoformat(),
        "end_time": end.isoformat(),
    }
    if bid_strategy:
        adset_payload["bid_strategy"] = bid_strategy
    if campaign_budget_field is None:
        # Template is ad set budget (ABO): budget is set at ad set level.
        adset_payload["daily_budget"] = str(daily_budget)
    # Optional fields if present
    if template_bid_amount:
        adset_payload["bid_amount"] = str(template_bid_amount)
    if str(template.adset.get("optimization_goal") or "").upper() == "CONVERSATIONS":
        # Messaging optimization in this account/version accepts only 1-day click attribution.
        adset_payload["attribution_spec"] = _json_compact([{"event_type": "CLICK_THROUGH", "window_days": 1}])
    elif template.adset.get("attribution_spec"):
        adset_payload["attribution_spec"] = _json_compact(template.adset["attribution_spec"])

    adset_res = _graph_post(version, f"act_{ad_account_id}/adsets", token, data=adset_payload)
    new_adset_id = str(adset_res.get("id"))
    if not new_adset_id:
        _die(f"Falha criando adset: {adset_res}")
    print(f"Criado adset: {new_adset_id}")

    # Creative create (clone template creative but replace image + copy)
    creative_mode = "unknown"
    creative_payload_fields: Dict[str, Any] = {}

    # Build a spec container matching what the template uses
    if isinstance(template.creative.get("asset_feed_spec"), dict):
        spec_container = {"asset_feed_spec": template.creative["asset_feed_spec"]}
    else:
        spec_container = {"object_story_spec": template.creative.get("object_story_spec") or {}}

    spec_container2 = _set_copy_in_spec(spec_container, primary_text, headline, desc, prefill)
    # Apply image into the same mode
    if "asset_feed_spec" in spec_container2:
        tmp_creative = {"asset_feed_spec": spec_container2["asset_feed_spec"]}
        creative_payload_fields, creative_mode = _set_image_in_creative(tmp_creative, hash_45)
        # If asset_feed_spec has multiple images, append 9:16 hash as second to help placements.
        afs = json.loads(creative_payload_fields["asset_feed_spec"])
        imgs = afs.get("images") or []
        if isinstance(imgs, list):
            seen = {i.get("hash") for i in imgs if isinstance(i, dict)}
            if hash_916 not in seen:
                imgs.append({"hash": hash_916})
            afs["images"] = imgs
            creative_payload_fields["asset_feed_spec"] = _json_compact(afs)
    else:
        tmp_creative = {"object_story_spec": spec_container2["object_story_spec"]}
        creative_payload_fields, creative_mode = _set_image_in_creative(tmp_creative, hash_45)

    creative_payload: Dict[str, Any] = {
        "name": args.name,
        "status": status,
        **creative_payload_fields,
    }
    # Preserve actor fields if present (important for IG/FB identity)
    if template.creative.get("instagram_actor_id"):
        creative_payload["instagram_actor_id"] = str(template.creative["instagram_actor_id"])
    if template.creative.get("actor_id"):
        creative_payload["actor_id"] = str(template.creative["actor_id"])

    cr_res = _graph_post(version, f"act_{ad_account_id}/adcreatives", token, data=creative_payload)
    new_creative_id = str(cr_res.get("id"))
    if not new_creative_id:
        _die(f"Falha criando creative: {cr_res}")
    print(f"Criado creative: {new_creative_id} (modo={creative_mode})")

    # Ad create
    ad_payload = {
        "name": args.name,
        "adset_id": new_adset_id,
        "status": status,
        "creative": _json_compact({"creative_id": new_creative_id}),
    }
    ad_res = _graph_post(version, f"act_{ad_account_id}/ads", token, data=ad_payload)
    new_ad_id = str(ad_res.get("id"))
    if not new_ad_id:
        _die(f"Falha criando ad: {ad_res}")
    print(f"Criado anuncio: {new_ad_id}")

    # Save previews (HTML) for quick validation.
    previews_dir = "/Users/renandiasoliveira/Desktop/real/tmp/meta_api/previews"
    os.makedirs(previews_dir, exist_ok=True)
    for fmt in ["DESKTOP_FEED_STANDARD", "MOBILE_FEED_STANDARD", "INSTAGRAM_STORY", "FACEBOOK_STORY_MOBILE"]:
        try:
            prev = _graph_get(version, f"{new_ad_id}/previews", token, params={"ad_format": fmt})
            data = prev.get("data") or []
            if data and isinstance(data, list) and isinstance(data[0], dict) and data[0].get("body"):
                body = data[0]["body"]
                out_path = os.path.join(previews_dir, f"{new_ad_id}_{fmt}.html")
                with open(out_path, "w", encoding="utf-8") as f:
                    f.write(body)
                print(f"Preview salvo: {out_path}")
        except Exception as exc:
            print(f"[WARN] preview {fmt} falhou: {exc}")

    print("OK.")
    print(f"IDs: campaign={new_camp_id} adset={new_adset_id} creative={new_creative_id} ad={new_ad_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
