"""Crawl Wikipedia's airliner-accident categories into a network + text dataset
(nodes = accident articles, edges = links in the article prose, text = the prose),
the way week 1 of 02805 builds the Marvel network, and run first measurements."""
import json, re, time, random, collections, statistics
import requests, networkx as nx

API = "https://en.wikipedia.org/w/api.php"
S = requests.Session()
S.headers["User-Agent"] = "SocialGraphsCourseProject/0.1 (student project; github.com/sdi2000182)"

def api(**p):
    p.update(format="json", formatversion=2, maxlag=5)
    last = None
    for i in range(8):
        try:
            r = S.post(API, data=p, timeout=90)
            j = r.json()
            if r.status_code == 200 and "error" not in j:
                return j
            last = f"{r.status_code} {j.get('error')}"
        except Exception as e:
            last = repr(e)
        time.sleep(min(60, 3 * 2 ** i))
    raise RuntimeError(f"api failed: {last}")

CATS = [
    "Airliner accidents and incidents caused by pilot error",
    "Aviation accidents and incidents caused by pilot error",
    "Airliner accidents and incidents involving controlled flight into terrain",
    "Airliner accidents and incidents caused by fuel exhaustion",
    "Airliner accidents and incidents caused by stalls",
    "Aviation accidents and incidents caused by air traffic controller error",
]
log = []
def members(cat, depth=1):
    out, sub = set(), []
    cont = {}
    while True:
        j = api(action="query", list="categorymembers", cmtitle="Category:" + cat, cmlimit=500, cmtype="page|subcat", **cont)
        for m in j["query"]["categorymembers"]:
            if m["ns"] == 0: out.add(m["title"])
            elif m["ns"] == 14: sub.append(m["title"][9:])
        if "continue" in j: cont = j["continue"]
        else: break
        time.sleep(0.2)
    log.append(f"{cat}: {len(out)} pages, {len(sub)} subcats")
    if depth > 0:
        for c in sub: out |= members(c, depth - 1)
    return out

pages = set()
for c in CATS:
    try: pages |= members(c, 1)
    except Exception as e: log.append(f"{c}: FAILED {e}")
pages = sorted(p for p in pages if not p.startswith(("List of", "Lists of")))
log.append(f"total candidate pages: {len(pages)}")

# resolve redirects so every alias maps to one node
def resolve(titles):
    m = {}
    for i in range(0, len(titles), 50):
        try: j = api(action="query", titles="|".join(titles[i:i+50]), redirects=1)
        except Exception as e: log.append(f"resolve batch {i} failed: {e}"); continue
        for r in j["query"].get("redirects", []): m[r["from"]] = r["to"]
        for r in j["query"].get("normalized", []): m[r["from"]] = r["to"]
        time.sleep(0.2)
    return m

TERMS = {
    "captain": r"\bcaptain\b", "first_officer": r"\bfirst officer\b|\bco-?pilot\b", "flight_engineer": r"\bflight engineer\b",
    "crm": r"\bcrew resource management\b|\bCRM\b", "cvr": r"\bcockpit voice recorder\b|\bCVR\b",
    "authority": r"\bauthority gradient\b|\bauthoritarian\b|\bhierarch\w*|\bsenior\w*\b|\bjunior\b|\bdeferen\w*|\bdefer(?:red|ring)?\b",
    "challenge": r"\bchalleng\w*|\bspeak up\b|\bspoke up\b|\bassertive\w*|\bhesitan\w*|\bhint\w*\b|\bsuggest(?:ed|ion)\b",
    "culture": r"\bpower distance\b|\bculture\b|\bcultural\b",
}
def strip(wt):
    wt = re.sub(r"<!--.*?-->|<ref[^>]*/>|<ref[^>]*>.*?</ref>", " ", wt, flags=re.S)
    while True:                             # drop {{templates}} (infoboxes, navboxes, citations), innermost first
        wt2 = re.sub(r"\{\{[^{}]*\}\}", " ", wt)
        if wt2 == wt: return wt
        wt = wt2

def contents(titles):
    """wikitext for up to 50 pages per request (redirects followed)"""
    out = {}
    for i in range(0, len(titles), 50):
        try:
            j = api(action="query", titles="|".join(titles[i:i+50]), prop="revisions", rvprop="content", rvslots="main", redirects=1)
        except Exception as e:
            log.append(f"content batch {i} failed: {e}"); continue
        for pg in j["query"].get("pages", []):
            if pg.get("revisions"): out[pg["title"]] = pg["revisions"][0]["slots"]["main"]["content"]
        print(i, len(out), flush=True)
        time.sleep(0.5)
    return out

data, raw_links, skipped = {}, {}, []
texts = contents(pages)
log.append(f"fetched wikitext for {len(texts)} pages")
for t, wt in texts.items():
    box = re.search(r"\{\{\s*Infobox (?:aircraft occurrence|aviation accident|airliner accident)", wt, re.I)
    if not box:                             # concept pages, people, films, inquiries: not an accident
        skipped.append(t); continue
    prose = strip(wt)
    # year: title, then the infobox's own date field, then the lead ({{Use dmy dates|date=...}} is not the accident)
    date = re.search(r"\|\s*(?:occurrence_)?date\s*=\s*([^\n]+)", wt[box.start():])
    year = None
    for src in [t, date.group(1) if date else "", prose.strip()[:800]]:
        y = re.search(r"\b(19[0-9]{2}|20[0-2][0-9])\b", src)
        if y: year = int(y.group(1)); break
    links = [m.split("|")[0].split("#")[0].strip() for m in re.findall(r"\[\[([^\]]+)\]\]", prose)]
    links = [l[0].upper() + l[1:] for l in links if l and ":" not in l]
    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]+)\]\]", r"\1", prose)
    text = re.sub(r"'{2,}|==+[^=]+==+|<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    data[t] = {"year": year, "chars": len(text), "terms": {k: len(re.findall(v, text, flags=re.I)) for k, v in TERMS.items()}}
    raw_links[t] = links
log.append(f"kept {len(data)} accident articles; skipped {len(skipped)} without an occurrence infobox, e.g. {skipped[:12]}")
print("parsed", len(data), flush=True)

alias = resolve(sorted({l for ls in raw_links.values() for l in ls}))
G = nx.DiGraph(); G.add_nodes_from(data)
for s, ls in raw_links.items():
    for l in ls:
        t = alias.get(l, l)
        if t in data and t != s:
            G.add_edge(s, t, weight=G[s][t]["weight"] + 1 if G.has_edge(s, t) else 1)

U = nx.Graph()
U.add_nodes_from(G)
for s, t, d in G.edges(data=True):
    U.add_edge(s, t, weight=U[s][t]["weight"] + d["weight"] if U.has_edge(s, t) else d["weight"])
pr = nx.pagerank(G, alpha=0.85, weight=None)
bt = nx.betweenness_centrality(U)
comms = nx.community.louvain_communities(U, weight="weight", seed=1)
Q = nx.community.modularity(U, comms, weight="weight")
# null: modularity of degree-preserving rewired copies
nullQ = []
for k in range(20):
    R = nx.configuration_model([d for _, d in U.degree()], seed=k); R = nx.Graph(R); R.remove_edges_from(nx.selfloop_edges(R))
    if R.number_of_edges(): nullQ.append(nx.community.modularity(R, nx.community.louvain_communities(R, seed=k)))
cid = {n: i for i, c in enumerate(sorted(comms, key=len, reverse=True)) for n in c}

def era(y): return None if y is None else ("pre-CRM (<1981)" if y < 1981 else "CRM era (1981+)")
for n in G:
    d = data[n]; d.update(indeg=G.in_degree(n), outdeg=G.out_degree(n), pr=round(pr[n], 5), bt=round(bt[n], 5), comm=cid[n], era=era(d["year"]))
    d["seniority"] = d["terms"]["authority"] + d["terms"]["challenge"] + d["terms"]["crm"]
    d["seniority_per_10k"] = round(1e4 * d["seniority"] / max(1, d["chars"]), 2)

# does talking about seniority/CRM go with being linked to (a "teaching case")? Spearman vs shuffled attribute
def spearman(a, b):
    ra = {v: i for i, v in enumerate(sorted(range(len(a)), key=lambda i: a[i]))}
    rb = {v: i for i, v in enumerate(sorted(range(len(b)), key=lambda i: b[i]))}
    x = [ra[i] for i in range(len(a))]; y = [rb[i] for i in range(len(b))]
    mx, my = statistics.mean(x), statistics.mean(y)
    num = sum((p - mx) * (q - my) for p, q in zip(x, y)); den = (sum((p - mx) ** 2 for p in x) * sum((q - my) ** 2 for q in y)) ** .5
    return num / den if den else 0
nodes = list(G)
indeg = [G.in_degree(n) for n in nodes]; sen = [data[n]["seniority_per_10k"] for n in nodes]
rho = spearman(indeg, sen)
rng = random.Random(7); null_rho = []
for _ in range(500):
    s2 = sen[:]; rng.shuffle(s2); null_rho.append(spearman(indeg, s2))
p_rho = sum(abs(r) >= abs(rho) for r in null_rho) / len(null_rho)

by_decade = collections.defaultdict(lambda: [0, 0, 0])
for n in nodes:
    y = data[n]["year"]
    if not y: continue
    dec = y // 10 * 10; by_decade[dec][0] += 1
    by_decade[dec][1] += data[n]["terms"]["crm"] > 0
    by_decade[dec][2] += (data[n]["terms"]["authority"] + data[n]["terms"]["challenge"]) > 0
summary = {
    "crawled": time.strftime("%Y-%m-%d"), "log": log,
    "nodes": G.number_of_nodes(), "edges": G.number_of_edges(), "undirected_links": U.number_of_edges(),
    "isolates": sum(1 for n in U if U.degree(n) == 0), "giant": len(max(nx.connected_components(U), key=len)) if len(U) else 0,
    "avg_degree": round(2 * U.number_of_edges() / max(1, len(U)), 2), "density": round(nx.density(U), 4),
    "clustering": round(nx.average_clustering(U), 3), "reciprocity": round(nx.reciprocity(G), 3) if G.number_of_edges() else 0,
    "modularity": round(Q, 3), "modularity_null_mean": round(statistics.mean(nullQ), 3) if nullQ else None,
    "modularity_null_sd": round(statistics.pstdev(nullQ), 3) if nullQ else None, "communities": len(comms),
    "top_pagerank": sorted(([n, data[n]["pr"], data[n]["year"]] for n in nodes), key=lambda x: -x[1])[:15],
    "top_betweenness": sorted(([n, data[n]["bt"]] for n in nodes), key=lambda x: -x[1])[:10],
    "top_seniority": sorted(([n, data[n]["seniority"], data[n]["year"]] for n in nodes), key=lambda x: -x[1])[:15],
    "rho_indeg_seniority": round(rho, 3), "rho_null_95": [round(sorted(null_rho)[12], 3), round(sorted(null_rho)[487], 3)], "p_rho": p_rho,
    "by_decade": {k: {"n": v[0], "crm": v[1], "seniority": v[2]} for k, v in sorted(by_decade.items())},
    "years_known": sum(1 for n in nodes if data[n]["year"]),
}
out = {"summary": summary,
       "nodes": [{"id": n, **{k: data[n][k] for k in ("year", "era", "indeg", "outdeg", "pr", "bt", "comm", "seniority", "seniority_per_10k", "chars")}, "terms": data[n]["terms"]} for n in nodes],
       "edges": [[s, t, d["weight"]] for s, t, d in G.edges(data=True)]}
json.dump(out, open("aviation_graph.json", "w"), ensure_ascii=False)
print("wrote aviation_graph.json", flush=True)
print(json.dumps(summary, indent=1, ensure_ascii=False)[:6000])
