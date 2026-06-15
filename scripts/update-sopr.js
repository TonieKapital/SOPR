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
        console.log(`[LOG] Pomyślnie pobrano kod HTML (Długość: ${html.length} znaków).`);
        console.log("[LOG] Uruchamianie pancernego skanera najgłębszych tablic płaskich...");
        
        const flatArrays = [];
        let pos = 0;

        // Algorytm wyciągający wyłącznie najgłębsze, płaskie tablice (bez zagnieżdżeń)
        while (true) {
            let start = html.indexOf('[', pos);
            if (start === -1) break;
            
            let nextEnd = html.indexOf(']', start);
            if (nextEnd === -1) break;
            
            // Kluczowy krok: szukamy OSTATNIEGO otwarcia nawiasu przed znalezionym zamknięciem
            let trueStart = html.lastIndexOf('[', nextEnd);
            
            if (trueStart !== -1) {
                let content = html.substring(trueStart + 1, nextEnd);
                // Interesują nas tylko długie serie danych rynkowych
                if (content.length > 1000) {
                    flatArrays.push(content);
                }
            }
            pos = nextEnd + 1;
        }

        console.log(`[LOG] Wyodrębniono ${flatArrays.length} rzeczywistych serii danych. Uruchamianie klasyfikacji...`);

        let btcDates = null;
        let soprValues = null;

        for (let rawContent of flatArrays) {
            let clean = rawContent.replace(/[\s"'\\]/g, '');
            let items = clean.split(',');
            
            if (items.length < 500) continue;

            // Sprawdzenie czy to oś czasu (daty zawierające myślniki)
            let isDateArray = items.slice(0, 20).some(item => item.includes('-') && item.length >= 8);
            
            if (isDateArray) {
                if (!btcDates || items.length > btcDates.length) {
                    btcDates = items;
                }
                continue;
            }

            // Sprawdzenie czy to seria numeryczna SOPR
            let numbers = items.map(v => parseFloat(v)).filter(v => !isNaN(v));
            if (numbers.length === 0) continue;

            let avg = numbers.reduce((sum, val) => sum + val, 0) / numbers.length;

            // Szeroki, bezpieczny filtr profilu: SOPR z definicji makro oscyluje wokół wartości 1.0
            if (avg > 0.5 && avg < 2.0) {
                soprValues = items.map(v => v === 'null' ? null : parseFloat(v));
                console.log(`[LOG] Sukces! Zidentyfikowano linię STH-SOPR. Elementy: ${items.length}, Średnia cyklu: ${avg.toFixed(4)}`);
            }
        }

        if (!soprValues || !btcDates) {
            throw new Error("Algorytm klasyfikacji nie dopasował profilu matematycznego wskaźnika SOPR lub osi dat.");
        }

        console.log(`[LOG] Synchronizacja struktur udana. Szukanie najnowszego odczytu rynkowego...`);

        let latestDate = null;
        let latestValue = null;

        // Skanowanie od tyłu w celu pominięcia przyszłego paddingu null
        for (let idx = soprValues.length - 1; idx >= 0; idx--) {
            let val = soprValues[idx];
            if (val !== null && !isNaN(val)) {
                latestValue = val;
                latestDate = btcDates[idx] ? btcDates[idx].replace(/["'\s]/g, '') : null;
                break;
            }
        }

        if (!latestDate || latestValue === null) {
            throw new Error("Wyciągnięta seria nie zawiera poprawnych punktów danych rynkowych.");
        }

        console.log(`[SUCCESS] Sukces automatyzacji!`);
        console.log(`[SUCCESS] Najnowszy dzień: ${latestDate} | Wartość STH-SOPR = ${latestValue}`);

        // Zapis struktury do pliku bazodanowego JSON
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
                console.log(`[LOG] Zaktualizowano wartość dla dnia ${latestDate}.`);
            } else {
                console.log(`[LOG] Dane dla dnia ${latestDate} są zbieżne. Brak zmian.`);
            }
        } else {
            localDatabase.push({
                date: latestDate,
                value: latestValue,
                updatedAt: new Date().toISOString()
            });
            console.log(`[LOG] Pomyślnie dopisano nowy rekord dla daty: ${latestDate}`);
        }

        fs.writeFileSync(DATA_PATH, JSON.stringify(localDatabase, null, 2), 'utf-8');
        console.log(`[SUCCESS] Baza danych JSON została pomyślnie zapisana.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    }
}

main();
