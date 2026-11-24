# Forgotten Places

<!-- coolcode:guide -->
Search a locality or choose a theme, then open the original designation and its historical description. Theme matches describe archive wording and do not establish current abandonment, access permission or a site’s physical condition.
<!-- /coolcode:guide -->

A browser-only CoolCode atlas of federal historic places drawn from the Canadian Register of Historic Places. Explore the country by province or territory, narrow by locality and designation, search English and French place names, or start with a theme such as defence installations, mills and mines, or historic settlements. Open a record for its description, heritage value, character-defining elements, and original government links.

The **atlas uses the federal-designation extract**, not a complete list of Canadian heritage sites. The map groups records by their province or territory. The workbook has no coordinates, so the map shows regional distributions and never guesses an individual site's location. A record's map-search link uses the address or locality reported by the register.

Themes describe wording in the archive. They include evidence such as “company town,” “military,” and “archaeological remains.” A theme match does not establish present-day abandonment, physical condition, ownership, or permission to visit.

## Run locally

```sh
python3 -m pip install -r requirements.txt
python3 scripts/build.py
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). Use `--input /path/to/crhp.xlsx` to develop with a local copy of the official workbook. A modern browser supporting the gzip DecompressionStream API loads the generated search index and individual record detail bundles. Search and filtering run in the browser with no API, framework, or mapping service dependency.

## Deploy and refresh

GitHub Actions reads the Open Government catalogue, downloads the official XLSX, and builds and deploys `dist/` to GitHub Pages. The workflow supports weekly refreshes and manual runs. A failed download or invalid workbook fails the build before deployment, preserving the previous published site. The built site's Source notes show the extract date, resource update, build date, and record count. `data/manifest.json` also records the exact source URL and SHA-256.

Use **Settings → Pages → GitHub Actions** as the publishing source. The project inherits the custom domain of `jsdyer/jsdyer.github.io` and uses relative assets under [coolcode.ca/forgottenplaces/](https://coolcode.ca/forgottenplaces/).

## Sources and licence

- [Canadian Register of Historic Places (CRHP)](https://open.canada.ca/data/en/dataset/e9385d68-ce65-46fa-a9fc-1b1f377f3f5d), Parks Canada. The official catalogue identifies the federal snapshot as extracted December 12, 2025. The downloadable workbook was published July 8, 2026. One duplicate place ID in the supplied snapshot is represented by its most complete row (2,527 unique entries from 2,528 rows).
- [Official workbook resource](https://open.canada.ca/data/en/dataset/e9385d68-ce65-46fa-a9fc-1b1f377f3f5d/resource/7e691189-5c74-4fb4-866c-5389d5abfa48), a bilingual XLSX. Source links are keyed on its `PLACE_ID`. `MAIN_FPT_ID` is a different identifier.
- [Directory of Federal Heritage Designations](https://www.parks.canada.ca/culture/adpf-dfhd), the current federal authority. The CRHP archive is no longer actively maintained.
- Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).
- Map made with [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/), public-domain base geography. The shapes use a generalized projection and are intended for browsing the archive.

## Nearby coastal history

**Find nearby sites and wrecks** compares both archives in one radius, ordered by straight-line distance. Use a Nova Scotia preset, enter coordinates, or start with a plotted vessel in [Shipwreck Explorer](https://coolcode.ca/shipwrecks/). The location is included in the page URL. Each result shows the available wreck or designation date and links to its official record.

The register workbook lacks coordinates. The builder matches unique National Historic Site names and provinces with the published [National historic sites map](https://parks.canada.ca/lhn-nhs?wbdisable=true) from Parks Canada. The match strips the common designation suffix and normalizes punctuation and accents. Ambiguous names and unmatched sites stay in the main register without entering the radius index. The tested snapshot matches 126 of 2,527 entries. The coordinate data in `scripts/parks-map-points.json` is copied from the Parks Canada map and follows the site's [terms](https://parks.canada.ca/termes-terms). To review and refresh that source copy, run `python3 scripts/nearby.py`.

The radius explorer also reads the compact, same-origin index published by Shipwreck Explorer. Provincial wreck positions are approximate and have separate source attribution. Serve both built sites at `/forgottenplaces/` and `/shipwrecks/` for end-to-end local testing.

## Regression checks

Pull requests that change code run logic tests and Chromium checks at this tool’s
Pages subpath, including a real control interaction and 320/390-pixel layouts.
Documentation-only pull requests skip this workflow. Publication waits for the
same checks. Test data stays in a separate job and is never packaged for Pages.

```sh
python3 -m unittest discover -s tests -v
python3 tests/build_fixture.py
python3 -m pip install -r tests/browser-requirements.txt
python3 -m playwright install chromium
python3 tests/browser_smoke.py
```

<!-- schedule-reliability -->
## Schedule reliability

Public GitHub repositories can have scheduled workflows disabled after 60 days of inactivity. A separate weekly [schedule guard](.github/workflows/schedule-guard.yml) calls GitHub's enable-workflow API for an explicit list of refresh workflows and itself. It can restore workflows disabled for inactivity, preserves manually disabled workflows, and runs independently of collection failures.

This is an interim mitigation, not a scheduling guarantee: GitHub does not document active-workflow renewal as a permanent exemption, and scheduled runs can be delayed or dropped. A scheduler on our own Linux server is the planned independent trigger. The guard does not collect data, create dummy commits, or change source/check timestamps; successful collection and published data freshness still need monitoring.
<!-- /schedule-reliability -->
