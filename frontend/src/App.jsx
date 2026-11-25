import {
  Fragment,
  useCallback,
  useEffect,
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

function QuranText({ text, showSigns, isJuzStart }) {
  return formatQuranText(text, { showSigns, isJuzStart }).map((part, index) =>
    typeof part === "string" ? (
      part
    ) : (
      <span key={index} className={part.className}>
        {part.text}
      </span>
    ),
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
                <div
                  className="quran-text"
                  style={{ "--arabic-scale": fontScale }}
                >
                  {reader.verses.map((verse) => {
                    const active =
                      verse.sura === location.sura &&
                      verse.aya === location.aya;
                    const verseSura = suras.find(
                      (sura) => sura.number === verse.sura,
                    );
                    return (
                      <Fragment key={`${verse.sura}:${verse.aya}`}>
                        {(verse.aya === 0 ||
                          (verse.aya === 1 &&
                            (verse.sura === 1 || verse.sura === 9))) && (
                          <div
                            className="sura-heading-frame"
                            lang="ar"
                            dir="rtl"
                          >
                            <span>
                              سورة{" "}
                              {verseSura?.arabicName ||
                                arabicNumber(verse.sura)}
                            </span>
                          </div>
                        )}
                        {verse.aya === 0 ? (
                          <span className="basmala" lang="ar" dir="rtl">
                            <QuranText
                              text={verse.text}
                              showSigns={showSigns}
                            />
                          </span>
                        ) : (
                          <span
                            className={`aya ${active ? "aya-selected" : ""}`}
                            id={`verse-${verse.sura}-${verse.aya}`}
                            lang="ar"
                            dir="rtl"
                            role="button"
                            tabIndex={0}
                            onClick={() => navigate(verse.sura, verse.aya)}
                            onKeyDown={(event) =>
                              navigateOnKeyDown(event, verse.sura, verse.aya)
                            }
                          >
                            {" "}
                            <QuranText
                              text={verse.text}
                              showSigns={showSigns}
                              isJuzStart={juzStarts.some(
                                (start) =>
                                  start.startSura === verse.sura &&
                                  start.startAya === verse.aya,
                              )}
                            />{" "}
                            <span className="ayaNumber" aria-hidden="true">
                              {formatAyaNumber(verse.aya)}
                            </span>
                          </span>
                        )}
                      </Fragment>
                    );
                  })}
                </div>
                {showTranslation && (
                  <div className="translation-list" lang="fa" dir="rtl">
                    {reader.verses
                      .filter((verse) => verse.translation)
                      .map((verse) => (
                        <p
                          className="translation"
                          key={`translation-${verse.sura}:${verse.aya}`}
                        >
                          <span className="translation-reference" dir="ltr">
                            {verse.sura}:{verse.aya}
                          </span>
                          {verse.translation}
                        </p>
                      ))}
                  </div>
                )}
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
