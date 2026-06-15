/**
 * Skrypt automatycznie pobierający najnowszą wartość wskaźnika STH-SOPR ze strony CheckOnChain.
 * Wersja V3: Elastyczny parser z uniwersalnym dopasowaniem tablic tekstowych (x/y) o dużej objętości.
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Nie udało się pobrać strony. Status HTTP: ${response.status}`);
        }
        
        const html = await response.text();
        console.log(`[LOG] Pomyślnie pobrano kod HTML (Długość dokumentu: ${html.length} znaków).`);

        // UNIWERSALNY REGEX: Szuka klucza x/y w cudzysłowach, apostrofach lub bez, a następnie przechwytuje zawartość nawiasu [ ]
        // Zastosowanie [\s\S]*? pozwala na bezpieczne bezpieczne parsowanie wielolinijkowych struktur tekstowych
        const xMatches = [...html.matchAll(/(?:"x"|'x'|\bx\b)\s*:\s*\[([\s\S]*?)\]/g)];
        const yMatches = [...html.matchAll(/(?:"y"|'y'|\by\b)\s*:\s*\[([\s\S]*?)\]/g)];

        if (xMatches.length === 0 || yMatches.length === 0) {
            throw new Error("Krytyczny błąd: Parser nie dopasował żadnych tablic danych x/y w strukturze wykresu.");
        }

        console.log(`[LOG] Wykryto ${xMatches.length} serii danych w kodzie źródłowym. Uruchamianie heurystyki...`);

        let selectedIndex = -1;

        // Przeszukiwanie serii w celu zlokalizowania wskaźnika SOPR (wartości oscylujące wokół 1.0)
        for (let i = 0; i < xMatches.length; i++) {
            const rawY = yMatches[i] ? yMatches[i][1] : '';
            // Czyszczenie spacji, cudzysłowów i ukośników dla poprawnej konwersji typów
            const cleanY = rawY.replace(/[\s\\"']/g, '');
            const sampleValues = cleanY.split(',')
                .slice(-20) // Analiza ostatnich 20 próbek rynkowych
                .map(v => parseFloat(v))
                .filter(v => !isNaN(v));

            if (sampleValues.length > 0) {
                const avg = sampleValues.reduce((sum, val) => sum + val, 0) / sampleValues.length;
                // SOPR krótkoterminowy porusza się w wąskim paśmie makro (0.5 do 2.0)
                if (avg > 0.5 && avg < 2.0) {
                    selectedIndex = i;
                    console.log(`[LOG] Sukces heurystyki! Dopasowano wskaźnik STH-SOPR na indeksie serii: ${i} (Średnia próbek: ${avg.toFixed(4)})`);
                    break;
                }
            }
        }

        if (selectedIndex === -1) {
            console.warn("[WARN] Heurystyka wartości zawiodła. Wybieranie serii o największej objętości punktów.");
            selectedIndex = 0;
        }

        // Pobranie i ostateczne oczyszczenie wyekstrahowanych ciągów danych
        const cleanX = xMatches[selectedIndex][1].replace(/[\s\\"']/g, '');
        const cleanY = yMatches[selectedIndex][1].replace(/[\s\\"']/g, '');

        const dates = cleanX.split(',').filter(d => d.length > 0);
        const values = cleanY.split(',').map(v => v === 'null' ? null : parseFloat(v));

        if (dates.length === 0 || values.length === 0 || dates.length !== values.length) {
            throw new Error(`Niezgodność struktur danych. Daty: ${dates.length}, Wartości: ${values.length}`);
        }

        const latestDate = dates[dates.length - 1];
        const latestValue = values[values.length - 1];

        if (!latestDate || latestValue === null || isNaN(latestValue)) {
            throw new Error("Wyciągnięty punkt końcowy zawiera uszkodzone dane.");
        }

        console.log(`[SUCCESS] Sparowano najnowszy odczyt: ${latestDate} | Wartość STH-SOPR = ${latestValue}`);

        // Odczyt i aktualizacja lokalnego pliku JSON
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
                console.log(`[LOG] Zaktualizowano wartość dla daty ${latestDate}.`);
            } else {
                console.log(`[LOG] Dane dla dnia ${latestDate} są aktualne. Brak zmian.`);
            }
        } else {
            localDatabase.push({
                date: latestDate,
                value: latestValue,
                updatedAt: new Date().toISOString()
            });
            console.log(`[LOG] Zapisano nowy rekord dla daty: ${latestDate}`);
        }

        fs.writeFileSync(DATA_PATH, JSON.stringify(localDatabase, null, 2), 'utf-8');
        console.log(`[SUCCESS] Baza danych JSON została pomyślnie zaktualizowana.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    }
}

main();
