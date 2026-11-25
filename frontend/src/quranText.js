const HARAKA = '[\\u064B-\\u0653\\u0670]';
const HARAKAT = `${HARAKA}*`;

function normalizeHafsText(text) {
  return text
    .replace(/\u064D\u06ED/g, '\u0650\u06ED')
    .replace(/\u064B\u06E2/g, '\u064E\u06E2')
    .replace(/\u064C\u06E2/g, '\u064F\u06E2')
    .replace(/\u06EB/g, '\u06EC')
    .replace(new RegExp(`\\u0640(${HARAKA})`, 'g'), '$1')
    .replace(new RegExp(`(\\u0643)(${HARAKAT}\\u0644${HARAKAT}\\u0627\\u0653)`, 'g'), '$1\u0640$2')
    .replace(/[\u064B\u064C]\u06ED/g, (match) => match[0])
    .replace(/(\u064D\u0651?)\u06E2/g, '$1');
}

export function formatQuranText(text, { showSigns = true, isJuzStart = false } = {}) {
  const cleanedText = normalizeHafsText(text);
  if (!showSigns) {
    return [cleanedText.replace(/[\u06D6-\u06DE\u06E9]/gu, '')];
  }

  const parts = [];
  const signPattern = / ([\u06D6-\u06DC])|(\u06DE)|(\u06E9)/gu;
  let lastIndex = 0;

  for (const match of cleanedText.matchAll(signPattern)) {
    const index = match.index;
    if (index > lastIndex) {
      parts.push(cleanedText.slice(lastIndex, index));
    }

    if (match[1]) {
      parts.push({ className: 'sign', text: `\u00A0${match[1]}` });
    } else {
      parts.push({
        className: match[2] ? (isJuzStart ? 'juz-sign' : 'hezb-sign') : 'internal-sign',
        text: match[2] ? `${match[2]} ` : match[3],
      });
    }
    lastIndex = index + match[0].length;
  }

  if (lastIndex < cleanedText.length) {
    parts.push(cleanedText.slice(lastIndex));
  }

  return parts;
}
