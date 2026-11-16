// Token Radar's renderer.
//
// The page is one sealed dataset (window.RADAR, written beside this file) and this script. There is no
// fetch here, no timer, no remote font and no analytics: every number on screen was computed before the
// page loaded, and the same snapshot always paints the same board.
//
// Three views share the data: the launch radar (a ranked, filterable table), the live-token market view
// (protocols already trading, kept out of the ranking) and the method page, which prints the model's
// formula and constants beside the values they produce.

(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA || !Array.isArray(DATA.rows)) {
    document.body.innerHTML = '<p style="padding:40px;font:16px system-ui;color:#8ba0c0">This page reads the dataset written beside it. Run <code>node main.ts</code> to write data.js, then open the page again.</p>';
    return;
  }

  var ROWS = DATA.rows;
  var LIVE = DATA.live || [];
  var MODEL = DATA.model || {};
  var SECTORS = DATA.sectors || [];
  var NETWORKS = DATA.networks || [];

  // --------------------------------------------------------------- formatting

  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /** A dollar figure at the width a table can hold: $2.71B, $184M, $940K. */
  function compact(value) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    var abs = Math.abs(value);
    if (abs >= 1e12) return '$' + trim(value / 1e12) + 'T';
    if (abs >= 1e9) return '$' + trim(value / 1e9) + 'B';
    if (abs >= 1e6) return '$' + trim(value / 1e6) + 'M';
    if (abs >= 1e3) return '$' + Math.round(value / 1e3) + 'K';
    return money.format(value);
  }

  /** Two significant decimals, with trailing zeros removed: 2.71, 2.7, 2. */
  function trim(value) {
    var fixed = Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
    return fixed.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
  }

  /** A seven-day change, always signed, or an em dash when the snapshot has none. */
  function signed(value) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    return (value > 0 ? '+' : '') + trim(value) + '%';
  }

  /** How long a protocol has run without a recorded token: days under two years, years above it. */
  function age(value) {
    if (value === null || value === undefined) return 'unlisted';
    if (value >= 730) return trim(value / 365) + 'y';
    if (value >= 365) return '1y';
    return Math.max(0, Math.round(value)) + 'd';
  }

  function multiple(value) {
    return value === null || value === undefined ? '—' : trim(value) + '×';
  }

  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** The chains cell: the first two names, then a count for the rest. */
  function chainText(chains) {
    if (!chains || chains.length === 0) return '—';
    var head = chains.slice(0, 2).join(', ');
    return chains.length > 2 ? head + ' +' + (chains.length - 2) : head;
  }

  /** A farm step ends "Cost: … Time: …"; this splits the sentence from its two chips. */
  function parseStep(text) {
    var match = /^(.*?)\s*Cost:\s*(.*?)\s*Time:\s*(.*)$/s.exec(text);
    if (!match) return { body: text, cost: '', time: '' };
    return { body: match[1], cost: match[2], time: match[3] };
  }

  function trendClass(value) {
    if (value === null || value === undefined || !isFinite(value)) return 'flat';
    if (value > 0.05) return 'up';
    if (value < -0.05) return 'down';
    return 'flat';
  }

  function percent(value, of) {
    return of > 0 ? Math.max(1, Math.min(100, Math.round((value / of) * 100))) : 0;
  }

  // --------------------------------------------------------------- page chrome

  function renderSnapshot() {
    document.getElementById('snapshot').innerHTML =
      '<span class="livedot" aria-hidden="true"></span>' +
      'snapshot ' + esc(DATA.as_of) +
      ' · ' + ROWS.length + ' ranked rows' +
      ' · floor ' + compact(DATA.floor_usd);
    document.getElementById('footsnap').textContent = 'sealed snapshot ' + DATA.as_of;
  }

  function renderStats() {
    var top = ROWS[0];
    var watchCovered = ROWS.filter(function (row) { return row.watchlist; }).length;
    var cards = [
      { k: 'Rows on the board', v: String(ROWS.length), s: DATA.watchlist_size + ' watchlist + ' + DATA.early_size + ' below the floor', cls: '' },
      { k: 'Watchlist covered', v: watchCovered + ' / ' + DATA.watchlist_size, s: 'every slug the snapshot names', cls: 'cool' },
      { k: 'Total implied value', v: compact(DATA.total_implied_usd), s: 'sum across every ranked row', cls: 'accent' },
      { k: 'Largest estimate', v: top ? compact(top.implied_value_usd) : '—', s: top ? esc(top.name) : 'no rows', cls: '' },
      { k: 'Live tokens set aside', v: String(DATA.live_size), s: 'already trading, never scored', cls: '' },
      { k: 'Model', v: esc(DATA.model_version), s: 'four functions, no exceptions', cls: 'cool' }
    ];
    document.getElementById('stats').innerHTML = cards.map(function (card) {
      return '<div class="stat ' + card.cls + '">' +
        '<div class="k">' + card.k + '</div>' +
        '<div class="v">' + card.v + '</div>' +
        '<div class="s">' + card.s + '</div>' +
        '</div>';
    }).join('');
  }

  function renderTabs() {
    var tabs = document.getElementById('tabs');
    tabs.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-tab]');
      if (!button) return;
      var name = button.getAttribute('data-tab');
      tabs.querySelectorAll('button[data-tab]').forEach(function (other) {
        other.classList.toggle('on', other === button);
      });
      ['radar', 'market', 'method'].forEach(function (panel) {
        document.getElementById('panel-' + panel).hidden = panel !== name;
      });
      if (name === 'radar') document.getElementById('q').focus({ preventScroll: true });
    });
  }

  // --------------------------------------------------------------- filters

  var state = { q: '', sector: 'all', chain: 'all', size: 'all', sort: 'implied' };

  function fillSelect(id, label, values) {
    var select = document.getElementById(id);
    select.innerHTML = '<option value="all">' + label + '</option>' + values.map(function (value) {
      return '<option value="' + esc(value) + '">' + esc(value) + '</option>';
    }).join('');
  }

  function sizeFloor() {
    return state.size === 'all' ? 0 : Number(state.size);
  }

  /** Every row that passes the toolbar, in the chosen order. Rank is the row's place on the full board. */
  function visibleRows() {
    var query = state.q.trim().toLowerCase();
    var floor = sizeFloor();
    var rows = ROWS.filter(function (row) {
      if (floor > 0 && row.tvl_usd < floor) return false;
      if (state.sector !== 'all' && (row.category || 'Unclassified') !== state.sector) return false;
      if (state.chain !== 'all' && (row.chains || []).indexOf(state.chain) === -1) return false;
      if (query.length > 0) {
        var haystack = (row.name + ' ' + row.slug + ' ' + (row.category || '') + ' ' + (row.chains || []).join(' ')).toLowerCase();
        if (haystack.indexOf(query) === -1) return false;
      }
      return true;
    });
    var sorters = {
      implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      signal: function (a, b) { return b.signal - a.signal || b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); },
      name: function (a, b) { return a.name.localeCompare(b.name); }
    };
    return rows.sort(sorters[state.sort] || sorters.implied);
  }

  function renderFilterLine(shown) {
    var chips = [];
    if (state.q.trim()) chips.push('search: ' + state.q.trim());
    if (state.sector !== 'all') chips.push('sector: ' + state.sector);
    if (state.chain !== 'all') chips.push('chain: ' + state.chain);
    if (state.size !== 'all') chips.push('TVL ≥ ' + compact(Number(state.size)));
    if (state.sort !== 'implied') chips.push('sorted by ' + document.getElementById('sort').selectedOptions[0].textContent.toLowerCase());
    var line = document.getElementById('filterline');
    if (chips.length === 0) {
      line.innerHTML = '';
      return;
    }
    line.innerHTML = chips.map(function (chip) { return '<span class="chip">' + esc(chip) + '</span>'; }).join('') +
      '<span class="count">' + shown + ' of ' + ROWS.length + ' rows</span>';
  }

  function renderBoard() {
    var rows = visibleRows();
    var body = document.getElementById('rows');
    var html = rows.map(function (row) {
      var rankClass = row.rank <= 3 ? 'rank top' : 'rank';
      return '<tr data-slug="' + esc(row.slug) + '" tabindex="0">' +
        '<td class="num"><span class="' + rankClass + '">' + row.rank + '</span></td>' +
        '<td><div class="pname"><b>' + esc(row.name) + '</b><span>' + esc(row.slug) + (row.watchlist ? ' · watchlist' : '') + '</span></div></td>' +
        '<td><span class="sector">' + esc(row.category || 'Unclassified') + '</span></td>' +
        '<td><div class="chains">' + esc(chainText(row.chains)) + '</div></td>' +
        '<td class="num">' + compact(row.tvl_usd) + '</td>' +
        '<td class="num ' + trendClass(row.change_7d) + '">' + signed(row.change_7d) + '</td>' +
        '<td class="num">' + age(row.age_days) + '</td>' +
        '<td><div class="sig"><div class="track"><span class="fill" style="width:' + percent(row.signal, 100) + '%"></span></div><em>' + row.signal + '</em></div></td>' +
        '<td class="num value">' + compact(row.implied_value_usd) + '<small>' + multiple(row.fdv_tvl_multiple) + '</small></td>' +
        '<td><span class="risk"><b class="dot ' + row.risk + '"></b>' + row.risk + '</span></td>' +
        '</tr>';
    }).join('');
    body.innerHTML = html;
    var empty = document.getElementById('empty');
    empty.hidden = rows.length > 0;
    renderFilterLine(rows.length);
    document.getElementById('footnote').textContent =
      'Ranked by implied launch value, computed by ' + DATA.model_version + ' from the ' + DATA.as_of +
      ' snapshot. Values are FDV estimates in dollars, not price targets, and not advice.';
  }

  function renderMarket() {
    document.getElementById('liverows').innerHTML = LIVE.map(function (row, index) {
      return '<tr>' +
        '<td class="num">' + (index + 1) + '</td>' +
        '<td><div class="pname"><b>' + esc(row.name) + '</b><span>' + esc(row.slug) + (row.symbol ? ' · ' + esc(row.symbol) : '') + '</span></div></td>' +
        '<td><span class="sector">' + esc(row.category || 'Unclassified') + '</span></td>' +
        '<td><div class="chains">' + esc(chainText(row.chains)) + '</div></td>' +
        '<td class="num">' + compact(row.mcap_usd) + '</td>' +
        '<td class="num">' + compact(row.tvl_usd) + '</td>' +
        '<td class="num">' + multiple(row.mcap_tvl_multiple) + '</td>' +
        '<td class="num ' + trendClass(row.change_7d) + '">' + signed(row.change_7d) + '</td>' +
        '</tr>';
    }).join('');
  }

  // --------------------------------------------------------------- drawer

  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('scrim');
  var openSlug = null;

  function wrow(label, amount, width, total) {
    return '<div class="wrow">' +
      '<span class="lab">' + esc(label) + '</span>' +
      '<div class="track"><i style="width:' + percent(amount, total) + '%"></i></div>' +
      '<span class="amt">' + compact(amount) + '</span>' +
      '</div>';
  }

  function openDrawer(slug) {
    var row = ROWS.find(function (candidate) { return candidate.slug === slug; });
    if (!row) return;
    openSlug = slug;
    var afterGrowth = row.base_usd * row.growth_multiplier;
    var afterAge = afterGrowth * row.age_multiplier;
    var afterChain = afterAge * row.chain_multiplier;
    var steps = row.farm_steps.map(function (step) {
      var parts = parseStep(step);
      return '<div class="step"><p>' + esc(parts.body) + '</p><div class="costs">' +
        '<span>cost · ' + esc(parts.cost) + '</span><span>time · ' + esc(parts.time) + '</span>' +
        '</div></div>';
    }).join('');

    drawer.innerHTML =
      '<button type="button" class="close" aria-label="Close detail">×</button>' +
      '<div class="dhead">' +
        '<div class="kicker">Rank ' + row.rank + ' · ' + esc(row.token_status) + (row.watchlist ? ' · watchlist' : ' · below the floor') + '</div>' +
        '<h2>' + esc(row.name) + '</h2>' +
        '<div class="slug">' + esc(row.slug) + '</div>' +
        '<div class="dmeta">' +
          (row.watchlist ? '<span class="tag watch">watchlist</span>' : '') +
          '<span class="tag"><b class="dot ' + row.risk + '"></b>' + row.risk + ' risk</span>' +
          '<span class="tag">signal ' + row.signal + ' / 100</span>' +
          '<span class="tag">' + esc(row.category || 'Unclassified') + '</span>' +
          '<span class="tag">' + esc(chainText(row.chains)) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="valuehero">' +
        '<div class="k">Implied launch value · ' + esc(DATA.model_version) + '</div>' +
        '<div class="v">' + compact(row.implied_value_usd) + '</div>' +
        '<div class="s">' + multiple(row.fdv_tvl_multiple) + ' of TVL · an FDV estimate, not a per-token price</div>' +
      '</div>' +
      '<div class="dsec"><h3>How the model got there</h3><div class="wf">' +
        wrow('TVL × ' + trim(row.sector_multiple), row.base_usd, row.base_usd, row.implied_value_usd) +
        wrow('7d growth × ' + trim(row.growth_multiplier), afterGrowth, afterGrowth, row.implied_value_usd) +
        wrow('Age × ' + trim(row.age_multiplier), afterAge, afterAge, row.implied_value_usd) +
        wrow('Chain reach × ' + trim(row.chain_multiplier), afterChain, afterChain, row.implied_value_usd) +
        '<div class="wrow total"><span class="lab">Implied value</span><div class="track"><i style="width:100%"></i></div><span class="amt">' + compact(row.implied_value_usd) + '</span></div>' +
      '</div></div>' +
      '<div class="dsec"><h3>Snapshot facts</h3><dl class="dgrid">' +
        '<div><dt>TVL</dt><dd>' + compact(row.tvl_usd) + '</dd></div>' +
        '<div><dt>7-day change</dt><dd class="' + trendClass(row.change_7d) + '">' + signed(row.change_7d) + '</dd></div>' +
        '<div><dt>Age without token</dt><dd>' + age(row.age_days) + '</dd></div>' +
        '<div><dt>First tracked</dt><dd>' + esc(row.listed_at || 'unlisted') + '</dd></div>' +
        '<div><dt>Sector multiple</dt><dd>' + trim(row.sector_multiple) + '</dd></div>' +
        '<div><dt>Signal score</dt><dd>' + row.signal + ' / 100</dd></div>' +
        '<div><dt>Token recorded</dt><dd>none</dd></div>' +
        '<div><dt>Chains</dt><dd>' + row.chains.length + '</dd></div>' +
      '</dl></div>' +
      '<div class="dsec"><h3>Farm plan · activity that may earn a future allocation</h3><div class="steps">' + steps + '</div>' +
      '<p style="margin-top:12px;color:var(--dim);font-size:11.5px">Capital can be lost and no allocation is promised. Check every address on the protocol\'s own app before signing.</p></div>';

    drawer.hidden = false;
    scrim.hidden = false;
    document.body.style.overflow = 'hidden';
    drawer.querySelector('.close').focus({ preventScroll: true });
  }

  function closeDrawer() {
    openSlug = null;
    drawer.hidden = true;
    scrim.hidden = true;
    drawer.innerHTML = '';
    document.body.style.overflow = '';
  }

  function wireDrawer() {
    document.getElementById('rows').addEventListener('click', function (event) {
      var tr = event.target.closest('tr[data-slug]');
      if (tr) openDrawer(tr.getAttribute('data-slug'));
    });
    document.getElementById('rows').addEventListener('keydown', function (event) {
      var tr = event.target.closest('tr[data-slug]');
      if (tr && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        openDrawer(tr.getAttribute('data-slug'));
      }
    });
    drawer.addEventListener('click', function (event) {
      if (event.target.closest('.close')) closeDrawer();
    });
    scrim.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && openSlug !== null) closeDrawer();
      if (event.key === '/' && openSlug === null && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
        event.preventDefault();
        document.getElementById('q').focus();
      }
    });
  }

  // --------------------------------------------------------------- method page

  function renderMethod() {
    document.getElementById('methodlede').textContent =
      'Every row is the same four-function model, printed here in full. ' + DATA.model_version +
      ' reads nothing but the sealed snapshot: no live calls, no per-protocol exceptions, no price feed.';

    document.getElementById('formula').textContent =
      'implied = TVL × sector_multiple\n' +
      '        × exp(' + MODEL.growth_elasticity + ' × clipped(change_7d, ' + MODEL.growth_floor + ', ' + MODEL.growth_cap + ') / 100)\n' +
      '        × (' + MODEL.age_floor + ' + ' + MODEL.age_range + ' × (1 − e^(−days / ' + MODEL.age_scale_days + ')))\n' +
      '        × (1 + min(' + MODEL.chain_cap + ', ' + MODEL.chain_step + ' × (chains − 1)))';

    var constants = [
      ['default sector multiple', trim(MODEL.default_multiple)],
      ['growth elasticity', String(MODEL.growth_elasticity)],
      ['growth clip', MODEL.growth_floor + '% to ' + MODEL.growth_cap + '%'],
      ['age floor', String(MODEL.age_floor)],
      ['age range', String(MODEL.age_range)],
      ['age scale', MODEL.age_scale_days + ' days'],
      ['age when unlisted', MODEL.unknown_age_days + ' days'],
      ['chain step / cap', MODEL.chain_step + ' / ' + MODEL.chain_cap]
    ];
    document.getElementById('constants').innerHTML = constants.map(function (pair) {
      return '<span>' + esc(pair[0]) + '</span><b>' + esc(pair[1]) + '</b>';
    }).join('');

    var top = SECTORS.slice(0, 12);
    var peak = top.reduce(function (max, group) { return Math.max(max, group.count); }, 1);
    document.getElementById('sectors').innerHTML = top.map(function (group) {
      return '<div class="barrow">' +
        '<span class="n" title="' + esc(group.name) + '">' + esc(group.name) + '</span>' +
        '<div class="t"><i style="width:' + percent(group.count, peak) + '%"></i></div>' +
        '<span class="p">' + group.count + '</span>' +
        '</div>';
    }).join('');
  }

  // --------------------------------------------------------------- start

  function wireToolbar() {
    var q = document.getElementById('q');
    var sector = document.getElementById('sector');
    var chain = document.getElementById('chain');
    var size = document.getElementById('size');
    var sort = document.getElementById('sort');

    q.addEventListener('input', function () { state.q = q.value; renderBoard(); });
    sector.addEventListener('change', function () { state.sector = sector.value; renderBoard(); });
    chain.addEventListener('change', function () { state.chain = chain.value; renderBoard(); });
    size.addEventListener('change', function () { state.size = size.value; renderBoard(); });
    sort.addEventListener('change', function () { state.sort = sort.value; renderBoard(); });
    document.getElementById('reset').addEventListener('click', function () {
      state = { q: '', sector: 'all', chain: 'all', size: 'all', sort: 'implied' };
      q.value = '';
      sector.value = 'all';
      chain.value = 'all';
      size.value = 'all';
      sort.value = 'implied';
      renderBoard();
    });
  }

  /** The small public surface the screenshot pass and a curious reader can drive from the console. */
  window.RadarApp = {
    open: openDrawer,
    close: closeDrawer,
    filter: function (patch) {
      Object.keys(patch || {}).forEach(function (key) {
        if (key in state) state[key] = String(patch[key]);
      });
      document.getElementById('q').value = state.q;
      document.getElementById('sector').value = state.sector;
      document.getElementById('chain').value = state.chain;
      document.getElementById('size').value = state.size;
      document.getElementById('sort').value = state.sort;
      renderBoard();
    },
    state: function () { return Object.assign({}, state); }
  };

  renderSnapshot();
  renderStats();
  fillSelect('sector', 'All sectors', SECTORS.map(function (group) { return group.name; }));
  fillSelect('chain', 'All chains', NETWORKS.slice(0, 40).map(function (group) { return group.name; }).sort());
  renderTabs();
  wireToolbar();
  wireDrawer();
  renderBoard();
  renderMarket();
  renderMethod();
})();
