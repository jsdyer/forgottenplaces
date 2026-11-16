#!/usr/bin/env python3
"""Build the browser-only atlas from the Parks Canada CRHP federal extract."""
import argparse
import datetime as dt
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
from tempfile import TemporaryDirectory
from time import sleep
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "e9385d68-ce65-46fa-a9fc-1b1f377f3f5d"
RESOURCE = "7e691189-5c74-4fb4-866c-5389d5abfa48"
CATALOG = f"https://open.canada.ca/data/en/dataset/{PACKAGE}"
API = f"https://open.canada.ca/data/api/3/action/package_show?id={PACKAGE}"
SNAPSHOT = f"https://open.canada.ca/data/dataset/{PACKAGE}/resource/{RESOURCE}/download/rclp-crhp-2026-12-12-donnees-federales-federal-data.xlsx"
LICENSE = "https://open.canada.ca/en/open-government-licence-canada"
EXTRACT_DATE = "2025-12-12"
PUBLISHED_DATE = "2026-07-08"
PROVINCES = {
    "AB": "Alberta", "BC": "British Columbia", "MB": "Manitoba", "NB": "New Brunswick",
    "NL": "Newfoundland and Labrador", "NS": "Nova Scotia", "NT": "Northwest Territories",
    "NU": "Nunavut", "ON": "Ontario", "PE": "Prince Edward Island", "QC": "Quebec",
    "SK": "Saskatchewan", "YT": "Yukon",
}
PROVINCE_CODES = {name.casefold(): code for code, name in PROVINCES.items()}
NEEDED = {"PLACE_ID", "MAIN_NAME_EN", "MAIN_NAME_FR", "PL_PROV_TERR", "MAIN_REC_TYPE", "DESC_HIST_EN"}

# Categories classify the wording in the historical record. They do not infer current condition.
THEMES = [
    ("settlements", "Ghost towns & settlements", r"\b(?:ghost[ -]towns?|abandoned (?:towns?|villages?|settlements?)|company towns?|former (?:mining|fishing|logging) (?:towns?|villages?|settlements?)|resettlement|abandoned communit(?:y|ies))\b"),
    ("military", "Defence & military", r"\b(?:defence|military|armour(?:y|ies)|barracks|blockhouses?|fortifications?|bunkers?|coastal batter(?:y|ies))\b"),
    ("industry", "Mines, mills & industry", r"\b(?:coal min(?:e|es|ing)|mining|foundr(?:y|ies)|sawmills?|pulp mills?|textile mills?|steelworks|smelters?|powerhouses?|hydroelectric(?:ity)?|manufacturing|industrial)\b"),
    ("ruins", "Ruins & former sites", r"\b(?:ruins?|ruined|archaeological remains|building foundations|abandoned (?:buildings?|structures?|sites?|railways?|mines?|mills?|forts?|stations?)|demolished)\b"),
    ("rail", "Railways & waystations", r"\b(?:railways?|railroad|locomotives?|roundhouses?|rail facilities|train stations?|rail lines?)\b"),
    ("coastal", "Lighthouses & coasts", r"\b(?:lighthouses?|light stations?|navigational aids?|fog alarms?|coastal|fishing stations?|shipwrecks?)\b"),
    ("remoteness", "Remote outposts", r"\b(?:remote(?:ly)? located|remote (?:areas?|outposts?|sites?|locations?|islands?|communities)|isolated (?:outposts?|stations?|locations?|sites?|areas?|settlements?|islands?)|trading posts?|fur trade posts?|arctic expeditions?)\b"),
]
THEME_PATTERNS = [(key, re.compile(pattern, re.I)) for key, _, pattern in THEMES]


def download(url, path=None):
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "CoolCode Forgotten Places data import"})
            with urlopen(request, timeout=90) as response:
                if urlparse(response.url).scheme != "https":
                    raise ValueError("Download redirected away from HTTPS.")
                if path is None:
                    return json.load(response)
                with path.open("wb") as target:
                    shutil.copyfileobj(response, target)
                return None
        except (URLError, TimeoutError, OSError, ValueError) as error:
            if attempt == 2:
                raise RuntimeError(f"Could not download {url}: {error}") from error
            sleep(2 ** attempt)


def discover():
    catalog = download(API)["result"]
    if catalog.get("license_id") != "ca-ogl-lgo":
        raise ValueError("The CRHP catalogue licence changed. Review before publishing.")
    resources = [
        row for row in catalog["resources"]
        if row.get("format", "").upper() == "XLSX"
        and (row.get("id") == RESOURCE or row.get("unique_identifier") == "PLACE_ID")
    ]
    if not resources:
        raise ValueError("No CRHP PLACE_ID workbook found in the federal catalogue.")
    resource = max(resources, key=lambda row: row.get("last_modified") or row.get("created") or "")
    url = resource["url"]
    if urlparse(url).scheme != "https" or urlparse(url).hostname != "open.canada.ca":
        raise ValueError("CRHP workbook moved outside the expected Open Government Portal.")
    return {
        "downloadUrl": url,
        "extractDate": str(catalog.get("date_published") or "")[:10],
        "resourceDate": str(resource.get("last_modified") or resource.get("created") or "")[:10],
    }


def clean(value):
    return "" if value is None else str(value).replace("\r\n", "\n").replace("\r", "\n").strip()


def compact(value):
    return " ".join(clean(value).split())


def clip(value, max_length):
    if len(value) <= max_length:
        return value
    return value[:max_length].rsplit(" ", 1)[0] + "…"


def read_workbook(path):
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        for sheet in workbook:
            rows = sheet.iter_rows(values_only=True)
            for _, values in zip(range(12), rows):
                headers = [clean(value) for value in values]
                if NEEDED.issubset(headers):
                    return [dict(zip(headers, row)) for row in rows if any(row)]
        raise ValueError("Expected machine-readable CRHP headers were not found.")
    finally:
        workbook.close()


def text_url(value):
    url = compact(value)
    parsed = urlparse(url)
    return url if parsed.scheme in {"https", "http"} and parsed.hostname and not parsed.username else ""


def organize(source):
    records, details = {}, {}
    for row in source:
        get = lambda key: clean(row.get(key))
        record_id = get("PLACE_ID")
        name = get("MAIN_NAME_EN") or get("MAIN_NAME_FR")
        if not record_id or not name:
            continue
        province = PROVINCE_CODES.get(get("PL_PROV_TERR").casefold(), "")
        locality = next((get(f"PL_LEVEL_{i}") for i in range(1, 6)
                         if get(f"PL_LEVEL_{i}") and get(f"PL_LEVEL_{i}").casefold() != get("PL_PROV_TERR").casefold()), "")
        description = get("DESC_HIST_EN") or get("DESC_HIST_FR")
        significance = get("DESC_VALUE_EN") or get("DESC_VALUE_FR")
        characters = get("DESC_CDE_EN") or get("DESC_CDE_FR")
        alias = get("NM_OTHER_NAME_EN")
        designation = get("MAIN_REC_TYPE")
        address = get("PL_STREET_EN") or get("PL_STREET_FR")
        historic_text = compact(" ".join((name, description, significance, characters)))
        evidence = {}
        for key, pattern in THEME_PATTERNS:
            fields = (historic_text,) if key in {"settlements", "ruins", "remoteness"} else (
                " ".join((name, designation, get("FN_CATEGORY_EN"), get("FN_TYPE_EN"))), historic_text)
            for field in fields:
                match = pattern.search(field)
                if match:
                    evidence[key] = match.group()
                    break
        year = get("MAIN_REC_DATE")[:4]
        detail = {
            "description": description,
            "heritageValue": significance,
            "character": characters,
            "nameFr": get("MAIN_NAME_FR"),
            "historicFrom": get("DT_FROM"),
            "historicTo": get("DT_TO"),
            "recognitionDate": get("MAIN_REC_DATE"),
            "authority": get("MAIN_REC_AUTH"),
            "statute": get("MAIN_REC_STATUTE"),
            "otherNames": alias,
            "function": get("FN_TYPE_EN"),
            "documentation": get("DESC_DOC_EN"),
            "governmentLinks": [
                {"name": text or "Source-listed link", "url": url}
                for text, raw_url in [(get("LK_DESC_EN"), get("LK_WEBSITE_EN"))]
                if (url := text_url(raw_url)) and
                (urlparse(url).hostname or "").endswith((".gc.ca", ".canada.ca", ".historicplaces.ca"))
            ],
        }
        record = {
            "id": record_id, "name": name, "province": province,
            "provinceLabel": get("PL_PROV_TERR"), "place": locality, "address": address,
            "designation": designation, "year": int(year) if year.isdigit() else None,
            "short": clip(compact(description or significance), 470),
            "evidence": evidence, "search": compact(" ".join((
                get("MAIN_NAME_FR"), alias, get("NM_OTHER_NAME_FR"),
                get("TH_CATEGORY_EN"), get("TH_TYPE_EN"), get("FN_CATEGORY_EN"), get("FN_TYPE_EN"),
                clip(compact(description), 800), clip(compact(significance), 400),
                " ".join(get(f"PL_LEVEL_{i}") for i in range(1, 6)),
            ))),
        }
        # Keep the most complete source row if a place identifier occurs more than once.
        richness = sum(len(detail[field]) for field in ("description", "heritageValue", "character"))
        old = details.get(record_id)
        if old and richness <= sum(len(old[field]) for field in ("description", "heritageValue", "character")):
            continue
        records[record_id], details[record_id] = record, detail
    if not records:
        raise ValueError("No supported place records in the source workbook.")
    return sorted(records.values(), key=lambda record: (record["name"].casefold(), record["id"])), details


def zip_json(path, value):
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf8")
    path.write_bytes(gzip.compress(encoded, compresslevel=6, mtime=0))


def build(path, provenance, output):
    if output.exists() and not (output / "data" / "manifest.json").is_file():
        raise ValueError(f"Refusing to replace an existing directory that is not an atlas build: {output}")
    raw = read_workbook(path)
    records, details = organize(raw)
    if len(records) < 100:
        raise ValueError("CRHP workbook contains unexpectedly few unique records.")
    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".forgotten-places-build-", dir=output.parent) as temp:
        staging = Path(temp) / "site"
        shutil.copytree(ROOT / "web", staging)
        data = staging / "data"
        data.mkdir()
        for start in range(0, len(records), 120):
            shard = start // 120
            group = records[start:start + 120]
            zip_json(data / f"detail-{shard}.json.gz", {r["id"]: details[r["id"]] for r in group})
            for record in group:
                record["shard"] = shard
        zip_json(data / "places.json.gz", records)
        metadata = {
            **provenance, "publisher": "Parks Canada", "catalogUrl": CATALOG, "licenceUrl": LICENSE,
            "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "builtAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "count": len(records), "sourceRows": len(raw), "provinces": PROVINCES,
            "themes": {key: label for key, label, _ in THEMES},
            "designations": sorted({r["designation"] for r in records if r["designation"]}),
        }
        (data / "manifest.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf8")
        # Preserve the previous build until the complete replacement is ready.
        previous = staging.parent / "previous"
        if output.exists():
            output.rename(previous)
        try:
            staging.rename(output)
        except OSError:
            if previous.exists():
                previous.rename(output)
            raise
    print(f"Built {len(records):,} unique places from {len(raw):,} source rows into {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Use a local copy of the verified workbook.")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or output == ROOT / "web" or output in ROOT.parents:
        parser.error("Output must be a dedicated build directory.")
    if args.input:
        build(args.input, {"downloadUrl": SNAPSHOT, "extractDate": EXTRACT_DATE,
                           "resourceDate": PUBLISHED_DATE}, output)
    else:
        with TemporaryDirectory(prefix="forgotten-places-data-") as temp:
            source = Path(temp) / "crhp.xlsx"
            provenance = discover()
            download(provenance["downloadUrl"], source)
            build(source, provenance, output)


if __name__ == "__main__":
    main()
