import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const EDITIONS = [
  ['quran_text_uthmani', 'Uthmani'],
  ['quran_text_uthmani_min', 'Uthmani (compact)'],
  ['quran_text_simple', 'Simple'],
  ['quran_text_simple_clean', 'Simple (clean)'],
  ['quran_text_simple_min', 'Simple (compact)'],
  ['quran_text_simple_plain', 'Simple (plain)'],
];

function hasBasmalaAya(sura) {
  return sura !== 1 && sura !== 9;
}

function readHash() {
  const match = window.location.hash.match(/^#?(\d+):(\d+)$/);
  if (!match) {
    return { sura: 1, aya: 1 };
  }
  return { sura: Number(match[1]), aya: Number(match[2]) };
}

async function requestJson(url, signal) {
  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || 'The request could not be completed.');
  }
  return body;
}

function App() {
  const [location, setLocation] = useState(readHash);
  const [reader, setReader] = useState(null);
  const [surahs, setSurahs] = useState([]);
  const [reciters, setReciters] = useState([]);
  const [edition, setEdition] = useState(EDITIONS[0][0]);
  const [reciter, setReciter] = useState('');
  const [showTranslation, setShowTranslation] = useState(true);
  const [playTranslation, setPlayTranslation] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioTrack, setAudioTrack] = useState('recitation');
  const audioRef = useRef(null);

  const currentSurah = useMemo(
    () => surahs.find((item) => item.number === location.sura),
    [surahs, location.sura],
  );
  const audioUrl = `/api/audio/${location.sura}/${location.aya}${reciter ? `?reciter=${encodeURIComponent(reciter)}` : ''}`;
  const translationAudioUrl = `/api/translation-audio/${location.sura}/${location.aya}`;
  const currentAudioUrl = audioTrack === 'translation' ? translationAudioUrl : audioUrl;

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
    const hash = `#${sura}:${aya}`;
    if (window.location.hash !== hash) {
      window.history[replace ? 'replaceState' : 'pushState'](null, '', hash);
    }
    if (!replace) {
      setIsPlaying(false);
      setAudioTrack('recitation');
    }
    setLocation({ sura, aya });
  }, []);

  useEffect(() => {
    const onHashChange = () => setLocation(readHash());
    const onPopState = () => setLocation(readHash());
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      requestJson('/api/surahs', controller.signal),
      requestJson('/api/reciters', controller.signal),
    ])
      .then(([chapterList, reciterList]) => {
        setSurahs(chapterList);
        setReciters(reciterList);
        setReciter(reciterList[0]?.id || '');
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (
      location.sura < 1
      || location.sura > 114
      || location.aya < 0
      || (location.aya === 0 && !hasBasmalaAya(location.sura))
    ) {
      setError('The address must use a valid surah and ayah, for example #112:1.');
      setLoading(false);
      return undefined;
    }

    const alreadyLoaded = reader?.edition === edition
      && reader.verses.some((verse) => verse.sura === location.sura && verse.aya === location.aya);
    if (alreadyLoaded) {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');
    requestJson(
      `/api/reader?sura=${location.sura}&aya=${location.aya}&edition=${edition}`,
      controller.signal,
    )
      .then((data) => {
        setReader({ ...data, edition });
        setLoading(false);
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [location.sura, location.aya, edition, reader]);

  useEffect(() => {
    const activeVerse = document.getElementById(`verse-${location.sura}-${location.aya}`);
    activeVerse?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
    const lastAya = currentSurah?.ayahCount;
    setAudioTrack('recitation');
    if (!lastAya) {
      setIsPlaying(false);
      return;
    }
    if (location.aya < lastAya) {
      navigate(location.sura, location.aya + 1, { replace: true });
    } else if (location.sura < 114) {
      const nextSura = location.sura + 1;
      navigate(nextSura, hasBasmalaAya(nextSura) ? 0 : 1, { replace: true });
    } else {
      setIsPlaying(false);
    }
  };

  const handleAudioEnded = () => {
    if (audioTrack === 'translation') {
      advancePlayback();
      return;
    }

    const currentVerse = reader?.verses.find(
      (verse) => verse.sura === location.sura && verse.aya === location.aya,
    );
    if (playTranslation && currentVerse?.translation) {
      setAudioTrack('translation');
      return;
    }
    advancePlayback();
  };

  const handleAudioPause = (event) => {
    if (!event.currentTarget.ended) {
      setIsPlaying(false);
    }
  };

  const changeSurah = (event) => {
    const sura = Number(event.target.value);
    navigate(sura, hasBasmalaAya(sura) ? 0 : 1);
  };

  const submitLocation = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    navigate(Number(data.get('sura')), Number(data.get('aya')));
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
          <span className="brand-mark" aria-hidden="true">۞</span>
          <span>
            <strong>Quran Reader</strong>
            <small>Read · Listen · Reflect</small>
          </span>
        </a>
        <div className="topbar-meta">
          <span className="local-indicator"><i /> Local library</span>
          <span className="edition-label">604-page Madinah edition</span>
        </div>
      </header>

      <main className="workspace">
        <aside className="control-panel">
          <div className="panel-heading">
            <span className="eyebrow">READING POSITION</span>
            <span className="position-badge">{location.sura}:{location.aya}</span>
          </div>

          <label className="field-label" htmlFor="surah-select">Surah</label>
          <select id="surah-select" value={location.sura} onChange={changeSurah}>
            {surahs.map((surah) => (
              <option key={surah.number} value={surah.number}>
                {String(surah.number).padStart(3, '0')} · {surah.name}
              </option>
            ))}
          </select>

          <form className="location-form" key={`${location.sura}:${location.aya}`} onSubmit={submitLocation}>
            <label className="field-label" htmlFor="sura-input">Go to ayah</label>
            <div className="location-fields">
              <input id="sura-input" name="sura" type="number" min="1" max="114" defaultValue={location.sura} aria-label="Surah number" />
              <span>:</span>
              <input name="aya" type="number" min="0" defaultValue={location.aya} aria-label="Ayah number" />
              <button className="go-button" type="submit">Go</button>
            </div>
          </form>

          <div className="control-divider" />
          <span className="eyebrow">TEXT & DISPLAY</span>
          <label className="field-label" htmlFor="edition-select">Arabic text</label>
          <select id="edition-select" value={edition} onChange={(event) => setEdition(event.target.value)}>
            {EDITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label className="check-row">
            <input type="checkbox" checked={showTranslation} onChange={(event) => setShowTranslation(event.target.checked)} />
            <span>Fooladvand Persian translation</span>
          </label>
          <label className="check-row translation-audio-toggle">
            <input
              type="checkbox"
              checked={playTranslation}
              onChange={(event) => {
                const enabled = event.target.checked;
                setPlayTranslation(enabled);
                if (!enabled && audioTrack === 'translation') {
                  setAudioTrack('recitation');
                }
              }}
            />
            <span>Play Persian translation audio after each ayah</span>
          </label>

          <div className="font-size-control">
            <span className="field-label">Text size</span>
            <div>
              <button type="button" aria-label="Decrease text size" onClick={() => setFontScale((size) => Math.max(0.8, size - 0.1))}>−</button>
              <span>{Math.round(fontScale * 100)}%</span>
              <button type="button" aria-label="Increase text size" onClick={() => setFontScale((size) => Math.min(1.5, size + 0.1))}>+</button>
            </div>
          </div>

          <div className="control-divider" />
          <span className="eyebrow">RECITATION</span>
          <label className="field-label" htmlFor="reciter-select">Reciter</label>
          <select id="reciter-select" value={reciter} onChange={(event) => setReciter(event.target.value)}>
            {reciters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <p className="panel-note">Audio is served from the files in your local data folder.</p>
        </aside>

        <section className="reader-column" aria-label="Quran text">
          <div className="reader-toolbar">
            <div>
              <span className="eyebrow">THE QURAN</span>
              <h1>{currentSurah?.name || `Surah ${location.sura}`}</h1>
              <p>{currentSurah?.ayahCount || '—'} ayahs <span>·</span> Page {reader?.page.number || '—'} of 604</p>
            </div>
            <div className="page-controls">
              <button type="button" onClick={() => changePage(-1)} disabled={!reader || reader.page.number === 1} aria-label="Previous page">←</button>
              <label>
                <span>Page</span>
                <input
                  type="number"
                  min="1"
                  max="604"
                  value={pageInput}
                  onChange={(event) => {
                    setPageInput(event.target.value);
                  }}
                  onBlur={() => {
                    const pageNumber = Number(pageInput);
                    if (pageInput && pageNumber >= 1 && pageNumber <= 604 && pageNumber !== reader?.page.number) {
                      goToPage(pageNumber);
                    }
                  }}
                  aria-label="Page number"
                />
              </label>
              <button type="button" onClick={() => changePage(1)} disabled={!reader || reader.page.number === 604} aria-label="Next page">→</button>
            </div>
          </div>

          {error && <div className="error-banner" role="alert">{error}</div>}
          {loading && <div className="loading-state">Loading local Quran text…</div>}
          {!loading && reader && (
            <div className="page-card">
              <div className="page-card-heading">
                <span>{reader.page.start.sura}:{reader.page.start.aya} — {reader.page.end.sura}:{reader.page.end.aya}</span>
                <span>PAGE {reader.page.number}</span>
              </div>
              <div className="verses" style={{ '--arabic-scale': fontScale }}>
                {reader.verses.map((verse) => {
                  const active = verse.sura === location.sura && verse.aya === location.aya;
                  return (
                    <article
                      className={`verse ${active ? 'verse-active' : ''}`}
                      id={`verse-${verse.sura}-${verse.aya}`}
                      key={`${verse.sura}:${verse.aya}`}
                      onClick={() => navigate(verse.sura, verse.aya)}
                    >
                      <div className="arabic-line" lang="ar" dir="rtl">
                        <span>{verse.text}</span>
                        <button
                          type="button"
                          className="verse-number"
                          aria-label={`Go to ${verse.sura}:${verse.aya}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(verse.sura, verse.aya);
                          }}
                        >
                          {verse.aya}
                        </button>
                      </div>
                      {showTranslation && verse.translation && (
                        <p className="translation" lang="fa" dir="rtl">{verse.translation}</p>
                      )}
                    </article>
                  );
                })}
              </div>
              <div className="page-card-footer">
                <button type="button" onClick={() => changePage(-1)} disabled={reader.page.number === 1}>← Previous page</button>
                <button type="button" onClick={() => changePage(1)} disabled={reader.page.number === 604}>Next page →</button>
              </div>
            </div>
          )}

          <div className="audio-player">
            <div className="audio-copy">
              <span className="audio-icon" aria-hidden="true">♫</span>
              <span>
                <strong>{audioTrack === 'translation' ? 'Playing translation' : 'Listen to this ayah'}</strong>
                <small>
                  {location.sura}:{location.aya} · {audioTrack === 'translation'
                    ? 'Fooladvand Persian'
                    : reciters.find((item) => item.id === reciter)?.name || 'Local recitation'}
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
                setError(audioTrack === 'translation'
                  ? 'Translation audio is not available for this ayah.'
                  : 'This ayah audio file is not available in the selected local recitation.');
              }}
            >
              Your browser does not support audio playback.
            </audio>
          </div>
          <footer className="reader-footer">Text and audio are loaded from your local Quran database and data files.</footer>
        </section>
      </main>
    </div>
  );
}

export default App;
