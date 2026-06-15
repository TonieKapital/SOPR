/**
 * Skrypt automatycznie pobierający najnowszą wartość wskaźnika STH-SOPR ze strony CheckOnChain.
 * Wersja V6: Globalna analiza profilu matematycznego oraz odwrócone skanowanie pętli (odporne na padding null).
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

        const largeArrays = [];
        let searchPos = 0;

        // Wyciąganie wszystkich surowych struktur zamkniętych w [ ] o długości powyżej 1000 znaków
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

        console.log(`[LOG] Wykryto ${largeArrays.length} potencjalnych obiektów danych. Mapowanie struktur...`);

        // Analizujemy i profilujemy każdą tablicę na podstawie jej globalnej zawartości
        const parsedArrays = largeArrays.map((content, idx) => {
            const clean = content.replace(/[\s\\"']/g, '');
            const items = clean.split(',');
            
            // Sprawdzamy czy to tablica dat (czy elementy zawierają myślniki formatu YYYY-MM-DD)
            const isDateArray = items.slice(0, 10).some(item => item.includes('-') && item.length >= 8);
            
            // Filtrujemy wyłącznie poprawne liczby z całej tablicy (ignorujemy tekstowe 'null')
            const validNumbers = items.map(v => parseFloat(v)).filter(v => !isNaN(v));
            const globalAvg = validNumbers.length > 0 ? validNumbers.reduce((sum, val) => sum + val, 0) / validNumbers.length : 0;
            
            return {
                idx,
                items,
                isDateArray,
                globalAvg,
                validNumbersCount: validNumbers.length
            };
        });

        // Wypisujemy pełną diagnostykę do logów GitHub Actions
        parsedArrays.forEach(arr => {
            console.log(`[DIAGNOSTIC] Tablica #${arr.idx}: elementów=${arr.items.length}, czy_daty=${arr.isDateArray}, średnia_liczb=${arr.globalAvg.toFixed(4)}, liczby_nie_null=${arr.validNumbersCount}`);
        });

        // Szukamy wskaźnika SOPR: nie może być datą, a jego globalna średnia historyczna musi być blisko 1.0 (przedział 0.5 - 2.0)
        const soprInfo = parsedArrays.find(arr => !arr.isDateArray && arr.globalAvg > 0.5 && arr.globalAvg < 2.0 && arr.validNumbersCount > 500);
        
        if (!soprInfo) {
            throw new Error("Krytyczny błąd profilowania: Żadna z tablic nie pasuje do charakterystyki matematycznej wskaźnika SOPR.");
        }
        console.log(`[LOG] Identyfikacja udana. Tablica #${soprInfo.idx} to poszukiwany STH-SOPR.`);

        // Szukamy tablicy dat, która ma dokładnie taką samą liczbę elementów co nasz SOPR
        const dateInfo = parsedArrays.find(arr => arr.isDateArray && arr.items.length === soprInfo.items.length);
        
        if (!dateInfo) {
            throw new Error("Krytyczny błąd synchronizacji: Nie znaleziono tablicy dat dopasowanej długością do wskaźnika SOPR.");
        }

        // ODWRÓCONE SKANOWANIE (Pętla wsteczna): Idziemy od końca tablicy, pomijając przyszłe nulle
        let latestDate = null;
        let latestValue = null;

        for (let i = soprInfo.items.length - 1; i >= 0; i--) {
            let rawVal = soprInfo.items[i];
            let val = (rawVal === 'null' || rawVal === undefined) ? null : parseFloat(rawVal);
            
            if (val !== null && !isNaN(val)) {
                latestValue = val;
                latestDate = dateInfo.items[i].replace(/["'\s]/g, ''); // Czyszczenie formatu daty
                break;
            }
        }

        if (!latestDate || latestValue === null) {
            throw new Error("Nie udało się wypreparować żadnej niepustej wartości liczbowej z serii.");
        }

        console.log(`[SUCCESS] Znaleziono aktualny koniec wykresu rynkowego!`);
        console.log(`[SUCCESS] Najnowszy realny zapis: Dzień = ${latestDate} | Wartość STH-SOPR = ${latestValue}`);

        // Zapis do bazy danych JSON
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
                console.log(`[LOG] Dane dla dnia ${latestDate} są już zbieżne z bazą. Brak zmian.`);
            }
        } else {
            localDatabase.push({
                date: latestDate,
                value: latestValue,
                updatedAt: new Date().toISOString()
            });
            console.log(`[LOG] Pomyślnie dopisano nowy punkt historyczny dla daty: ${latestDate}`);
        }

        fs.writeFileSync(DATA_PATH, JSON.stringify(localDatabase, null, 2), 'utf-8');
        console.log(`[SUCCESS] Plik bazy danych JSON został pomyślnie zapisany.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    }
}

main();
