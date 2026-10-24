// Downloads each crew member's Letterboxd watchlist + watched films (with ratings)
// into watchlist/data.json so the page works without CORS proxies.
import { readFile, writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

const CREW = 'watchlist/crew.json', OUT = 'watchlist/data.json';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
    if (res.status === 404) return null;
    if (res.ok) return res.text();
    console.warn(`  ${url} -> HTTP ${res.status}, retry ${attempt}`);
    await sleep(2000 * attempt);
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
    const box = n.closest('li') || n.parentElement;
    const own = parseFloat(a('data-owner-rating') || (box && box.getAttribute('data-owner-rating')) || '');
    if (own > 0) f.r = own > 5 ? own / 2 : own;
    else if (box) { const rm = box.innerHTML.match(/\brated-(\d{1,2})\b/); if (rm) f.r = +rm[1] / 2; }
    out.push(f);
  }
  const hasNext = !!document.querySelector('a.next, .paginate-nextprev .next a');
  return { items: out, hasNext };
}

async function list(user, kind) {
  const base = `https://letterboxd.com/${encodeURIComponent(user)}/${kind === 'watched' ? 'films' : 'watchlist'}/`;
  const all = new Map();
  for (let page = 1; page <= 150; page++) {
    const html = await get(base + (page > 1 ? `page/${page}/` : ''));
    if (html == null) return page === 1 ? null : [...all.values()];
    const { items, hasNext } = parseGrid(html);
    let added = 0;
    for (const f of items) if (!all.has(f.s)) { all.set(f.s, f); added++; }
    if (!added || (!hasNext && items.length < 20)) break;
    await sleep(700);
  }
  return [...all.values()];
}

const crew = JSON.parse(await readFile(CREW, 'utf8')).crew || [];
let prev = { friends: [] };
try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
const friends = [];
for (const c of crew) {
  if (!c.username) continue;
  const old = (prev.friends || []).find(f => f.username.toLowerCase() === c.username.toLowerCase());
  try {
    console.log('Fetching', c.username);
    const watchlist = await list(c.username, 'watchlist');
    const watched = await list(c.username, 'watched');
    if (watchlist == null) { console.warn('  user not found:', c.username); continue; }
    console.log(`  ${watchlist.length} on watchlist, ${watched ? watched.length : 0} watched`);
    friends.push({ username: c.username, name: c.name || c.username, watchlist, watched: watched || [] });
  } catch (e) {
    console.warn('  failed, keeping previous data:', e.message);
    if (old) friends.push(Object.assign(old, { name: c.name || c.username }));
  }
}
await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), friends }));
console.log('Wrote', OUT, 'with', friends.length, 'people');
