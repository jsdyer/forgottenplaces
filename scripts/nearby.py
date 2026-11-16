"""Match Canadian Register entries to points from Parks Canada's public historic-sites map."""
from collections import Counter
from datetime import date
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


SOURCE = "https://parks.canada.ca/lhn-nhs?wbdisable=true"
TERMS = "https://parks.canada.ca/termes-terms"
CACHE = Path(__file__).parent / "parks-map-points.json"


def name_key(value):
    folded = unicodedata.normalize("NFKD", value.casefold())
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    folded = " ".join(re.findall(r"[^\W_]+", folded))
    return re.sub(r" national historic site(?: of canada)?$", "", folded)


class PointTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.points = []
        self.point = None
        self.link = None
        self.name = None
        self.modified = ""
        self.date_capture = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "tr":
            match = re.fullmatch(r"POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)", attrs.get("data-geometry", ""))
            point = tuple(map(float, match.groups())) if match else None
            self.point = point if point and -180 <= point[0] <= 180 and -90 <= point[1] <= 90 else None
        elif tag == "a" and self.point and attrs.get("href"):
            href = urljoin(SOURCE, attrs["href"])
            parsed = urlparse(href)
            if parsed.scheme == "https" and parsed.hostname == "parks.canada.ca":
                self.link = href
                self.name = []
        elif tag == "time" and attrs.get("property") == "dateModified":
            self.date_capture = True

    def handle_data(self, value):
        if self.name is not None:
            self.name.append(value)
        if self.date_capture:
            self.modified += value

    def handle_endtag(self, tag):
        if tag == "a" and self.name is not None:
            title = " ".join("".join(self.name).split())
            province = urlparse(self.link).path.split("/")[2:3]
            if title and province and re.fullmatch(r"[a-z]{2}", province[0]):
                self.points.append([title, province[0].upper(), list(self.point), self.link])
            self.name = self.link = None
        elif tag == "tr":
            self.point = None
        elif tag == "time":
            self.date_capture = False


def parse_map(html):
    parser = PointTable()
    parser.feed(html)
    if len(parser.points) < 100:
        raise ValueError("Expected at least 100 Parks Canada map points.")
    return {
        "modified": date.fromisoformat(parser.modified.strip()).isoformat(),
        "points": parser.points,
    }


def write_nearby(data, records, details, provenance):
    source = json.loads(CACHE.read_text(encoding="utf-8"))
    eligible = [r for r in records if r["designation"] == "National Historic Site of Canada"]
    keys = Counter((name_key(r["name"]), r["province"]) for r in eligible)
    points = Counter((name_key(name), province) for name, province, _, _ in source["points"])
    lookup = {(name_key(name), province): (point, link) for name, province, point, link in source["points"]}
    nearby = []
    for record in eligible:
        key = name_key(record["name"]), record["province"]
        if keys[key] != 1 or points[key] != 1:
            continue
        point, link = lookup[key]
        nearby.append({
            "id": record["id"], "name": record["name"],
            "place": ", ".join(filter(None, (record["place"], record["provinceLabel"]))),
            "date": details[record["id"]]["recognitionDate"], "point": point, "locationSource": link,
        })
    payload = {
        "meta": {
            "source": "https://open.canada.ca/data/en/dataset/e9385d68-ce65-46fa-a9fc-1b1f377f3f5d",
            "sourceUpdated": provenance["extractDate"],
            "locationSource": SOURCE, "locationUpdated": source["modified"], "locationTerms": TERMS,
            "count": len(records), "mapped": len(nearby),
        },
        "rows": nearby,
    }
    (data / "nearby.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Nearby index matched {len(nearby)} register records to Parks Canada points.")


def main():
    request = Request(SOURCE, headers={"User-Agent": "CoolCode Forgotten Places location snapshot"})
    with urlopen(request, timeout=30) as response:
        value = parse_map(response.read(2_000_000).decode("utf-8"))
    CACHE.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
