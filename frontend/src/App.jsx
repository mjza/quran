import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatQuranText } from "./quranText.js";

const EDITIONS = [
  ["quran_text_uthmani", "Uthmani"],
  ["quran_text_uthmani_min", "Uthmani (compact)"],
  ["quran_text_simple", "Simple"],
  ["quran_text_simple_clean", "Simple (clean)"],
  ["quran_text_simple_min", "Simple (compact)"],
  ["quran_text_simple_plain", "Simple (plain)"],
];
const HEZB_PORTION_LABELS = [
  "Hezb {{hezb}}",
  "Hezb {{hezb}} \u00BC",
  "Hezb {{hezb}} \u00BD",
  "Hezb {{hezb}} \u00BE",
];
const PAGE_NAVIGATION_CLICK_COOLDOWN_MS = 500;

function hasBasmalaAya(sura) {
  return sura !== 1 && sura !== 9;
}

function arabicNumber(value) {
  return String(value).replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[digit]);
}

function normalizeArabicDigits(value) {
  return String(value).replace(/[٠-٩۰-۹]/g, (digit) => {
    const digitCode = digit.charCodeAt(0);
    return String(digitCode - (digitCode >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

function arabicNumberName(value) {
  const ordinalNames = [
    "الاول",
    "الثاني",
    "الثالث",
    "الرابع",
    "الخامس",
    "السادس",
    "السابع",
    "الثامن",
    "التاسع",
    "العاشر",
  ];
  const tensNames = ["عشر", "العشرون", "الثلاثون"];
  if (value < 1 || value >= 40) return "";
  if (value <= 10) return ordinalNames[value - 1];

  const remainder = value % 10;
  const tens = parseInt(value / 10);
  ordinalNames[0] = "الحادي";
  return (
    (remainder > 0
      ? ordinalNames[remainder - 1] + (tens > 1 ? " و" : " ")
      : "") + tensNames[tens - 1]
  );
}

function formatAyaNumber(value) {
  return `\u200e﴿${arabicNumber(value)}﴾\u200f`;
}

function readHash() {
  const match = window.location.hash.match(/^#?(\d+):(\d+)$/);
  if (!match) {
    return { sura: 1, aya: 1 };
  }
  const aya = Number(match[2]);
  return { sura: Number(match[1]), aya: aya === 0 ? 1 : aya };
}

function splitFormattedText(parts) {
  const tokens = [];
  let pendingWhitespace = "";

  for (const part of parts) {
    if (typeof part !== "string") {
      if (part.className === "sign" && tokens.length) {
        const previousToken = tokens[tokens.length - 1];
        previousToken.trailingSigns = [
          ...(previousToken.trailingSigns || []),
          {
            className: part.className,
            text: `${pendingWhitespace}${part.text}`,
          },
        ];
      } else {
        tokens.push({
          leading: pendingWhitespace,
          text: part.text,
          className: part.className,
          trailing: "",
        });
      }
      pendingWhitespace = "";
      continue;
    }

    let cursor = 0;
    for (const match of part.matchAll(/\S+/gu)) {
      tokens.push({
        leading: pendingWhitespace + part.slice(cursor, match.index),
        text: match[0],
        trailing: "",
      });
      pendingWhitespace = "";
      cursor = match.index + match[0].length;
    }
    pendingWhitespace += part.slice(cursor);
  }

  if (pendingWhitespace && tokens.length) {
    tokens[tokens.length - 1].trailing += pendingWhitespace;
  }
  return tokens;
}

function buildQuranStreams(verses, suras, showSigns, juzStarts) {
  const arabicItems = [];
  const arabicTokens = [];
  const basmalaTranslations = [];
  const translationTokens = [];
  let arabicIndex = 0;
  let translationIndex = 0;
  let hasTranslation = false;

  for (const verse of verses) {
    if (
      verse.aya === 0 ||
      (verse.aya === 1 && (verse.sura === 1 || verse.sura === 9))
    ) {
      const sura = suras.find((item) => item.number === verse.sura);
      arabicItems.push({
        kind: "heading",
        key: `heading-${verse.sura}:${verse.aya}`,
        sura: verse.sura,
        title: `سورة ${sura?.arabicName || arabicNumber(verse.sura)}`,
      });
    }

    const isJuzStart = juzStarts.some(
      (start) => start.startSura === verse.sura && start.startAya === verse.aya,
    );
    const verseTokens = splitFormattedText(
      formatQuranText(verse.text, { showSigns, isJuzStart }),
    ).map((token) => ({
      ...token,
      index: arabicIndex++,
      verse,
      isAyaNumber: false,
    }));

    if (verse.aya === 0) {
      arabicItems.push({
        kind: "basmala",
        key: `basmala-${verse.sura}`,
        verse,
        tokens: verseTokens,
      });
    } else {
      const lastToken = verseTokens[verseTokens.length - 1];
      if (lastToken) {
        lastToken.text = lastToken.text.replace(/\s+$/u, "");
        lastToken.trailing = lastToken.trailing.replace(/\s+$/u, "");
        lastToken.endingMarker = formatAyaNumber(verse.aya);
        lastToken.endingSpace = true;
      } else {
        verseTokens.push({
          index: arabicIndex++,
          leading: " ",
          text: formatAyaNumber(verse.aya),
          trailing: " ",
          className: "ayaNumber",
          verse,
          isAyaNumber: true,
        });
      }
      for (const token of verseTokens) {
        arabicItems.push({ kind: "token", token });
      }
    }
    arabicTokens.push(...verseTokens);

    if (
      (verse.aya === 0 || (verse.sura === 1 && verse.aya === 1)) &&
      verse.translation
    ) {
      basmalaTranslations.push(verse);
    } else if (verse.translation) {
      const textTokens = splitFormattedText([verse.translation.trimEnd()]);
      if (hasTranslation && textTokens.length) {
        textTokens[0].leading = ` ${textTokens[0].leading}`;
      }
      for (const token of textTokens) {
        translationTokens.push({
          ...token,
          index: translationIndex++,
          verse,
        });
      }
      if (verse.aya > 0) {
        translationTokens.push({
          index: translationIndex++,
          leading: "\u00a0",
          text: formatAyaNumber(verse.aya),
          trailing: "",
          className: "translation-aya-number",
          verse,
        });
      }
      hasTranslation = true;
    }
  }

  return {
    arabicItems,
    arabicTokens,
    basmalaTranslations,
    translationTokens,
  };
}

function renderToken(token, measure = false) {
  return (
    <Fragment key={token.index}>
      <span
        className={[
          token.className,
          token.trailingSigns?.length && "sign-attached",
          token.endingMarker && "aya-end-token",
        ]
          .filter(Boolean)
          .join(" ")}
        data-quran-token={measure ? token.index : undefined}
      >
        {`${token.leading}${token.text}${token.trailing}`}
        {token.trailingSigns?.map((sign, index) => (
          <span
            className={sign.className}
            key={`token-sign-${token.index}-${index}`}
          >
            {sign.text}
          </span>
        ))}
        {token.endingMarker && (
          <span className="ayaNumber" aria-hidden="true">
            {" "}
            {token.endingMarker}
          </span>
        )}
        {token.endingSpace && " "}
      </span>
      {token.endingMarker && <wbr />}
    </Fragment>
  );
}

function renderSuraHeading(item) {
  return (
    <div key={item.key} className="sura-heading-frame" lang="ar" dir="rtl">
      <span>{item.title}</span>
    </div>
  );
}

function measureTokenLines(node, tokens) {
  if (!node) {
    return [];
  }

  const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
  const threshold = Number.isFinite(lineHeight) ? lineHeight / 2 : 12;
  const lineMap = [];
  let line = -1;
  let lineTop = null;
  const tokenNodes = new Map(
    Array.from(node.querySelectorAll("[data-quran-token]"), (tokenNode) => [
      Number(tokenNode.dataset.quranToken),
      tokenNode,
    ]),
  );

  for (const token of tokens) {
    const tokenNode = tokenNodes.get(token.index);
    const textNode = tokenNode?.firstChild;
    if (!textNode || !token.text.length) {
      continue;
    }
    const range = document.createRange();
    range.setStart(textNode, token.leading.length);
    range.setEnd(textNode, token.leading.length + token.text.length);
    const top = range.getBoundingClientRect().top;

    if (lineTop === null || top - lineTop > threshold) {
      line += 1;
      lineTop = top;
    }
    lineMap[token.index] = line;
  }

  return lineMap;
}

const FIXED_ARABIC_LINE_COUNT = 15;
const OPENING_PAGE_ARABIC_LINE_COUNT = 5;
const TATWEEL_JOINING_LETTERS = new Set(
  "\u0628\u062a\u062b\u062c\u062d\u062e\u0633\u0634\u0635\u0636\u0637\u0638\u0639\u063a\u0641\u0642\u0643\u0644\u0645\u0646\u0647\u064a\u0626",
);
const PERSIAN_TATWEEL_JOINING_LETTERS = new Set([
  ...TATWEEL_JOINING_LETTERS,
  "\u067e",
  "\u0686",
  "\u0698",
  "\u06a9",
  "\u06af",
  "\u06cc",
]);

function measureTokenWidths(node, tokens) {
  if (!node) {
    return { widths: [], contentWidth: 0, tatweelWidth: 0 };
  }

  const tokenNodes = new Map(
    Array.from(node.querySelectorAll("[data-quran-token]"), (tokenNode) => [
      Number(tokenNode.dataset.quranToken),
      tokenNode,
    ]),
  );
  const widths = [];
  for (const token of tokens) {
    const tokenNode = tokenNodes.get(token.index);
    if (tokenNode) {
      widths[token.index] = tokenNode.getBoundingClientRect().width;
    }
  }

  const style = getComputedStyle(node);
  const contentWidth =
    node.clientWidth -
    Number.parseFloat(style.paddingLeft) -
    Number.parseFloat(style.paddingRight);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (context) {
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  }
  const measuredTatweelWidth = context?.measureText("\u0640").width || 0;
  const fontSize = Number.parseFloat(style.fontSize);

  return {
    widths,
    contentWidth,
    tatweelWidth: measuredTatweelWidth || fontSize * 0.4,
  };
}

function tokenWidth(token, widths) {
  const measuredWidth = widths[token.index];
  return Number.isFinite(measuredWidth) && measuredWidth > 0
    ? measuredWidth
    : Math.max(Array.from(token.text).length, 1);
}

function splitTokensIntoLines(
  tokens,
  lineCount,
  widths,
  preferAyaBoundaries = false,
  maximumLineWidth = Number.POSITIVE_INFINITY,
  preferredAyaEndNumbers = [],
) {
  if (lineCount < 1 || tokens.length < lineCount) {
    return null;
  }

  const prefixWidths = [0];
  for (const token of tokens) {
    prefixWidths.push(
      prefixWidths[prefixWidths.length - 1] + tokenWidth(token, widths),
    );
  }

  const partitions = Array.from({ length: lineCount + 1 }, () =>
    Array(tokens.length + 1).fill(-1),
  );
  let previousWidths = Array(tokens.length + 1).fill(Number.POSITIVE_INFINITY);
  let previousAyaSplits = Array(tokens.length + 1).fill(
    Number.POSITIVE_INFINITY,
  );
  let previousAyaAlignmentMisses = Array(tokens.length + 1).fill(
    Number.POSITIVE_INFINITY,
  );
  previousWidths[0] = 0;
  previousAyaSplits[0] = 0;
  previousAyaAlignmentMisses[0] = 0;
  for (let linesUsed = 1; linesUsed <= lineCount; linesUsed += 1) {
    const currentWidths = Array(tokens.length + 1).fill(
      Number.POSITIVE_INFINITY,
    );
    const currentAyaSplits = Array(tokens.length + 1).fill(
      Number.POSITIVE_INFINITY,
    );
    const currentAyaAlignmentMisses = Array(tokens.length + 1).fill(
      Number.POSITIVE_INFINITY,
    );
    const lastEnd = tokens.length - (lineCount - linesUsed);
    for (let end = linesUsed; end <= lastEnd; end += 1) {
      for (let start = linesUsed - 1; start < end; start += 1) {
        if (!Number.isFinite(previousWidths[start])) {
          continue;
        }
        const lineWidth = prefixWidths[end] - prefixWidths[start];
        if (lineWidth > maximumLineWidth) {
          continue;
        }
        const maximumWidth = Math.max(previousWidths[start], lineWidth);
        const splitsAya =
          preferAyaBoundaries &&
          start > 0 &&
          tokens[start - 1].verse === tokens[start].verse;
        const ayaSplits = previousAyaSplits[start] + Number(splitsAya);
        const preferredAyaEnd = preferredAyaEndNumbers[linesUsed - 1];
        const matchesPreferredAyaEnd =
          preferredAyaEnd != null &&
          tokens[end - 1].className === "translation-aya-number" &&
          tokens[end - 1].verse.aya === preferredAyaEnd;
        const ayaAlignmentMisses =
          previousAyaAlignmentMisses[start] +
          Number(preferredAyaEnd != null && !matchesPreferredAyaEnd);
        if (
          (preferAyaBoundaries &&
            (ayaAlignmentMisses < currentAyaAlignmentMisses[end] ||
              (ayaAlignmentMisses === currentAyaAlignmentMisses[end] &&
                (ayaSplits < currentAyaSplits[end] ||
                  (ayaSplits === currentAyaSplits[end] &&
                    maximumWidth < currentWidths[end] - 0.1))))) ||
          (!preferAyaBoundaries && maximumWidth < currentWidths[end] - 0.1)
        ) {
          currentWidths[end] = maximumWidth;
          currentAyaSplits[end] = ayaSplits;
          currentAyaAlignmentMisses[end] = ayaAlignmentMisses;
          partitions[linesUsed][end] = start;
        }
      }
    }
    previousWidths = currentWidths;
    previousAyaSplits = currentAyaSplits;
    previousAyaAlignmentMisses = currentAyaAlignmentMisses;
  }

  const lines = Array(lineCount);
  let end = tokens.length;
  for (let linesUsed = lineCount; linesUsed > 0; linesUsed -= 1) {
    const start = partitions[linesUsed][end];
    if (start < 0) {
      return null;
    }
    lines[linesUsed - 1] = tokens.slice(start, end);
    end = start;
  }
  return lines;
}

function buildFixedArabicLineMap(
  items,
  widths,
  contentWidth,
  lineCount,
  pageNumber,
) {
  const segments = [];
  let currentTokens = [];
  let currentKind = "text";
  const flushTokens = () => {
    if (currentTokens.length) {
      segments.push({ kind: currentKind, tokens: currentTokens });
      currentTokens = [];
      currentKind = "text";
    }
  };

  for (const item of items) {
    if (item.kind === "heading") {
      flushTokens();
      if (pageNumber > 2) {
        segments.push({ kind: "heading", item });
      }
    } else if (item.kind === "basmala") {
      flushTokens();
      segments.push({ kind: "basmala", tokens: item.tokens });
    } else if (
      pageNumber === 1 &&
      item.token.verse.sura === 1 &&
      item.token.verse.aya === 1
    ) {
      if (currentKind !== "basmala-verse") {
        flushTokens();
        currentKind = "basmala-verse";
      }
      currentTokens.push(item.token);
      if (item.token.endingMarker || item.token.isAyaNumber) {
        flushTokens();
      }
    } else {
      if (currentKind === "basmala-verse") {
        flushTokens();
      }
      currentTokens.push(item.token);
    }
  }
  flushTokens();

  const reservedLineCount = segments.filter(
    (segment) =>
      segment.kind === "heading" ||
      segment.kind === "basmala" ||
      segment.kind === "basmala-verse",
  ).length;
  const textSegments = segments.filter((segment) => segment.kind === "text");
  const availableTextLines = lineCount - reservedLineCount;
  if (
    availableTextLines < textSegments.length ||
    (textSegments.length === 0 && availableTextLines > 0)
  ) {
    return null;
  }

  const textWidth = textSegments.reduce(
    (total, segment) =>
      total +
      segment.tokens.reduce(
        (width, token) => width + tokenWidth(token, widths),
        0,
      ),
    0,
  );
  if (contentWidth <= 0 || textWidth > contentWidth * availableTextLines) {
    return null;
  }

  const lineCounts = segments.map((segment) =>
    segment.kind === "text" ? 1 : 0,
  );
  let remainingLines =
    availableTextLines - lineCounts.reduce((total, count) => total + count, 0);
  while (remainingLines > 0) {
    let bestIndex = -1;
    let bestWidthPerLine = -1;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (
        segment.kind !== "text" ||
        lineCounts[index] >= segment.tokens.length
      ) {
        continue;
      }
      const segmentWidth = segment.tokens.reduce(
        (width, token) => width + tokenWidth(token, widths),
        0,
      );
      const widthPerLine = segmentWidth / lineCounts[index];
      if (widthPerLine > bestWidthPerLine) {
        bestIndex = index;
        bestWidthPerLine = widthPerLine;
      }
    }
    if (bestIndex < 0) {
      return null;
    }
    lineCounts[bestIndex] += 1;
    remainingLines -= 1;
  }

  const lineMap = [];
  let lineIndex = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.kind === "heading") {
      lineIndex += 1;
      continue;
    }
    if (segment.kind !== "text") {
      for (const token of segment.tokens) {
        lineMap[token.index] = lineIndex;
      }
      lineIndex += 1;
      continue;
    }

    const lines = splitTokensIntoLines(
      segment.tokens,
      lineCounts[index],
      widths,
    );
    if (!lines) {
      return null;
    }
    for (const line of lines) {
      const lineWidth = line.reduce(
        (width, token) => width + tokenWidth(token, widths),
        0,
      );
      if (lineWidth > contentWidth + 0.5) {
        return null;
      }
      for (const token of line) {
        lineMap[token.index] = lineIndex;
      }
      lineIndex += 1;
    }
  }

  return lineIndex === lineCount ? lineMap : null;
}

function tatweelInsertionPoints(
  text,
  joiningLetters = TATWEEL_JOINING_LETTERS,
) {
  const characters = Array.from(text);
  const points = [];
  for (let index = 0; index < characters.length; index += 1) {
    if (!joiningLetters.has(characters[index])) {
      continue;
    }
    let nextIndex = index + 1;
    while (
      nextIndex < characters.length &&
      /\p{M}/u.test(characters[nextIndex])
    ) {
      nextIndex += 1;
    }
    const marks = characters.slice(index + 1, nextIndex);
    const hasKasraSmallYeh =
      marks.includes("\u0650") &&
      (marks.includes("\u06e6") || characters[nextIndex] === "\u06e6");
    if (
      characters[index] === "\u0647" &&
      (marks.includes("\u064f") || hasKasraSmallYeh)
    ) {
      continue;
    }
    if (
      nextIndex < characters.length &&
      /\p{Script=Arabic}/u.test(characters[nextIndex])
    ) {
      points.push(nextIndex);
    }
  }
  return points;
}

function insertTatweel(text, insertions) {
  const characters = Array.from(text);
  let output = "";
  for (let index = 0; index <= characters.length; index += 1) {
    output += "\u0640".repeat(insertions.get(index) || 0);
    if (index < characters.length) {
      output += characters[index];
    }
  }
  return output;
}

function addLineTatweel(
  tokens,
  widths,
  contentWidth,
  tatweelWidth,
  joiningLetters = TATWEEL_JOINING_LETTERS,
  fillRatio = 0.75,
  minimumWordCount = 2,
  maximumInsertionsPerPoint = 2,
) {
  const wordCount = tokens.filter((token) =>
    /\p{Script=Arabic}/u.test(token.text),
  ).length;
  if (wordCount < minimumWordCount || tatweelWidth <= 0) {
    return tokens;
  }

  const naturalWidth = tokens.reduce(
    (width, token) => width + tokenWidth(token, widths),
    0,
  );
  const gap = contentWidth - naturalWidth;
  if (gap < tatweelWidth * 2) {
    return tokens;
  }

  const candidates = tokens.flatMap((token) =>
    tatweelInsertionPoints(token.text, joiningLetters).map((position) => ({
      tokenIndex: token.index,
      position,
    })),
  );
  if (!candidates.length) {
    return tokens;
  }

  const insertionCount = Math.min(
    candidates.length * maximumInsertionsPerPoint,
    Math.floor((gap * fillRatio) / tatweelWidth),
  );
  const insertionsByToken = new Map();
  for (let index = 0; index < insertionCount; index += 1) {
    const candidate = candidates[index % candidates.length];
    let insertions = insertionsByToken.get(candidate.tokenIndex);
    if (!insertions) {
      insertions = new Map();
      insertionsByToken.set(candidate.tokenIndex, insertions);
    }
    insertions.set(
      candidate.position,
      (insertions.get(candidate.position) || 0) + 1,
    );
  }

  return tokens.map((token) => {
    const insertions = insertionsByToken.get(token.index);
    return insertions
      ? { ...token, text: insertTatweel(token.text, insertions) }
      : token;
  });
}

function addPersianLineTatweel(tokens, widths, contentWidth, tatweelWidth) {
  return addLineTatweel(
    tokens,
    widths,
    contentWidth,
    tatweelWidth,
    PERSIAN_TATWEEL_JOINING_LETTERS,
    0.9,
    1,
    6,
  );
}

function QuranLines({
  verses,
  suras,
  showTranslation,
  showSigns,
  juzStarts,
  fontScale,
  pageNumber,
  location,
  playingTranslation,
  navigate,
  navigateOnKeyDown,
}) {
  const arabicMeasureRef = useRef(null);
  const translationMeasureRef = useRef(null);
  const [lineMaps, setLineMaps] = useState(null);
  const streams = useMemo(
    () => buildQuranStreams(verses, suras, showSigns, juzStarts),
    [verses, suras, showSigns, juzStarts],
  );
  const translationTokensBySura = useMemo(() => {
    const groups = new Map();
    for (const token of streams.translationTokens) {
      const tokens = groups.get(token.verse.sura) || [];
      tokens.push(token);
      groups.set(token.verse.sura, tokens);
    }
    return groups;
  }, [streams.translationTokens]);
  const fontStyle = { "--arabic-scale": fontScale };
  const [hoveredVerse, setHoveredVerse] = useState(null);
  const [isDesktopViewport, setIsDesktopViewport] = useState(
    () => window.innerWidth > 820,
  );

  useEffect(() => {
    const updateViewport = () => setIsDesktopViewport(window.innerWidth > 820);
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useLayoutEffect(() => {
    let active = true;
    const measureLines = () => {
      if (!active) {
        return;
      }
      const fixedDesktopPage = isDesktopViewport && pageNumber >= 1;
      const fixedArabicLineCount =
        pageNumber > 2
          ? FIXED_ARABIC_LINE_COUNT
          : OPENING_PAGE_ARABIC_LINE_COUNT;
      const arabicMeasurements = fixedDesktopPage
        ? measureTokenWidths(arabicMeasureRef.current, streams.arabicTokens)
        : null;
      const translationMeasurements = showTranslation
        ? measureTokenWidths(
            translationMeasureRef.current,
            streams.translationTokens,
          )
        : null;
      const fixedArabicLineMap = arabicMeasurements
        ? buildFixedArabicLineMap(
            streams.arabicItems,
            arabicMeasurements.widths,
            arabicMeasurements.contentWidth,
            fixedArabicLineCount,
            pageNumber,
          )
        : null;
      const nextLineMaps = {
        arabic:
          fixedArabicLineMap ||
          measureTokenLines(arabicMeasureRef.current, streams.arabicTokens),
        translation: showTranslation
          ? measureTokenLines(
              translationMeasureRef.current,
              streams.translationTokens,
            )
          : [],
        fixedArabic: Boolean(fixedArabicLineMap),
        arabicTokenWidths: arabicMeasurements?.widths || [],
        arabicContentWidth: arabicMeasurements?.contentWidth || 0,
        arabicTatweelWidth: arabicMeasurements?.tatweelWidth || 0,
        translationTokenWidths: translationMeasurements?.widths || [],
        translationContentWidth: translationMeasurements?.contentWidth || 0,
        translationTatweelWidth: translationMeasurements?.tatweelWidth || 0,
      };

      setLineMaps((current) => {
        const sameMap = (left, right) =>
          left.length === right.length &&
          left.every((value, index) => value === right[index]);
        const sameWidths = (left, right) =>
          left.length === right.length &&
          left.every((value, index) => Math.abs(value - right[index]) < 0.1);
        if (
          current &&
          sameMap(current.arabic, nextLineMaps.arabic) &&
          sameMap(current.translation, nextLineMaps.translation) &&
          current.fixedArabic === nextLineMaps.fixedArabic &&
          sameWidths(
            current.arabicTokenWidths,
            nextLineMaps.arabicTokenWidths,
          ) &&
          sameWidths(
            current.translationTokenWidths,
            nextLineMaps.translationTokenWidths,
          ) &&
          Math.abs(
            current.arabicContentWidth - nextLineMaps.arabicContentWidth,
          ) < 0.1 &&
          Math.abs(
            current.arabicTatweelWidth - nextLineMaps.arabicTatweelWidth,
          ) < 0.1 &&
          Math.abs(
            current.translationContentWidth -
              nextLineMaps.translationContentWidth,
          ) < 0.1 &&
          Math.abs(
            current.translationTatweelWidth -
              nextLineMaps.translationTatweelWidth,
          ) < 0.1
        ) {
          return current;
        }
        return nextLineMaps;
      });
    };

    measureLines();
    const observer = new ResizeObserver(measureLines);
    const observedNodes = [
      arabicMeasureRef.current,
      showTranslation ? translationMeasureRef.current : null,
    ];
    for (const node of observedNodes) {
      if (node) {
        observer.observe(node);
      }
    }
    window.addEventListener("resize", measureLines);
    document.fonts?.ready.then(() => {
      if (active) {
        measureLines();
      }
    });
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener("resize", measureLines);
    };
  }, [streams, showTranslation, fontScale, pageNumber, isDesktopViewport]);

  const seenVerses = new Set();
  const renderAyaFragment = (tokens, key) => {
    const verse = tokens[0].verse;
    const verseKey = `${verse.sura}:${verse.aya}`;
    const isFirstFragment = !seenVerses.has(verseKey);
    seenVerses.add(verseKey);
    const active = verse.sura === location.sura && verse.aya === location.aya;
    const hovered = hoveredVerse === verseKey;

    return (
      <span
        key={key}
        className={`aya ${active ? "aya-selected" : ""} ${
          hovered ? "aya-hovered" : ""
        }`}
        id={isFirstFragment ? `verse-${verse.sura}-${verse.aya}` : undefined}
        lang="ar"
        dir="rtl"
        role={isFirstFragment ? "button" : undefined}
        tabIndex={isFirstFragment ? 0 : undefined}
        onClick={() => navigate(verse.sura, verse.aya)}
        onKeyDown={
          isFirstFragment
            ? (event) => navigateOnKeyDown(event, verse.sura, verse.aya)
            : undefined
        }
        onMouseEnter={() => setHoveredVerse(verseKey)}
        onMouseLeave={() =>
          setHoveredVerse((current) => (current === verseKey ? null : current))
        }
        onFocus={() => setHoveredVerse(verseKey)}
        onBlur={() =>
          setHoveredVerse((current) => (current === verseKey ? null : current))
        }
      >
        {tokens.map((token) => renderToken(token))}
      </span>
    );
  };

  const renderContinuousArabic = () => {
    const output = [];
    for (let index = 0; index < streams.arabicItems.length; ) {
      const item = streams.arabicItems[index];
      if (item.kind === "heading") {
        output.push(renderSuraHeading(item));
        index += 1;
      } else if (item.kind === "basmala") {
        output.push(
          <div className="basmala-row" key={item.key}>
            <span className="basmala" lang="ar" dir="rtl">
              {item.tokens.map((token) => renderToken(token))}
            </span>
          </div>,
        );
        index += 1;
      } else if (
        pageNumber === 1 &&
        item.token.verse.sura === 1 &&
        item.token.verse.aya === 1
      ) {
        const tokens = [];
        while (
          index < streams.arabicItems.length &&
          streams.arabicItems[index].kind === "token" &&
          streams.arabicItems[index].token.verse === item.token.verse
        ) {
          tokens.push(streams.arabicItems[index].token);
          index += 1;
        }
        output.push(
          <div className="basmala-row" key="basmala-verse-1">
            <span className="basmala" lang="ar" dir="rtl">
              {renderAyaFragment(tokens, "basmala-verse-1")}
            </span>
          </div>,
        );
      } else {
        const tokens = [];
        while (
          index < streams.arabicItems.length &&
          streams.arabicItems[index].kind === "token" &&
          streams.arabicItems[index].token.verse === item.token.verse
        ) {
          tokens.push(streams.arabicItems[index].token);
          index += 1;
        }
        output.push(
          renderAyaFragment(
            tokens,
            `aya-${item.token.verse.sura}:${item.token.verse.aya}`,
          ),
        );
      }
    }
    return output;
  };

  const isFixedDesktopPage = isDesktopViewport && pageNumber >= 1;
  if (!showTranslation && !isFixedDesktopPage) {
    return (
      <div className="quran-text" style={fontStyle}>
        {renderContinuousArabic()}
      </div>
    );
  }

  let pendingHeadings = [];
  let currentArabicLine = null;
  const arabicLines = [];
  const headingsByLine = [];
  const addArabicLine = (tokens, kind = "arabic") => {
    const lineIndex = arabicLines.length;
    headingsByLine[lineIndex] = pendingHeadings;
    pendingHeadings = [];
    arabicLines.push({ kind, tokens });
  };
  const flushArabicLine = () => {
    if (currentArabicLine) {
      addArabicLine(currentArabicLine.tokens, currentArabicLine.kind);
      currentArabicLine = null;
    }
  };

  for (const item of streams.arabicItems) {
    if (item.kind === "heading") {
      flushArabicLine();
      if (lineMaps?.fixedArabic && pageNumber > 2) {
        addArabicLine([item], "heading");
      } else {
        pendingHeadings.push(item);
      }
    } else if (item.kind === "basmala") {
      flushArabicLine();
      addArabicLine(item.tokens, "basmala");
    } else if (
      pageNumber === 1 &&
      item.token.verse.sura === 1 &&
      item.token.verse.aya === 1
    ) {
      if (currentArabicLine && currentArabicLine.kind !== "basmala-verse") {
        flushArabicLine();
      }
      if (!currentArabicLine) {
        currentArabicLine = {
          line: "basmala-verse",
          tokens: [],
          kind: "basmala-verse",
        };
      }
      currentArabicLine.tokens.push(item.token);
      if (item.token.endingMarker || item.token.isAyaNumber) {
        flushArabicLine();
      }
    } else {
      const line = lineMaps?.arabic[item.token.index] ?? 0;
      if (currentArabicLine && currentArabicLine.line !== line) {
        flushArabicLine();
      }
      if (!currentArabicLine) {
        currentArabicLine = {
          line,
          tokens: [],
          kind: "arabic",
        };
      }
      currentArabicLine.tokens.push(item.token);
    }
  }
  flushArabicLine();
  if (pendingHeadings.length) {
    headingsByLine[arabicLines.length] = pendingHeadings;
  }

  const arabicTextLineCountsBySura = new Map();
  const arabicAyaLineEndsBySura = new Map();
  for (const line of arabicLines) {
    if (line.kind !== "arabic") {
      continue;
    }
    const sura = line.tokens[0].verse.sura;
    arabicTextLineCountsBySura.set(
      sura,
      (arabicTextLineCountsBySura.get(sura) || 0) + 1,
    );
    let lastMarkedAya = null;
    for (let index = line.tokens.length - 1; index >= 0; index -= 1) {
      const token = line.tokens[index];
      if (token.endingMarker || token.isAyaNumber) {
        lastMarkedAya = token.verse.aya;
        break;
      }
    }
    const ayaLineEnds = arabicAyaLineEndsBySura.get(sura) || [];
    ayaLineEnds.push(lastMarkedAya);
    arabicAyaLineEndsBySura.set(sura, ayaLineEnds);
  }

  const translationLinesBySura = new Map();
  if (showTranslation) {
    for (const token of streams.translationTokens) {
      const line = lineMaps?.translation[token.index] ?? 0;
      let lines = translationLinesBySura.get(token.verse.sura);
      if (!lines) {
        lines = [];
        translationLinesBySura.set(token.verse.sura, lines);
      }
      let current = lines[lines.length - 1];
      if (!current || current.line !== line) {
        current = { line, tokens: [] };
        lines.push(current);
      }
      current.tokens.push(token);
    }

    for (const [sura, lines] of translationLinesBySura) {
      const arabicLineCount = arabicTextLineCountsBySura.get(sura) || 0;
      const tokens = translationTokensBySura.get(sura) || [];
      const measurementsAvailable =
        (lineMaps?.translationTokenWidths?.length || 0) >= tokens.length;
      const lastLineWidth = lines[lines.length - 1]?.tokens.reduce(
        (width, token) =>
          width + tokenWidth(token, lineMaps?.translationTokenWidths || []),
        0,
      );
      const shouldExtend =
        arabicLineCount > 0 &&
        lines.length <= arabicLineCount &&
        measurementsAvailable &&
        lineMaps.translationContentWidth > 0 &&
        lastLineWidth <
          lineMaps.translationContentWidth -
            lineMaps.translationTatweelWidth * 2;
      if (!shouldExtend) {
        continue;
      }

      if (tokens.length >= arabicLineCount && measurementsAvailable) {
        const hasReadableLines = (candidateLines) =>
          candidateLines?.every(
            (line) =>
              line.filter(
                (token) => token.className !== "translation-aya-number",
              ).length > 1,
          );
        const ayaAlignedLines = splitTokensIntoLines(
          tokens,
          arabicLineCount,
          lineMaps.translationTokenWidths,
          true,
          lineMaps.translationContentWidth + 0.5,
          arabicAyaLineEndsBySura.get(sura),
        );
        const widthBalancedLines =
          hasReadableLines(ayaAlignedLines) && ayaAlignedLines
            ? ayaAlignedLines
            : splitTokensIntoLines(
                tokens,
                arabicLineCount,
                lineMaps.translationTokenWidths,
                false,
                lineMaps.translationContentWidth + 0.5,
              );
        const balancedLines = hasReadableLines(widthBalancedLines)
          ? widthBalancedLines
          : null;
        if (balancedLines) {
          translationLinesBySura.set(
            sura,
            balancedLines.map((line, index) => ({
              line: index,
              tokens: line,
              addTatweel: true,
            })),
          );
          continue;
        }
      }

      translationLinesBySura.set(
        sura,
        lines.map((line) => ({ ...line, addTatweel: true })),
      );
    }
  }

  const renderTranslationLine = (line, index, sura, isLastLine) => {
    const verseGroups = [];
    const displayTokens = line.addTatweel
      ? addPersianLineTatweel(
          line.tokens,
          lineMaps.translationTokenWidths,
          lineMaps.translationContentWidth,
          lineMaps.translationTatweelWidth,
        )
      : line.tokens;
    for (const token of displayTokens) {
      const current = verseGroups[verseGroups.length - 1];
      if (
        !current ||
        current.verse.sura !== token.verse.sura ||
        current.verse.aya !== token.verse.aya
      ) {
        verseGroups.push({ verse: token.verse, tokens: [token] });
      } else {
        current.tokens.push(token);
      }
    }

    return (
      <div
        className={`translation-line ${
          line.addTatweel ? "translation-extended" : ""
        } ${isLastLine ? "last-in-stream" : ""}`}
        lang="fa"
        dir="rtl"
        key={`translation-line-${sura}-${index}`}
      >
        {verseGroups.map((group, groupIndex) => {
          const isPlaying =
            playingTranslation?.sura === group.verse.sura &&
            playingTranslation?.aya === group.verse.aya;
          return (
            <span
              className={isPlaying ? "translation-playing" : undefined}
              key={`translation-aya-${sura}-${index}-${groupIndex}`}
            >
              {group.tokens.map((token) => renderToken(token))}
            </span>
          );
        })}
      </div>
    );
  };

  const renderMeasuredArabicLine = (line, index, isLastLine) => {
    if (line.kind === "heading") {
      return renderSuraHeading(line.tokens[0]);
    }
    if (line.kind === "basmala") {
      return (
        <div className="arabic-line basmala-line" key={`arabic-line-${index}`}>
          <span className="basmala" lang="ar" dir="rtl">
            {line.tokens.map((token) => renderToken(token))}
          </span>
        </div>
      );
    }
    if (line.kind === "basmala-verse") {
      return (
        <div className="arabic-line basmala-line" key={`arabic-line-${index}`}>
          <span className="basmala" lang="ar" dir="rtl">
            {renderAyaFragment(
              line.tokens,
              `basmala-verse-${line.tokens[0].verse.sura}:${line.tokens[0].verse.aya}`,
            )}
          </span>
        </div>
      );
    }

    const displayTokens =
      lineMaps?.fixedArabic && line.kind === "arabic"
        ? addLineTatweel(
            line.tokens,
            lineMaps.arabicTokenWidths,
            lineMaps.arabicContentWidth,
            lineMaps.arabicTatweelWidth,
          )
        : line.tokens;
    const verseGroups = [];
    for (const token of displayTokens) {
      const current = verseGroups[verseGroups.length - 1];
      if (!current || current.verse !== token.verse) {
        verseGroups.push({ verse: token.verse, tokens: [token] });
      } else {
        current.tokens.push(token);
      }
    }
    return (
      <div
        className={`arabic-line ${
          lineMaps?.fixedArabic ? "fixed-justified" : ""
        } ${isLastLine ? "last-in-stream" : ""}`}
        key={`arabic-line-${index}`}
      >
        {verseGroups.map((verseGroup, verseIndex) =>
          renderAyaFragment(
            verseGroup.tokens,
            `line-${index}-aya-${verseGroup.verse.sura}:${verseGroup.verse.aya}-${verseIndex}`,
          ),
        )}
      </div>
    );
  };

  const renderBasmalaTranslation = (arabicLine) => {
    const basmalaTranslation = streams.basmalaTranslations.find(
      (verse) =>
        verse.sura === arabicLine.tokens[0].verse.sura &&
        verse.aya === arabicLine.tokens[0].verse.aya,
    );
    if (!showTranslation || !basmalaTranslation) {
      return null;
    }

    return (
      <div
        className="translation-basmala"
        lang="fa"
        dir="rtl"
        key={`translation-basmala-${basmalaTranslation.sura}:${basmalaTranslation.aya}`}
      >
        {basmalaTranslation.translation.trimEnd()}
        {arabicLine.kind === "basmala-verse" && (
          <span className="translation-aya-number">
            {"\u00a0"}
            {formatAyaNumber(basmalaTranslation.aya)}
          </span>
        )}
      </div>
    );
  };

  const output = [];
  const arabicSections = [];
  for (let index = 0; index < arabicLines.length; index += 1) {
    const line = arabicLines[index];
    const sura =
      line.kind === "heading" ? line.tokens[0].sura : line.tokens[0].verse.sura;
    let section = arabicSections[arabicSections.length - 1];
    if (!section || section.sura !== sura) {
      section = { sura, lineIndexes: [] };
      arabicSections.push(section);
    }
    section.lineIndexes.push(index);
  }

  for (const section of arabicSections) {
    const sectionTranslationLines =
      translationLinesBySura.get(section.sura) || [];
    let translationIndex = 0;
    for (const arabicIndex of section.lineIndexes) {
      headingsByLine[arabicIndex]?.forEach((heading) =>
        output.push(renderSuraHeading(heading)),
      );
      const arabicLine = arabicLines[arabicIndex];
      output.push(
        renderMeasuredArabicLine(
          arabicLine,
          arabicIndex,
          arabicIndex === arabicLines.length - 1,
        ),
      );

      if (
        arabicLine.kind === "basmala" ||
        arabicLine.kind === "basmala-verse"
      ) {
        const basmalaTranslation = renderBasmalaTranslation(arabicLine);
        if (basmalaTranslation) {
          output.push(basmalaTranslation);
        }
      } else if (
        arabicLine.kind !== "heading" &&
        translationIndex < sectionTranslationLines.length
      ) {
        output.push(
          renderTranslationLine(
            sectionTranslationLines[translationIndex],
            translationIndex,
            section.sura,
            translationIndex === sectionTranslationLines.length - 1,
          ),
        );
        translationIndex += 1;
      }
    }

    while (translationIndex < sectionTranslationLines.length) {
      output.push(
        renderTranslationLine(
          sectionTranslationLines[translationIndex],
          translationIndex,
          section.sura,
          translationIndex === sectionTranslationLines.length - 1,
        ),
      );
      translationIndex += 1;
    }
  }
  headingsByLine[arabicLines.length]?.forEach((heading) =>
    output.push(renderSuraHeading(heading)),
  );

  return (
    <>
      <div
        ref={arabicMeasureRef}
        className="quran-text quran-line-measure"
        style={fontStyle}
        aria-hidden="true"
      >
        {streams.arabicItems.map((item) => {
          if (item.kind === "heading") {
            return renderSuraHeading(item);
          }
          if (item.kind === "basmala") {
            return (
              <div className="basmala-row" key={item.key}>
                <span className="basmala" lang="ar" dir="rtl">
                  {item.tokens.map((token) => renderToken(token, true))}
                </span>
              </div>
            );
          }
          return renderToken(item.token, true);
        })}
      </div>
      <div
        ref={translationMeasureRef}
        className="quran-text quran-line-measure translation-stream-measure"
        aria-hidden="true"
      >
        {showTranslation &&
          Array.from(translationTokensBySura, ([sura, tokens]) => (
            <div className="translation-measure-sura" key={sura}>
              {tokens.map((token) => renderToken(token, true))}
            </div>
          ))}
      </div>
      <div className="quran-text" style={fontStyle}>
        {lineMaps && output}
      </div>
    </>
  );
}

async function requestJson(url, signal) {
  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "The request could not be completed.");
  }
  return body;
}

function SearchableSuraSelect({ suras, selectedSura, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const filteredSuras = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return suras.filter((sura) =>
      sura.name.toLowerCase().includes(normalizedQuery),
    );
  }, [query, suras]);

  useEffect(() => {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, [selectedSura?.number]);

  const selectSura = (sura) => {
    onChange(sura.number);
    setIsOpen(false);
    setQuery("");
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setQuery("");
        setActiveIndex(0);
      } else {
        setActiveIndex((index) =>
          Math.min(index + 1, filteredSuras.length - 1),
        );
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && isOpen) {
      event.preventDefault();
      if (filteredSuras[activeIndex]) {
        selectSura(filteredSuras[activeIndex]);
      }
    } else if (event.key === "Escape" && isOpen) {
      setIsOpen(false);
      setQuery("");
    }
  };

  return (
    <div className="sura-picker">
      <input
        id="sura-select"
        className="sura-search-input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls="sura-options"
        aria-activedescendant={
          isOpen && filteredSuras[activeIndex]
            ? `sura-option-${filteredSuras[activeIndex].number}`
            : undefined
        }
        placeholder={selectedSura?.name || "Search suras"}
        value={isOpen ? query : selectedSura?.name || ""}
        onFocus={() => {
          setIsOpen(true);
          setQuery("");
          setActiveIndex(0);
        }}
        onBlur={() => {
          setIsOpen(false);
          setQuery("");
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />
      {isOpen && (
        <div className="sura-options" id="sura-options" role="listbox">
          {filteredSuras.length ? (
            filteredSuras.map((sura, index) => (
              <div
                id={`sura-option-${sura.number}`}
                className={`sura-option${index === activeIndex ? " active" : ""}`}
                key={sura.number}
                role="option"
                aria-selected={sura.number === selectedSura?.number}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectSura(sura)}
              >
                {String(sura.number).padStart(3, "0")} · {sura.name}
              </div>
            ))
          ) : (
            <div className="sura-no-results" role="status">
              No suras found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function App() {
  const [location, setLocation] = useState(readHash);
  const [reader, setReader] = useState(null);
  const [suras, setSuras] = useState([]);
  const [juzStarts, setJuzStarts] = useState([]);
  const [hezbStarts, setHezbStarts] = useState([]);
  const [reciters, setReciters] = useState([]);
  const [edition, setEdition] = useState(EDITIONS[0][0]);
  const [reciter, setReciter] = useState("");
  const [showTranslation, setShowTranslation] = useState(true);
  const [showSigns, setShowSigns] = useState(true);
  const [playTranslation, setPlayTranslation] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [isPageInputFocused, setIsPageInputFocused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isPageNavigationLoading, setIsPageNavigationLoading] = useState(false);
  const [error, setError] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioTrack, setAudioTrack] = useState("recitation");
  const [basmalaPlayed, setBasmalaPlayed] = useState(false);
  const audioRef = useRef(null);
  const pageCacheRef = useRef(new Map());
  const pageRequestsRef = useRef(new Map());
  const activePageRef = useRef(null);
  const pageNavigationRequestRef = useRef(0);
  const pageNavigationLoadingRef = useRef(false);
  const pageNavigationLastStartedAtRef = useRef(0);
  const pageNavigationTargetRef = useRef(null);

  const activateReaderPage = useCallback((data, selectedEdition) => {
    const pageNumber = data.page.number;
    activePageRef.current = { edition: selectedEdition, pageNumber };

    for (const [key, cachedPage] of pageCacheRef.current) {
      if (
        cachedPage.edition !== selectedEdition ||
        Math.abs(cachedPage.page.number - pageNumber) > 1
      ) {
        pageCacheRef.current.delete(key);
      }
    }

    pageCacheRef.current.set(`${selectedEdition}:${pageNumber}`, data);
  }, []);

  const loadPageData = useCallback((pageNumber, selectedEdition) => {
    const key = `${selectedEdition}:${pageNumber}`;
    const cachedPage = pageCacheRef.current.get(key);
    if (cachedPage) {
      return Promise.resolve(cachedPage);
    }

    const existingRequest = pageRequestsRef.current.get(key);
    if (existingRequest) {
      return existingRequest;
    }

    const request = (async () => {
      const bounds = await requestJson(`/api/pages/${pageNumber}`);
      const data = await requestJson(
        `/api/reader?sura=${bounds.startSura}&aya=${bounds.startAya}&edition=${selectedEdition}`,
      );
      const readerData = { ...data, edition: selectedEdition };
      const activePage = activePageRef.current;
      if (
        !activePage ||
        (activePage.edition === selectedEdition &&
          Math.abs(activePage.pageNumber - pageNumber) <= 1)
      ) {
        pageCacheRef.current.set(key, readerData);
      }
      return readerData;
    })();

    pageRequestsRef.current.set(key, request);
    request.then(
      () => {
        if (pageRequestsRef.current.get(key) === request) {
          pageRequestsRef.current.delete(key);
        }
      },
      () => {
        if (pageRequestsRef.current.get(key) === request) {
          pageRequestsRef.current.delete(key);
        }
      },
    );
    return request;
  }, []);

  const currentSura = useMemo(
    () => suras.find((item) => item.number === location.sura),
    [suras, location.sura],
  );
  const currentJuz = useMemo(() => {
    let juz = "";
    for (const start of juzStarts) {
      if (
        location.sura < start.startSura ||
        (location.sura === start.startSura && location.aya < start.startAya)
      ) {
        break;
      }
      juz = start.number;
    }
    return juz;
  }, [juzStarts, location.sura, location.aya]);
  const currentHezbPortion = useMemo(() => {
    let portion = "";
    for (const start of hezbStarts) {
      if (
        location.sura < start.startSura ||
        (location.sura === start.startSura && location.aya < start.startAya)
      ) {
        break;
      }
      portion = start.number;
    }
    return portion;
  }, [hezbStarts, location.sura, location.aya]);
  const isBasmalaPrelude =
    audioTrack === "recitation" &&
    location.aya === 1 &&
    hasBasmalaAya(location.sura) &&
    !basmalaPlayed;
  const audioUrl = isBasmalaPrelude
    ? `/api/audio/1/1${reciter ? `?reciter=${encodeURIComponent(reciter)}` : ""}`
    : `/api/audio/${location.sura}/${location.aya}${reciter ? `?reciter=${encodeURIComponent(reciter)}` : ""}`;
  const translationAudioUrl = `/api/translation-audio/${location.sura}/${location.aya}`;
  const currentAudioUrl =
    audioTrack === "translation" ? translationAudioUrl : audioUrl;

  useEffect(() => {
    const player = audioRef.current;
    if (!isPlaying || !player || !player.paused) {
      return;
    }

    player.play().catch((playError) => {
      if (audioRef.current === player) {
        setIsPlaying(false);
        setError(`Audio could not be played: ${playError.message}`);
      }
    });
  }, [currentAudioUrl, isPlaying]);

  const navigate = useCallback((sura, aya, { replace = false } = {}) => {
    const targetAya = aya === 0 ? 1 : aya;
    const hash = `#${sura}:${targetAya}`;
    if (window.location.hash !== hash) {
      window.history[replace ? "replaceState" : "pushState"](null, "", hash);
    }
    setBasmalaPlayed(false);
    if (!replace) {
      setIsPlaying(false);
      setAudioTrack("recitation");
    }
    setLocation({ sura, aya: targetAya });
  }, []);

  useEffect(() => {
    const syncLocation = () => {
      const nextLocation = readHash();
      const hash = `#${nextLocation.sura}:${nextLocation.aya}`;
      if (window.location.hash !== hash) {
        window.history.replaceState(null, "", hash);
      }
      setBasmalaPlayed(false);
      setLocation(nextLocation);
    };
    syncLocation();
    const onHashChange = () => syncLocation();
    const onPopState = () => syncLocation();
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      requestJson("/api/suras", controller.signal),
      requestJson("/api/juz", controller.signal),
      requestJson("/api/hezb", controller.signal),
      requestJson("/api/reciters", controller.signal),
    ])
      .then(([chapterList, juzList, hezbList, reciterList]) => {
        setSuras(chapterList);
        setJuzStarts(juzList);
        setHezbStarts(hezbList);
        setReciters(reciterList);
        setReciter(reciterList[0]?.id || "");
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") {
          setError(requestError.message);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (location.sura < 1 || location.sura > 114 || location.aya < 1) {
      setError(
        "The address must use a valid sura and aya, for example #112:1.",
      );
      setLoading(false);
      return undefined;
    }

    const alreadyLoaded =
      reader?.edition === edition &&
      reader.verses.some(
        (verse) => verse.sura === location.sura && verse.aya === location.aya,
      );
    if (alreadyLoaded) {
      setLoading(false);
      return undefined;
    }

    const cachedPage = Array.from(pageCacheRef.current.values()).find(
      (pageData) =>
        pageData.edition === edition &&
        pageData.verses.some(
          (verse) => verse.sura === location.sura && verse.aya === location.aya,
        ),
    );
    if (cachedPage) {
      activateReaderPage(cachedPage, edition);
      setReader(cachedPage);
      setLoading(false);
      setError("");
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");
    requestJson(
      `/api/reader?sura=${location.sura}&aya=${location.aya}&edition=${edition}`,
      controller.signal,
    )
      .then((data) => {
        const readerData = { ...data, edition };
        activateReaderPage(readerData, edition);
        setReader(readerData);
        setLoading(false);
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") {
          setError(requestError.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [location.sura, location.aya, edition, reader, activateReaderPage]);

  useEffect(() => {
    if (!reader || reader.edition !== edition) {
      return;
    }

    for (const pageNumber of [reader.page.number - 1, reader.page.number + 1]) {
      if (pageNumber < 1 || pageNumber > 604) {
        continue;
      }
      loadPageData(pageNumber, edition).catch((requestError) => {
        setError(
          `Could not preload page ${pageNumber}: ${requestError.message}`,
        );
      });
    }
  }, [reader, edition, loadPageData]);

  useEffect(() => {
    if (
      isPageNavigationLoading &&
      reader?.page.number === pageNavigationTargetRef.current
    ) {
      pageNavigationLoadingRef.current = false;
      pageNavigationTargetRef.current = null;
      setIsPageNavigationLoading(false);
    }
  }, [reader, isPageNavigationLoading]);

  useEffect(() => {
    const activeVerse = document.getElementById(
      `verse-${location.sura}-${location.aya}`,
    );
    activeVerse?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [reader, location.sura, location.aya]);

  useEffect(() => {
    if (reader) {
      setPageInput(String(reader.page.number));
    }
  }, [reader]);

  const goToPage = async (pageNumber) => {
    const now = Date.now();
    if (
      pageNavigationLoadingRef.current ||
      now - pageNavigationLastStartedAtRef.current <
        PAGE_NAVIGATION_CLICK_COOLDOWN_MS
    ) {
      return;
    }

    pageNavigationLoadingRef.current = true;
    pageNavigationLastStartedAtRef.current = now;
    setIsPageNavigationLoading(true);
    const requestId = ++pageNavigationRequestRef.current;
    setError("");
    try {
      const pageData = await loadPageData(pageNumber, edition);
      if (requestId !== pageNavigationRequestRef.current) {
        return;
      }
      pageNavigationTargetRef.current = pageData.page.number;
      activateReaderPage(pageData, edition);
      setReader(pageData);
      setLoading(false);
      navigate(pageData.page.start.sura, pageData.page.start.aya);
    } catch (requestError) {
      if (requestId !== pageNavigationRequestRef.current) {
        return;
      }
      pageNavigationLoadingRef.current = false;
      pageNavigationLastStartedAtRef.current = 0;
      pageNavigationTargetRef.current = null;
      setIsPageNavigationLoading(false);
      setError(requestError.message);
      setLoading(false);
    }
  };

  const changePage = (offset) => {
    const pageNumber = reader?.page.number + offset;
    if (pageNumber >= 1 && pageNumber <= 604) {
      goToPage(pageNumber);
    }
  };

  const advancePlayback = () => {
    const lastAya = currentSura?.ayaCount;
    setAudioTrack("recitation");
    if (!lastAya) {
      setIsPlaying(false);
      return;
    }
    if (location.aya < lastAya) {
      navigate(location.sura, location.aya + 1, { replace: true });
    } else if (location.sura < 114) {
      const nextSura = location.sura + 1;
      navigate(nextSura, 1, { replace: true });
    } else {
      setIsPlaying(false);
    }
  };

  const handleAudioEnded = () => {
    if (isBasmalaPrelude) {
      setBasmalaPlayed(true);
      return;
    }

    if (audioTrack === "translation") {
      advancePlayback();
      return;
    }

    const currentVerse = reader?.verses.find(
      (verse) => verse.sura === location.sura && verse.aya === location.aya,
    );
    if (playTranslation && currentVerse?.translation) {
      setAudioTrack("translation");
      return;
    }
    advancePlayback();
  };

  const handleAudioPause = (event) => {
    if (!event.currentTarget.ended) {
      setIsPlaying(false);
    }
  };

  const changeJuz = (event) => {
    const juz = juzStarts.find(
      (item) => item.number === Number(event.target.value),
    );
    if (juz) {
      navigate(juz.startSura, juz.startAya);
    }
  };

  const changeHezbPortion = (event) => {
    const portion = hezbStarts.find(
      (item) => item.number === Number(event.target.value),
    );
    if (portion) {
      navigate(portion.startSura, portion.startAya);
    }
  };

  const submitLocation = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    navigate(Number(data.get("sura")), Number(data.get("aya")));
  };

  const navigateOnKeyDown = (event, sura, aya) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      navigate(sura, aya);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#1:1"
          aria-label="Quran Reader home"
          onClick={(event) => {
            event.preventDefault();
            navigate(1, 1);
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            ۞
          </span>
          <span>
            <strong>Quran Reader</strong>
            <small>Read · Listen · Reflect</small>
          </span>
        </a>
        <div className="topbar-meta">
          <span className="local-indicator">
            <i /> Local library
          </span>
          <span className="edition-label">604-page Madinah edition</span>
        </div>
      </header>

      <main className="workspace">
        <aside className="control-panel">
          <div className="panel-heading">
            <span className="eyebrow">READING POSITION</span>
            <span className="position-badge">
              {location.sura}:{location.aya}
            </span>
          </div>

          <label className="field-label" htmlFor="juz-select">
            Juz
          </label>
          <select id="juz-select" value={currentJuz} onChange={changeJuz}>
            {juzStarts.map((juz) => (
              <option key={juz.number} value={juz.number}>
                Juz {juz.number}
              </option>
            ))}
          </select>

          <div className="location-form">
            <label className="field-label" htmlFor="hezb-select">
              Hezb
            </label>
            <select
              id="hezb-select"
              value={currentHezbPortion}
              onChange={changeHezbPortion}
            >
              {hezbStarts.map((portion) => (
                <option key={portion.number} value={portion.number}>
                  {HEZB_PORTION_LABELS[portion.quarter].replaceAll(
                    "{{hezb}}",
                    portion.hizb,
                  )}
                </option>
              ))}
            </select>
          </div>

          <div className="location-form">
            <label className="field-label" htmlFor="sura-select">
              Sura
            </label>
            <SearchableSuraSelect
              suras={suras}
              selectedSura={currentSura}
              onChange={(sura) => navigate(sura, 1)}
            />
          </div>

          <form
            className="location-form"
            key={`${location.sura}:${location.aya}`}
            onSubmit={submitLocation}
          >
            <label className="field-label" htmlFor="sura-input">
              Go to aya
            </label>
            <div className="location-fields">
              <input
                id="sura-input"
                name="sura"
                type="number"
                min="1"
                max="114"
                defaultValue={location.sura}
                aria-label="Sura number"
              />
              <span>:</span>
              <input
                name="aya"
                type="number"
                min="1"
                max={currentSura?.ayaCount}
                defaultValue={location.aya}
                aria-label="Aya number"
              />
              <button className="go-button" type="submit">
                Go
              </button>
            </div>
          </form>

          <div className="control-divider" />
          <span className="eyebrow">TEXT & DISPLAY</span>
          <label className="field-label" htmlFor="edition-select">
            Arabic text
          </label>
          <select
            id="edition-select"
            value={edition}
            onChange={(event) => setEdition(event.target.value)}
          >
            {EDITIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="check-row">
            <input
              type="checkbox"
              checked={showSigns}
              onChange={(event) => setShowSigns(event.target.checked)}
            />
            <span>Show recitation signs</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={showTranslation}
              onChange={(event) => setShowTranslation(event.target.checked)}
            />
            <span>Fooladvand Persian translation</span>
          </label>
          <label className="check-row translation-audio-toggle">
            <input
              type="checkbox"
              checked={playTranslation}
              onChange={(event) => {
                const enabled = event.target.checked;
                setPlayTranslation(enabled);
                if (!enabled && audioTrack === "translation") {
                  setAudioTrack("recitation");
                }
              }}
            />
            <span>Play Persian translation audio after each aya</span>
          </label>

          <div className="font-size-control">
            <span className="field-label">Text size</span>
            <div>
              <button
                type="button"
                aria-label="Decrease text size"
                onClick={() =>
                  setFontScale((size) => Math.max(0.8, size - 0.1))
                }
              >
                −
              </button>
              <span>{Math.round(fontScale * 100)}%</span>
              <button
                type="button"
                aria-label="Increase text size"
                onClick={() =>
                  setFontScale((size) => Math.min(1.5, size + 0.1))
                }
              >
                +
              </button>
            </div>
          </div>

          <div className="control-divider" />
          <span className="eyebrow">RECITATION</span>
          <label className="field-label" htmlFor="reciter-select">
            Reciter
          </label>
          <select
            id="reciter-select"
            value={reciter}
            onChange={(event) => setReciter(event.target.value)}
          >
            {reciters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <p className="panel-note">
            Audio is served from the files in your local data folder.
          </p>
        </aside>

        <section className="reader-column" aria-label="Quran text">
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {loading && (
            <div className="loading-state">Loading local Quran text…</div>
          )}
          {!loading && reader && (
            <div className="quran-page">
              <div className="quran-page-header">
                <div className="quran-sura-name" dir="rtl">
                  <strong>
                    {currentSura
                      ? `سورة ${currentSura.arabicName}`
                      : `سورة ${arabicNumber(location.sura)}`}
                    {currentSura?.revelationType &&
                      ` (${currentSura.revelationType == "Meccan" ? "مكية" : "مدنية"}`}
                    )
                  </strong>
                </div>
                <div className="quran-page-navigation" dir="ltr">
                  <button
                    type="button"
                    onClick={() => changePage(1)}
                    disabled={
                      isPageNavigationLoading || reader.page.number === 604
                    }
                    aria-label="Next page"
                  >
                    ◄
                  </button>
                  <label>
                    <span className="visually-hidden">Page number</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={
                        isPageInputFocused
                          ? pageInput
                          : arabicNumber(normalizeArabicDigits(pageInput))
                      }
                      disabled={isPageNavigationLoading}
                      onFocus={() => setIsPageInputFocused(true)}
                      onChange={(event) => setPageInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                      onBlur={() => {
                        setIsPageInputFocused(false);
                        const normalizedPageInput =
                          normalizeArabicDigits(pageInput);
                        const pageNumber = Number(normalizedPageInput);
                        if (
                          normalizedPageInput &&
                          Number.isInteger(pageNumber) &&
                          pageNumber >= 1 &&
                          pageNumber <= 604 &&
                          pageNumber !== reader.page.number
                        ) {
                          setPageInput(String(pageNumber));
                          goToPage(pageNumber);
                        } else {
                          setPageInput(String(reader.page.number));
                        }
                      }}
                      aria-label="Page number"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => changePage(-1)}
                    disabled={
                      isPageNavigationLoading || reader.page.number === 1
                    }
                    aria-label="Previous page"
                  >
                    ►
                  </button>
                </div>
                <div className="quran-juz-name" dir="rtl">
                  <strong>
                    جزء {arabicNumberName(reader.current.juz)}
                    &nbsp;({arabicNumber(reader.current.juz)})
                  </strong>
                </div>
              </div>
              <div
                className={`page-navigation-progress${
                  isPageNavigationLoading ? " is-loading" : ""
                }`}
                role="progressbar"
                aria-label="Loading page"
                aria-hidden={!isPageNavigationLoading}
              />

              <div className="quran-frame quran-frame-top" aria-hidden="true" />
              <div className="quran-frame quran-frame-middle">
                <QuranLines
                  verses={reader.verses}
                  suras={suras}
                  showTranslation={showTranslation}
                  showSigns={showSigns}
                  juzStarts={juzStarts}
                  fontScale={fontScale}
                  pageNumber={reader.page.number}
                  location={location}
                  playingTranslation={
                    audioTrack === "translation" && isPlaying ? location : null
                  }
                  navigate={navigate}
                  navigateOnKeyDown={navigateOnKeyDown}
                />
              </div>
              <div
                className="quran-frame quran-frame-bottom"
                aria-hidden="true"
              />
              <div className="quran-page-footer" dir="ltr">
                <button
                  type="button"
                  onClick={() => changePage(1)}
                  disabled={
                    isPageNavigationLoading || reader.page.number === 604
                  }
                  aria-label="Next page"
                >
                  ◄
                </button>
                <span>{arabicNumber(reader.page.number)}</span>
                <button
                  type="button"
                  onClick={() => changePage(-1)}
                  disabled={isPageNavigationLoading || reader.page.number === 1}
                  aria-label="Previous page"
                >
                  ►
                </button>
              </div>
            </div>
          )}

          <div className="audio-player">
            <div className="audio-copy">
              <span className="audio-icon" aria-hidden="true">
                ♫
              </span>
              <span>
                <strong>
                  {audioTrack === "translation"
                    ? "Playing translation"
                    : "Listen to this aya"}
                </strong>
                <small>
                  {location.sura}:{location.aya} ·{" "}
                  {audioTrack === "translation"
                    ? "Fooladvand Persian"
                    : reciters.find((item) => item.id === reciter)?.name ||
                      "Local recitation"}
                </small>
              </span>
            </div>
            <audio
              key={currentAudioUrl}
              ref={audioRef}
              controls
              preload="none"
              src={currentAudioUrl}
              onPlay={() => setIsPlaying(true)}
              onPause={handleAudioPause}
              onEnded={handleAudioEnded}
              onError={() => {
                setIsPlaying(false);
                setError(
                  audioTrack === "translation"
                    ? "Translation audio is not available for this aya."
                    : "This aya audio file is not available in the selected local recitation.",
                );
              }}
            >
              Your browser does not support audio playback.
            </audio>
          </div>
          <footer className="reader-footer">
            Text and audio are loaded from your local Quran database and data
            files.
          </footer>
        </section>
      </main>
    </div>
  );
}

export default App;
