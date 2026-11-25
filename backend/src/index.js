import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import express from "express";
import {
  getJuzNumber,
  JUZ_STARTS,
  PAGE_STARTS,
  RUB_EL_HIZB_STARTS,
  SURA_METADATA,
} from "./data.js";

const backendDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const projectDirectory = path.resolve(backendDirectory, "..");
const databasePath = path.join(projectDirectory, "data", "quran.sqlite");
const audioDirectory = path.join(
  projectDirectory,
  "data",
  "audio",
  "recitations",
);
const translationAudioDirectory = path.join(
  projectDirectory,
  "data",
  "audio",
  "translations",
  "Persian_Fooladvand_Hedayatfar_40Kbps",
);
const port = Number(process.env.PORT || 3001);

if (!fs.existsSync(databasePath)) {
  throw new Error(`Quran database not found: ${databasePath}`);
}

const db = new Database(databasePath);
const editions = new Set([
  "quran_text_simple",
  "quran_text_simple_clean",
  "quran_text_simple_min",
  "quran_text_simple_plain",
  "quran_text_uthmani",
  "quran_text_uthmani_min",
]);

function seedPageBounds() {
  if (PAGE_STARTS.length !== 604) {
    throw new Error(
      `Expected 604 Madinah page starts, got ${PAGE_STARTS.length}`,
    );
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS quran_pages (
      page INTEGER PRIMARY KEY,
      start_sura INTEGER NOT NULL,
      start_aya INTEGER NOT NULL,
      end_sura INTEGER NOT NULL,
      end_aya INTEGER NOT NULL,
      start_index INTEGER NOT NULL,
      end_index INTEGER NOT NULL
    )
  `);

  const existing = db
    .prepare("SELECT COUNT(*) AS count FROM quran_pages")
    .get().count;
  if (existing === 604) {
    return;
  }
  if (existing !== 0) {
    throw new Error(`quran_pages contains ${existing} rows; expected 0 or 604`);
  }

  const verseAt = db.prepare(
    'SELECT "index" AS verseIndex, sura, aya FROM quran_text_uthmani WHERE sura = ? AND aya = ?',
  );
  const finalVerse = db
    .prepare(
      'SELECT "index" AS verseIndex, sura, aya FROM quran_text_uthmani ORDER BY "index" DESC LIMIT 1',
    )
    .get();
  const pageRows = [];

  for (let index = 0; index < PAGE_STARTS.length; index += 1) {
    const start = PAGE_STARTS[index];
    const nextStart = PAGE_STARTS[index + 1];
    const startVerse = verseAt.get(start.sura, start.aya);
    if (!startVerse) {
      throw new Error(`Missing page start verse ${start.sura}:${start.aya}`);
    }

    let endVerse = finalVerse;
    if (nextStart) {
      const nextVerse = verseAt.get(nextStart.sura, nextStart.aya);
      if (!nextVerse) {
        throw new Error(
          `Missing page start verse ${nextStart.sura}:${nextStart.aya}`,
        );
      }
      endVerse = db
        .prepare(
          'SELECT "index" AS verseIndex, sura, aya FROM quran_text_uthmani WHERE "index" = ?',
        )
        .get(nextVerse.verseIndex - 1);
      if (!endVerse) {
        throw new Error(`Cannot determine the end of page ${index + 1}`);
      }
    }

    pageRows.push({
      page: index + 1,
      startSura: startVerse.sura,
      startAya: startVerse.aya,
      endSura: endVerse.sura,
      endAya: endVerse.aya,
      startIndex: startVerse.verseIndex,
      endIndex: endVerse.verseIndex,
    });
  }

  const insertPage = db.prepare(`
    INSERT INTO quran_pages
      (page, start_sura, start_aya, end_sura, end_aya, start_index, end_index)
    VALUES
      (@page, @startSura, @startAya, @endSura, @endAya, @startIndex, @endIndex)
  `);
  db.transaction((rows) => {
    for (const row of rows) {
      insertPage.run(row);
    }
  })(pageRows);
}

seedPageBounds();

const reciters = fs.existsSync(audioDirectory)
  ? fs
      .readdirSync(audioDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        id: entry.name,
        name: entry.name.replace(/_\d+kbps$/i, ""),
      }))
  : [];

const app = express();
app.disable("x-powered-by");

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function selectedEdition(value) {
  return editions.has(value) ? value : null;
}

function normalizeArabic(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/ٱ/g, "ا");
}

function hasBasmalaAya(sura) {
  return sura !== 1 && sura !== 9;
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/suras", (_request, response) => {
  const chapters = db
    .prepare(
      `
    SELECT sura AS number, MIN("index") AS startVerseIndex, COUNT(*) AS ayaCount
    FROM quran_text_uthmani
    GROUP BY sura
    ORDER BY sura
  `,
    )
    .all();

  response.json(
    chapters.map((chapter) => {
      const metadata = SURA_METADATA[chapter.number - 1];
      if (
        !metadata ||
        metadata.number !== chapter.number ||
        metadata.startVerseIndex !== chapter.startVerseIndex ||
        metadata.ayaCount !== chapter.ayaCount
      ) {
        throw new Error(`Sura metadata mismatch for sura ${chapter.number}.`);
      }
      return metadata;
    }),
  );
});

app.get("/api/juz", (_request, response) => {
  response.json(
    JUZ_STARTS.map(({ sura, aya }, index) => ({
      number: index + 1,
      startSura: sura,
      startAya: aya,
    })),
  );
});

app.get("/api/hezb", (_request, response) => {
  response.json(
    RUB_EL_HIZB_STARTS.map(({ sura, aya }, index) => ({
      number: index + 1,
      hizb: Math.floor(index / 4) + 1,
      quarter: index % 4,
      startSura: sura,
      startAya: aya,
    })),
  );
});

app.get("/api/pages/:page", (request, response) => {
  const page = positiveInteger(request.params.page, "page");
  if (!page || page > 604) {
    response.status(400).json({ error: "Page must be between 1 and 604." });
    return;
  }

  const bounds = db
    .prepare(
      `
    SELECT page, start_sura AS startSura,
      start_aya AS startAya,
      end_sura AS endSura, end_aya AS endAya
    FROM quran_pages
    WHERE page = ?
  `,
    )
    .get(page);

  response.json(bounds);
});

app.get("/api/reader", (request, response) => {
  const sura = positiveInteger(request.query.sura, "sura");
  const aya = nonNegativeInteger(request.query.aya);
  const edition = selectedEdition(
    request.query.edition || "quran_text_uthmani",
  );

  if (
    !sura ||
    sura > 114 ||
    aya === null ||
    !edition ||
    (aya === 0 && !hasBasmalaAya(sura))
  ) {
    response
      .status(400)
      .json({ error: "Provide a valid sura, aya, and text edition." });
    return;
  }

  const verseAya = aya === 0 ? 1 : aya;
  const currentVerse = db
    .prepare(
      'SELECT "index" AS verseIndex FROM quran_text_uthmani WHERE sura = ? AND aya = ?',
    )
    .get(sura, verseAya);
  if (!currentVerse) {
    response.status(404).json({ error: "Verse not found." });
    return;
  }

  const page = db
    .prepare(
      `
    SELECT page, start_sura AS startSura, start_aya AS startAya,
      end_sura AS endSura, end_aya AS endAya, start_index AS startIndex, end_index AS endIndex
    FROM quran_pages
    WHERE start_index <= ? AND end_index >= ?
  `,
    )
    .get(currentVerse.verseIndex, currentVerse.verseIndex);

  const basmala = db
    .prepare(`SELECT text FROM ${edition} WHERE sura = 1 AND aya = 1`)
    .get().text;
  const basmalaTranslation = db
    .prepare("SELECT text FROM fa_fooladvand WHERE sura = 1 AND aya = 1")
    .get().text;
  const verses = db
    .prepare(
      `
    SELECT base.sura, base.aya, edition.text AS text, translation.text AS translation
    FROM quran_text_uthmani AS base
    JOIN ${edition} AS edition ON edition."index" = base."index"
    LEFT JOIN fa_fooladvand AS translation
      ON translation.sura = base.sura AND translation.aya = base.aya
    WHERE base."index" BETWEEN ? AND ?
    ORDER BY base."index"
  `,
    )
    .all(page.startIndex, page.endIndex);
  const displayVerses = [];
  for (const verse of verses) {
    if (verse.aya !== 1 || verse.sura === 1 || verse.sura === 9) {
      displayVerses.push(verse);
      continue;
    }

    const words = verse.text.trim().split(/\s+/);
    const sourceBasmala = words.slice(0, 4).join(" ");
    if (normalizeArabic(sourceBasmala) !== normalizeArabic(basmala)) {
      throw new Error(
        `Unexpected basmala text in ${edition} at ${verse.sura}:1`,
      );
    }

    displayVerses.push({
      sura: verse.sura,
      aya: 0,
      text: basmala,
      translation: basmalaTranslation,
    });
    displayVerses.push({
      ...verse,
      text: words.slice(4).join(" "),
    });
  }

  response.json({
    page: {
      number: page.page,
      start: { sura: page.startSura, aya: page.startAya },
      end: { sura: page.endSura, aya: page.endAya },
    },
    current: { sura, aya: verseAya, juz: getJuzNumber(sura, verseAya) },
    verses: displayVerses,
  });
});

app.get("/api/reciters", (_request, response) => {
  response.json(reciters);
});

app.get("/api/audio/:sura/:aya", (request, response) => {
  const sura = positiveInteger(request.params.sura, "sura");
  const aya = nonNegativeInteger(request.params.aya);
  const reciter =
    reciters.find((item) => item.id === request.query.reciter) || reciters[0];

  if (
    !sura ||
    sura > 114 ||
    aya === null ||
    !reciter ||
    (aya === 0 && !hasBasmalaAya(sura))
  ) {
    response.status(400).json({ error: "Invalid audio request." });
    return;
  }

  const audioSura = aya === 0 ? 1 : sura;
  const audioAya = aya === 0 ? 1 : aya;
  const audioPath = path.join(
    audioDirectory,
    reciter.id,
    `${String(audioSura).padStart(3, "0")}${String(audioAya).padStart(3, "0")}.mp3`,
  );
  if (!fs.existsSync(audioPath)) {
    response
      .status(404)
      .json({ error: "Audio file not found for this verse." });
    return;
  }

  response.sendFile(audioPath);
});

app.get("/api/translation-audio/:sura/:aya", (request, response) => {
  const sura = positiveInteger(request.params.sura, "sura");
  const aya = nonNegativeInteger(request.params.aya);

  if (
    !sura ||
    sura > 114 ||
    aya === null ||
    (aya === 0 && !hasBasmalaAya(sura))
  ) {
    response.status(400).json({ error: "Invalid translation audio request." });
    return;
  }

  const audioSura = aya === 0 ? 1 : sura;
  const audioAya = aya === 0 ? 1 : aya;
  const audioPath = path.join(
    translationAudioDirectory,
    `${String(audioSura).padStart(3, "0")}${String(audioAya).padStart(3, "0")}.mp3`,
  );
  if (!fs.existsSync(audioPath)) {
    response
      .status(404)
      .json({ error: "Translation audio file not found for this verse." });
    return;
  }

  response.sendFile(audioPath);
});

const clientBuild = path.join(projectDirectory, "dist");
if (fs.existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(clientBuild, "index.html"));
  });
}

app.listen(port, "127.0.0.1", () => {
  console.log(`Quran API listening at http://127.0.0.1:${port}`);
});
