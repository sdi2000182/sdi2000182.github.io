// Downloads each crew member's Letterboxd watchlist + watched films (with ratings)
// into watchlist/data.json so the page works without CORS proxies.
// Letterboxd lets every watchlist page through, but only page 1 of /films/, so
// watched films come from that page plus the RSS diary, merged with earlier runs.
import { readFile, writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

const CREW = 'watchlist/crew.json', OUT = 'watchlist/data.json';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 403 means Letterboxd doesn't serve that page to scripts; we take the hint and stop.
// Only rate limits and server errors are retried.
async function get(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' } });
    if (res.status === 404) return null;
    if (res.ok) return res.text();
    if (res.status === 403) { const e = new Error('not served (403) ' + url); e.code = 403; throw e; }
    console.warn(`  ${url} -> HTTP ${res.status}, retry ${attempt}`);
    await sleep(3000 * attempt);
  }
  throw new Error('failed ' + url);
}

function parseGrid(html) {
  const { document } = parseHTML(html);
  const nodes = document.querySelectorAll('[data-item-slug],[data-film-slug],[data-target-link^="/film/"],[data-item-link^="/film/"],[data-film-link^="/film/"]');
  const seen = new Set(), out = [];
  for (const n of nodes) {
    const a = k => n.getAttribute(k) || '';
    const link = a('data-item-link') || a('data-target-link') || a('data-film-link');
    const slug = a('data-item-slug') || a('data-film-slug') || (link.match(/\/film\/([^/]+)/) || [])[1];
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    let name = a('data-item-name') || a('data-film-name') || a('data-item-full-display-name');
    if (!name) { const img = n.querySelector('img'); name = img ? img.getAttribute('alt') || '' : ''; }
    name = name.replace(/^Poster for /i, '');
    let y = parseInt(a('data-film-release-year') || a('data-item-release-year'), 10) || 0;
    const m = name.match(/^(.*)\s\((\d{4})\)\s*$/);
    if (m) { name = m[1]; y = y || +m[2]; }
    if (!name) name = slug.replace(/-\d{4}$/, '').replace(/-/g, ' ');
    const f = { t: name, y, s: slug };
      const pid = ((a('data-postered-identifier') || '').match(/film:(\d+)/) || [])[1];
      if (pid) { f.i = +pid; const ck = (a('data-resolvable-poster-path').match(/"cacheBustingKey":"([^"]+)"/) || [])[1]; if (ck) f.v = ck; }
    const box = n.closest('li') || n.parentElement;
    const own = parseFloat(a('data-owner-rating') || (box && box.getAttribute('data-owner-rating')) || '');
    if (own > 0) f.r = own > 5 ? own / 2 : own;
    else if (box) { const rm = box.innerHTML.match(/\brated-(\d{1,2})\b/); if (rm) f.r = +rm[1] / 2; }
    out.push(f);
  }
  const hasNext = !!document.querySelector('a.next, .paginate-nextprev .next a');
  return { items: out, hasNext };
}

async function watchlist(user) {
  const base = `https://letterboxd.com/${encodeURIComponent(user)}/watchlist/`;
  const all = new Map();
  for (let page = 1; page <= 150; page++) {
    let html;
    try { html = await get(base + (page > 1 ? `page/${page}/` : '')); }
    catch (e) { if (page > 1 && e.code === 403) { console.warn('  stopped at page', page, '(not served)'); break; } throw e; }
    if (html == null) return page === 1 ? null : [...all.values()];
    const { items, hasNext } = parseGrid(html);
    let added = 0;
    for (const f of items) if (!all.has(f.s)) { all.set(f.s, f); added++; }
    if (!added || (!hasNext && items.length < 20)) break;
    await sleep(700);
  }
  return [...all.values()];
}

const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").trim();
async function watched(user) {
  const out = new Map();
  try {
    const html = await get(`https://letterboxd.com/${encodeURIComponent(user)}/films/`, 2);
    if (html) for (const f of parseGrid(html).items) out.set(f.s, f);
  } catch (e) { console.warn('  films page skipped:', e.message); }
  try {
    const xml = await get(`https://letterboxd.com/${encodeURIComponent(user)}/rss/`, 2);
    for (const item of (xml || '').split('<item>').slice(1)) {
      const tag = t => { const m = item.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };
      const title = tag('letterboxd:filmTitle'); if (!title) continue;
      const slug = (tag('link').match(/\/film\/([^/]+)/) || [])[1];
      if (!slug) continue;
      const f = out.get(slug) || { t: title, y: +tag('letterboxd:filmYear') || 0, s: slug };
      const r = parseFloat(tag('letterboxd:memberRating'));
      if (r > 0) f.r = r;
      out.set(slug, f);
    }
  } catch (e) { console.warn('  rss skipped:', e.message); }
  return [...out.values()];
}

// People on a /following/ or /followers/ page, as {u: username, n: display name}.
async function people(user, kind) {
  const out = new Map();
  for (let page = 1; page <= 20; page++) {
    let html;
    try { html = await get(`https://letterboxd.com/${encodeURIComponent(user)}/${kind}/` + (page > 1 ? `page/${page}/` : ''), 2); }
    catch (e) { if (e.code === 403 && page > 1) { console.warn(`  ${kind}: only ${page - 1} page(s) served`); break; } throw e; }
    if (html == null) break;
    const { document } = parseHTML(html);
    let added = 0;
    for (const a of document.querySelectorAll('a.name[href]')) {
      const u = (a.getAttribute('href').match(/^\/([A-Za-z0-9_]+)\/$/) || [])[1];
      if (u && !out.has(u.toLowerCase())) { out.set(u.toLowerCase(), { u, n: a.textContent.replace(/[\u202a-\u202e]/g, '').trim() || u }); added++; }
    }
    if (!added || !document.querySelector('a.next')) break;
    await sleep(1500);
  }
  return [...out.values()];
}

const crewFile = JSON.parse(await readFile(CREW, 'utf8'));
const crew = crewFile.crew = crewFile.crew || [];
const exclude = new Set((crewFile.exclude || []).map(x => x.toLowerCase()));
if (process.env.MUTUALS_OF) crewFile.mutualsOf = process.env.MUTUALS_OF.trim().replace(/^@/, '');
// Crew = you + everyone you follow who follows you back (minus anyone removed).
if (crewFile.mutualsOf) {
  const me = crewFile.mutualsOf;
  try {
    console.log('Finding mutuals of', me);
    const following = await people(me, 'following');
    const followers = new Set((await people(me, 'followers')).map(p => p.u.toLowerCase()));
    const mutuals = following.filter(p => followers.has(p.u.toLowerCase()));
    console.log(`  following ${following.length}, followers ${followers.size}, mutuals ${mutuals.length}`);
    for (const p of [{ u: me, n: crewFile.myName || me }, ...mutuals]) {
      if (exclude.has(p.u.toLowerCase()) || crew.some(c => c.username.toLowerCase() === p.u.toLowerCase())) continue;
      crew.push({ username: p.u, name: p.n, mutual: true });
      console.log('  + crew:', p.u, `(${p.n})`);
    }
  } catch (e) { console.warn('  could not read follows:', e.message); }
}
// "Run workflow" on GitHub can add people: ADD_USERS="name1, name2" or "user=Display Name"
for (const raw of (process.env.ADD_USERS || '').split(/[,\n]+/)) {
  let [username, name] = raw.split('=').map(x => (x || '').trim());
  username = (username.match(/letterboxd\.com\/([^/?#\s]+)/i) || [])[1] || username.replace(/^@/, '');
  if (!/^[A-Za-z0-9_]+$/.test(username)) continue;
  const ex = crew.find(c => c.username.toLowerCase() === username.toLowerCase());
  exclude.delete(username.toLowerCase());
  if (ex) { if (name) ex.name = name; } else crew.push({ username, name: name || username });
  console.log('Added to crew:', username);
}
for (const raw of (process.env.REMOVE_USERS || '').split(/[,\n]+/).map(x => x.trim().toLowerCase()).filter(Boolean)) {
  const i = crew.findIndex(c => c.username.toLowerCase() === raw);
  if (i >= 0) { crew.splice(i, 1); console.log('Removed from crew:', raw); }
  exclude.add(raw);
}
crewFile.exclude = [...exclude];
await writeFile(CREW, JSON.stringify(crewFile, null, 2) + '\n');
let prev = { friends: [] };
try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
const ONLY_DETAILS = !!process.env.ONLY_DETAILS;
const friends = ONLY_DETAILS ? (prev.friends || []) : [];
for (const c of ONLY_DETAILS ? [] : crew) {
  if (!c.username) continue;
  const old = (prev.friends || []).find(f => f.username.toLowerCase() === c.username.toLowerCase());
  try {
    console.log('Fetching', c.username);
    const wl = await watchlist(c.username);
    if (wl == null) { console.warn('  user not found:', c.username); continue; }
    // watched only grows, so keep what earlier runs saw and add the latest
    const seen = new Map(((old && old.watched) || []).map(f => [f.s || f.t + f.y, f]));
    for (const f of await watched(c.username)) seen.set(f.s || f.t + f.y, Object.assign(seen.get(f.s) || {}, f));
    console.log(`  ${wl.length} on watchlist, ${seen.size} watched`);
    friends.push({ username: c.username, name: c.name || c.username, watchlist: wl, watched: [...seen.values()] });
    await sleep(1500);
  } catch (e) {
    console.warn('  failed, keeping previous data:', e.message);
    if (old) friends.push(Object.assign(old, { name: c.name || c.username }));
  }
}
if (!ONLY_DETAILS) {
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), friends }));
  console.log('Wrote', OUT, 'with', friends.length, 'people');
}

/* ---------- film details (poster, description, cast…) from each film page's JSON-LD ---------- */
const FILMS = 'watchlist/films.json';
let films = {};
try { films = JSON.parse(await readFile(FILMS, 'utf8')); } catch {}
const LB = 'https://a.ltrbxd.com/resized/';
const slugOf = url => (String(url || '').match(/letterboxd\.com\/(?:actor|director)\/([^/]+)/) || [])[1] || '';
function details(html) {
  const m = html.match(/<script type="application\/ld\+json">\s*(?:\/\*[\s\S]*?\*\/)?\s*(\{[\s\S]*?\})\s*(?:\/\*[\s\S]*?\*\/)?\s*<\/script>/);
  if (!m) return null;
  const d = JSON.parse(m[1]), arr = x => Array.isArray(x) ? x : x ? [x] : [];
  const dur = String(d.duration || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  const tag = (html.match(/class="tagline">([^<]*)/) || [])[1];
  const out = {
    p: String(d.image || '').replace(LB, ''),
    d: decode(String(d.description || '')).slice(0, 600),
    dir: arr(d.director).map(x => [x.name, slugOf(x.sameAs)]),
    c: arr(d.actor).slice(0, 12).map(x => [x.name, slugOf(x.sameAs)]),
    g: arr(d.genre),
    rt: dur ? (+dur[1] || 0) * 60 + (+dur[2] || 0) : 0,
    r: d.aggregateRating ? Math.round(d.aggregateRating.ratingValue * 100) / 100 : 0,
    cc: arr(d.countryOfOrigin).map(x => x.name).slice(0, 2),
  };
  if (tag) out.tl = decode(tag);
  for (const k of Object.keys(out)) if (out[k] === '' || out[k] === 0 || (Array.isArray(out[k]) && !out[k].length)) delete out[k];
  return out;
}
// what to fetch first: tonight's ballot, then films more people want
const want = new Map();
for (const f of friends) for (const w of f.watchlist || []) if (w.s) want.set(w.s, (want.get(w.s) || 0) + 1);
const ballot = [];
if (crewFile.ballotTopic) {
  try {
    const res = await fetch(`https://ntfy.sh/${crewFile.ballotTopic}/json?poll=1&since=all`);
    for (const line of (await res.text()).split('\n')) {
      try { const d = JSON.parse(JSON.parse(line).message); if (d.op === 'add' && d.f && d.f.s) ballot.push(d.f.s); } catch {}
    }
  } catch (e) { console.warn('ballot read failed:', e.message); }
}
// films the crew rated highly feed the taste recommender, so they come right after the shared picks
const loved = new Map();
for (const f of friends) for (const w of f.watched || []) if (w.s && w.r >= 3.5) loved.set(w.s, Math.max(loved.get(w.s) || 0, w.r));
const byWant = [...want].sort((a, b) => b[1] - a[1]);
const todo = [...new Set([...ballot, ...byWant.filter(x => x[1] >= 2).map(x => x[0]),
  ...[...loved].sort((a, b) => b[1] - a[1]).map(x => x[0]), ...byWant.map(x => x[0])])].filter(s => !films[s]);
const LIMIT = +(process.env.DETAILS_LIMIT || 300);
console.log(`Film details: ${Object.keys(films).length} cached, ${todo.length} to go (${ballot.length} on ballot), fetching up to ${LIMIT}`);
let got = 0;
for (const slug of todo.slice(0, LIMIT)) {
  try {
    const html = await get(`https://letterboxd.com/film/${slug}/`, 2);
    if (html == null) { films[slug] = { x: 1 }; continue; }
    const d = details(html);
    if (d) { films[slug] = d; got++; }
  } catch (e) {
    if (e.code === 403) { console.warn('  film pages not served right now, stopping'); break; }
    console.warn('  ', slug, e.message);
  }
  await sleep(900);
}
await writeFile(FILMS, JSON.stringify(films));
console.log(`  fetched ${got}; films.json has ${Object.keys(films).length}`);
