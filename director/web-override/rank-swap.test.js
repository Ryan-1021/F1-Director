/*
 * node director/web-override/rank-swap.test.js
 * 排名换行：车号身份、换位计划、invert 位移。不进 share/web。
 */
'use strict';

var RS = require('./rank-swap.js');

var failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL ' + msg);
  }
}

assert(RS.carKey({ number: 1, tla: 'VER' }) === '1', 'carKey prefers number');
assert(RS.carKey({ number: 0, tla: 'DRU' }) === '0', 'carKey keeps 0');
assert(RS.carKey({ tla: 'NOR' }) === 'NOR', 'carKey falls back to tla');
assert(RS.carKey({ number: '', tla: 'HAM' }) === 'HAM', 'empty number uses tla');
assert(RS.carKey(null) === '', 'carKey null');

assert(RS.sameOrder(['1', '4'], ['1', '4']) === true, 'sameOrder equal');
assert(RS.sameOrder(['1', '4'], ['4', '1']) === false, 'sameOrder swapped');
assert(RS.sameOrder(['1'], ['1', '4']) === false, 'sameOrder length');
assert(RS.sameOrder(null, ['1']) === false, 'sameOrder null');

var keys = RS.keysOfCars([
  { number: 1, tla: 'VER' },
  { number: 4, tla: 'NOR' },
  { tla: 'LEC' }
]);
assert(keys.join(',') === '1,4,LEC', 'keysOfCars ' + keys.join(','));

var twoWay = RS.planSwap(['1', '4', '16', '81'], ['4', '1', '16', '81']);
assert(twoWay.same === false, 'swap not same');
assert(twoWay.moved.join(',') === '4,1', 'two-car swap moved ' + twoWay.moved.join(','));

var multi = RS.planSwap(
  ['1', '4', '16', '81', '55'],
  ['16', '1', '81', '4', '55']
);
assert(multi.moved.length === 4, 'multi-car reshuffle moves all changers ' + multi.moved.join(','));
assert(multi.moved.indexOf('55') === -1, 'unchanged tail is not moved');

var append = RS.planSwap(['1', '4'], ['1', '4', '16']);
assert(append.same === false, 'append changes length');
assert(append.moved.length === 0, 'append-only does not move existing keys');

var removeMid = RS.planSwap(['1', '4', '16'], ['1', '16']);
assert(removeMid.moved.join(',') === '16', 'remove-middle shifts later cars');

assert(RS.invertDy(100, 140) === -40, 'slide down invert');
assert(RS.invertDy(140, 100) === 40, 'slide up invert');

assert(RS.stripeClassForIndex(0) === true, 'P1 stripe');
assert(RS.stripeClassForIndex(1) === false, 'P2 no stripe');
assert(RS.stripeClassForIndex(2) === true, 'P3 stripe');

assert(RS.DURATION_MS >= 280 && RS.DURATION_MS <= 350, 'duration in agreed window');

(function testSkipBoardEmptyRow() {
  function fakeTr(opts) {
    opts = opts || {};
    return {
      querySelector: function (sel) {
        return sel === 'th' ? (opts.th || null) : null;
      },
      classList: { contains: function (c) { return c === opts.cls; } },
      getAttribute: function (n) { return n === 'data-car' ? (opts.car || '') : ''; }
    };
  }
  var table = {
    querySelectorAll: function () {
      return [
        fakeTr({ th: {} }),
        fakeTr({ cls: 'board-empty' }),
        fakeTr({ car: '1' })
      ];
    }
  };
  var rows = RS.dataRows(table);
  assert(rows.length === 1 && rows[0].getAttribute('data-car') === '1',
    'dataRows skips board-empty placeholder');
})();

assert(RS.prefersReducedMotion(function () { return { matches: true }; }) === true, 'reduce on');
assert(RS.prefersReducedMotion(function () { return { matches: false }; }) === false, 'reduce off');
assert(RS.prefersReducedMotion(function () { throw new Error('no mm'); }) === false, 'reduce throws');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('rank-swap ok');
