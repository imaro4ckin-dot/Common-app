import L from 'https://esm.sh/leaflet@1.9.4';
import { CATS, svg } from './icons.js';

export const AREAS = {
  'Altstadt':          [49.4093, 8.7100],
  'Bergheim':          [49.4055, 8.6900],
  'Neuenheim':         [49.4160, 8.6950],
  'Weststadt':         [49.3990, 8.6870],
  'Handschuhsheim':    [49.4260, 8.6900],
  'Neuenheimer Feld':  [49.4180, 8.6700],
  'Bahnstadt':         [49.3980, 8.6720]
};

// Map instances keyed by container element id
const maps = new Map();

function getOrCreateMap(containerId, opts = {}) {
  if (maps.has(containerId)) {
    const existing = maps.get(containerId);
    existing.map.remove();
    maps.delete(containerId);
  }
  const el = document.getElementById(containerId);
  if (!el) return null;

  const map = L.map(el, {
    zoomControl: !opts.mini,
    attributionControl: !opts.mini,
    scrollWheelZoom: !opts.mini,
    dragging: !opts.mini,
    touchZoom: !opts.mini,
    doubleClickZoom: !opts.mini,
    boxZoom: !opts.mini,
    keyboard: !opts.mini,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);

  maps.set(containerId, { map, markers: [] });
  return maps.get(containerId);
}

function categoryIcon(catKey, selected = false) {
  const c = CATS[catKey];
  const hue = c ? c.hue : '#888';
  const bg = selected ? hue : '#fff';
  const color = selected ? '#fff' : hue;
  const border = hue;
  const size = selected ? 44 : 36;
  const iconSvg = svg(catKey, selected ? 20 : 18);
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${bg};border:2.5px solid ${border};
      color:${color};display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 8px rgba(0,0,0,.18);
      transition:transform 160ms ease;
      ${selected ? 'transform:scale(1.15);z-index:10;' : ''}
    ">${iconSvg}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function youIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:16px;height:16px;border-radius:50%;
      background:var(--accent,#2B44D9);border:3px solid #fff;
      box-shadow:0 0 0 5px color-mix(in oklab,var(--accent,#2B44D9) 22%,transparent);
    "></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}

// Full discover map — rendered into a div with id="leaflet-map"
export function initDiscoverMap(list, opts = {}) {
  const { sel, ring, youCoords, onSelect } = opts;
  const el = document.getElementById('leaflet-map');
  if (!el) return;

  function doInit() {
    const instance = getOrCreateMap('leaflet-map');
    if (!instance) return;
    const { map, markers } = instance;
    markers.forEach(m => m.remove());
    instance.markers = [];

    const [uLat, uLng] = youCoords || AREAS.Bergheim;

    const youMarker = L.marker([uLat, uLng], { icon: youIcon(), zIndexOffset: 1000, interactive: false }).addTo(map);
    instance.markers.push(youMarker);

    if (ring && ring > 0) {
      const circle = L.circle([uLat, uLng], {
        radius: ring * 1000,
        color: 'var(--accent,#2B44D9)',
        fillColor: 'var(--accent,#2B44D9)',
        fillOpacity: 0.05,
        weight: 1.5,
        dashArray: '6 6'
      }).addTo(map);
      instance.markers.push(circle);
    }

    list.forEach(g => {
      const isSelected = g.id === sel;
      const marker = L.marker([g.lat, g.lng], { icon: categoryIcon(g.cat, isSelected), title: g.name }).addTo(map);
      marker.on('click', () => { if (onSelect) onSelect(g.id); });
      instance.markers.push(marker);
    });

    map.invalidateSize();
    if (list.length > 0) {
      const allCoords = [[uLat, uLng], ...list.map(g => [g.lat, g.lng])];
      map.fitBounds(L.latLngBounds(allCoords), { padding: [32, 32], maxZoom: 15 });
    } else {
      map.setView([uLat, uLng], 14);
    }
  }

  const ro = new ResizeObserver(entries => {
    const rect = entries[0].contentRect;
    if (rect.width > 0 && rect.height > 0) { ro.disconnect(); doInit(); }
  });
  ro.observe(el);
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) { ro.disconnect(); doInit(); }
}

// Mini map on group detail page — rendered into div id="leaflet-mini-{groupId}"
export function initMiniMap(g, youCoords) {
  const containerId = `leaflet-mini-${g.id}`;
  const el = document.getElementById(containerId);
  if (!el) return;

  function doInit() {
    const instance = getOrCreateMap(containerId, { mini: true });
    if (!instance) return;
    const { map, markers } = instance;
    markers.forEach(m => m.remove());
    instance.markers = [];

    const [uLat, uLng] = youCoords || AREAS.Bergheim;
    const youMarker = L.marker([uLat, uLng], { icon: youIcon(), interactive: false }).addTo(map);
    instance.markers.push(youMarker);
    const pinMarker = L.marker([g.lat, g.lng], { icon: categoryIcon(g.cat, true) }).addTo(map);
    instance.markers.push(pinMarker);

    const bounds = L.latLngBounds([[uLat, uLng], [g.lat, g.lng]]);
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
  }

  const ro = new ResizeObserver(entries => {
    const rect = entries[0].contentRect;
    if (rect.width > 0 && rect.height > 0) { ro.disconnect(); doInit(); }
  });
  ro.observe(el);
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) { ro.disconnect(); doInit(); }
}

export function cleanupMap(containerId) {
  if (maps.has(containerId)) {
    maps.get(containerId).map.remove();
    maps.delete(containerId);
  }
}

// Heidelberg bounding box for Nominatim viewbox filter
const HD_BOX = '8.60,49.36,8.80,49.46'; // west,south,east,north

function pickerIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:var(--accent,#2B44D9);border:3px solid #fff;
      box-shadow:0 2px 10px rgba(0,0,0,.35);
      cursor:grab;
    "></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

// Interactive location picker rendered into containerId.
// opts: { lat, lng, onLocation(lat, lng, name) }
export function initLocationPicker(containerId, opts = {}) {
  const existing = maps.get(containerId);
  if (existing) { existing.map.remove(); maps.delete(containerId); }

  const el = document.getElementById(containerId);
  if (!el) return;

  function doInit() {
    // Don't init if already created for this element
    if (maps.has(containerId)) return;

    const startLat = opts.lat || 49.4100;
    const startLng = opts.lng || 8.6950;

    const map = L.map(el, { zoomControl: true, scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(map);

    map.setView([startLat, startLng], opts.lat ? 17 : 14);
    map.invalidateSize();

    let marker = null;

    function placeMarker(lat, lng, name) {
      if (marker) marker.setLatLng([lat, lng]);
      else {
        marker = L.marker([lat, lng], { icon: pickerIcon(), draggable: true }).addTo(map);
        marker.on('dragend', e => {
          const p = e.target.getLatLng();
          if (opts.onLocation) opts.onLocation(p.lat, p.lng, name || '');
        });
      }
      if (opts.onLocation) opts.onLocation(lat, lng, name || '');
    }

    map.on('click', e => placeMarker(e.latlng.lat, e.latlng.lng, ''));

    if (opts.lat && opts.lng) placeMarker(opts.lat, opts.lng, '');

    maps.set(containerId, { map, markers: marker ? [marker] : [] });

    // Wire up search controls
    const searchInput = document.getElementById('s-loc-search');
    const searchBtn = document.getElementById('s-loc-btn');
    const resultsList = document.getElementById('s-loc-results');
    if (!searchInput || !searchBtn || !resultsList) return;

    async function doSearch() {
      const q = searchInput.value.trim();
      if (!q) return;
      resultsList.innerHTML = '<li class="loc-loading">Searching…</li>';
      resultsList.hidden = false;
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ' Heidelberg')}&format=json&limit=5&viewbox=${HD_BOX}&bounded=0&accept-language=en`;
        const res = await fetch(url, { headers: { 'User-Agent': 'CommonApp/1.0' } });
        const data = await res.json();
        if (!data.length) {
          resultsList.innerHTML = '<li class="loc-noresult">No results — try a different name</li>';
          return;
        }
        resultsList.innerHTML = data.map((r, i) =>
          `<li><button type="button" class="loc-result" data-idx="${i}" data-lat="${r.lat}" data-lng="${r.lon}" data-name="${r.display_name.split(',')[0]}">${r.display_name.split(',').slice(0, 2).join(', ')}</button></li>`
        ).join('');
      } catch {
        resultsList.innerHTML = '<li class="loc-noresult">Search failed — click the map to place manually</li>';
      }
    }

    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });

    resultsList.addEventListener('click', e => {
      const btn = e.target.closest('.loc-result');
      if (!btn) return;
      const lat = parseFloat(btn.dataset.lat);
      const lng = parseFloat(btn.dataset.lng);
      const name = btn.dataset.name;
      placeMarker(lat, lng, name);
      map.setView([lat, lng], 17);
      searchInput.value = name;
      resultsList.hidden = true;
    });
  }

  // Use ResizeObserver: init Leaflet only when the container has real pixel dimensions
  const ro = new ResizeObserver(entries => {
    const rect = entries[0].contentRect;
    if (rect.width > 0 && rect.height > 0) {
      ro.disconnect();
      doInit();
    }
  });
  ro.observe(el);

  // Also try immediately in case it's already sized
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    ro.disconnect();
    doInit();
  }
}
