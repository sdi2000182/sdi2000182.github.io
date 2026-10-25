/* Who speaks up? — page script: the crawled accident graph, the cockpit sketch,
   the authority-gradient explorable, the labelling exercise and the week cards. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const fmt = n => Number(n).toLocaleString('en');
  const pct = x => Math.round(100 * x) + '%';

  /* ---------- theme toggle (the page also follows the OS setting) ---------- */
  $('#themeBtn').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark';
    drawAll();
  };

  /* ---------- tooltip ---------- */
  const tip = $('#tip');
  function showTip(e, html) {
    tip.innerHTML = html; tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  }
  const hideTip = () => { tip.style.display = 'none'; };

  /* ================= the crawled accident graph ================= */
  let G = null, colorMode = 'era';
  fetch('aviation_graph.json', { cache: 'no-cache' }).then(r => r.json()).then(d => { G = d; renderData(); }).catch(() => {
    $('#stats').innerHTML = '<div class="stat"><div class="v">–</div><div class="l">The crawl data could not be loaded.</div></div>';
  });

  function renderData() {
    const s = G.summary;
    $('#slideN').textContent = fmt(s.nodes);
    $('#crawled').textContent = 'on ' + s.crawled;
    const z = s.modularity_null_sd ? ((s.modularity - s.modularity_null_mean) / s.modularity_null_sd) : null;
    $('#stats').innerHTML = [
      [fmt(s.nodes), 'accident articles (nodes)'],
      [fmt(s.edges), 'prose links (directed edges)'],
      [fmt(s.isolates), 'isolates: accidents nobody links to, and that link to none'],
      [fmt(s.giant), 'in the giant component'],
      [s.avg_degree, 'average degree ⟨k⟩ (undirected)'],
      [s.clustering, 'average clustering C'],
      [s.modularity, `modularity Q, ${s.communities} Louvain communities` + (s.modularity_null_mean != null ? ` · rewired nulls ${s.modularity_null_mean} ± ${s.modularity_null_sd}` + (z != null ? `, z ≈ ${Math.round(z)}` : '') : '')],
    ].map(([v, l]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('');

    // top PageRank
    $('#topPR').innerHTML = '<thead><tr><th>#</th><th>Accident</th><th>Year</th><th class="num">PageRank</th></tr></thead><tbody>' +
      s.top_pagerank.slice(0, 10).map((r, i) => `<tr><td class="faint">${i + 1}</td><td><a href="https://en.wikipedia.org/wiki/${encodeURIComponent(r[0].replace(/ /g, '_'))}" target="_blank" rel="noopener">${esc(r[0])}</a></td><td>${r[2] || ''}</td><td class="num">${r[1].toFixed(4)}</td></tr>`).join('') + '</tbody>';

    // decades
    const dec = Object.entries(s.by_decade).filter(([, v]) => v.n >= 3);
    $('#decades').innerHTML = dec.map(([k, v]) => {
      const sh = v.seniority / v.n, crm = v.crm / v.n;
      return `<span>${k}s <span class="faint">(${v.n})</span></span><div style="position:relative"><div class="b" style="width:${(100 * sh).toFixed(1)}%" title="${pct(sh)} use challenge / seniority words"></div><div class="b" style="width:${(100 * crm).toFixed(1)}%;height:5px;margin-top:2px;background:var(--s2)" title="${pct(crm)} mention CRM"></div></div><span class="t">${pct(sh)}</span>`;
    }).join('') + '<span></span><span class="faint" style="font-size:12px"><span style="display:inline-block;width:10px;height:10px;background:var(--seq-3);border-radius:2px"></span> challenge / seniority words &nbsp; <span style="display:inline-block;width:10px;height:4px;background:var(--s2);border-radius:2px;vertical-align:2px"></span> mentions CRM</span><span></span>';

    // the first check: is seniority language related to being linked to?
    const sig = s.p_rho < 0.05;
    $('#firstCheck').innerHTML = `<b>A first check, with its null.</b> Do accidents described with more seniority and challenge vocabulary get linked to more (become the cases others cite)? Spearman ρ between in-degree and that vocabulary's density is <b>${s.rho_indeg_seniority}</b>. Shuffling the vocabulary across articles 500 times puts 95% of chance correlations between ${s.rho_null_95[0]} and ${s.rho_null_95[1]} (p = ${s.p_rho}). ${sig ? 'So the link is real for how Wikipedia writes about these accidents, which is exactly why the transcripts have to tell us whether it is real for the cockpit.' : 'So for now this is indistinguishable from chance: a good reminder that a correlation needs its null, and that the editors\' wording is not the crew\'s.'}`;
    drawNet();
  }

  /* ---------- the force-directed graph ---------- */
  let sim = null;
  function nodeColor(n, top3) {
    if (colorMode === 'era') return n.era == null ? css('--other') : n.era.startsWith('pre') ? css('--s1') : css('--s2');
    if (colorMode === 'comm') { const i = top3.indexOf(n.comm); return i < 0 ? css('--other') : css(['--s1', '--s2', '--s3'][i]); }
    const q = G._senQ, v = n.seniority_per_10k;
    const i = v <= 0 ? 0 : v < q[0] ? 1 : v < q[1] ? 2 : v < q[2] ? 3 : v < q[3] ? 4 : 5;
    return css('--seq-' + i);
  }
  function drawNet() {
    if (!G || !window.d3) return;
    const svg = d3.select('#net'); svg.selectAll('*').remove();
    const W = $('#net').clientWidth, H = $('#net').clientHeight;
    const nodes = G._nodes || (G._nodes = G.nodes.map(n => Object.assign({}, n)));
    const idx = new Map(nodes.map(n => [n.id, n]));
    const links = G._links || (G._links = G.edges.filter(e => idx.has(e[0]) && idx.has(e[1])).map(e => ({ source: e[0], target: e[1], w: e[2] })));
    const commSize = {}; nodes.forEach(n => commSize[n.comm] = (commSize[n.comm] || 0) + 1);
    const top3 = Object.entries(commSize).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => +x[0]);
    if (!G._senQ) { const v = nodes.map(n => n.seniority_per_10k).filter(x => x > 0).sort((a, b) => a - b); G._senQ = [0.2, 0.4, 0.6, 0.8].map(p => v[Math.floor(p * (v.length - 1))] || 0); }
    const maxPR = d3.max(nodes, n => n.pr) || 1;
    const r = n => 2.2 + 9 * Math.sqrt(n.pr / maxPR);
    const g = svg.append('g');
    const link = g.append('g').attr('stroke', css('--ink-3')).attr('stroke-opacity', 0.28).selectAll('line').data(links).join('line').attr('stroke-width', d => Math.min(2.5, 0.6 + 0.3 * d.w));
    const node = g.append('g').selectAll('circle').data(nodes).join('circle')
      .attr('r', r).attr('fill', n => nodeColor(n, top3)).attr('stroke', css('--surface')).attr('stroke-width', 1)
      .on('mousemove', (e, n) => showTip(e, `<b>${esc(n.id)}</b><br>${n.year || 'year unknown'} · ${n.era || ''}<br>in ${n.indeg} · out ${n.outdeg} · PageRank ${n.pr.toFixed(4)}<br>seniority/challenge words: ${n.terms.authority + n.terms.challenge} · CRM: ${n.terms.crm} · captain: ${n.terms.captain} · first officer: ${n.terms.first_officer}`))
      .on('mouseleave', hideTip)
      .on('click', (e, n) => open('https://en.wikipedia.org/wiki/' + encodeURIComponent(n.id.replace(/ /g, '_')), '_blank', 'noopener'));
    node.call(d3.drag()
      .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.2).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
    if (sim) sim.stop();
    sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(28).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-26).distanceMax(260))
      .force('x', d3.forceX(W / 2).strength(0.05)).force('y', d3.forceY(H / 2).strength(0.07))
      .force('collide', d3.forceCollide().radius(n => r(n) + 1))
      .on('tick', () => {
        for (const n of nodes) { n.x = Math.max(8, Math.min(W - 8, n.x)); n.y = Math.max(8, Math.min(H - 8, n.y)); }
        link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        node.attr('cx', d => d.x).attr('cy', d => d.y);
      });
    if (G._settled) sim.alpha(0.05);
    G._settled = true;
    // legend
    const L = (c, t) => `<span><i style="background:${c}"></i>${esc(t)}</span>`;
    const cnt = f => nodes.filter(f).length;
    if (colorMode === 'era') $('#legend').innerHTML = L(css('--s1'), `before CRM, < 1981 (${cnt(n => n.era && n.era.startsWith('pre'))})`) + L(css('--s2'), `CRM era, 1981+ (${cnt(n => n.era && !n.era.startsWith('pre'))})`) + L(css('--other'), `year unknown (${cnt(n => !n.era)})`);
    else if (colorMode === 'comm') {
      const lab = c => { const m = nodes.filter(n => n.comm === c).sort((a, b) => b.pr - a.pr)[0]; return `around ${m ? m.id : '?'} (${commSize[c]})`; };
      $('#legend').innerHTML = top3.map((c, i) => L(css(['--s1', '--s2', '--s3'][i]), lab(c))).join('') + L(css('--other'), 'the other communities');
    } else $('#legend').innerHTML = L(css('--seq-0'), 'none') + L(css('--seq-1'), 'low') + L(css('--seq-3'), 'middle') + L(css('--seq-5'), 'highest fifth') + '<span class="faint">seniority + challenge + CRM words per 10k characters</span>';
    $('#netNote').textContent = `${fmt(nodes.length)} nodes · ${fmt(links.length)} links`;
  }
  $('#colorBy').addEventListener('click', e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    colorMode = b.dataset.c;
    document.querySelectorAll('#colorBy button').forEach(x => x.classList.toggle('on', x === b));
    if (!G) return;
    const top3 = Object.entries(G._nodes.reduce((a, n) => (a[n.comm] = (a[n.comm] || 0) + 1, a), {})).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => +x[0]);
    d3.select('#net').selectAll('circle').attr('fill', n => nodeColor(n, top3));
    drawNet();
  });

  /* ================= the cockpit sketch ================= */
  function drawCockpit() {
    const s = $('#cockpit');
    const P = { CPT: [160, 34], FO: [62, 160], FE: [258, 160], ATC: [30, 40] };
    const seq = i => css('--seq-' + i);
    const edges = [['FO', 'CPT', 5, 3], ['CPT', 'FO', 1, 2], ['FE', 'CPT', 4, 2], ['CPT', 'FE', 1, 1], ['FO', 'FE', 2, 1], ['ATC', 'CPT', 1, 1]];
    let h = `<defs>${[1, 2, 3, 4, 5].map(i => `<marker id="ar${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${seq(i)}"/></marker>`).join('')}</defs>`;
    for (const [a, b, lvl, w] of edges) {
      const [x1, y1] = P[a], [x2, y2] = P[b], mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
      const cx = mx - dy / L * 18, cy = my + dx / L * 18;
      const ex = x2 - dx / L * 22, ey = y2 - dy / L * 22, sx = x1 + dx / L * 22, sy = y1 + dy / L * 22;
      const c = seq(Math.min(5, lvl));
      h += `<path d="M${sx},${sy} Q${cx},${cy} ${ex},${ey}" fill="none" stroke="${c}" stroke-width="${1 + w}" marker-end="url(#ar${Math.min(5, lvl)})"/>`;
    }
    for (const [k, [x, y]] of Object.entries(P)) h += `<circle cx="${x}" cy="${y}" r="20" fill="${css('--surface')}" stroke="${css('--ink')}" stroke-width="1.5"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${css('--ink')}">${k}</text>`;
    s.innerHTML = h;
  }

  /* ================= the authority-gradient explorable ================= */
  // illustrative assumptions: chance the captain acts on each mitigation level (1 command … 6 hint)
  const UPTAKE = [0.95, 0.85, 0.72, 0.55, 0.40, 0.22];
  const NAMES = ['Command', 'Crew obligation', 'Crew suggestion', 'Query', 'Preference', 'Hint'];
  function firstLevelDist(g) {          // a steeper cockpit pushes the first warning toward hints
    const w = [1, 2, 3, 4, 5, 6].map(i => Math.exp(2.4 * (g - 0.45) * (i - 3.5)));
    const t = w.reduce((a, b) => a + b, 0);
    return w.map(x => x / t);
  }
  function caught(g, attempts, crm) {
    const p = firstLevelDist(g);
    let total = 0;
    p.forEach((pi, i) => {
      let lvl = i, miss = 1;
      for (let a = 0; a < attempts; a++) { miss *= 1 - UPTAKE[lvl]; if (crm) lvl = Math.max(0, lvl - 2); }
      total += pi * (1 - miss);
    });
    return total;
  }
  function drawSim() {
    const g = +$('#g').value, A = +$('#att').value, crm = $('#crm').checked;
    $('#gV').textContent = g.toFixed(2); $('#aV').textContent = A;
    const p = firstLevelDist(g);
    $('#caught').textContent = pct(caught(g, A, crm));
    $('#meanLvl').textContent = p.reduce((a, x, i) => a + x * (i + 1), 0).toFixed(1) + ' / 6';
    $('#lvlBars').innerHTML = p.map((x, i) => `<span>${i + 1} · ${NAMES[i]}</span><div><div class="b" style="width:${(100 * x / Math.max(...p)).toFixed(1)}%;background:var(--seq-${Math.min(5, i)})"></div></div><span class="t">${pct(x)}</span>`).join('');
    // curve across the gradient
    const W = 520, H = 200, m = { l: 40, r: 12, t: 10, b: 30 };
    const X = v => m.l + v * (W - m.l - m.r), Y = v => H - m.b - v * (H - m.t - m.b);
    const line = f => Array.from({ length: 51 }, (_, i) => i / 50).map((v, i) => `${i ? 'L' : 'M'}${X(v).toFixed(1)},${Y(f(v)).toFixed(1)}`).join('');
    let h = '';
    for (const t of [0, 0.25, 0.5, 0.75, 1]) h += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${css('--line')}"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="${css('--ink-3')}">${pct(t)}</text>`;
    h += `<text x="${X(0)}" y="${H - 8}" font-size="11" fill="${css('--ink-3')}">flat cockpit</text><text x="${X(1)}" y="${H - 8}" font-size="11" text-anchor="end" fill="${css('--ink-3')}">steep cockpit</text>`;
    h += `<path d="${line(v => caught(v, A, false))}" fill="none" stroke="${css('--s1')}" stroke-width="2.5"/>`;
    h += `<path d="${line(v => caught(v, A, true))}" fill="none" stroke="${css('--s2')}" stroke-width="2.5"/>`;
    h += `<text x="${X(0.02)}" y="${Y(caught(0.02, A, false)) - 8}" font-size="11" fill="${css('--ink-2')}">without CRM</text>`;
    h += `<text x="${X(0.98)}" y="${Y(caught(0.98, A, true)) - 8}" font-size="11" text-anchor="end" fill="${css('--ink-2')}">with CRM</text>`;
    h += `<circle cx="${X(g)}" cy="${Y(caught(g, A, crm))}" r="6" fill="${css(crm ? '--s2' : '--s1')}" stroke="${css('--surface')}" stroke-width="2"/>`;
    $('#curve').innerHTML = h;
  }
  ['g', 'att', 'crm'].forEach(id => $('#' + id).addEventListener('input', drawSim));

  /* ================= label it yourself ================= */
  const QUIZ = [
    ['Pull up. Now.', 1],
    ['Do you reckon we\'ve got enough fuel to hold here much longer?', 4],
    ['There\'s a fair bit of ice building on the wing out there.', 6],
    ['I think we need to go around.', 2],
  ];
  $('#quiz').insertAdjacentHTML('beforeend', QUIZ.map(([t, a], qi) => `<div class="item" data-q="${qi}"><div class="say">“${esc(t)}”</div>${NAMES.map((n, i) => `<button data-a="${i + 1}">${i + 1} ${n}</button>`).join('')}<span class="faint fb" style="font-size:13px;margin-left:6px"></span></div>`).join(''));
  $('#quiz').addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const it = b.closest('[data-q]'), ans = QUIZ[+it.dataset.q][1], pick = +b.dataset.a;
    it.querySelectorAll('button').forEach(x => x.classList.remove('right', 'wrong'));
    b.classList.add(pick === ans ? 'right' : 'wrong');
    if (pick !== ans) it.querySelector(`[data-a="${ans}"]`).classList.add('right');
    it.querySelector('.fb').textContent = pick === ans ? 'Agreed.' : Math.abs(pick - ans) === 1 ? 'One level off: exactly the disagreements κ is there to count.' : 'That is the kind of disagreement the hand-labelled sample exists to catch.';
  });

  /* ================= the weeks ================= */
  const WEEKS = [
    { n: 1, t: 'Networks', tag: 'net', s: 'Nodes, edges, representation, degree distributions, seeing a network',
      theory: ['Choosing what a node and an edge are, and what a different choice would change', 'Directed vs undirected, weighted vs not; why isolates are part of the story', 'Degree distributions on linear vs log–log axes, and what binning does', 'Reading a network drawing: what is data and what is layout'],
      here: 'Accidents are nodes and prose links are directed edges (the course\'s own Marvel choice: navboxes would link every accident of a year to every other). In-degree is "cited as precedent", out-degree is "cites precedents". The isolates are the forgotten crashes, kept on purpose. Each flight\'s transcript is a second, tiny directed network: speakers as nodes, utterances as edges.',
      check: 'Calibrate the crawler (exercise 1.2 style): count the links in five articles by hand and match the code.',
      paper: 'Draw the 4-node cockpit graph of a short exchange and compute in- and out-degrees, density, and the adjacency matrix.' },
    { n: 2, t: 'Models & null models', tag: 'net', s: 'Random graphs, small worlds, clustering, preferential attachment, shuffling',
      theory: ['G(n, p): expected degree, the Poisson distribution, the giant-component transition', 'Clustering and the Watts–Strogatz small world', 'Preferential attachment and how to (not) claim a power law', 'Shuffling as a test; the friendship paradox as a null-model story'],
      here: 'Compare the accident graph with G(n, p) and a configuration model of the same size. Ask whether precedent-citing is rich-get-richer: famous accidents are cited because they are cited. The friendship paradox becomes a "precedent paradox": the accidents yours points to are more cited than yours. The speaker-shuffle and year-shuffle nulls behind H1 and H2 are this week\'s idea.',
      check: 'Degree-preserving rewiring for every structural claim; a proper power-law fit with a comparison against alternatives, not a straight line on log–log axes.',
      paper: 'Expected links for given n and p; the clustering coefficient of the captain in a three-crew cockpit by hand.' },
    { n: 3, t: 'Who matters, and why', tag: 'net', s: 'Paths, closeness, betweenness, PageRank, mixing, cliques',
      theory: ['BFS, distances, eccentricity; weak vs strong connectivity', 'Degree, closeness/harmonic, betweenness: popularity, reach, control', 'Eigenvector centrality and PageRank: importance from important neighbours', '"Compared to what": the degree-preserving null; assortativity and mixing; cliques'],
      here: 'PageRank picks out the teaching cases (H3). Betweenness finds accidents that bridge eras or causes. Inside the cockpit, the flight engineer is often the broker between captain and first officer. Assortativity asks whether high-gradient accidents link to each other more than chance.',
      check: 'Report PageRank against what in-degree alone predicts under the degree-preserving null, so "central" is not just "well linked".',
      paper: 'One PageRank iteration by hand on a four-accident citation chain; explain what a dangling node does.' },
    { n: 4, t: 'Communities & backbones', tag: 'net', s: 'Edge betweenness, modularity, Louvain, overlap, weights, backbones',
      theory: ['Girvan–Newman and why it recomputes after each cut', 'Modularity: how grouped, not how right; always against a null', 'Louvain (and Leiden), stability via NMI; k-clique and link communities for overlap', 'Strong and weak ties; the disparity-filter backbone; the five drawing rules'],
      here: 'Communities of the accident graph should look like cause families (terrain, ice, fuel, stall). The graph above already shows modularity well above its rewired nulls. Accidents in two families (an ice stall that also hit terrain) are what overlapping communities are for. Link counts are the weights; the backbone makes the paper\'s network figure readable.',
      check: 'NMI between Louvain and Infomap, and between Louvain and Wikipedia\'s own cause categories; Q reported as a z-score against nulls.',
      paper: 'Q of a given partition of a small drawn graph; name a node in two 3-clique communities.' },
    { n: 5, t: 'NLP I · from language to numbers', tag: 'nlp', s: 'Tokens, preprocessing, Zipf, n-grams, collocations, bag of words',
      theory: ['Tokenization vs later preprocessing; subwords', 'Types, tokens, hapaxes; Zipf and why a straight log–log line is not proof', 'Concordances, n-grams, collocations vs mere frequent pairs', 'The document–term matrix and what bag of words throws away'],
      here: 'Cockpit speech breaks the usual pipeline: speaker tags (CAM-1, CAM-2), call-outs ("V one", "rotate"), "[unintelligible]". The key preprocessing lesson: the stopwords are the signal. "I think", "maybe", "we should", "do you" are exactly the mitigation markers a stopword list would delete. Collocations find the fixed phrases ("go around", "sink rate", "pull up") that must stay one token.',
      check: 'State every preprocessing choice, and show one count that changes if you drop stopwords.',
      paper: 'Unigrams and bigrams of a short exchange; why "I think we" is a collocation and "of the" is just frequent.' },
    { n: 6, t: 'NLP II · from counts to meaning', tag: 'nlp', s: 'TF-IDF, cosine, Scattertext, topic models, PPMI, word2vec',
      theory: ['TF-IDF and cosine similarity; why a word in every document carries no weight', 'Comparing two corpora with Scattertext', 'LDA: topics as distributions over words, documents as mixtures', 'Distributional meaning: PPMI, Word2Vec/GloVe, and the "bank" problem'],
      here: 'Scattertext on first-officer vs captain speech, and on investigation prose before vs after 1981. LDA over probable-cause sections gives a text grouping to set against the link communities. Embeddings trained separately on pre- and post-CRM reports show how "captain" and "first officer" changed company: the dialectogram method from the course\'s own Lehmann lab paper.',
      check: 'Several topic counts and seeds, not one solution; topic labels presented as our interpretation, not the model\'s output.',
      paper: 'TF-IDF and cosine for three tiny "reports"; a PMI value from a co-occurrence table.' },
    { n: 7, t: 'NLP III · from meaning to measurement', tag: 'nlp', s: 'Document embeddings, sentiment as an instrument, NER, semantic search, bias',
      theory: ['Static vs contextual representations; 2D maps vs the real space', 'Topics, embedding clusters and network communities as three groupings', 'Sentiment as a measurement that has to be validated in the new domain', 'BIO tags and NER; entity networks; sparse vs dense retrieval; where bias enters'],
      here: 'The mitigation level is this week\'s idea exactly: a model as a measuring instrument. A politeness classifier trained on online requests, or an LLM, labels each utterance, and is only trusted after it agrees with our hand labels. NER on final reports builds a role and organisation network (crew, ATC, airline, manufacturer). Semantic search finds "the first officer did not challenge" phrased a hundred ways. Bias: transcripts only exist for flights that crashed, so every sample is conditioned on failure.',
      check: '300 hand-labelled utterances, κ between labellers and against the model, a confusion matrix, and an honest note on domain shift.',
      paper: 'BIO-tag a sentence from a report; explain why a classifier\'s confidence is not validation in a new domain.' },
    { n: 8, t: 'Networks × language', tag: 'both', s: 'Putting it together: datasets, questions, checks, the paper',
      theory: ['Text as attribute (shuffle-tested) and text as network (edge-sample-tested)', 'The dataset test: both halves, a few hundred to a few thousand nodes, obtainable, cared about, something unknown', 'The question before the method; say what each measurement captures and misses', 'Undocumented APIs; fusing datasets; one story in six PNAS pages'],
      here: 'The authority gradient on each accident node is text as an attribute; the speaker graphs and the report entity graph are text as a network. NTSB\'s accident database is fed by a JSON endpoint, the workshop\'s method in practice. The fusion of Wikipedia\'s record with the transcripts is the dataset nobody has put together.',
      check: 'Every figure shows its check next to its claim: the null band, the second method, the κ.',
      paper: 'Not on the tests. It is the exam itself: the paper and three slides.' },
  ];
  $('#weekList').innerHTML = WEEKS.map(w => `<details class="week"${w.n === 1 ? ' open' : ''}>
    <summary><span class="wn">${w.n}</span><span><span class="wt">${esc(w.t)}</span> <span class="tag ${w.tag}">${w.tag === 'net' ? 'networks' : w.tag === 'nlp' ? 'language' : 'both halves'}</span><br><span class="ws">${esc(w.s)}</span></span><span class="chev">▸</span></summary>
    <div class="body">
      <div><h4>The theory</h4><ul>${w.theory.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><h4>In this project</h4><p>${esc(w.here)}</p></div>
      <div><h4>The check it supplies</h4><p>${esc(w.check)}</p><h4 style="margin-top:10px">On paper</h4><p>${esc(w.paper)}</p></div>
    </div></details>`).join('');

  function drawAll() { drawCockpit(); drawSim(); if (G) drawNet(); }
  drawAll();
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => G && drawNet(), 200); });
})();
