import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpeningHours, checkVisit } from '../src/hours.mjs';

const at = (time, day = '19') => new Date(`2026-10-${day}T${time}:00+05:00`); // 19 Oct 2026 is a Monday

test('parses the formats present in the Astana dataset', () => {
  assert.deepEqual(parseOpeningHours('24/7')[0], [[0, 1440]]);
  assert.deepEqual(parseOpeningHours('Mo-Su 10:00-22:00')[6], [[600, 1320]]);
  const split = parseOpeningHours('Fr-Sa 12:00-03:00; Mo-Th,Su 12:00-02:00');
  assert.deepEqual(split[4], [[720, 1620]]);
  assert.deepEqual(split[6], [[720, 1560]]);
  const listed = parseOpeningHours('Mo-Th 11:00-23:00, Fr,Sa 12:00-24:00, Su 11:00-23:00');
  assert.deepEqual(listed[5], [[720, 1440]]);
  assert.deepEqual(listed[6], [[660, 1380]]);
  assert.deepEqual(parseOpeningHours('Su, Tu-Fr 11:00-19:00')[0], []);
  assert.deepEqual(parseOpeningHours('PH,Mo-Su 10:00-22:00')[2], [[600, 1320]]);
  assert.deepEqual(parseOpeningHours('12:00 - 06:00')[3], [[720, 1800]]);
  assert.deepEqual(parseOpeningHours('closed')[0], []);
});

test('unsupported formats stay unknown instead of guessed', () => {
  for (const value of ['Mo-Su,PH 08:00+', 'sunrise-sunset', 'Jan-Mar 10:00-18:00', '', null, 42]) {
    assert.equal(parseOpeningHours(value), null);
    assert.equal(checkVisit(value, at('12:00'), 30).status, 'unknown');
  }
});

test('visit window is checked from arrival to departure, including spans past midnight', () => {
  assert.deepEqual(checkVisit('Mo-Su 10:00-22:00', at('12:00'), 30), { status: 'open', closesAt: '22:00' });
  assert.deepEqual(checkVisit('Mo-Su 10:00-22:00', at('21:45'), 30), { status: 'closes_early', closesAt: '22:00' });
  assert.deepEqual(checkVisit('Mo-Su 10:00-22:00', at('02:30'), 30), { status: 'closed', opensAt: '10:00' });
  // Sunday 12:00-02:00 still covers Monday 01:00.
  assert.equal(checkVisit('Fr-Sa 12:00-03:00; Mo-Th,Su 12:00-02:00', at('01:00'), 30).status, 'open');
  assert.equal(checkVisit('Fr-Sa 12:00-03:00; Mo-Th,Su 12:00-02:00', at('02:30'), 30).status, 'closed');
  assert.deepEqual(checkVisit('24/7', at('03:00'), 60), { status: 'open', closesAt: null });
  assert.equal(checkVisit('Su, Tu-Fr 11:00-19:00', at('12:00'), 30).status, 'closed');
});
