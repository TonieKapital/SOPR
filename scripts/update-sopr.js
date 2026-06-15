/**
 * Skrypt automatycznie pobierający najnowszą wartość wskaźnika STH-SOPR ze strony CheckOnChain.
 * Wersja V2: Pancerny parser z obsługą escaped JSON oraz detekcją blokad CDN/Cloudflare.
 */

const fs = require('fs');
const path = require('path');

const URL = 'https://charts.checkonchain.com/btconchain/realised/sthsopr_indicator/sthsopr_indicator_light.html';
const DATA_PATH = path.join(__dirname, '../data/sth-sopr.json');

async function main() {
    try {
        console.log(`[LOG] Rozpoczynanie pobierania danych z: ${URL}`);
        
        const response = await fetch(URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Nie udało się pobrać strony. Status HTTP: ${response.status} ${response.statusText}`);
        }
        
        const html = await response.text();
        console.log(`[LOG] Pomyślnie pobrano kod HTML (Długość dokumentu: ${html.length} znaków).`);

        // KROK 1: Sprawdzenie obecności systemów anty-botowych
        if (html.includes("cloudflare") || html.includes("Just a moment...") || html.includes("challenge-platform")) {
            console.error("[DIAGNOSTYKA] Pierwsze 300 znaków odebranej odpowiedzi:\\n", html.substring(0, 300));
            throw new Error("Krytyczna blokada anty-botowa (Cloudflare). Serwer wykrył maszynę GitHub Actions i zablokował dostęp.");
        }

        // KROK 2: Wielowariantowe poszukiwanie struktur danych Plotly (Standardowe i Escaped)
        let xMatches = [...html.matchAll(/(?:\\?"x\\?")\s*:\s*\\?\[([^\\\]]+)\\?\]/g)];
        let yMatches = [...html.matchAll(/(?:\\?"y\\?")\s*:\s*\\?\[([^\\\]]+)\\?\]/g)];

        if (xMatches.length === 0 || yMatches.length === 0) {
            console.error("[DIAGNOSTYKA] Parser nie odnalazł kluczy x/y. Pierwsze 400 znaków strony:\\n", html.substring(0, 400));
            throw new Error("Nie odnaleziono tablic danych x lub y w strukturze Plotly w kodzie HTML.");
        }

        console.log(`[LOG] Wykryto ${xMatches.length} potencjalnych serii danych w kodzie źródłowym.`);

        // KROK 3: Heurystyka wyboru serii STH-SOPR (szukamy średniej wartości bliskiej 1.0)
        let selectedIndex = -1;

        for (let i = 0; i < xMatches.length; i++) {
            const rawY = yMatches[i] ? yMatches[i][1] : '';
            // Czyszczenie znaków ucieczki, jeśli występują
            const cleanY = rawY.replace(/\\/g, '');
            const sampleValues = cleanY.split(',')
                .slice(-15)
                .map(v => parseFloat(v.trim()))
                .filter(v => !isNaN(v));

            if (sampleValues.length > 0) {
                const avg = sampleValues.reduce((sum, val) => sum + val, 0) / sampleValues.length;
                if (avg > 0.5 && avg < 2.0) {
                    selectedIndex = i;
                    console.log(`[LOG] Dopasowano serię danych wskaźnika STH-SOPR na indeksie: ${i} (średnia próbki: ${avg.toFixed(4)})`);
                    break;
                }
            }
        }

        if (selectedIndex === -1) {
            console.warn("[WARN] Heurystyka zawiodła. Wybieranie domyślnej serii o największej objętości danych.");
            selectedIndex = 0;
        }

        const rawX = xMatches[selectedIndex][1].replace(/\\/g, '');
        const rawY = yMatches[selectedIndex][1].replace(/\\/g, '');

        const dates = rawX.split(',').map(d => d.replace(/["'\s]/g, ''));
        const values = rawY.split(',').map(v => {
            const trimmed = v.trim();
            return trimmed === 'null' ? null : parseFloat(trimmed);
        });

        if (dates.length === 0 || values.length === 0) {
            throw new Error("Wyekstrahowane tablice danych są puste.");
        }

        const latestDate = dates[dates.length - 1];
        const latestValue = values[values.length - 1];

        if (!latestDate || latestValue === null || isNaN(latestValue)) {
            throw new Error("Najnowszy punkt danych zawiera nieprawidłowe wartości.");
        }

        console.log(`[SUCCESS] Pomyślnie sparsowano odczyt: ${latestDate} | Wartość = ${latestValue}`);

        // KROK 4: Zapis i aktualizacja bazy danych JSON
        let localDatabase = [];
        if (fs.existsSync(DATA_PATH)) {
            try {
                localDatabase = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
            } catch (e) {
                localDatabase = [];
            }
        }

        const existingIndex = localDatabase.findIndex(item => item.date === latestDate);

        if (existingIndex !== -1) {
            if (localDatabase[existingIndex].value !== latestValue) {
                localDatabase[existingIndex].value = latestValue;
                localDatabase[existingIndex].updatedAt = new Date().toISOString();
                console.log(`[LOG] Zaktualizowano wartość dla istniejącej daty ${latestDate}.`);
            } else {
                console.log(`[LOG] Brak zmian dla dnia ${latestDate}.`);
            }
        } else {
            localDatabase.push({
                date: latestDate,
                value: latestValue,
                updatedAt: new Date().toISOString()
            });
            console.log(`[LOG] Dodano nowy rekord historyczny dla daty: ${latestDate}`);
        }

        fs.writeFileSync(DATA_PATH, JSON.stringify(localDatabase, null, 2), 'utf-8');
        console.log(`[SUCCESS] Plik bazy danych został zaktualizowany.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    }
}

main();
