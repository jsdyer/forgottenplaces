import { loadMap } from "./map.js";

const $ = id => document.getElementById(id);
const rowsPerPage = 12;
const number = new Intl.NumberFormat("en-CA");
const normal = value => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const featured = [
  ["14309", "Gold rush settlement"],
  ["4169", "Cold War bunker"],
  ["3453", "Labrador fishing outpost"],
  ["18791", "Arctic archaeological remains"],
];
const detailsCache = new Map();
const groups = ["query", "province", "locality", "designation", "sort"];

let meta;
let records = [];
let matches = [];
let map;
let theme = "";
let page = 0;
let activeRecord = "";
const lookup = new Map();
let failed = false;
const initialState = new URLSearchParams(location.search);

function node(tag, text, classes) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (classes) el.className = classes;
  return el;
}

function link(text, url) {
  const el = node("a", text);
  el.href = url;
  el.target = "_blank";
  el.rel = "noopener noreferrer";
  return el;
}

function button(text, onClick, classes) {
  const el = node("button", text, classes);
  el.type = "button";
  el.addEventListener("click", onClick);
  return el;
}

async function readJson(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  if (!path.endsWith(".gz")) return response.json();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 31 || bytes[1] !== 139) return JSON.parse(new TextDecoder().decode(bytes));
  if (!window.DecompressionStream) throw new Error("Open the atlas in an up-to-date browser to read the snapshot.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json();
}

function official(record, lang = "en") {
  return `https://www.historicplaces.ca/${lang}/rep-reg/place-lieu.aspx?id=${encodeURIComponent(record.id)}`;
}

function address(record) {
  return [record.address, record.place, record.provinceLabel].filter(Boolean).join(", ");
}

function displayLocation(record) {
  return [record.place, record.provinceLabel].filter(Boolean).join(", ") || "Location not listed";
}

function mapSearch(record) {
  if (!record.provinceLabel) return "";
  const place = record.address ? address(record) : [record.name, displayLocation(record)].join(", ");
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: 1, query: place + ", Canada" })}`;
}

function detailData(record) {
  if (!detailsCache.has(record.shard)) {
    detailsCache.set(record.shard, readJson(`data/detail-${record.shard}.json.gz`).catch(error => {
      detailsCache.delete(record.shard);
      throw error;
    }));
  }
  return detailsCache.get(record.shard).then(shard => shard[record.id]);
}

function section(title, text) {
  const block = node("section");
  block.append(node("h3", title), typeof text === "string" ? node("p", text) : text);
  return block;
}

function definitionList(entries) {
  const dl = node("dl", null, "detail-facts");
  for (const [label, value] of entries) {
    if (value) dl.append(node("dt", label), node("dd", value));
  }
  return dl;
}

async function openRecord(record) {
  activeRecord = record.id;
  $("detail-title").textContent = record.name;
  $("detail-id").textContent = `Canadian Register · ${record.id}`;
  $("detail-context").textContent = [displayLocation(record), record.designation, record.year].filter(Boolean).join(" · ");
  const website = link("Official register entry ↗", official(record));
  website.className = "button";
  const actions = [website, link("French entry ↗", official(record, "fr"))];
  const mapUrl = mapSearch(record);
  if (mapUrl) actions.push(link("Search address on map ↗", mapUrl));
  actions.push(button("Copy record link", async () => {
    const url = new URL(location.href);
    url.searchParams.set("place", record.id);
    url.hash = "";
    const note = $("detail-copy");
    try {
      await navigator.clipboard.writeText(url.href);
      note.textContent = "Record link copied.";
    } catch {
      note.textContent = url.href;
    }
  }, "button quiet"));
  const copyNote = node("span");
  copyNote.id = "detail-copy";
  copyNote.setAttribute("role", "status");
  actions.push(copyNote);
  $("detail-actions").replaceChildren(...actions);
  const body = $("detail-body");
  body.replaceChildren(node("p", "Loading the full register entry…", "help"));
  if (!$("details").open) $("details").showModal();
  $("details").scrollTop = 0;
  try {
    const detail = await detailData(record);
    if (activeRecord !== record.id || !$("details").open) return;
    if (!detail) throw new Error("Details unavailable.");
    const content = [];
    const facts = definitionList([
      ["Recorded address", address(record)], ["French name", detail.nameFr],
      ["Other names", detail.otherNames], ["Recognition date", detail.recognitionDate],
      ["Historical dates", [detail.historicFrom, detail.historicTo !== detail.historicFrom ? detail.historicTo : ""].filter(Boolean).join("–")],
      ["Authority", detail.authority], ["Recognition statute", detail.statute], ["Recorded uses", detail.function],
    ]);
    if (facts.children.length) content.push(section("Register information", facts));
    for (const [title, text] of [["Description", detail.description], ["Heritage value", detail.heritageValue],
      ["Character-defining elements", detail.character], ["Supporting documentation", detail.documentation]]) {
      if (text) content.push(section(title, text));
    }
    if (detail.governmentLinks.length) {
      const links = node("ul");
      for (const source of detail.governmentLinks) {
        const item = node("li");
        item.append(link(source.name, source.url));
        links.append(item);
      }
      content.push(section("Government links in the source workbook", links));
    }
    body.replaceChildren(...(content.length ? content : [node("p", "The workbook has no further details for this record.")]));
  } catch {
    if (activeRecord === record.id && $("details").open) {
      body.replaceChildren(node("p", record.short || "No preview is available."), node("p", "The full entry could not be loaded. Open the official register entry above or try again."));
    }
  }
}

function terms(query) {
  return [...query.matchAll(/"([^"]*)"?|([^\s"]+)/gu)].map(part => normal(part[1] ?? part[2]).trim()).filter(Boolean);
}

function matchingRank(record, words) {
  let rank = 0;
  for (const word of words) {
    if (!record.haystack.includes(word)) return -1;
    if (record.normalName.includes(word)) rank += 5;
    if (record.normalPlace.includes(word)) rank += 3;
    if (record.id === word) rank += 10;
  }
  return rank;
}

function marked(el, text, words) {
  const indexes = [];
  const raw = normal(text);
  // Only use offsets when accent-folding leaves character positions intact.
  if (raw.length !== text.length) { el.textContent = text; return; }
  for (const word of words) {
    let start = raw.indexOf(word);
    while (start >= 0) {
      indexes.push([start, start + word.length]);
      start = raw.indexOf(word, start + word.length);
    }
  }
  let offset = 0;
  for (const [start, end] of indexes.sort((a, b) => a[0] - b[0])) {
    if (start < offset) continue;
    el.append(document.createTextNode(text.slice(offset, start)), node("mark", text.slice(start, end)));
    offset = end;
  }
  el.append(document.createTextNode(text.slice(offset)));
}

function renderCard(record, words) {
  const card = node("article", null, "panel record");
  const eyebrow = node("p", [displayLocation(record), record.year, record.designation].filter(Boolean).join(" · "), "record-meta");
  const title = node("h3", null, "record-title");
  const titleButton = button("", () => openRecord(record));
  marked(titleButton, record.name, words);
  title.append(titleButton);
  const snippet = node("p", null, "snippet");
  marked(snippet, record.short || "Open the register entry for details.", words);
  card.append(eyebrow, title, snippet);
  if (theme && record.evidence[theme]) {
    card.append(node("p", `Theme match in source: “${record.evidence[theme]}”`, "evidence"));
  }
  return card;
}

function getParams() {
  return {
    query: $("query").value.trim(), province: $("province").value,
    locality: $("locality").value, designation: $("designation").value, sort: $("sort").value,
  };
}

function syncUrl() {
  const url = new URL(location.href);
  const params = getParams();
  for (const [key, val] of Object.entries({ ...params, theme })) {
    if (val && !(key === "sort" && val === "relevance")) url.searchParams.set(key, val);
    else url.searchParams.delete(key);
  }
  history.replaceState(null, "", url);
}

function render() {
  if (!meta || failed) return;
  const { query, province, locality, designation, sort } = getParams();
  const tokens = terms(query);
  const regionCounts = {};
  const pool = [];
  for (const record of records) {
    if (designation && designation !== record.designation) continue;
    if (theme && !record.evidence[theme]) continue;
    const rank = matchingRank(record, tokens);
    if (rank < 0) continue;
    if (record.province) regionCounts[record.province] = (regionCounts[record.province] || 0) + 1;
    if (province && province !== record.province) continue;
    if (locality && locality !== record.place) continue;
    pool.push({ record, rank });
  }
  if (sort === "old" || sort === "new") {
    pool.sort((a, b) => {
      const ay = a.record.year, by = b.record.year;
      if (!ay || !by) return Number(Boolean(by)) - Number(Boolean(ay));
      return sort === "old" ? ay - by : by - ay;
    });
  } else if (sort === "relevance") {
    pool.sort((a, b) => b.rank - a.rank);
  }
  matches = pool.map(item => item.record);
  const pageCount = Math.max(1, Math.ceil(matches.length / rowsPerPage));
  page = Math.min(page, pageCount - 1);
  $("records").replaceChildren(...matches.slice(page * rowsPerPage, (page + 1) * rowsPerPage).map(record => renderCard(record, tokens)));
  if (!matches.length) {
    const empty = node("div", null, "panel empty");
    empty.append(node("h3", "No matching places"), node("p", "Try fewer search words, another location, or clear the filters."), button("Clear all filters", reset, "button quiet"));
    $("records").append(empty);
  }
  $("count").textContent = `${number.format(matches.length)} ${matches.length === 1 ? "entry" : "entries"}${province ? ` in ${meta.provinces[province]}` : ""}`;
  $("pages").hidden = pageCount <= 1;
  $("prev").disabled = page === 0;
  $("next").disabled = page >= pageCount - 1;
  $("page-number").textContent = `Page ${number.format(page + 1)} of ${number.format(pageCount)}`;
  $("surprise").disabled = !matches.length;
  $("reset").hidden = !(query || province || locality || designation || theme || sort !== "relevance");
  $("map-reset").hidden = !province;
  for (const chip of $("themes").children) {
    chip.setAttribute("aria-pressed", String(chip.dataset.theme === theme));
  }
  $("map-heading").textContent = province ? meta.provinces[province] : "Explore by region";
  if (map) {
    map.update(regionCounts, province);
    $("map-note").textContent = province
      ? `${number.format(regionCounts[province] || 0)} regional matches · Choose another region to switch.`
      : "Select a province or territory. Shading shows matching records by region.";
  }
}

function apply() {
  page = 0;
  syncUrl();
  render();
}

function addOption(id, text, value) {
  $(id).append(new Option(text, value));
}

function setProvince(code) {
  $("province").value = code;
  const enabled = Boolean($("province").value);
  $("locality").replaceChildren(new Option(enabled ? "All localities" : "Choose a region first", ""));
  $("locality").disabled = !enabled;
  const places = new Set(records.filter(row => row.province === code && row.place).map(row => row.place));
  for (const name of [...places].sort((a, b) => a.localeCompare(b, "en-CA"))) addOption("locality", name, name);
}

function reset() {
  for (const name of groups) $(name).value = name === "sort" ? "relevance" : "";
  theme = "";
  setProvince("");
  apply();
}

function buildDiscovery() {
  for (const [key, name] of Object.entries(meta.themes)) {
    const chip = button(name, () => { theme = theme === key ? "" : key; apply(); }, "chip");
    chip.dataset.theme = key;
    $("themes").append(chip);
  }
  for (const [id, label] of featured) {
    const place = lookup.get(id);
    if (!place) continue;
    const card = node("article", null, "feature");
    card.append(node("p", label, "feature-meta"), button(place.name, () => openRecord(place), "feature-title"));
    $("features").append(card);
  }
  $("data-details").replaceChildren(...definitionList([
    ["Register extract", meta.extractDate], ["Workbook updated", meta.resourceDate],
    ["Atlas built (UTC)", String(meta.builtAt || "").slice(0, 10)],
    ["Records in atlas", number.format(meta.count)],
  ]).children);
}

function restoreFilters() {
  setProvince(initialState.get("province") || "");
  for (const name of ["locality", "designation", "sort"]) {
    const value = initialState.get(name);
    if (value && Array.from($(name).options).some(option => option.value === value)) $(name).value = value;
  }
  if (!$("query").value) $("query").value = initialState.get("query") || "";
  const savedTheme = initialState.get("theme");
  if (Object.hasOwn(meta.themes, savedTheme)) theme = savedTheme;
}

$("search-form").addEventListener("submit", event => { event.preventDefault(); apply(); });
$("query").addEventListener("input", apply);
for (const id of ["locality", "designation", "sort"]) $(id).addEventListener("change", apply);
$("province").addEventListener("change", () => { setProvince($("province").value); apply(); });
$("map-reset").addEventListener("click", () => { setProvince(""); apply(); });
$("reset").addEventListener("click", reset);
$("surprise").addEventListener("click", () => {
  if (matches.length) openRecord(matches[Math.floor(Math.random() * matches.length)]);
});
$("details").addEventListener("close", () => { activeRecord = ""; });
for (const [id, direction] of [["prev", -1], ["next", 1]]) {
  $(id).addEventListener("click", () => { page = Math.max(0, page + direction); render(); $("results-heading").focus(); });
}

try {
  [meta, records] = await Promise.all([readJson("data/manifest.json"), readJson("data/places.json.gz")]);
  if (!Array.isArray(records) || records.length !== meta.count || !records.length) throw new Error("The search data is incomplete.");
  for (const record of records) {
    record.normalName = normal(record.name);
    record.normalPlace = normal([record.place, record.provinceLabel].join(" "));
    record.haystack = normal([record.name, record.address, record.place, record.provinceLabel,
      record.province, record.designation, record.id, record.search].join(" "));
    lookup.set(record.id, record);
  }
  for (const [code, name] of Object.entries(meta.provinces).sort((a, b) => a[1].localeCompare(b[1], "en-CA"))) {
    addOption("province", name, code);
  }
  for (const name of meta.designations) addOption("designation", name, name);
  restoreFilters();
  buildDiscovery();
  render();
  const requested = lookup.get(initialState.get("place"));
  if (requested) openRecord(requested);
  loadMap($("map"), code => {
    setProvince($("province").value === code ? "" : code);
    apply();
  }).then(loaded => { map = loaded; render(); }).catch(() => {
    $("map-note").textContent = "Map unavailable. Use the Province or territory filter to browse by region.";
  });
} catch (error) {
  failed = true;
  $("count").textContent = "Search data could not be loaded.";
  $("map-note").textContent = "Regional map data is unavailable.";
  const errorBox = node("div", null, "panel empty");
  errorBox.append(node("h3", "Atlas unavailable"), node("p", error.message),
    button("Try again", () => location.reload(), "button quiet"), " ",
    link("Open the official register index ↗", "https://www.historicplaces.ca/index_en.html"));
  $("records").replaceChildren(errorBox);
}
