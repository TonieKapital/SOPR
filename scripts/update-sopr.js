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
        console.log("[LOG] Uruchamianie Skanera Struktur Płaskich...");
        
        const flatArrays = [];
        let i = 0;

        // Wyciągamy z dokumentu wszystkie niezniszczone, płaskie tablice danych
        while (i < html.length) {
            let start = html.indexOf('[', i);
            if (start === -1) break;
            let end = html.indexOf(']', start);
            if (end === -1) break;
            
            let content = html.substring(start + 1, end);
            
            // Kryterium płaskiej tablicy: brak obiektów i zagnieżdżonych struktur wewnątrz
            if (!content.includes('[') && !content.includes('{') && content.length > 1000) {
                flatArrays.push({
                    raw: content,
                    length: content.length
                });
            }
            i = end + 1;
        }

        console.log(`[LOG] Wykryto ${flatArrays.length} długich serii danych. Klasyfikacja matematyczna linii...`);

        let btcDates = null;
        let soprValues = null;

        for (let arr of flatArrays) {
            let clean = arr.raw.replace(/[\s"'\\]/g, '');
            let items = clean.split(',');
            
            if (items.length < 1000) continue; // Ignorujemy mniejsze serie techniczne

            // Wykrywanie serii osi czasu (daty zawierające myślniki formatu YYYY-MM-DD)
            let isDateArray = items.slice(0, 15).some(item => item.includes('-') && item.length >= 8);
            
            if (isDateArray) {
                if (!btcDates || items.length > btcDates.length) {
                    btcDates = items; // Zabezpieczamy najdłuższą oś czasu
                }
                continue;
            }

            // Analiza serii numerycznej pod kątem profilu STH-SOPR
            let numbers = items.map(v => parseFloat(v)).filter(v => !isNaN(v));
            if (numbers.length === 0) continue;

            let avg = numbers.reduce((sum, val) => sum + val, 0) / numbers.length;

            // Krytyczny filtr profilu: SOPR z definicji makro oscyluje bardzo blisko wartości 1.0
            if (avg > 0.85 && avg < 1.15) {
                soprValues = items.map(v => v === 'null' ? null : parseFloat(v));
                console.log(`[LOG] Sukces klasyfikacji! Zidentyfikowano linię STH-SOPR. Punkty: ${items.length}, Średnia cyklu: ${avg.toFixed(4)}`);
            }
        }

        if (!soprValues || !btcDates) {
            throw new Error("Algorytm klasyfikacji nie dopasował profilu matematycznego wskaźnika SOPR lub osi dat.");
        }

        // Odwrócone skanowanie pętli w poszukiwaniu najnowszego, realnego zamknięcia dnia (omijamy przyszłe nulle)
        let latestDate = null;
        let latestValue = null;

        for (let idx = soprValues.length - 1; idx >= 0; idx--) {
            let val = soprValues[idx];
            if (val !== null && !isNaN(val)) {
                latestValue = val;
                // Skrypt dopasowuje indeks daty do struktury wartości
                latestDate = btcDates[idx] ? btcDates[idx].replace(/["'\s]/g, '') : null;
                break;
            }
        }

        if (!latestDate || latestValue === null) {
            throw new Error("Wyciągnięta seria nie zawiera poprawnych punktów danych rynkowych.");
        }

        console.log(`[SUCCESS] Znaleziono aktualną pozycję wskaźnika!`);
        console.log(`[SUCCESS] Odczyt: Dzień = ${latestDate} | Wartość STH-SOPR = ${latestValue}`);

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
                console.log(`[LOG] Dane dla dnia ${latestDate} są zbieżne. Brak modyfikacji.`);
            }
        } else {
            localDatabase.push({
                date: latestDate,
                value: latestValue,
                updatedAt: new Date().toISOString()
            });
            console.log(`[LOG] Pomyślnie dopisano nowy rekord historyczny dla daty: ${latestDate}`);
        }

        fs.writeFileSync(DATA_PATH, JSON.stringify(localDatabase, null, 2), 'utf-8');
        console.log(`[SUCCESS] Baza danych JSON została pomyślnie zaktualizowana.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    }
}

main();
