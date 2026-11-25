import assert from "node:assert/strict";
import test from "node:test";
import {
  getJuzNumber,
  JUZ_STARTS,
  RUB_EL_HIZB_STARTS,
  SURA_METADATA,
} from "./data.js";

test("preserves all Sura metadata and the canonical verse totals", () => {
  assert.equal(SURA_METADATA.length, 114);
  assert.equal(
    SURA_METADATA.reduce((total, sura) => total + sura.ayaCount, 0),
    6236,
  );
  assert.deepEqual(SURA_METADATA[0], {
    number: 1,
    startVerseIndex: 1,
    ayaCount: 7,
    revelationOrder: 5,
    rukuCount: 1,
    arabicName: "الفاتحة",
    name: "Al-Fatiha",
    meaning: "The Opening",
    revelationType: "Meccan",
  });
  assert.equal(SURA_METADATA[113].arabicName, "الناس");
});

test("has all thirty Juz starts and selects the Juz at boundary verses", () => {
  assert.equal(JUZ_STARTS.length, 30);
  assert.equal(getJuzNumber(2, 141), 1);
  assert.equal(getJuzNumber(2, 142), 2);
  assert.equal(getJuzNumber(78, 1), 30);
  assert.equal(getJuzNumber(114, 6), 30);
});

test("has all 240 quarter-Hezb starts and aligns every Juz to an odd Hezb", () => {
  assert.equal(RUB_EL_HIZB_STARTS.length, 240);
  assert.deepEqual(RUB_EL_HIZB_STARTS.slice(0, 5), [
    { sura: 1, aya: 1 },
    { sura: 2, aya: 26 },
    { sura: 2, aya: 44 },
    { sura: 2, aya: 60 },
    { sura: 2, aya: 75 },
  ]);
  assert.deepEqual(
    JUZ_STARTS,
    RUB_EL_HIZB_STARTS.filter((_, index) => index % 8 === 0),
  );
});
