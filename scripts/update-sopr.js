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
        console.log("[LOG] Lokaliowanie kotwic semantycznych dla wskaźnika STH-SOPR...");

        // Szukamy pozycji słów kluczowych w kodzie źródłowym
        const searchTerms = ["STH-SOPR", "Short-Term Holder", "sthsopr_indicator"];
        let anchors = [];
        
        for (let term of searchTerms) {
            let currPos = 0;
            while ((currPos = html.indexOf(term, currPos)) !== -1) {
                anchors.push(currPos);
                currPos += term.length;
            }
        }
        
        // Unifikacja i sortowanie znalezionych pozycji
        anchors = [...new Set(anchors)].sort((a, b) => a - b);
        
        if (anchors.length === 0) {
            throw new Error("Błąd krytyczny: Na stronie nie znaleziono żadnych wzmianek tekstowych o STH-SOPR.");
        }

        console.log(`[LOG] Znaleziono ${anchors.length} kotwic tekstowych. Uruchamianie autodiagnostyki i lokalnego skanowania...`);

        // DUMP DIAGNOSTYCZNY: Wypisujemy otoczenie pierwszej kotwicy do logów konsoli
        let diagStart = Math.max(0, anchors[0] - 300);
        let diagEnd = Math.min(html.length, anchors[0] + 700);
        console.log("\\n==================== [DIAGNOSTIC DUMP] ====================");
        console.log(html.substring(diagStart, diagEnd));
        console.log("============================================================\\n");

        let btcDates = null;
        let soprValues = null;

        // Dla każdej znalezionej kotwicy przeszukujemy jej najbliższe otoczenie rynkowe
        for (let anchor of anchors) {
            let startWin = Math.max(0, anchor - 150000);
            let endWin = Math.min(html.length, anchor + 150000);
            let windowText = html.substring(startWin, endWin);

            let wPos = 0;
            const localFlatArrays = [];

            // Wyciągamy płaskie tablice z wnętrza tego okna
            while (true) {
                let endIdx = windowText.indexOf(']', wPos);
                if (endIdx === -1) break;
                
                let startIdx = windowText.lastIndexOf('[', endIdx);
                if (startIdx !== -1 && startIdx >= wPos) {
                    let content = windowText.substring(startIdx + 1, endIdx);
                    if (content.length > 1000 && !content.includes('[')) {
                        localFlatArrays.push(content);
                    }
                }
                wPos = endIdx + 1;
            }

            // Klasyfikacja matematyczna wyekstrahowanych lokalnie tablic
            for (let rawContent of localFlatArrays) {
                let items = rawContent.split(',').map(v => v.replace(/[\s"'\\]/g, ''));
                if (items.length < 500) continue;

                let isDate = items.slice(0, 20).some(v => /^\d{4}-\d{2}-\d{2}$/.test(v));
                if (isDate) {
                    if (!btcDates || items.length > btcDates.length) {
                        btcDates = items;
                    }
                    continue;
                }

                let numbers = items.map(v => v === 'null' ? null : parseFloat(v)).filter(v => v !== null && !isNaN(v));
                if (numbers.length === 0) continue;

                let avg = numbers.reduce((sum, val) => sum + val, 0) / numbers.length;

                // Szukamy linii, której średnia oscyluje wokół 1.0 (to nasz SOPR!)
                if (avg > 0.85 && avg < 1.15) {
                    soprValues = items.map(v => v === 'null' ? null : parseFloat(v));
                    console.log(`[SUCCESS] Zlokalizowano lokalną serię STH-SOPR. Elementy: ${items.length}, Średnia: ${avg.toFixed(4)}`);
                    break;
                }
            }
            if (soprValues) break; // Jeśli znaleźliśmy dane, przerywamy sprawdzanie kolejnych kotwic
        }

        if (!soprValues || !btcDates) {
            throw new Error("Algorytm lokalnego skanowania okienkowego nie dopasował profilu linii SOPR.");
        }

        // Odwrócona pętla (Backward Scan) poszukująca ostatniego dnia bez paddingu null
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

        console.log(`[SUCCESS] Pobieranie zakończone sukcesem!`);
        console.log(`[SUCCESS] Dzień = ${latestDate} | Wartość STH-SOPR = ${latestValue}`);

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
        console.log(`[SUCCESS] Baza danych JSON została zaktualizowana.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    }
}

main();
