# Local Quran Reader

A responsive React reader backed by a local Express API and the supplied SQLite
database and audio files. The reader supports direct `#sura:aya` links, the
604-page Madinah layout, six Arabic text editions, Fooladvand Persian
translation, and local per-ayah recitation.

## Requirements

- Node.js 20 or newer
- `data/quran.sqlite`
- Recitation files under `data/audio/recitations/`

The app code is organized under `backend/src/` and `frontend/src/`. Put static
frontend images in `frontend/public/images/`. The existing `.gitignore`
excludes `data/`; keep the database and audio files in those local paths.

## Run locally

```powershell
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The development server proxies API
requests to Express on port 3001. For a production build, run `npm run build`
and then `npm start`; Express serves the built React app and API on port 3001 by
default. Set `PORT` to change the production port.

On first startup, Express creates and fills `quran_pages` in `data/quran.sqlite`
with each Madinah page's start and end sura/ayah and verse index. The page-start
metadata is bundled with the server, so the app does not fetch Quran content,
fonts, or page data from the internet.

## API

- `GET /api/health`
- `GET /api/surahs`
- `GET /api/pages/:page`
- `GET /api/reader?sura=112&aya=1&edition=quran_text_uthmani`
- `GET /api/reciters`
- `GET /api/audio/:sura/:aya?reciter=<local-reciter-id>`
- `GET /api/translation-audio/:sura/:aya`

The page-start mapping follows the 604-page Madinah layout and was sourced from
AlQuran Cloud's Quran metadata. Quran text, translations, and recitations are
read from the files already present in `data/`. Ayah selection is managed in
React; while navigating within the current page, only the highlight and URL
change. When enabled, Fooladvand translation audio plays after each recitation
before playback advances to the next ayah. For surahs other than 1 and 9, the
reader inserts a synthetic ayah `sura:0` containing the basmala using the
selected edition's spelling from `1:1`. Its translation and audio also use
`1:1`; the text of the surah's first ayah does not include the basmala.