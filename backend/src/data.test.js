import assert from 'node:assert/strict';
import test from 'node:test';
import { getJuzNumber, JUZ_STARTS, SURAH_METADATA } from './data.js';

test('preserves all Surah metadata and the canonical verse totals', () => {
  assert.equal(SURAH_METADATA.length, 114);
  assert.equal(SURAH_METADATA.reduce((total, surah) => total + surah.ayahCount, 0), 6236);
  assert.deepEqual(SURAH_METADATA[0], {
    number: 1,
    startVerseIndex: 1,
    ayahCount: 7,
    revelationOrder: 5,
    rukuCount: 1,
    arabicName: 'الفاتحة',
    name: 'Al-Fatiha',
    meaning: 'The Opening',
    revelationType: 'Meccan',
  });
  assert.equal(SURAH_METADATA[113].arabicName, 'الناس');
});

test('has all thirty Juz starts and selects the Juz at boundary verses', () => {
  assert.equal(JUZ_STARTS.length, 30);
  assert.equal(getJuzNumber(2, 141), 1);
  assert.equal(getJuzNumber(2, 142), 2);
  assert.equal(getJuzNumber(78, 1), 30);
  assert.equal(getJuzNumber(114, 6), 30);
});
