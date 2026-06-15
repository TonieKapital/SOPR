/**
 * Skrypt automatycznie pobierający najnowszą wartość wskaźnika STH-SOPR ze strony CheckOnChain.
 * Wersja V4: Ultra-szybki i odporny skrypt bez-regexowy, bazujący na indeksowaniu strumieniowym.
 * Pozwala na bezbłędne przetwarzanie plików HTML o rozmiarach przekraczających 6MB.
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

        console.log("[LOG] Uruchamianie algorytmu wyszukiwania strumieniowego danych Plotly...");
        
        const discoveredSeries = [];
        let pos = 0;

        // Skanowanie całego dokumentu znak po znaku za pomocą wydajnej metody indexOf
        while (pos < html.length) {
            let xIdx = html.indexOf('x', pos);
            if (xIdx === -1) break;

            // Wyciągamy mały fragment o długości 50 znaków do analizy struktury klucza
            let segment = html.substring(xIdx, xIdx + 50);
            let cleanSeg = segment.replace(/[\s"'\\]/g, '');

            // Jeśli fragment po wyczyszczeniu zbędnych znaków zaczyna się od tablicy osi X
            if (cleanSeg.startsWith('x:[')) {
                let startBracket = html.indexOf('[', xIdx);
                if (startBracket !== -1 && startBracket < xIdx + 50) {
                    let endBracket = html.indexOf(']', startBracket);
                    if (endBracket !== -1) {
                        let rawX = html.substring(startBracket + 1, endBracket);

                        // Szukamy powiązanej osi 'y' w bloku tego samego obiektu (maksymalnie 2000 znaków dalej)
                        let yIdx = html.indexOf('y', endBracket);
                        if (yIdx !== -1 && yIdx - endBracket < 2000) {
                            let ySegment = html.substring(yIdx, yIdx + 50);
                            let cleanYSeg = ySegment.replace(/[\s"'\\]/g, '');

                            if (cleanYSeg.startsWith('y:[')) {
                                let yStart = html.indexOf('[', yIdx);
                                let yEnd = html.indexOf(']', yStart);
                                if (yStart !== -1 && yEnd !== -1) {
                                    let rawY = html.substring(yStart + 1, yEnd);
                                    discoveredSeries.push({ rawX, rawY });
                                    console.log(`[LOG] Zlokalizowano kompletną serię danych wykresu (Pozycja w pliku: ${xIdx})`);
                                }
                            }
                        }
                    }
                }
            }
            pos = xIdx + 1;
        }

        if (discoveredSeries.length === 0) {
            throw new Error("Krytyczny błąd: Algorytm skanowania strumieniowego nie wyodrębnił serii danych x/y.");
        }

        console.log(`[LOG] Przetworzono dokument. Wykryto serii: ${discoveredSeries.length}. Uruchamianie heurystyki STH-SOPR...`);

        let selectedIndex = -1;

        // Filtrowanie serii w celu znalezienia wskaźnika SOPR (wartości wokół poziomu 1.0)
        for (let i = 0; i < discoveredSeries.length; i++) {
            const cleanY = discoveredSeries[i].rawY.replace(/[\s\\"']/g, '');
            const sampleValues = cleanY.split(',')
                .slice(-20) // Analiza ostatnich 20 wpisów rynkowych
                .map(v => parseFloat(v))
                .filter(v => !isNaN(v));

            if (sampleValues.length > 0) {
                const avg = sampleValues.reduce((sum, val) => sum + val, 0) / sampleValues.length;
                if (avg > 0.5 && avg < 2.0) {
                    selectedIndex = i;
                    console.log(`[LOG] Sukces heurystyki! Seria na indeksie ${i} odpowiada charakterystyce STH-SOPR (Średnia: ${avg.toFixed(4)})`);
                    break;
                }
            }
        }

        if (selectedIndex === -1) {
            console.warn("[WARN] Heurystyka zawiodła. Wybieranie pierwszej dostępnej serii danych.");
            selectedIndex = 0;
        }

        // Oczyszczanie ostatecznych danych z cudzysłowów i spacji
        const finalX = discoveredSeries[selectedIndex].rawX.replace(/[\s\\"']/g, '');
        const finalY = discoveredSeries[selectedIndex].rawY.replace(/[\s\\"']/g, '');

        const dates = finalX.split(',').filter(d => d.length > 0);
        const values = finalY.split(',').map(v => v === 'null' ? null : parseFloat(v));

        if (dates.length === 0 || values.length === 0 || dates.length !== values.length) {
            throw new Error(`Niezgodność struktur danych. Daty: ${dates.length}, Wartości: ${values.length}`);
        }

        const latestDate = dates[dates.length - 1];
        const latestValue = values[values.length - 1];

        if (!latestDate || latestValue === null || isNaN(latestValue)) {
            throw new Error("Wyciągnięty punkt końcowy zawiera uszkodzone lub puste dane.");
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
