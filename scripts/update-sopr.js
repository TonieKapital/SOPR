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
        console.log("[LOG] Uruchamianie Globalnego Skanera Strumienia Tokenów...");

        // Rozbijamy cały dokument na płaskie elementy
        const rawTokens = html.split(',');
        console.log(`[LOG] Wygenerowano ${rawTokens.length} surowych tokenów tekstowych. Rozpoczynanie segmentacji cyklu...`);

        let segments = [];
        let currentType = null;
        let currentSegment = [];

        // KROK 1: Klasyfikacja i budowanie nieprzerwanych ciągów danych (Date / Number)
        for (let rawToken of rawTokens) {
            // Oczyszczamy token ze wszystkich znaków strukturalnych JavaScript/JSON
            let token = rawToken.replace(/[\s"'\\\{\}\[\]]/g, '');
            // Usuwamy ewentualne przypisania zmiennych typu x:, y:, name:
            token = token.replace(/^[a-zA-Z0-9_]+:/, '');

            let type = 'other';
            if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
                type = 'date';
            } else if (token === 'null' || (!isNaN(parseFloat(token)) && isFinite(token))) {
                type = 'number';
            }

            if (type === currentType) {
                currentSegment.push(token);
            } else {
                if (currentSegment.length > 0) {
                    segments.push({ type: currentType, data: currentSegment });
                }
                currentType = type;
                currentSegment = [token];
            }
        }
        if (currentSegment.length > 0) {
            segments.push({ type: currentType, data: currentSegment });
        }

        // KROK 2: Filtrowanie i identyfikacja struktur rynkowych
        const dateSegments = segments.filter(s => s.type === 'date' && s.data.length > 1000);
        const numberSegments = segments.filter(s => s.type === 'number' && s.data.length > 1000);

        console.log(`[LOG] Segmentacja zakończona. Wykryto długich serii dat: ${dateSegments.length}, serii liczb: ${numberSegments.length}`);

        let soprSegment = null;

        // Szukamy serii liczbowej, która idealnie odpowiada zachowaniu SOPR (średnia blisko 1.0)
        for (let seg of numberSegments) {
            let nums = seg.data.map(v => v === 'null' ? null : parseFloat(v)).filter(v => v !== null && !isNaN(v));
            if (nums.length > 0) {
                let avg = nums.reduce((sum, val) => sum + val, 0) / nums.length;
                // STH-SOPR oscyluje stabilnie w kanale wokół wartości neutralnej 1.0
                if (avg > 0.85 && avg < 1.15) {
                    soprSegment = seg;
                    console.log(`[LOG] Sukces! Zidentyfikowano nieprzerwany ciąg STH-SOPR. Długość: ${seg.data.length}, Średnia cyklu: ${avg.toFixed(4)}`);
                    break;
                }
            }
        }

        if (!soprSegment) {
            throw new Error("Krytyczny błąd: Żaden strumień liczb nie spełnia kryteriów matematycznych wskaźnika STH-SOPR.");
        }

        // Dopasowanie osi czasu o identycznej długości
        let matchingDateSeg = dateSegments.find(s => s.data.length === soprSegment.data.length);
        if (!matchingDateSeg && dateSegments.length > 0) {
            // Fallback do najdłuższego dostępnego ciągu dat w dokumencie
            matchingDateSeg = dateSegments.sort((a, b) => b.data.length - a.data.length)[0];
        }

        if (!matchingDateSeg) {
            throw new Error("Krytyczny błąd: Nie udało się odnaleźć dopasowanej osi czasu dla wyekstrahowanych liczb.");
        }

        // KROK 3: Odwrócone skanowanie pętli w celu pobrania najnowszego dnia (omijamy przyszły padding null)
        let latestDate = null;
        let latestValue = null;

        for (let idx = soprSegment.data.length - 1; idx >= 0; idx--) {
            let rawVal = soprSegment.data[idx];
            if (rawVal !== 'null') {
                let val = parseFloat(rawVal);
                if (!isNaN(val)) {
                    latestValue = val;
                    latestDate = matchingDateSeg.data[idx] ? matchingDateSeg.data[idx] : null;
                    break;
                }
            }
        }

        if (!latestDate || latestValue === null) {
            throw new Error("Agregacja strumienia nie zwróciła żadnej poprawnej wartości numerycznej.");
        }

        console.log(`[SUCCESS] Cel osiągnięty! Dane wyciągnięte pomyślnie.`);
        console.log(`[SUCCESS] Najnowszy rekord On-Chain: Dzień = ${latestDate} | Wartość STH-SOPR = ${latestValue}`);

        // KROK 4: Zapis do bazy danych JSON
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
                console.log(`[LOG] Wpis dla dnia ${latestDate} jest w pełni aktualny.`);
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
        console.log(`[SUCCESS] Baza danych JSON została pomyślnie zaktualizowana i zapisana.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    }
}

main();
