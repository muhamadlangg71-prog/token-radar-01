// Token Radar dashboard.
//
// Reads the data file the entrypoint writes beside this page, renders the
// ranked board, and opens a detail view for any protocol. Everything the
// page shows is derived from that data file: the board, the live-token list,
// the filters, and the per-row recompute in the detail view, which replays
// the model's arithmetic from the snapshot inputs and checks it against the
// number the board carries.
//
// The page takes its state from the URL hash, so a filtered view is a link:
// #tab=live, #category=Risk Curators, #chain=Solana, #watchlist=1, #q=usdd.

(function () {
  'use strict';

  var DATA = window.RADAR;
  var countEl = document.getElementById('count');
  var metaEl = document.getElementById('meta');
  var rowsEl = document.getElementById('rows');
  var valueHead = document.getElementById('value-head');
  var dialog = document.getElementById('detail');

  if (!DATA || !Array.isArray(DATA.rows)) {
    countEl.textContent = 'The dashboard data did not load.';
    return;
  }

  var state = {
    tab: 'board',
    q: '',
    category: '',
    chain: '',
    watchlist: false,
    sortKey: 'rank',
    sortDir: 1,
  };

  // ---- formatting ---------------------------------------------------------

  function money(n) {
    return '$' + n.toLocaleString('en-US');
  }

  function compact(n) {
    if (n >= 1000000000) return '$' + (n / 1000000000).toFixed(2) + 'B';
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
    return money(n);
  }

  function changeText(change) {
    if (change === null || change === undefined) return '—';
    var sign = change > 0 ? '+' : '';
    return sign + change.toFixed(2) + '%';
  }

  function changeClass(change) {
    if (change === null || change === undefined) return '';
    return change >= 0 ? 'pos' : 'neg';
  }

  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- the farm plan, replayed from the same rules as the model ----------
  //
  // The board's data file does not carry farm steps, so the page rebuilds
  // them from the row: the position size follows TVL, the hold follows the
  // protocol's age, and the wording follows its category.

  function groupLookup(groups, fallback) {
    var map = new Map();
    groups.forEach(function (pair) {
      pair[0].forEach(function (category) {
        map.set(category, pair[1]);
      });
    });
    return function (category) {
      return map.get(category) || fallback;
    };
  }

  var stepTwo = groupLookup(
    [
      [['Risk Curators', 'Onchain Capital Allocator'], function (n, c, a) {
        return 'Deposit $' + a + ' into a ' + n + ' vault on ' + c + ' and keep the shares.';
      }],
      [['CDP', 'CDP Manager'], function (n, c, a) {
        return 'Mint ' + n + ' against $' + a + ' of collateral on ' + c + ' and keep the loan open.';
      }],
      [['RWA'], function (n, c, a) {
        return 'Mint $' + a + " of the protocol's yield asset on " + c + ' and hold it.';
      }],
      [['Lending', 'Collateral Markets', 'Uncollateralized Lending'], function (n, c, a) {
        return 'Supply $' + a + ' of USDC to ' + n + ' on ' + c + ' and keep the position open.';
      }],
      [['Dexs', 'Yield', 'Yield Aggregator', 'Leveraged Farming', 'Indexes'], function (n, c, a) {
        return 'Provide $' + a + " of liquidity to " + n + "'s main pool on " + c + ' and keep the position open.';
      }],
      [['Restaking', 'Staking Pool'], function (n, c, a) {
        return 'Stake $' + a + " of the chain's staking asset through " + n + ' and keep the receipt.';
      }],
      [['Derivatives', 'Interest Rate Derivatives'], function (n, c, a) {
        return 'Deposit $' + a + ' of USDC as margin on ' + n + ' and open one small hedge.';
      }],
      [['Prediction Market'], function (n, c, a) {
        return 'Fund $' + a + ' and place one market position on ' + n + '.';
      }],
      [['Cross Chain Bridge'], function (n, c, a) {
        return 'Bridge $' + a + ' of USDC to ' + c + ' through ' + n + ' and use the bridged funds in its app.';
      }],
      [['Stablecoin Wrapper', 'Dual-Token Stablecoin'], function (n, c, a) {
        return 'Mint or deposit $' + a + ' of the stable asset through ' + n + ' on ' + c + '.';
      }],
      [['Insurance'], function (n, c, a) {
        return 'Buy $' + a + ' of cover from ' + n + ' on ' + c + ' and keep the policy.';
      }],
      [['Anchor BTC', 'Decentralized BTC'], function (n, c, a) {
        return 'Deposit $' + a + ' of BTC into ' + n + ' on ' + c + ' and keep the receipt.';
      }],
      [['Basis Trading'], function (n, c, a) {
        return 'Deposit $' + a + ' of USDC as margin on ' + n + ' and open one small basis trade.';
      }],
      [['CeDeFi'], function (n, c, a) {
        return 'Deposit $' + a + " of USDC into " + n + "'s vault on " + c + ' and keep the position open.';
      }],
      [['Chain'], function (n, c, a) {
        return 'Move $' + a + ' of USDC onto ' + c + ' through ' + n + " and use it in the chain's main app.";
      }],
      [['Crypto Card Issuer'], function (n, c, a) {
        return 'Order a ' + n + ' card and load $' + a + ' on ' + c + ', then use it for everyday spending.';
      }],
      [['Farm'], function (n, c, a) {
        return 'Deposit $' + a + " of USDC into " + n + "'s farm on " + c + ' and keep the position open.';
      }],
      [['Governance Incentives'], function (n, c, a) {
        return 'Deposit $' + a + ' into ' + n + ' on ' + c + ' and take part in its governance votes.';
      }],
      [['Liquidity Manager'], function (n, c, a) {
        return 'Deposit $' + a + ' into a ' + n + ' managed vault on ' + c + ' and keep the shares.';
      }],
      [['OTC Marketplace'], function (n, c, a) {
        return 'Fund $' + a + ' and place one OTC trade on ' + n + ' on ' + c + '.';
      }],
      [['Payments'], function (n, c, a) {
        return 'Open a $' + a + ' payment channel on ' + c + ' through ' + n + ' and keep it funded.';
      }],
    ],
    function (n, c, a) {
      return 'Deposit $' + a + ' of USDC into ' + n + ' on ' + c + ' and keep the position open.';
    },
  );

  var stepThree = groupLookup(
    [
      [['Risk Curators', 'Onchain Capital Allocator', 'Liquidity Manager'], function (n) {
        return "Check " + n + "'s rebalance and add or remove a small amount each week.";
      }],
      [['CDP', 'CDP Manager', 'Collateral Markets', 'Lending', 'Uncollateralized Lending'], function (n) {
        return 'Top up collateral or repay a small amount of the loan on ' + n + ' once a week.';
      }],
      [['Dexs', 'Yield', 'Yield Aggregator', 'Leveraged Farming', 'Indexes'], function (n) {
        return "Swap a small amount through " + n + "'s pool each week.";
      }],
      [['Restaking', 'Staking Pool'], function (n) {
        return 'Top up the stake or claim and restake the rewards on ' + n + ' once a week.';
      }],
      [['Derivatives', 'Interest Rate Derivatives', 'Basis Trading'], function (n) {
        return 'Open and close one small hedge on ' + n + ' each week.';
      }],
      [['Prediction Market'], function (n) {
        return 'Place one small market position on ' + n + ' each week.';
      }],
      [['RWA'], function (n) {
        return 'Check the yield accrual on ' + n + ' and mint or redeem a small amount each week.';
      }],
      [['Stablecoin Wrapper', 'Dual-Token Stablecoin'], function (n) {
        return 'Mint or redeem a small amount of the stable asset through ' + n + ' each week.';
      }],
      [['Insurance'], function (n) {
        return 'Check the cover terms on ' + n + ' and renew or adjust a small amount each week.';
      }],
      [['Anchor BTC'], function (n) {
        return 'Check the BTC yield accrual on ' + n + ' and add or restake a small amount each week.';
      }],
      [['CeDeFi'], function (n) {
        return 'Check the yield on ' + n + ' and add or withdraw a small amount each week.';
      }],
      [['Chain'], function (n, c) {
        return "Use " + n + "'s main app on " + c + ' once a week so the activity is recorded.';
      }],
      [['Cross Chain Bridge'], function (n) {
        return 'Bridge a small amount through ' + n + ' to another chain each week.';
      }],
      [['Crypto Card Issuer'], function (n) {
        return 'Spend a small amount with the ' + n + ' card each week and top it up.';
      }],
      [['Decentralized BTC'], function (n) {
        return 'Check the BTC yield on ' + n + ' and add or restake a small amount each week.';
      }],
      [['Farm'], function (n) {
        return 'Harvest and restake the farm rewards on ' + n + ' once a week.';
      }],
      [['Governance Incentives'], function (n) {
        return 'Vote with the ' + n + ' position once a week and claim any incentives.';
      }],
      [['OTC Marketplace'], function (n) {
        return 'Place one small OTC trade on ' + n + ' each week.';
      }],
      [['Payments'], function (n) {
        return 'Route one small payment through the ' + n + ' channel each week.';
      }],
    ],
    function (n) {
      return 'Make one qualifying action on ' + n + ' each week, such as a deposit, a borrow, a swap or a vote.';
    },
  );

  var stepFive = groupLookup(
    [
      [['Risk Curators', 'Onchain Capital Allocator', 'Liquidity Manager'], function (n) {
        return "Before you withdraw, open " + n + "'s vault points page and claim only from the link it publishes.";
      }],
      [['CDP', 'CDP Manager', 'Collateral Markets', 'Lending', 'Uncollateralized Lending'], function (n) {
        return "Before you withdraw, open " + n + "'s borrow dashboard and check the loan health, then claim only from the link it publishes.";
      }],
      [['Dexs', 'Yield', 'Yield Aggregator', 'Leveraged Farming', 'Indexes'], function (n) {
        return "Before you withdraw, open " + n + "'s LP rewards page and claim only from the link it publishes.";
      }],
      [['Restaking', 'Staking Pool'], function (n) {
        return "Before you withdraw, open " + n + "'s staking rewards page and claim only from the link it publishes.";
      }],
      [['Derivatives', 'Interest Rate Derivatives', 'Basis Trading'], function (n) {
        return "Before you withdraw, open " + n + "'s perps points page and claim only from the link it publishes.";
      }],
      [['Prediction Market'], function (n) {
        return "Before you withdraw, open " + n + "'s rewards page and claim only from the link it publishes.";
      }],
      [['RWA'], function (n) {
        return "Before you withdraw, open " + n + "'s yield dashboard and claim only from the link it publishes.";
      }],
      [['Anchor BTC', 'Decentralized BTC'], function (n) {
        return "Before you withdraw, open " + n + "'s BTC rewards page and claim only from the link it publishes.";
      }],
      [['CeDeFi', 'Chain', 'Insurance', 'Payments'], function (n) {
        return "Before you withdraw, open " + n + "'s rewards page and claim only from the link it publishes.";
      }],
      [['Cross Chain Bridge'], function (n) {
        return "Before you withdraw, open " + n + "'s bridge rewards page and claim only from the link it publishes.";
      }],
      [['Crypto Card Issuer'], function (n) {
        return "Before you withdraw, open " + n + "'s card rewards page and claim only from the link it publishes.";
      }],
      [['Dual-Token Stablecoin', 'Stablecoin Wrapper'], function (n) {
        return "Before you withdraw, open " + n + "'s stable rewards page and claim only from the link it publishes.";
      }],
      [['Farm'], function (n) {
        return "Before you withdraw, open " + n + "'s farm rewards page and claim only from the link it publishes.";
      }],
      [['Governance Incentives'], function (n) {
        return "Before you withdraw, open " + n + "'s incentives page and claim only from the link it publishes.";
      }],
      [['OTC Marketplace'], function (n) {
        return "Before you withdraw, open " + n + "'s trading rewards page and claim only from the link it publishes.";
      }],
    ],
    function () {
      return "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.";
    },
  );

  function farmPlan(row) {
    var amount = row.tvl_usd >= 1000000000 ? 150 : row.tvl_usd >= 100000000 ? 100 : 50;
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    var days = age >= 365 ? 30 : age >= 180 ? 45 : 60;
    var gas = amount === 150 ? 8 : 4;
    var chain = row.chains[0] || 'Ethereum';
    return [
      'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. ' +
        'Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
      stepTwo(row.category)(row.name, chain, amount) +
        ' Cost: $' + amount + ' of capital and about $' + gas + ' of gas. Time: 15 minutes to set up.',
      stepThree(row.category)(row.name, chain, amount) +
        ' Cost: about $2 of gas a week. Time: 10 minutes a week.',
      'Hold the position for at least ' + days + ' days so the activity is counted in more than one snapshot. ' +
        'Cost: the $' + amount + ' stays in the position. Time: ' + days + ' days.',
      stepFive(row.category)(row.name, chain, amount) +
        ' Cost: no fee to check, and never pay to claim. Time: 10 minutes.',
      'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. ' +
        'Cost: nothing but the log. Time: 5 minutes.',
    ];
  }

  // ---- board sections: summary, top-10 chart, model, calibration --------
  //
  // All four are computed from the data file at load, never hard-coded, so
  // they stay right whatever snapshot the entry is run on.

  function renderSummary() {
    var el = document.getElementById('summary');
    if (!el) return;
    var rows = DATA.rows;
    var total = rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var top10 = rows.slice(0, 10).reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var chains = new Set();
    rows.forEach(function (r) { r.chains.forEach(function (c) { chains.add(c); }); });
    var byCat = {};
    rows.forEach(function (r) {
      byCat[r.category] = byCat[r.category] || { n: 0, sum: 0 };
      byCat[r.category].n += 1;
      byCat[r.category].sum += r.implied_value_usd;
    });
    var biggest = Object.keys(byCat).sort(function (a, b) { return byCat[b].sum - byCat[a].sum; })[0];
    el.innerHTML =
      '<div class="stat"><span class="stat-label">Total implied value</span><span class="stat-value">' + compact(total) + '</span></div>' +
      '<div class="stat"><span class="stat-label">Top 10 protocols</span><span class="stat-value">' + compact(top10) + ' · ' + Math.round((top10 / total) * 100) + '%</span></div>' +
      '<div class="stat"><span class="stat-label">Chains covered</span><span class="stat-value">' + chains.size + '</span></div>' +
      '<div class="stat"><span class="stat-label">Largest category</span><span class="stat-value">' + esc(biggest) + ' · ' + byCat[biggest].n + ' · ' + compact(byCat[biggest].sum) + '</span></div>';
  }

  function renderTop10() {
    var el = document.getElementById('top10');
    if (!el) return;
    var top = DATA.rows.slice(0, 10);
    var max = top.length ? top[0].implied_value_usd : 1;
    var html = '<h2>Top 10 by implied value</h2><div class="bars">' + top.map(function (r) {
      var pct = (r.implied_value_usd / max) * 100;
      return '<div class="bar-row"><span class="bar-rank">#' + r.rank + '</span>' +
        '<span class="bar-name">' + esc(r.name) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct.toFixed(1) + '%"></span></span>' +
        '<span class="bar-value">' + compact(r.implied_value_usd) + '</span></div>';
    }).join('') + '</div>';
    el.innerHTML = html;
  }

  function renderHow() {
    var el = document.getElementById('how');
    if (!el || !DATA.model) return;
    var m = DATA.model;
    var mults = Object.keys(m.category_multiples)
      .filter(function (k) { return k !== 'default'; })
      .sort(function (a, b) { return m.category_multiples[b] - m.category_multiples[a] || (a < b ? -1 : 1); });
    var html = '<h2>How the model works</h2>' +
      '<p>Implied value = TVL × category multiple × growth multiple × maturity multiple × chain multiple. ' +
      'The growth multiple is 1 + (7-day change, clamped to ' + m.growth_floor + '% … +' + m.growth_cap + '%) × ' + m.growth_weight + '. ' +
      'The maturity multiple runs from ' + m.maturity_floor + ' up to 1 over ' + m.maturity_days + ' days (an unknown listing date counts as ' + m.unknown_age_days + ' days). ' +
      'The chain multiple adds ' + m.chain_step + ' per extra chain, capped at +' + (m.chain_step * m.chain_cap) + '. ' +
      'The base multiple of ' + m.base_multiple + ' is recorded but not used in the product.</p>' +
      '<div class="table-wrap"><table class="mults"><thead><tr><th>Category</th><th class="num">Multiple</th></tr></thead><tbody>' +
      mults.map(function (k) {
        return '<tr><td>' + esc(k) + '</td><td class="num">× ' + m.category_multiples[k] + '</td></tr>';
      }).join('') +
      '<tr><td>Anything else (default)</td><td class="num">× ' + m.category_multiples['default'] + '</td></tr>' +
      '</tbody></table></div>';
    el.innerHTML = html;
  }

  function renderCalibration() {
    var el = document.getElementById('calibration');
    if (!el || !Array.isArray(DATA.calibration) || !DATA.calibration.length) return;
    var html = '<h2>Calibration against live tokens</h2>' +
      '<p>For each category on the board that already has launched tokens: what those live tokens trade at per dollar of TVL (median), next to the multiple the model credits the category. ' +
      'Where the live median sits far above the multiple the board is conservative; where it sits below, the board is optimistic. ' +
      'Categories with one live token are noisy — read the count before the number. This table never changes the ranking.</p>' +
      '<div class="table-wrap"><table class="calib"><thead><tr><th>Category</th><th class="num">Live tokens</th><th class="num">Median live mcap</th><th class="num">Median live mcap / TVL</th><th class="num">Model multiple</th></tr></thead><tbody>' +
      DATA.calibration.map(function (c) {
        return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.live_n + '</td><td class="num">' + compact(c.median_mcap_usd) + '</td><td class="num">' + c.median_mcap_tvl + '</td><td class="num">× ' + c.model_multiple + '</td></tr>';
      }).join('') +
      '</tbody></table></div>';
    el.innerHTML = html;
  }

  // ---- recompute: replay the model's arithmetic from the row itself ------

  function recompute(row) {
    var m = DATA.model;
    var pct = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growth = 1 + (pct * m.growth_weight) / 100;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = Math.min(1, m.maturity_floor + (age * m.maturity_range) / m.maturity_days);
    var chain = 1 + m.chain_step * Math.min(row.chains.length - 1, m.chain_cap);
    return Math.round(row.tvl_usd * row.category_multiple * growth * maturity * chain);
  }

  // ---- state from the hash ------------------------------------------------

  function readHash() {
    var params = new URLSearchParams(window.location.hash.slice(1));
    state.tab = params.get('tab') === 'live' ? 'live' : 'board';
    state.q = params.get('q') || '';
    state.category = params.get('category') || '';
    state.chain = params.get('chain') || '';
    state.watchlist = params.get('watchlist') === '1';
    var sort = params.get('sort');
    if (sort) state.sortKey = sort;
    state.sortDir = params.get('dir') === 'desc' ? -1 : 1;
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('category', state.category);
    if (state.chain) params.set('chain', state.chain);
    if (state.watchlist) params.set('watchlist', '1');
    if (state.sortKey !== 'rank') params.set('sort', state.sortKey);
    if (state.sortDir === -1) params.set('dir', 'desc');
    var hash = params.toString();
    history.replaceState(null, '', hash ? '#' + hash : window.location.pathname + window.location.search);
  }

  // ---- controls -----------------------------------------------------------

  var searchEl = document.getElementById('search');
  var categoryEl = document.getElementById('category');
  var chainEl = document.getElementById('chain');
  var watchEl = document.getElementById('watchlist');
  var tabBoard = document.getElementById('tab-board');
  var tabLive = document.getElementById('tab-live');

  function fillSelects() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category; }))).sort();
    categories.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      categoryEl.appendChild(opt);
    });
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains; }))).sort();
    chains.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      chainEl.appendChild(opt);
    });
  }

  function syncControls() {
    searchEl.value = state.q;
    categoryEl.value = state.category;
    chainEl.value = state.chain;
    watchEl.checked = state.watchlist;
    tabBoard.classList.toggle('active', state.tab === 'board');
    tabLive.classList.toggle('active', state.tab === 'live');
    valueHead.textContent = state.tab === 'live' ? 'Market cap' : 'Implied value';
  }

  // ---- rendering ----------------------------------------------------------

  function visibleRows() {
    var list = state.tab === 'live' ? DATA.live : DATA.rows;
    var q = state.q.trim().toLowerCase();
    var out = list.filter(function (row) {
      if (state.tab === 'board') {
        if (state.watchlist && !row.watchlist) return false;
        if (state.category && row.category !== state.category) return false;
        if (state.chain && row.chains.indexOf(state.chain) === -1) return false;
      } else {
        if (state.category && row.category !== state.category) return false;
        if (state.chain && row.chains.indexOf(state.chain) === -1) return false;
      }
      if (q && row.name.toLowerCase().indexOf(q) === -1 && row.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sortKey;
    var dir = state.sortDir;
    out.sort(function (a, b) {
      var av = key === 'implied' ? (state.tab === 'live' ? a.mcap_usd : a.implied_value_usd) : a[key];
      var bv = key === 'implied' ? (state.tab === 'live' ? b.mcap_usd : b.implied_value_usd) : b[key];
      if (key === 'rank' && state.tab === 'live') {
        av = DATA.live.indexOf(a);
        bv = DATA.live.indexOf(b);
      }
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return (av - bv) * dir;
    });
    return out;
  }

  function chainCell(chains) {
    var shown = chains.slice(0, 3).join(', ');
    if (chains.length > 3) shown += ' +' + (chains.length - 3) + ' more';
    return '<span class="chains" title="' + esc(chains.join(', ')) + '">' + esc(shown) + '</span>';
  }

  function render() {
    syncControls();
    var list = visibleRows();
    var total = state.tab === 'live' ? DATA.live_size : DATA.board_size;
    countEl.textContent =
      'Showing ' + list.length + ' of ' + total + (state.tab === 'live' ? ' live tokens' : ' protocols') +
      ' · snapshot ' + DATA.as_of;
    if (list.length === 0) {
      rowsEl.innerHTML = '<tr><td colspan="7" class="empty">No protocols match these filters.</td></tr>';
      return;
    }
    var html = list
      .map(function (row, i) {
        var rank = state.tab === 'live' ? i + 1 : row.rank;
        var value = state.tab === 'live' ? row.mcap_usd : row.implied_value_usd;
        var star = state.tab === 'board' && row.watchlist ? ' <span class="star" title="On the watchlist">★</span>' : '';
        return (
          '<tr data-slug="' + esc(row.slug) + '" data-tab="' + state.tab + '">' +
          '<td>' + rank + '</td>' +
          '<td><span class="name">' + esc(row.name) + '</span>' + star + '<br><span class="slug">' + esc(row.slug) + '</span></td>' +
          '<td>' + esc(row.category) + '</td>' +
          '<td>' + chainCell(row.chains) + '</td>' +
          '<td class="num">' + compact(row.tvl_usd) + '</td>' +
          '<td class="num ' + changeClass(row.change_7d) + '">' + changeText(row.change_7d) + '</td>' +
          '<td class="num">' + compact(value) + '</td>' +
          '</tr>'
        );
      })
      .join('');
    rowsEl.innerHTML = html;
    document.querySelectorAll('thead th[data-sort]').forEach(function (th) {
      var base = th.getAttribute('data-sort');
      var label = { rank: 'Rank', name: 'Protocol', category: 'Category', tvl: 'TVL', change: '7d', implied: state.tab === 'live' ? 'Market cap' : 'Implied value' }[base];
      th.textContent = label + (state.sortKey === base ? (state.sortDir === 1 ? ' ▲' : ' ▼') : '');
      th.classList.toggle('sorted', state.sortKey === base);
    });
  }

  // ---- detail view --------------------------------------------------------

  function peersFor(row) {
    return DATA.rows
      .filter(function (r) { return r.category === row.category && r.slug !== row.slug; })
      .slice(0, 5);
  }

  function openBoardDetail(row) {
    var again = recompute(row);
    var matches = again === row.implied_value_usd;
    var m = DATA.model;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var prev = row.rank > 1 ? DATA.rows[row.rank - 2] : null;
    var next = row.rank < DATA.rows.length ? DATA.rows[row.rank] : null;
    var steps = farmPlan(row);
    var peers = peersFor(row);
    var html =
      '<div class="detail-inner">' +
      '<button type="button" class="close">Close</button>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="rank-line">Rank #' + row.rank + ' of ' + DATA.board_size + ' · ' + esc(row.category) +
      ' · ' + (row.watchlist ? 'on the watchlist' : 'found beyond the watchlist') + '</p>' +
      '<h3>Why this rank</h3>' +
      '<table><tbody>' +
      '<tr><td>TVL</td><td class="num">' + money(row.tvl_usd) + '</td></tr>' +
      '<tr><td>Category multiple (' + esc(row.category) + ')</td><td class="num">× ' + row.category_multiple + '</td></tr>' +
      '<tr><td>Growth multiple (' + changeText(row.change_7d) + ' in 7 days)</td><td class="num">× ' + row.growth_multiplier + '</td></tr>' +
      '<tr><td>Maturity multiple (' + (row.age_days === null ? 'listed date unknown, counted as ' + age + ' days' : age + ' days old') + ')</td><td class="num">× ' + row.maturity_multiplier + '</td></tr>' +
      '<tr><td>Chain multiple (' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ')</td><td class="num">× ' + row.chain_multiplier + '</td></tr>' +
      '<tr><td><strong>Implied value</strong></td><td class="num"><strong>' + money(row.implied_value_usd) + '</strong></td></tr>' +
      '</tbody></table>' +
      '<p class="recompute">Recomputed from the snapshot inputs, the product comes to ' + money(again) +
      (matches
        ? ' — the same number board.json carries.'
        : ' (board.json carries ' + money(row.implied_value_usd) + ').') +
      ' The base multiple of ' + m.base_multiple + ' is recorded in the model but not used in the product. ' +
      'Multipliers are shown rounded to six decimals; the recompute uses the unrounded inputs.</p>' +
      (prev || next
        ? '<p>Neighbours on the board: ' +
          (prev ? '#' + prev.rank + ' ' + esc(prev.name) + ' at ' + compact(prev.implied_value_usd) : '') +
          (prev && next ? ' · ' : '') +
          (next ? '#' + next.rank + ' ' + esc(next.name) + ' at ' + compact(next.implied_value_usd) : '') +
          '.</p>'
        : '') +
      '<h3>Farm plan</h3>' +
      '<ol class="farm">' +
      steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>' +
      '<h3>Same-category peers</h3>' +
      (peers.length
        ? '<ul class="peers">' +
          peers.map(function (p) {
            return '<li>#' + p.rank + ' ' + esc(p.name) + ' — ' + compact(p.implied_value_usd) + '</li>';
          }).join('') +
          '</ul>'
        : '<p>No other ' + esc(row.category) + ' protocol is on the board.</p>') +
      '</div>';
    dialog.innerHTML = html;
    dialog.querySelector('.close').addEventListener('click', function () { dialog.close(); });
    dialog.showModal();
  }

  function openLiveDetail(row) {
    var html =
      '<div class="detail-inner">' +
      '<button type="button" class="close">Close</button>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="rank-line">' + esc(row.category) + ' · ' + esc(row.chains.join(', ')) + '</p>' +
      '<table><tbody>' +
      '<tr><td>TVL</td><td class="num">' + money(row.tvl_usd) + '</td></tr>' +
      '<tr><td>Market cap</td><td class="num">' + money(row.mcap_usd) + '</td></tr>' +
      '<tr><td>7-day change</td><td class="num ' + changeClass(row.change_7d) + '">' + changeText(row.change_7d) + '</td></tr>' +
      '</tbody></table>' +
      '<p>This token already trades, so it sits on the live side of the radar instead of the board: the board only ranks protocols without a token yet.</p>' +
      '</div>';
    dialog.innerHTML = html;
    dialog.querySelector('.close').addEventListener('click', function () { dialog.close(); });
    dialog.showModal();
  }

  // ---- wiring -------------------------------------------------------------

  rowsEl.addEventListener('click', function (event) {
    var tr = event.target.closest('tr[data-slug]');
    if (!tr) return;
    var slug = tr.getAttribute('data-slug');
    if (tr.getAttribute('data-tab') === 'live') {
      var live = DATA.live.find(function (r) { return r.slug === slug; });
      if (live) openLiveDetail(live);
      return;
    }
    var row = DATA.rows.find(function (r) { return r.slug === slug; });
    if (row) openBoardDetail(row);
  });

  document.querySelectorAll('thead th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sortKey === key) {
        state.sortDir = -state.sortDir;
      } else {
        state.sortKey = key;
        state.sortDir = key === 'name' || key === 'category' ? 1 : -1;
      }
      writeHash();
      render();
    });
  });

  searchEl.addEventListener('input', function () {
    state.q = searchEl.value;
    writeHash();
    render();
  });
  categoryEl.addEventListener('change', function () {
    state.category = categoryEl.value;
    writeHash();
    render();
  });
  chainEl.addEventListener('change', function () {
    state.chain = chainEl.value;
    writeHash();
    render();
  });
  watchEl.addEventListener('change', function () {
    state.watchlist = watchEl.checked;
    writeHash();
    render();
  });
  tabBoard.addEventListener('click', function () {
    state.tab = 'board';
    writeHash();
    render();
  });
  tabLive.addEventListener('click', function () {
    state.tab = 'live';
    writeHash();
    render();
  });
  window.addEventListener('hashchange', function () {
    readHash();
    render();
  });

  // ---- start ---------------------------------------------------------------

  metaEl.textContent =
    'Snapshot ' + DATA.as_of + ' · ' + DATA.board_size + ' protocols on the board · ' +
    DATA.live_size + ' live tokens · model ' + DATA.model_version;
  fillSelects();
  renderSummary();
  renderTop10();
  renderHow();
  renderCalibration();
  readHash();
  render();
})();
