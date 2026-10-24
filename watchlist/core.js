/* Shared core for the Watchlist Merger (/watchlist/).
   Everything runs in the browser; data lives in localStorage on this device. */
(function () {
  'use strict';
  const STORE_KEY = 'lbxm.v1';
  const TMDB_KEY = 'lbxm.tmdb.v1';
  const PALETTE = ['#ff8000', '#00e054', '#40bcf4', '#f45b9c', '#b48cff', '#ffd23f', '#ff6b6b', '#2ec4b6',
    '#9be564', '#f7a072', '#7f9cff', '#e36bff', '#57d9a3', '#ffb3c1', '#d9b44a', '#8fd3ff'];

  const PROXIES = [
    { id: 'allorigins', name: 'allorigins.win', make: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
    { id: 'codetabs', name: 'codetabs.com', make: u => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u) },
  ];

  /* ---------- theme ---------- */
  function initTheme() {
    let t = null;
    try { t = localStorage.getItem('lbxm.theme'); } catch (e) { }
    if (t) document.documentElement.dataset.theme = t;
  }
  function toggleTheme() {
    const cur = document.documentElement.dataset.theme ||
      (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('lbxm.theme', next); } catch (e) { }
  }
  initTheme();

  /* ---------- store ---------- */
  function blank() {
    return { v: 1, friends: [], vetoes: [], settings: { proxy: 'auto', customProxy: '', tmdbKey: '', fetchWatched: true } };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && Array.isArray(s.friends)) {
        const b = blank();
        return Object.assign(b, s, { settings: Object.assign(b.settings, s.settings || {}) });
      }
    } catch (e) { }
    return blank();
  }
  function save(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); return true; }
    catch (e) { toast('Could not save on this device (storage full or blocked).'); return false; }
  }

  /* ---------- small utils ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function norm(t) {
    return String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function keyOf(f) { return norm(f.t) + '|' + (f.y || ''); }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function initials(name) {
    const p = String(name || '?').replace(/[_.\-]+/g, ' ').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p[1] ? p[1][0] : (p[0] || '').slice(1, 2))).toUpperCase();
  }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function nextColor(friends) {
    const used = new Set(friends.map(f => f.color));
    return PALETTE.find(c => !used.has(c)) || PALETTE[friends.length % PALETTE.length];
  }
  function avatar(f, cls) {
    return `<span class="avatar ${cls || ''}" style="--c:${f.color}" title="${esc(f.name)}">${esc(initials(f.name))}</span>`;
  }
  let toastTimer;
  function toast(msg, ms) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), ms || 3200);
  }
  function filmUrl(f) {
    return f.s ? 'https://letterboxd.com/film/' + f.s + '/'
      : 'https://letterboxd.com/search/films/' + encodeURIComponent(f.t + (f.y ? ' ' + f.y : '')) + '/';
  }
  /* Letterboxd poster URL from the film id + cache key scraped off the grid */
  function lbPoster(f, w, h) {
    if (!f.i || !f.s) return '';
    w = w || 230; h = h || 345;
    const id = String(f.i);
    return `https://a.ltrbxd.com/resized/film-poster/${id.split('').join('/')}/${id}-${f.s}-0-${w}-0-${h}-crop.jpg${f.v ? '?v=' + f.v : ''}`;
  }
  function posterGradient(f) {
    const h = hash(keyOf(f));
    const a = h % 360, b = (a + 40 + (h >> 9) % 80) % 360;
    return `linear-gradient(170deg,hsl(${a} 22% 30%),hsl(${b} 24% 15%))`;
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { }
      ta.remove(); return ok;
    }
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const head = (rows.shift() || []).map(h => h.trim().toLowerCase());
    return rows.filter(r => r.some(x => x.trim() !== '')).map(r => {
      const o = {}; head.forEach((h, i) => o[h] = (r[i] || '').trim()); return o;
    });
  }
  function csvToFilms(text) {
    return parseCSV(text).map(o => {
      const f = { t: o.name || o.title || o.film || '', y: parseInt(o.year, 10) || 0 };
      const r = parseFloat(o.rating);
      if (r > 0) f.r = r;
      const uri = o['letterboxd uri'] || o.uri || '';
      const m = uri.match(/letterboxd\.com\/film\/([^/]+)/);
      if (m) f.s = m[1];
      return f;
    }).filter(f => f.t);
  }
  function csvKind(name, text) {
    const n = name.toLowerCase();
    if (/watchlist/.test(n)) return 'watchlist';
    if (/rating/.test(n)) return 'ratings';
    if (/watched/.test(n)) return 'watched';
    const head = text.slice(0, 200).toLowerCase();
    if (/rating/.test(head.split('\n')[0])) return 'ratings';
    return 'watchlist';
  }
  /* combine watched + ratings into one list of {t,y,s,r} */
  function mergeWatched(watched, ratings) {
    const m = new Map();
    for (const f of watched || []) m.set(keyOf(f), Object.assign({}, f));
    for (const f of ratings || []) {
      const k = keyOf(f);
      m.set(k, Object.assign(m.get(k) || {}, f));
    }
    return [...m.values()];
  }

  /* Reads a Letterboxd export ZIP (needs JSZip) -> {username, watchlist, watched} */
  async function readZip(file) {
    if (!window.JSZip) throw new Error('ZIP support failed to load');
    const zip = await JSZip.loadAsync(file);
    const get = async n => { const e = zip.file(n) || zip.file(new RegExp('(^|/)' + n + '$', 'i'))[0]; return e ? e.async('string') : null; };
    const wl = await get('watchlist.csv'), wd = await get('watched.csv'), rt = await get('ratings.csv');
    const prof = await get('profile.csv');
    let username = '';
    if (prof) { const p = parseCSV(prof)[0] || {}; username = p.username || ''; }
    if (!username) { const m = file.name.match(/letterboxd-(.+?)-\d{4}-\d{2}-\d{2}/i); if (m) username = m[1]; }
    if (!wl && !wd && !rt) throw new Error(file.name + ' does not look like a Letterboxd export');
    return {
      username,
      watchlist: wl ? csvToFilms(wl) : null,
      watched: (wd || rt) ? mergeWatched(wd ? csvToFilms(wd) : [], rt ? csvToFilms(rt) : []) : null,
    };
  }

  /* ---------- fetching via CORS proxy ---------- */
  let preferred = null;
  function proxyList(settings) {
    const custom = (settings.customProxy || '').trim();
    const customP = custom ? [{
      id: 'custom', name: 'your proxy',
      make: u => custom.includes('{url}') ? custom.replace('{url}', encodeURIComponent(u)) : custom + u,
    }] : [];
    if (settings.proxy === 'custom') return customP;
    if (settings.proxy && settings.proxy !== 'auto') {
      const p = PROXIES.find(x => x.id === settings.proxy); if (p) return [p];
    }
    const list = customP.concat(PROXIES);
    if (preferred) list.sort((a, b) => (b.id === preferred) - (a.id === preferred));
    return list;
  }
  /* Proxies that time out or get blocked are skipped for the rest of the session;
     the first one that works is reused, and only if it fails are the others raced. */
  const dead = new Set();
  async function tryProxy(p, url, ms, ctrl) {
    ctrl = ctrl || new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(p.make(url), { signal: ctrl.signal });
      const txt = await res.text();
      if (res.status === 404 && /letterboxd/i.test(txt)) { const e = new Error('not found'); e.code = 404; throw e; }
      if (!res.ok) throw new Error(p.name + ' returned HTTP ' + res.status);
      if (!/letterboxd/i.test(txt)) throw new Error(p.name + ' returned something unexpected');
      if (/Just a moment\.\.\.|challenge-platform/i.test(txt) && !/data-(item|film)-slug|\/film\//.test(txt))
        throw new Error(p.name + ' was blocked by Cloudflare');
      return txt;
    } catch (e) {
      if (e.code === 404) throw e;
      if (e.name === 'AbortError') { if (ctrl.raceLost) throw e; e = new Error(p.name + ' timed out'); }
      dead.add(p.id);
      throw e;
    } finally { clearTimeout(t); }
  }
  async function fetchText(url, settings) {
    let list = proxyList(settings);
    if (list.every(p => dead.has(p.id))) dead.clear();
    list = list.filter(p => !dead.has(p.id));
    const pref = list.find(p => p.id === preferred);
    if (pref) {
      try { return await tryProxy(pref, url, 12000); }
      catch (e) { if (e.code === 404) throw e; preferred = null; list = list.filter(p => p !== pref && !dead.has(p.id)); }
    }
    if (!list.length) throw new Error('every proxy failed');
    const ctrls = list.map(() => new AbortController());
    try {
      return await Promise.any(list.map((p, i) => tryProxy(p, url, 15000, ctrls[i]).then(txt => {
        preferred = p.id;
        ctrls.forEach((c, j) => { if (j !== i) { c.raceLost = true; c.abort(); } });
        return txt;
      })));
    } catch (agg) {
      const errs = agg.errors || [agg];
      throw errs.find(e => e.code === 404) || errs[errs.length - 1] || new Error('No proxy configured');
    }
  }
  function parseGrid(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const nodes = doc.querySelectorAll('[data-item-slug],[data-film-slug],[data-target-link^="/film/"],[data-item-link^="/film/"],[data-film-link^="/film/"]');
    const seen = new Set(), out = [];
    for (const n of nodes) {
      const d = n.dataset;
      const link = d.itemLink || d.targetLink || d.filmLink || '';
      const slug = d.itemSlug || d.filmSlug || (link.match(/\/film\/([^/]+)/) || [])[1];
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      let name = d.itemName || d.filmName || d.itemFullDisplayName || '';
      if (!name) { const img = n.querySelector('img'); name = img ? img.getAttribute('alt') || '' : ''; }
      name = name.replace(/^Poster for /i, '');
      let y = parseInt(d.filmReleaseYear || d.itemReleaseYear || '', 10) || 0;
      const m = name.match(/^(.*)\s\((\d{4})\)\s*$/);
      if (m) { name = m[1]; y = y || +m[2]; }
      if (!name) name = slug.replace(/-\d{4}$/, '').replace(/-/g, ' ');
      const f = { t: name, y, s: slug };
      const a = k => n.getAttribute(k) || '';
      const pid = ((a('data-postered-identifier') || '').match(/film:(\d+)/) || [])[1];
      if (pid) { f.i = +pid; const ck = (a('data-resolvable-poster-path').match(/"cacheBustingKey":"([^"]+)"/) || [])[1]; if (ck) f.v = ck; }
      const box = n.closest('li') || n.parentElement;
      const own = parseFloat(d.ownerRating || (box && box.dataset && box.dataset.ownerRating) || '');
      if (own > 0) f.r = own > 5 ? own / 2 : own;
      else if (box) { const rm = box.innerHTML.match(/\brated-(\d{1,2})\b/); if (rm) f.r = +rm[1] / 2; }
      out.push(f);
    }
    const hasNext = !!doc.querySelector('a.next, .paginate-nextprev .next a, link[rel="next"]');
    return { items: out, hasNext };
  }
  async function pool(n, jobs) {
    const q = jobs.slice(), run = async () => { while (q.length) await q.shift()(); };
    await Promise.all(Array.from({ length: Math.min(n, q.length) }, run));
  }
  function lastPage(html) {
    const nums = [...html.matchAll(/\/page\/(\d+)\/"/g)].map(m => +m[1]);
    return nums.length ? Math.max(...nums) : 1;
  }
  /* Whole watchlist: page 1 tells how many pages there are, the rest load 4 at a time. */
  async function fetchWatchlist(username, settings, onProgress) {
    const base = 'https://letterboxd.com/' + encodeURIComponent(username) + '/watchlist/';
    const first = await fetchText(base, settings);
    const pages = [parseGrid(first).items];
    const last = Math.min(lastPage(first), 200);
    let done = 1, missed = 0;
    if (onProgress) onProgress(done, last);
    await pool(4, Array.from({ length: last - 1 }, (_, i) => async () => {
      const n = i + 2;
      let html = null;
      for (let attempt = 0; attempt < 2 && html == null; attempt++) {
        try { html = await fetchText(base + 'page/' + n + '/', settings); } catch (e) { if (e.code === 404) break; }
      }
      if (html == null) missed++; else pages[n - 1] = parseGrid(html).items;
      done++; if (onProgress) onProgress(done, last);
    }));
    const all = new Map();
    for (const items of pages) for (const f of items || []) if (!all.has(f.s)) all.set(f.s, f);
    return { items: [...all.values()], missed };
  }
  function parseRSS(xml) {
    const dec = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").trim();
    const out = [];
    for (const item of xml.split('<item>').slice(1)) {
      const tag = t => { const m = item.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>')); return m ? dec(m[1]) : ''; };
      const t = tag('letterboxd:filmTitle'), s = (tag('link').match(/\/film\/([^/]+)/) || [])[1];
      if (!t || !s) continue;
      const f = { t, y: +tag('letterboxd:filmYear') || 0, s }, r = parseFloat(tag('letterboxd:memberRating'));
      if (r > 0) f.r = r;
      out.push(f);
    }
    return out;
  }
  /* Letterboxd only serves page 1 of /films/ to non-browsers, so watched = that page + the RSS diary. */
  async function fetchWatched(username, settings) {
    const base = 'https://letterboxd.com/' + encodeURIComponent(username);
    const [films, rss] = await Promise.all([
      fetchText(base + '/films/', settings).then(h => parseGrid(h).items).catch(() => []),
      fetchText(base + '/rss/', settings).then(parseRSS).catch(() => []),
    ]);
    const m = new Map(films.map(f => [f.s, f]));
    for (const f of rss) m.set(f.s, Object.assign(m.get(f.s) || {}, f));
    return [...m.values()];
  }
  function cleanUsername(s) {
    s = String(s || '').trim();
    const m = s.match(/letterboxd\.com\/([^/?#\s]+)/i);
    if (m) s = m[1];
    return s.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '');
  }

  /* ---------- film index across friends ---------- */
  /* Returns {films: Map key->{k,t,y,s,wl:Set(friendIds)}, seen: Map friendId->{keys,titles}} */
  function lookupFor(list) {
    const keys = new Map(), titles = new Map();
    for (const f of list || []) { keys.set(keyOf(f), f); const n = norm(f.t); if (!titles.has(n)) titles.set(n, []); titles.get(n).push(f); }
    return {
      keys, titles,
      get(film) {
        const hit = keys.get(film.k); if (hit) return hit;
        const arr = titles.get(norm(film.t)); if (!arr) return null;
        if (!film.y) return arr[0];
        return arr.find(x => !x.y) || null;
      },
    };
  }
  function buildIndex(friends) {
    const films = new Map(), byTitle = new Map();
    const put = (f, fid) => {
      let k = keyOf(f);
      if (!f.y) { const c = byTitle.get(norm(f.t)); if (c && c.length === 1) k = c[0]; }
      let e = films.get(k);
      if (!e) {
        e = { k, t: f.t, y: f.y || 0, s: f.s || '', i: f.i || 0, v: f.v || '', wl: new Set() }; films.set(k, e);
        const n = norm(f.t); if (!byTitle.has(n)) byTitle.set(n, []); byTitle.get(n).push(k);
      }
      if (!e.s && f.s) e.s = f.s;
      if (!e.i && f.i) { e.i = f.i; e.v = f.v || ''; e.s = f.s || e.s; }
      e.wl.add(fid);
    };
    for (const fr of friends) for (const f of fr.watchlist || []) if (f.y) put(f, fr.id);
    for (const fr of friends) for (const f of fr.watchlist || []) if (!f.y) put(f, fr.id);
    const seen = new Map();
    for (const fr of friends) seen.set(fr.id, lookupFor(fr.watched));
    return { films, seen };
  }

  /* ---------- TMDB (optional) ---------- */
  let tmdbCache = null, genreMap = null;
  function tmdbLoad() { if (!tmdbCache) { try { tmdbCache = JSON.parse(localStorage.getItem(TMDB_KEY)) || {}; } catch (e) { tmdbCache = {}; } } return tmdbCache; }
  let tmdbSaveTimer;
  function tmdbSave() { clearTimeout(tmdbSaveTimer); tmdbSaveTimer = setTimeout(() => { try { localStorage.setItem(TMDB_KEY, JSON.stringify(tmdbCache)); } catch (e) { } }, 600); }
  async function tmdbGet(path, key) {
    const bearer = key.length > 40;
    const url = 'https://api.themoviedb.org/3' + path + (bearer ? '' : (path.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(key));
    const res = await fetch(url, bearer ? { headers: { Authorization: 'Bearer ' + key } } : {});
    if (res.status === 401) { const e = new Error('TMDB key rejected'); e.code = 401; throw e; }
    if (!res.ok) throw new Error('TMDB HTTP ' + res.status);
    return res.json();
  }
  async function tmdbGenres(key) {
    if (genreMap) return genreMap;
    const j = await tmdbGet('/genre/movie/list', key);
    genreMap = {}; for (const g of j.genres || []) genreMap[g.id] = g.name;
    return genreMap;
  }
  async function tmdbInfo(film, key) {
    const c = tmdbLoad();
    if (c[film.k]) return c[film.k];
    const q = '/search/movie?query=' + encodeURIComponent(film.t) + (film.y ? '&year=' + film.y : '');
    let j = await tmdbGet(q, key);
    if ((!j.results || !j.results.length) && film.y) j = await tmdbGet('/search/movie?query=' + encodeURIComponent(film.t), key);
    const r = (j.results || [])[0];
    let info = { none: 1 };
    if (r) {
      info = { id: r.id, p: r.poster_path || '', v: Math.round((r.vote_average || 0) * 10) / 10, g: r.genre_ids || [], o: (r.overview || '').slice(0, 280) };
      try { const d = await tmdbGet('/movie/' + r.id, key); info.rt = d.runtime || 0; } catch (e) { if (e.code === 401) throw e; }
    }
    c[film.k] = info; tmdbSave();
    return info;
  }
  function tmdbCached(k) { return tmdbLoad()[k]; }

  /* ---------- share links (compressed) ---------- */
  async function packGroup(state) {
    const films = [], idx = new Map();
    const ref = f => { const k = keyOf(f); if (!idx.has(k)) { idx.set(k, films.length); films.push([f.t, f.y || 0, f.s || '', f.i || 0, f.v || '']); } return idx.get(k); };
    const fr = state.friends.map(f => [f.name, f.username || '', f.color,
      (f.watchlist || []).map(ref),
      f.watched ? f.watched.map(w => w.r ? [ref(w), w.r * 2] : ref(w)) : null]);
    const json = JSON.stringify({ v: 1, films, fr });
    return 'd=' + await deflate(json);
  }
  function unpackGroupJSON(obj) {
    const F = obj.films.map(a => ({ t: a[0], y: a[1] || 0, s: a[2] || '', i: a[3] || 0, v: a[4] || '' }));
    const film = i => Object.assign({}, F[i]);
    return obj.fr.map(a => ({
      id: uid(), name: a[0], username: a[1] || '', color: a[2], present: true, source: 'shared', updated: Date.now(),
      watchlist: (a[3] || []).map(film),
      watched: a[4] ? a[4].map(x => Array.isArray(x) ? Object.assign(film(x[0]), { r: x[1] / 2 }) : film(x)) : null,
    }));
  }
  async function deflate(str) {
    const cs = new CompressionStream('deflate-raw');
    const buf = await new Response(new Blob([str]).stream().pipeThrough(cs)).arrayBuffer();
    let bin = ''; const b = new Uint8Array(buf);
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function inflate(b64) {
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    const ds = new DecompressionStream('deflate-raw');
    return new Response(new Blob([b]).stream().pipeThrough(ds)).text();
  }

  /* hover tooltip helper */
  let tipEl;
  function tip(e, html) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
    if (!html) { tipEl.style.display = 'none'; return; }
    tipEl.innerHTML = html; tipEl.style.display = 'block';
    const r = tipEl.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tipEl.style.left = Math.max(8, x) + 'px'; tipEl.style.top = Math.max(8, y) + 'px';
  }

  window.LBX = {
    PALETTE, PROXIES, lbPoster, load, save, blank, esc, norm, keyOf, hash, initials, uid, nextColor, avatar, toast, filmUrl,
    posterGradient, download, copy, parseCSV, csvToFilms, csvKind, mergeWatched, readZip, fetchText, parseGrid, fetchWatchlist, fetchWatched, parseRSS,
    cleanUsername, buildIndex, lookupFor, tmdbInfo, tmdbCached, tmdbGenres, packGroup, unpackGroupJSON, inflate, deflate,
    toggleTheme, tip,
  };
})();
