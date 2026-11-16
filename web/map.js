const SVG = "http://www.w3.org/2000/svg";
const RAD = Math.PI / 180;
const labels = {
  YT: [-137, 64], NT: [-118, 65], NU: [-89, 68], BC: [-125, 54], AB: [-115, 54],
  SK: [-106, 54], MB: [-98, 55], ON: [-84, 51], QC: [-72, 54],
  NL: [-57, 52], NB: [-67.2, 47], NS: [-63, 44.7], PE: [-61.4, 46.8],
};

// Lambert azimuthal equal-area projection centered on Canada.
function project([longitude, latitude]) {
  const phi = latitude * RAD;
  const lambda = (longitude + 95) * RAD;
  const center = 60 * RAD;
  const scale = Math.sqrt(2 / (1 + Math.sin(center) * Math.sin(phi) + Math.cos(center) * Math.cos(phi) * Math.cos(lambda)));
  return [
    scale * Math.cos(phi) * Math.sin(lambda) * 700,
    -scale * (Math.cos(center) * Math.sin(phi) - Math.sin(center) * Math.cos(phi) * Math.cos(lambda)) * 700,
  ];
}

function rings(geometry) {
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

function pathData(geometry) {
  return rings(geometry).map(ring => "M" + ring.map(point => project(point).map(n => n.toFixed(1)).join(",")).join("L") + "Z").join("");
}

function svgElement(name, properties) {
  const el = document.createElementNS(SVG, name);
  for (const [key, val] of Object.entries(properties)) el.setAttribute(key, val);
  return el;
}

function mapBounds(features) {
  const points = features.flatMap(feature => rings(feature.geometry).flat().map(project));
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return [Math.min(...xs) - 14, Math.min(...ys) - 12, Math.max(...xs) - Math.min(...xs) + 28, Math.max(...ys) - Math.min(...ys) + 24];
}

export async function loadMap(svg, onChoose) {
  const read = async name => {
    const response = await fetch(new URL(name, import.meta.url));
    if (!response.ok) throw new Error(name + " is unavailable");
    return response.json();
  };
  const [provinceData, contextData] = await Promise.all([
    read("map-provinces.json"), read("map-outline.json").catch(() => ({ features: [] })),
  ]);
  const provinces = provinceData.features;
  const paths = new Map();
  svg.setAttribute("viewBox", mapBounds(provinces).join(" "));
  for (const feature of contextData.features) {
    svg.append(svgElement("path", { d: pathData(feature.geometry), class: "context-path", "aria-hidden": true }));
  }
  for (const feature of provinces) {
    const { name, code } = feature.properties;
    const path = svgElement("path", { d: pathData(feature.geometry), class: "province", tabindex: 0,
      role: "button", "aria-label": name, "aria-pressed": false, "fill-rule": "evenodd", "vector-effect": "non-scaling-stroke" });
    const title = svgElement("title", {});
    title.textContent = name;
    path.append(title);
    svg.append(path);
    path.addEventListener("click", () => onChoose(code));
    path.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onChoose(code);
      }
    });
    paths.set(code, { path, title, name });
  }
  for (const [code, position] of Object.entries(labels)) {
    const [x, y] = project(position);
    const label = svgElement("text", { x, y, class: "region-label", "aria-hidden": true });
    label.textContent = code;
    svg.append(label);
  }
  return {
    update(counts, selected) {
      const max = Math.max(1, ...Object.values(counts));
      for (const [code, { path, title, name }] of paths) {
        const count = counts[code] || 0;
        const lightness = Math.round(31 + Math.sqrt(count / max) * 36);
        const text = `${name}: ${count.toLocaleString("en-CA")} matching ${count === 1 ? "place" : "places"}`;
        path.style.setProperty("--region-fill", `hsl(100 25% ${lightness}%)`);
        path.classList.toggle("selected", selected === code);
        path.classList.toggle("dim", Boolean(selected && selected !== code) || count === 0);
        path.setAttribute("aria-pressed", String(selected === code));
        path.setAttribute("aria-label", text);
        title.textContent = text;
      }
    },
  };
}
