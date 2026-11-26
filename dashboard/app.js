// Token Radar dashboard: renders the board main.ts generated into ../data.js (window.RADAR).
// No network, no framework: the ranked board with filters and sorting, a detail view per
// protocol with its model breakdown and farm plan, and the already-launched set kept apart.

(function () {
  'use strict';
  var R = window.RADAR;
  var $ = function (id) { return document.getElementById(id); };
  if (!R) {
    document.body.innerHTML = '<p style="padding:24px">No data: run main.ts first — it writes data.js beside this page.</p>';
    return;
  }

  var state = { q: '', cat: '', chain: '', sort: 'rank', watch: false, selected: null };

  function money(v) {
    if (v === null || v === undefined) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function years(row) {
    if (row.age_days === null || row.age_days === undefined) return null;
    return row.age_days / 365.25;
  }
  function ageText(row) {
    var y = years(row);
    return y === null ? 'unknown' : y.toFixed(1) + ' yrs';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- masthead + model strip -------------------------------------------------
  $('mast-stats').innerHTML =
    '<div class="stat"><b>' + R.board_size + '</b><span>ranked</span></div>' +
    '<div class="stat"><b>' + R.watchlist_size + '</b><span>watchlist</span></div>' +
    '<div class="stat"><b>' + R.early_size + '</b><span>early finds</span></div>' +
    '<div class="stat"><b>' + R.live_size + '</b><span>already launched</span></div>';

  var t = R.tilts;
  $('model-strip').innerHTML =
    '<span class="formula">implied value = TVL &times; category multiple &times; growth factor &times; age factor &times; breadth factor</span>' +
    '<p>Each protocol is priced from the snapshot\u2019s own figures: a multiple of TVL set by its category ' +
    '(a DEX at ' + R.category_multiple['Dexs'].toFixed(2) + '&times;, lending at ' + R.category_multiple['Lending'].toFixed(2) +
    '&times;, bridges at ' + R.category_multiple['Bridge'].toFixed(2) + '&times;, anything unlisted at ' + R.default_multiple.toFixed(2) + '&times;), ' +
    'tilted by its 7-day TVL change (clamped to ' + t.growth_floor_pct + '%\u2026+' + t.growth_cap_pct + '%, weight ' + t.growth_weight + '), ' +
    'by the years it has run with no token (' + t.age_base + ' at listing, rising to 1.00 over ' + t.age_full_years + ' years), ' +
    'and by ' + (t.breadth_step * 100) + '% for each chain past the first. Snapshot as of ' + esc(R.as_of) +
    '; the watchlist floor is ' + money(R.floor_usd) + ' of TVL. One function prices every row — no protocol is priced by name.</p>';

  $('source-line').textContent = 'Data: ' + R.source + '. Board generated from that snapshot alone; nothing on this page is fetched.';

  // ---- controls ---------------------------------------------------------------
  var cats = {}, chains = {};
  R.rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('cat').appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('chain').appendChild(o);
  });

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = R.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      value: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
      name: function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }
    };
    return out.sort(by[state.sort] || by.rank);
  }

  function renderBoard() {
    var rows = filtered();
    $('count').textContent = 'Showing ' + rows.length + ' of ' + R.board_size + ' ranked protocols' +
      (state.watch ? ' (watchlist only)' : '') + (state.cat ? ' in ' + state.cat : '') +
      (state.chain ? ' on ' + state.chain : '') + (state.q ? ' matching \u201C' + state.q + '\u201D' : '') + '.';
    $('empty').hidden = rows.length > 0;
    $('rows').innerHTML = rows.map(function (r) {
      var g = r.change_7d;
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' +
        (r.on_watchlist ? '<span class="star">watchlist</span>' : '') +
        '<br><span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + (g === null ? '' : g >= 0 ? 'up' : 'down') + '">' + pct(g) + '</td>' +
        '<td class="num">' + ageText(r) + '</td>' +
        '<td class="num value">' + money(r.implied_value_usd) + '</td></tr>';
    }).join('');
    Array.prototype.forEach.call($('rows').querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug'), true); });
    });
  }

  // ---- detail view --------------------------------------------------------------
  function peersFor(row) {
    var same = R.live.filter(function (l) { return l.category === row.category; }).slice(0, 3);
    return same.length > 0 ? same : R.live.slice(0, 3);
  }

  function select(slug, scroll) {
    state.selected = slug;
    var row = null;
    R.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    var box = $('detail');
    if (!row) { box.hidden = true; renderBoard(); return; }
    var m = row.model;
    var peers = peersFor(row);
    box.innerHTML =
      '<div class="detail-head"><div>' +
      '<h2>' + esc(row.name) + (row.on_watchlist ? '<span class="star">on the watchlist</span>' : '') + '</h2>' +
      '<p class="sub">Radar rank #' + row.rank + ' of ' + R.board_size + ' &middot; ' + esc(row.category || 'uncategorised') +
      ' &middot; records no token in the snapshot</p></div>' +
      '<div class="big"><span>Implied value</span><b>' + money(row.implied_value_usd) + '</b>' +
      '<button class="close-btn" id="close-detail">Close</button></div></div>' +
      '<div class="detail-grid"><div>' +
      '<h3>The record</h3>' +
      '<div class="kv"><span>TVL</span><b>' + money(row.tvl_usd) + '</b></div>' +
      '<div class="kv"><span>TVL change, 7 days</span><b>' + pct(row.change_7d) + '</b></div>' +
      '<div class="kv"><span>Tracked since</span><b>' + esc(row.listed_at || 'unknown') + '</b></div>' +
      '<div class="kv"><span>Time with no token</span><b>' + ageText(row) + '</b></div>' +
      '<div class="kv"><span>Chains</span><b>' + esc(row.chains.join(', ') || '—') + '</b></div>' +
      '<h3 style="margin-top:18px">How the value is built</h3>' +
      '<div class="kv"><span>TVL</span><b>' + money(row.tvl_usd) + '</b></div>' +
      '<div class="kv"><span>&times; category multiple (' + esc(row.category || 'default') + ')</span><b>' + m.category_multiple.toFixed(2) + '</b></div>' +
      '<div class="kv"><span>&times; growth factor</span><b>' + m.growth_factor.toFixed(3) + '</b></div>' +
      '<div class="kv"><span>&times; age factor</span><b>' + m.age_factor.toFixed(3) + '</b></div>' +
      '<div class="kv"><span>&times; breadth factor</span><b>' + m.breadth_factor.toFixed(3) + '</b></div>' +
      '<div class="kv"><span>= implied value</span><b>' + money(row.implied_value_usd) + '</b></div>' +
      '<h3 style="margin-top:18px">Already launched, for scale</h3>' +
      peers.map(function (l) {
        return '<p class="peer"><b>' + esc(l.name) + '</b> (' + esc(l.symbol || '—') + ') — market cap ' + money(l.mcap_usd) + ' on ' + money(l.tvl_usd) + ' TVL</p>';
      }).join('') +
      '</div><div>' +
      '<h3>Farm plan</h3><ol class="steps">' +
      row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></div></div>';
    box.hidden = false;
    $('close-detail').addEventListener('click', function () { select(null, false); });
    renderBoard();
    if (scroll) box.scrollIntoView({ block: 'start' });
  }

  // ---- live table -----------------------------------------------------------------
  $('live-rows').innerHTML = R.live.map(function (l) {
    var g = l.change_7d;
    return '<tr><td><span class="pname">' + esc(l.name) + '</span><br><span class="pslug">' + esc(l.slug) + '</span></td>' +
      '<td>' + esc(l.symbol || '—') + '</td><td>' + esc(l.category || '—') + '</td>' +
      '<td class="num">' + money(l.tvl_usd) + '</td><td class="num">' + money(l.mcap_usd) + '</td>' +
      '<td class="num ' + (g === null ? '' : g >= 0 ? 'up' : 'down') + '">' + pct(g) + '</td></tr>';
  }).join('');

  // ---- wiring -----------------------------------------------------------------------
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  $('watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });

  // Deep links, also how the screenshots are framed: #p=<slug> opens a protocol,
  // #cat=<category> / #chain=<chain> / #q=<text> start from a filtered board.
  var hash = {};
  location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
    var at = kv.indexOf('=');
    if (at > 0) hash[decodeURIComponent(kv.slice(0, at))] = decodeURIComponent(kv.slice(at + 1));
  });
  if (hash.q) { state.q = hash.q; $('q').value = hash.q; }
  if (hash.cat) { state.cat = hash.cat; $('cat').value = hash.cat; }
  if (hash.chain) { state.chain = hash.chain; $('chain').value = hash.chain; }
  if (hash.watch) { state.watch = true; $('watch').checked = true; }
  renderBoard();
  if (hash.p) select(hash.p, false);
})();
