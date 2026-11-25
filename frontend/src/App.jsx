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

function hasBasmalaAya(sura) {
  return sura !== 1 && sura !== 9;
}

function arabicNumber(value) {
  return String(value).replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[digit]);
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
      tokens.push({
        leading: pendingWhitespace,
        text: part.text,
        className: part.className,
        trailing: "",
      });
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
        className={[token.className, token.endingMarker && "aya-end-token"]
          .filter(Boolean)
          .join(" ")}
        data-quran-token={measure ? token.index : undefined}
      >
        {`${token.leading}${token.text}${token.trailing}`}
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

function measureArabicTokenWidths(node, tokens) {
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

function splitTokensIntoLines(tokens, lineCount, widths) {
  if (lineCount < 1 || tokens.length < lineCount) {
    return null;
  }

  const lines = Array.from({ length: lineCount }, () => []);
  let totalWidth = tokens.reduce(
    (width, token) => width + tokenWidth(token, widths),
    0,
  );
  let lineIndex = 0;
  let lineWidth = 0;
  let lineTarget = totalWidth / lineCount;

  for (let index = 0; index < tokens.length; index += 1) {
    const linesRemaining = lineCount - lineIndex;
    const tokensRemaining = tokens.length - index;
    const width = tokenWidth(tokens[index], widths);
    if (
      lineIndex < lineCount - 1 &&
      lines[lineIndex].length > 0 &&
      (lineWidth + width > lineTarget || tokensRemaining === linesRemaining)
    ) {
      lineIndex += 1;
      lineWidth = 0;
      lineTarget = totalWidth / (lineCount - lineIndex);
    }

    lines[lineIndex].push(tokens[index]);
    lineWidth += width;
    totalWidth -= width;
  }

  return lines.every((line) => line.length > 0) ? lines : null;
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
      segment.kind === "basmala" || segment.kind === "basmala-verse",
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
    availableTextLines -
    lineCounts.reduce((total, count) => total + count, 0);
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
      for (const token of line) {
        lineMap[token.index] = lineIndex;
      }
      lineIndex += 1;
    }
  }

  return lineIndex === lineCount ? lineMap : null;
}

function tatweelInsertionPoints(text) {
  const characters = Array.from(text);
  const points = [];
  for (let index = 0; index < characters.length; index += 1) {
    if (!TATWEEL_JOINING_LETTERS.has(characters[index])) {
      continue;
    }
    let nextIndex = index + 1;
    while (
      nextIndex < characters.length &&
      /\p{M}/u.test(characters[nextIndex])
    ) {
      nextIndex += 1;
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

function addLineTatweel(tokens, widths, contentWidth, tatweelWidth) {
  const arabicWordCount = tokens.filter((token) =>
    /\p{Script=Arabic}/u.test(token.text),
  ).length;
  if (arabicWordCount < 2 || tatweelWidth <= 0) {
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
    tatweelInsertionPoints(token.text).map((position) => ({
      tokenIndex: token.index,
      position,
    })),
  );
  if (!candidates.length) {
    return tokens;
  }

  const insertionCount = Math.min(
    candidates.length * 2,
    Math.floor((gap * 0.75) / tatweelWidth),
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
  const fontStyle = { "--arabic-scale": fontScale };
  const [hoveredVerse, setHoveredVerse] = useState(null);
  const [isDesktopViewport, setIsDesktopViewport] = useState(
    () => window.innerWidth > 820,
  );

  useEffect(() => {
    const updateViewport = () =>
      setIsDesktopViewport(window.innerWidth > 820);
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
        ? measureArabicTokenWidths(
            arabicMeasureRef.current,
            streams.arabicTokens,
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
        tatweelWidth: arabicMeasurements?.tatweelWidth || 0,
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
          Math.abs(
            current.arabicContentWidth - nextLineMaps.arabicContentWidth,
          ) < 0.1 &&
          Math.abs(current.tatweelWidth - nextLineMaps.tatweelWidth) < 0.1
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
      pendingHeadings.push(item);
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

  const translationLines = [];
  if (showTranslation) {
    for (const token of streams.translationTokens) {
      const line = lineMaps?.translation[token.index] ?? 0;
      let current = translationLines[translationLines.length - 1];
      if (!current || current.line !== line) {
        current = { line, tokens: [] };
        translationLines.push(current);
      }
      current.tokens.push(token);
    }
  }

  const renderTranslationLine = (line, index) => {
    const verseGroups = [];
    for (const token of line.tokens) {
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
          index === translationLines.length - 1 ? "last-in-stream" : ""
        }`}
        lang="fa"
        dir="rtl"
        key={`translation-line-${index}`}
      >
        {verseGroups.map((group, groupIndex) => {
          const isPlaying =
            playingTranslation?.sura === group.verse.sura &&
            playingTranslation?.aya === group.verse.aya;
          return (
            <span
              className={isPlaying ? "translation-playing" : undefined}
              key={`translation-aya-${index}-${groupIndex}`}
            >
              {group.tokens.map((token) => renderToken(token))}
            </span>
          );
        })}
      </div>
    );
  };

  const renderMeasuredArabicLine = (line, index, isLastLine) => {
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
        <div
          className="arabic-line basmala-line"
          key={`arabic-line-${index}`}
        >
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
            lineMaps.tatweelWidth,
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

  const output = [];
  let arabicIndex = 0;
  let translationIndex = 0;
  while (
    arabicIndex < arabicLines.length ||
    translationIndex < translationLines.length
  ) {
    if (arabicIndex < arabicLines.length) {
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
        const basmalaTranslation = streams.basmalaTranslations.find(
          (verse) =>
            verse.sura === arabicLine.tokens[0].verse.sura &&
            verse.aya === arabicLine.tokens[0].verse.aya,
        );
        if (showTranslation && basmalaTranslation) {
          output.push(
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
            </div>,
          );
        }
      } else if (translationIndex < translationLines.length) {
        output.push(
          renderTranslationLine(
            translationLines[translationIndex],
            translationIndex,
          ),
        );
        translationIndex += 1;
      }
      arabicIndex += 1;
    } else {
      output.push(
        renderTranslationLine(
          translationLines[translationIndex],
          translationIndex,
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
          streams.translationTokens.map((token) => renderToken(token, true))}
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioTrack, setAudioTrack] = useState("recitation");
  const [basmalaPlayed, setBasmalaPlayed] = useState(false);
  const audioRef = useRef(null);

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

    const controller = new AbortController();
    setLoading(true);
    setError("");
    requestJson(
      `/api/reader?sura=${location.sura}&aya=${location.aya}&edition=${edition}`,
      controller.signal,
    )
      .then((data) => {
        setReader({ ...data, edition });
        setLoading(false);
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") {
          setError(requestError.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [location.sura, location.aya, edition, reader]);

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
    try {
      const page = await requestJson(`/api/pages/${pageNumber}`);
      navigate(page.startSura, page.startAya);
    } catch (requestError) {
      setError(requestError.message);
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

  const changeSura = (event) => {
    const sura = Number(event.target.value);
    navigate(sura, 1);
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
            <select
              id="sura-select"
              value={location.sura}
              onChange={changeSura}
            >
              {suras.map((sura) => (
                <option key={sura.number} value={sura.number}>
                  {String(sura.number).padStart(3, "0")} · {sura.name}
                </option>
              ))}
            </select>
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
                  </strong>
                  <small
                    title={
                      currentSura
                        ? `${currentSura.name}; ${currentSura.revelationType}; revelation order ${currentSura.revelationOrder}; ${currentSura.rukuCount} rukus`
                        : undefined
                    }
                  >
                    {currentSura?.meaning || currentSura?.name}
                    {currentSura?.revelationType &&
                      ` · ${currentSura.revelationType}`}
                  </small>
                </div>
                <div className="quran-page-navigation" dir="ltr">
                  <button
                    type="button"
                    onClick={() => changePage(-1)}
                    disabled={reader.page.number === 1}
                    aria-label="Previous page"
                  >
                    ◄
                  </button>
                  <label>
                    <span className="visually-hidden">Page number</span>
                    <input
                      type="text"
                      min="1"
                      max="604"
                      value={pageInput}
                      onChange={(event) => setPageInput(event.target.value)}
                      onBlur={() => {
                        const pageNumber = Number(pageInput);
                        if (
                          pageInput &&
                          pageNumber >= 1 &&
                          pageNumber <= 604 &&
                          pageNumber !== reader.page.number
                        ) {
                          goToPage(pageNumber);
                        }
                      }}
                      aria-label="Page number"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => changePage(1)}
                    disabled={reader.page.number === 604}
                    aria-label="Next page"
                  >
                    ►
                  </button>
                </div>
                <div className="quran-edition-name" dir="rtl">
                  <strong>مصحف المدينة</strong>
                  <small>
                    {currentSura?.ayaCount || "—"} ayas · Juz{" "}
                    {reader.current.juz}
                  </small>
                </div>
              </div>

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
                  onClick={() => changePage(-1)}
                  disabled={reader.page.number === 1}
                  aria-label="Previous page"
                >
                  ◄
                </button>
                <span>{arabicNumber(reader.page.number)}</span>
                <button
                  type="button"
                  onClick={() => changePage(1)}
                  disabled={reader.page.number === 604}
                  aria-label="Next page"
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
