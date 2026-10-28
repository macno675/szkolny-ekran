# Szkolny Ekran

Zdalnie sterowany wyświetlacz ogłoszeń dla szkoły. Jeden program (Electron) na komputerze z Windows 10:
pełnoekranowy odtwarzacz na telewizorze + panel sterowania w przeglądarce (`http://<komputer>:8080`).

**Pełna instrukcja z grafikami:** `public/admin/help.html` (w panelu: zakładka *Instrukcja*).

## Szybki start

```bash
npm install
npm start          # na Macu/PC w oknie (test)
npm run kiosk      # pełny ekran, jak w szkole
npm test           # testy serwera i harmonogramu
npm run dist:win   # instalator Windows -> dist/Szkolny Ekran Setup 1.0.0.exe
```

Panel: http://localhost:8080 - przy pierwszym wejściu (tylko z tego komputera) ustawiasz hasło.

## Struktura

- `main.js` - Electron: okno kiosk, watchdog, autostart, zrzut ekranu, nocne odświeżenie
- `server.js` - serwer HTTP bez zależności: API, logowanie, pliki, SSE do odtwarzacza
- `lib/schedule.js` - harmonogram (treści / tryb nocny) i daty slajdów
- `public/player/` - odtwarzacz: slajdy, przejścia, animacje w pętli, tryb nocny
- `public/admin/` - panel sterowania i instrukcja
- `test/` - testy (`node --test`)

Dane: `%APPDATA%\Szkolny Ekran\data` (Windows), `~/Library/Application Support/Szkolny Ekran/data` (Mac).
Port zmienisz zmienną `EKRAN_PORT`.
