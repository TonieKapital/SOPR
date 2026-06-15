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
        console.log(`[LOG] Pomyślnie pobrano kod HTML (${html.length} znaków).`);
        console.log("[LOG] Uruchamianie pancernego skanera najgłębszych tablic płaskich...");

        const flatArrays = [];
        let pos = 0;
        
        // Algorytm wyciągający wyłącznie nienaruszone, płaskie tablice wartości
        while (true) {
            let endIdx = html.indexOf(']', pos);
            if (endIdx === -1) break;
            
            // Szukamy najbliższego otwarcia nawiasu bezpośrednio przed tym domknięciem
            let startIdx = html.lastIndexOf('[', endIdx);
            if (startIdx !== -1 && startIdx >= pos) {
                let content = html.substring(startIdx + 1, endIdx);
                // Interesują nas tylko gigantyczne serie danych, pomijamy tablice konfiguracyjne
                if (content.length > 1000 && !content.includes('[')) {
                    flatArrays.push(content);
                }
            }
            pos = endIdx + 1;
        }

        console.log(`[LOG] Wyodrębniono ${flatArrays.length} długich serii danych. Klasyfikacja matematyczna...`);

        let btcDates = null;
        let soprValues = null;

        for (let rawContent of flatArrays) {
            // Bezpieczne, nie-zachłanne czyszczenie pojedynczych elementów z cudzysłowów i spacji
            let items = rawContent.split(',').map(v => v.replace(/[\s"'\\]/g, ''));
            if (items.length < 500) continue;

            // Klasyfikacja serii osi czasu (daty formatu YYYY-MM-DD)
            let isDate = items.slice(0, 30).some(v => /^\d{4}-\d{2}-\d{2}$/.test(v));
            if (isDate) {
                if (!btcDates || items.length > btcDates.length) {
                    btcDates = items;
                }
                continue;
            }

            // Klasyfikacja serii numerycznej (wskaźnik rynkowy)
            let numbers = items.map(v => v === 'null' ? null : parseFloat(v)).filter(v => v !== null && !isNaN(v));
            if (numbers.length === 0) continue;

            // Obliczamy globalną średnią linii
            let avg = numbers.reduce((sum, val) => sum + val, 0) / numbers.length;
            console.log(`[DEBUG] Wykryto serię liczb | Długość: ${items.length} | Średnia: ${avg.toFixed(4)}`);

            // Dokładna identyfikacja: cena BTC to tysiące USD, natomiast SOPR oscyluje wokół 1.0 (zakres 0.5 - 2.0)
            if (avg > 0.5 && avg < 2.0) {
                soprValues = items.map(v => v === 'null' ? null : parseFloat(v));
                console.log(`[SUCCESS] Zidentyfikowano właściwą linię STH-SOPR ze średnią: ${avg.toFixed(4)}`);
            }
        }

        if (!soprValues || !btcDates) {
            throw new Error("Algorytm klasyfikacji nie dopasował profilu matematycznego wskaźnika SOPR lub osi dat.");
        }

        // Odwrócona pętla (Backward Scan) - pobieramy najświeższy dzień ignorując przyszłe nulle paddingu
        let latestDate = null;
        let latestValue = null;

        for (let idx = soprValues.length - 1; idx >= 0; idx--) {
            let val = soprValues[idx];
            if (val !== null && !isNaN(val)) {
                latestValue = val;
                latestDate = btcDates[idx];
                break;
            }
        }

        if (!latestDate || latestValue === null) {
            throw new Error("Brak prawidłowych danych rynkowych na końcu serii.");
        }

        console.log(`[SUCCESS] Sukces automatyzacji!`);
        console.log(`[SUCCESS] Najnowszy punkt: Dzień = ${latestDate} | Wartość STH-SOPR = ${latestValue}`);

        // Aktualizacja bazy danych JSON
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
                console.log(`[LOG] Brak zmian dla dnia ${latestDate}.`);
            }
        } else {
            localDatabase.push({
                date: latestDate,
                value: latestValue,
                updatedAt: new Date().toISOString()
            });
            console.log(`[LOG] Dodano nowy rekord dla dnia ${latestDate}`);
        }

        fs.writeFileSync(DATA_PATH, JSON.stringify(localDatabase, null, 2), 'utf-8');
        console.log(`[SUCCESS] Baza danych JSON została pomyślnie zaktualizowana.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    }
}

main();
