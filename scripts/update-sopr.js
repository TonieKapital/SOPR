/**
 * Skrypt automatycznie pobierający najnowszą wartość wskaźnika STH-SOPR ze strony CheckOnChain.
 * Wersja V5: Inteligentne skanowanie semantyczne. Wyciąga duże bloki danych i filtruje je na podstawie wartości.
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

        console.log("[LOG] Lokaliowanie wszystkich dużych tablic danych w pliku HTML...");
        
        const largeArrays = [];
        let searchPos = 0;

        // Wyciągamy z pliku każdy blok zamknięty w nawiasach kwadratowych [ ], który ma ponad 1000 znaków
        while (true) {
            let start = html.indexOf('[', searchPos);
            if (start === -1) break;
            let end = html.indexOf(']', start);
            if (end === -1) break;
            
            if (end - start > 1000) {
                largeArrays.push(html.substring(start + 1, end));
            }
            searchPos = end + 1;
        }

        console.log(`[LOG] Znaleziono ${largeArrays.length} dużych struktur danych. Filtrowanie wskaźnika SOPR...`);

        let soprValues = null;
        let soprDates = null;

        // KROK 1: Szukamy tablicy z wartościami SOPR (liczby ze średnią w przedziale 0.5 - 2.0)
        for (let content of largeArrays) {
            let cleanY = content.replace(/[\s\\"']/g, '');
            let items = cleanY.split(',');
            let sample = items.slice(-20).map(v => parseFloat(v)).filter(v => !isNaN(v));

            if (sample.length > 0) {
                let avg = sample.reduce((sum, val) => sum + val, 0) / sample.length;
                // SOPR oscyluje bardzo blisko wartości 1.0
                if (avg > 0.5 && avg < 2.0) {
                    soprValues = items.map(v => v === 'null' ? null : parseFloat(v));
                    console.log(`[LOG] Sukces! Zidentyfikowano tablicę wartości SOPR (Średnia próbki: ${avg.toFixed(4)})`);
                    break;
                }
            }
        }

        if (!soprValues) {
            throw new Error("Nie udało się odnaleźć właściwej tablicy wartości wskaźnika SOPR.");
        }

        // KROK 2: Szukamy tablicy z datami (musi mieć tę samą długość i zawierać myślniki daty)
        for (let content of largeArrays) {
            let cleanX = content.replace(/[\s\\"']/g, '');
            let items = cleanX.split(',').filter(i => i.length > 0);

            if (items.length === soprValues.length && items[0].includes('-')) {
                soprDates = items;
                console.log(`[LOG] Sukces! Dopasowano powiązaną tablicę osi czasu (Liczba punktów: ${soprDates.length})`);
                break;
            }
        }

        if (!soprDates) {
            throw new Error("Nie udało się dopasować osi czasu (dat) do wartości SOPR.");
        }

        const latestDate = soprDates[soprDates.length - 1];
        const latestValue = soprValues[soprValues.length - 1];

        console.log(`[SUCCESS] Sparowano najnowszy odczyt: ${latestDate} | Wartość STH-SOPR = ${latestValue}`);

        // KROK 3: Aktualizacja bazy danych JSON
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
                console.log(`[LOG] Dane dla dnia ${latestDate} są aktualne.`);
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
