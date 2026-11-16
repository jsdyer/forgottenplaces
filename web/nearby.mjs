const $ = id => document.getElementById(`nearby-${id}`);
const earthRadiusKm = 6371.0088;
const radians = value => value * Math.PI / 180;
const fetches = new Map();
const size = 10;
const formatDistance = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" });
const sources = [
  { kind: "place", label: "Historic places", file: "./data/nearby.json" },
  { kind: "wreck", label: "Shipwrecks", file: "../shipwrecks/data/nearby.json" },
];
const canvas = $("map");
let coastline;
let area = null;
let matches = [];
let active = null;
let page = 0;
let request = 0;

function node(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

function link(text, href, separate = false) {
  const element = node("a", text);
  element.href = href;
  if (separate) {
    element.target = "_blank";
    element.rel = "noopener noreferrer";
  }
  return element;
}

function getJSON(path) {
  if (!fetches.has(path)) {
    const pending = fetch(path).then(response => {
      if (!response.ok) throw new Error("Source unavailable");
      return response.json();
    }).catch(error => {
      fetches.delete(path);
      throw error;
    });
    fetches.set(path, pending);
  }
  return fetches.get(path);
}

function position(centre, [lon, lat]) {
  const phi1 = radians(centre.lat);
  const phi2 = radians(lat);
  const delta = radians(lon - centre.lon);
  const haversine = Math.sin((phi2 - phi1) / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(delta / 2) ** 2;
  const distance = 2 * earthRadiusKm * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
  const bearing = Math.atan2(Math.sin(delta) * Math.cos(phi2),
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(delta));
  return { distance, bearing };
}

function sourceDate(value) {
  if (value == null || value === "") return "";
  if (/^\d{4}$/.test(value)) return value;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const date = new Date(value.slice(0, 10) + "T00:00:00Z");
  return Number.isFinite(date.valueOf()) ? dateFormat.format(date) : value;
}

async function readSource(source) {
  const snapshot = await getJSON(source.file);
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length !== snapshot.meta?.mapped) {
    fetches.delete(source.file);
    throw new Error("Incomplete snapshot");
  }
  return { ...source, ...snapshot };
}

function shown() {
  return matches.filter(row => !$("kind").value || row.kind === $("kind").value);
}

function renderMap() {
  if (!area) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const centre = canvas.width / 2;
  const border = centre - 14;
  const scale = border / area.km;
  const pixel = ({ distance, bearing }) => [
    centre + Math.sin(bearing) * distance * scale,
    centre - Math.cos(bearing) * distance * scale,
  ];
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.beginPath();
  context.arc(centre, centre, border, 0, 2 * Math.PI);
  context.clip();
  context.fillStyle = "#20362e";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (coastline) {
    context.beginPath();
    for (const polygon of coastline) {
      for (const ring of polygon) {
        for (const [index, point] of ring.entries()) {
          const [x, y] = pixel(position(area, point));
          if (!index) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.closePath();
      }
    }
    context.fillStyle = "#45604f";
    context.fill("evenodd");
  }
  context.beginPath();
  context.moveTo(centre - 6, centre);
  context.lineTo(centre + 6, centre);
  context.moveTo(centre, centre - 6);
  context.lineTo(centre, centre + 6);
  context.strokeStyle = "#f7f6e9";
  context.lineWidth = 2;
  context.stroke();
  for (const row of shown()) {
    const [x, y] = pixel(row);
    context.beginPath();
    if (row.kind === "place") {
      context.moveTo(x, y - 5);
      context.lineTo(x + 5, y);
      context.lineTo(x, y + 5);
      context.lineTo(x - 5, y);
      context.closePath();
    } else {
      context.arc(x, y, 2.8, 0, 2 * Math.PI);
    }
    context.fillStyle = row.kind === "place" ? "#d0f098" : "#a1dcee";
    context.fill();
  }
  context.restore();
  context.beginPath();
  context.arc(centre, centre, border, 0, 2 * Math.PI);
  context.strokeStyle = "#799481";
  context.lineWidth = 2;
  context.stroke();
  if (active) {
    const [x, y] = pixel(active);
    context.beginPath();
    context.arc(x, y, 8, 0, 2 * Math.PI);
    context.strokeStyle = "#fff2c7";
    context.lineWidth = 2;
    context.stroke();
  }
}

function renderList() {
  const list = $("list");
  const visible = shown();
  list.replaceChildren();
  const start = page * size;
  const pages = Math.ceil(visible.length / size);
  $("pages").hidden = pages <= 1;
  $("page").textContent = `Page ${page + 1} of ${pages}`;
  $("prev").disabled = !page;
  $("next").disabled = page + 1 >= pages;
  if (!visible.length) {
    list.append(node("li", "No published locations match this radius and dataset selection."));
  }
  for (const row of visible.slice(start, start + size)) {
    const item = node("li");
    const wreck = row.kind === "wreck";
    const explorer = wreck ? `../shipwrecks/#wreck=${encodeURIComponent(row.id)}` : `?place=${encodeURIComponent(row.id)}`;
    const official = wreck
      ? `${row.sourceMap}#data_s=id%3AdataSource_3-19db53b0d64-layer-3%3A${row.mapId}`
      : `https://www.historicplaces.ca/en/rep-reg/place-lieu.aspx?id=${encodeURIComponent(row.id)}`;
    const details = [
      wreck ? "Shipwreck" : "Historic place",
      `${formatDistance.format(row.distance)} km`,
      row.date ? `${wreck ? "Wreck" : "Designated"} ${sourceDate(row.date)}` : "Date unrecorded",
      row.place,
    ].filter(Boolean).join(" · ");
    const actions = node("div");
    actions.className = "nearby-record-actions";
    const locate = node("button", "Locate on map");
    locate.type = "button";
    locate.setAttribute("aria-label", `Locate ${row.name} on map`);
    locate.addEventListener("click", () => {
      active = row;
      $("focus").textContent = `${row.name} · ${formatDistance.format(row.distance)} km from centre`;
      renderMap();
    });
    actions.append(link(wreck ? "Official wreck map ↗" : "Official register entry ↗", official, true));
    if (!wreck) actions.append(link("Published location ↗", row.locationSource, true));
    actions.append(locate);
    const recenter = node("button", "Search from here");
    recenter.type = "button";
    recenter.setAttribute("aria-label", `Search from ${row.name}`);
    recenter.addEventListener("click", () => {
      const [lon, lat] = row.point;
      $("lat").value = lat;
      $("lon").value = lon;
      $("preset").value = "";
      $("form").querySelector("button[type=submit]").focus();
      search();
    });
    actions.append(recenter);
    item.append(link(row.name, explorer), node("p", details), actions);
    list.append(item);
  }
  renderMap();
}

function updateURL() {
  const url = new URL(location.href);
  url.searchParams.set("nearLat", area.lat);
  url.searchParams.set("nearLon", area.lon);
  url.searchParams.set("nearKm", area.km);
  history.replaceState(null, "", url);
}

async function search() {
  const id = ++request;
  const centre = { lat: $("lat").valueAsNumber, lon: $("lon").valueAsNumber, km: $("km").valueAsNumber };
  const status = $("status");
  if (!Object.values(centre).every(Number.isFinite) || !$("form").reportValidity()) return;
  status.textContent = "Loading published locations…";
  const results = await Promise.allSettled(sources.map(readSource));
  if (id !== request) return;
  area = centre;
  matches = [];
  active = null;
  page = 0;
  $("focus").textContent = "Select a record to locate it within the radius.";
  $("coverage").replaceChildren();
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      $("coverage").append(node("p", `${sources[index].label} are unavailable. Submit again to retry.`));
      return;
    }
    const { kind, label, meta, rows } = result.value;
    const count = rows.length.toLocaleString("en-CA");
    const total = meta.count.toLocaleString("en-CA");
    const note = node("p", `${label} · ${count} of ${total} records have usable locations on this map. `);
    note.append(link(kind === "wreck" ? "Nova Scotia dataset ↗" : "Parks Canada register extract ↗", meta.source, true));
    if (meta.sourceUpdated) note.append(` · ${sourceDate(meta.sourceUpdated)}`);
    if (kind === "place") {
      note.append(" · ", link("Parks Canada National Historic Sites location map ↗", meta.locationSource, true),
        ` · ${sourceDate(meta.locationUpdated)}. Location coordinates copied from Parks Canada’s published map. `,
        link("Source terms ↗", meta.locationTerms, true));
    }
    $("coverage").append(note);
    for (const row of rows) {
      const relative = position(centre, row.point);
      if (relative.distance <= centre.km) matches.push({ ...row, ...relative, kind, sourceMap: meta.map });
    }
  });
  matches.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
  const places = matches.filter(row => row.kind === "place").length;
  const wrecks = matches.length - places;
  const ok = results.filter(result => result.status === "fulfilled").length;
  status.textContent = !ok ? "The nearby sources could not load."
    : `${places} historic ${places === 1 ? "place" : "places"} · ${wrecks} ${wrecks === 1 ? "shipwreck" : "shipwrecks"} within ${area.km} km${ok === 1 ? " · one source unavailable" : ""}`;
  updateURL();
  $("results").hidden = false;
  renderList();
  if (ok && !coastline) {
    getJSON("../shipwrecks/shoreline.json").then(data => {
      if (Array.isArray(data)) coastline = data;
      renderMap();
    }).catch(() => {});
  }
}

$("form").addEventListener("submit", event => {
  event.preventDefault();
  search();
});
$("preset").addEventListener("change", event => {
  if (!event.target.value) return;
  const [lat, lon] = event.target.value.split(",");
  $("lat").value = lat;
  $("lon").value = lon;
});
for (const coordinate of ["lat", "lon"]) {
  $(coordinate).addEventListener("input", () => { $("preset").value = ""; });
}
$("kind").addEventListener("change", () => {
  active = null;
  page = 0;
  $("focus").textContent = "Select a record to locate it within the radius.";
  renderList();
});
$("prev").addEventListener("click", () => { page--; renderList(); });
$("next").addEventListener("click", () => { page++; renderList(); });
const params = new URLSearchParams(location.search);
if (["nearLat", "nearLon", "nearKm"].every(key => params.get(key))) {
  $("lat").value = params.get("nearLat");
  $("lon").value = params.get("nearLon");
  $("km").value = params.get("nearKm");
  $("preset").value = `${$("lat").value},${$("lon").value}`;
}
if (location.hash === "#nearby" || params.has("nearLat")) search();
window.addEventListener("hashchange", () => {
  if (location.hash === "#nearby" && !area) search();
});
