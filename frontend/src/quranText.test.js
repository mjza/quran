import assert from 'node:assert/strict';
import test from 'node:test';
import { formatQuranText } from './quranText.js';

function textContent(parts) {
  return parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
}

test('normalizes Hafs-specific marks and extra meem signs', () => {
  const source = '\u064B\u06ED \u064C\u06ED \u064D\u0651\u06E2 \u064D\u06ED \u064B\u06E2 \u064C\u06E2 \u06EB \u0640\u064E ك\u064Eل\u064Eا\u0653';
  const expected = '\u064B \u064C \u064D\u0651 \u0650\u06ED \u064E\u06E2 \u064F\u06E2 \u06EC \u064E ك\u0640\u064Eل\u064Eا\u0653';

  assert.equal(textContent(formatQuranText(source)), expected);
  assert.equal(textContent(formatQuranText('عَذَابٌۭ شَدِيدٌۭ')), 'عَذَابٌ شَدِيدٌ');
});

test('renders waqf, rub el hizb, and sajdah markers as styled segments', () => {
  const parts = formatQuranText('كلمة \u06D7 كلمة \u06DE كلمة \u06E9');

  assert.deepEqual(parts.filter((part) => typeof part !== 'string'), [
    { className: 'sign', text: '\u00A0\u06D7' },
    { className: 'hezb-sign', text: '\u06DE ' },
    { className: 'internal-sign', text: '\u06E9' },
  ]);
  assert.equal(textContent(parts), 'كلمة\u00A0\u06D7 كلمة \u06DE  كلمة \u06E9');
});

test('marks rub el hizb signs at Juz starts in the Juz color', () => {
  const parts = formatQuranText('\u06DE كلمة', { isJuzStart: true });

  assert.deepEqual(parts, [{ className: 'juz-sign', text: '\u06DE ' }, ' كلمة']);
});

test('hides the signs Tanzil marks optional when signs are disabled', () => {
  const parts = formatQuranText('كلمة \u06D7 كلمة \u06DE كلمة \u06E9', { showSigns: false });

  assert.deepEqual(parts, ['كلمة  كلمة  كلمة ']);
});
