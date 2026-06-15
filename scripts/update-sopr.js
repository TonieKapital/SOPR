const fs = require('fs');
const path = require('path');

const URL = 'https://charts.checkonchain.com/btconchain/realised/sthsopr_indicator/sthsopr_indicator_light.html';
const DATA_PATH = path.join(__dirname, '../data/sth-sopr.json');

// Precyzyjne wycinanie zawartości tablicy [ ] z uwzględnieniem głębokości nawiasów
function extractArrayAt(html, startPos) {
    let startBracket = html.indexOf('[', startPos);
    if (startBracket === -1 || (startBracket - startPos) > 30) return null;
    
    let depth = 1;
    let endBracket = -1;
    
    for (let i = startBracket + 1; i < html.length; i++) {
        if (html[i] === '[') depth++;
        else if (html[i] === ']') depth--;
        
        if (depth === 0) {
            endBracket = i;
            break;
        }
    }
    return endBracket !== -1 ? html.substring(startBracket + 1, endBracket) : null;
}

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
        console.log("[LOG] Skanowanie kontekstowe struktur wykresów Plotly...");
        
        let pos = 0;
        const matchingSoprTraces = [];
        let globalDatesArray = null;

        while (pos < html.length) {
            let idx = html.indexOf('y', pos);
            if (idx === -1) break;
            
            let slice = html.substring(Math.max(0, idx - 5), Math.min(html.length, idx + 20));
            let cleanSlice = slice.replace(/[\s"'\\]/g, '');
            
            if (cleanSlice.includes('y:')) {
                let yContent = extractArrayAt(html, idx);
                if (yContent && yContent.length > 1000) {
                    
                    // Pobieramy kontekst tekstowy wokół tej serii (2500 znaków przed i po)
                    let contextWindow = html.substring(Math.max(0, idx - 2500), Math.min(html.length, idx + 2500));
                    
                    // Sprawdzamy czy w otoczeniu tej serii znajduje się wzmianka o SOPR
                    if (/sopr|short-term/i.test(contextWindow)) {
                        const cleanY = yContent.replace(/[\s\\"']/g, '');
                        const itemsY = cleanY.split(',');
                        
                        // Próbujemy wyciągnąć oś czasu (X) z tego samego bloku kontekstowego
                        let xIdx = contextWindow.indexOf('x:');
                        if (xIdx === -1) xIdx = contextWindow.indexOf('"x":');
                        
                        if (xIdx !== -1) {
                            let absoluteXIdx = Math.max(0, idx - 2500) + xIdx;
                            let xContent = extractArrayAt(html, absoluteXIdx);
                            if (xContent) {
                                const itemsX = xContent.replace(/[\s\\"']/g, '').split(',').filter(d => d.length > 0);
                                if (itemsX.length === itemsY.length) {
                                    globalDatesArray = itemsX;
                                }
                            }
                        }
                        
                        matchingSoprTraces.push(itemsY);
                        console.log(`[LOG] Znaleziono serię powiązaną ze wskaźnikiem SOPR (Liczba punktów: ${itemsY.length})`);
                    }
                }
            }
            pos = idx + 1;
        }

        if (matchingSoprTraces.length === 0 || !globalDatesArray) {
            throw new Error("Krytyczny błąd: Algorytm kontekstowy nie zidentyfikował serii powiązanych ze słowem kluczowym SOPR.");
        }

        console.log(`[LOG] Zlokalizowano segmenty wskaźnika (Suma serii: ${matchingSoprTraces.length}). Scalanie danych w jedną linię bazową...`);

        // Inteligentne scalanie: Jeśli wykres był podzielony na strefy >1 i <1, łączymy je w jeden nieprzerwany ciąg
        const finalSoprValues = [];
        const dataLength = globalDatesArray.length;

        for (let i = 0; i < dataLength; i++) {
            let mergedValue = null;
            
            for (let trace of matchingSoprTraces) {
                let rawVal = trace[i];
                if (rawVal !== undefined && rawVal !== 'null' && rawVal !== '') {
                    let parsed = parseFloat(rawVal);
                    if (!isNaN(parsed)) {
                        mergedValue = parsed;
                        break;
                    }
                }
            }
            finalSoprValues.push(mergedValue);
        }

        // Pętla wsteczna (Backward Scan) poszukująca ostatniego dnia, który nie jest nullem (omijanie przyszłego paddingu)
        let latestDate = null;
        let latestValue = null;

        for (let i = finalSoprValues.length - 1; i >= 0; i--) {
            if (finalSoprValues[i] !== null) {
                latestValue = finalSoprValues[i];
                latestDate = globalDatesArray[i];
                break;
            }
        }

        if (!latestDate || latestValue === null) {
            throw new Error("Błąd agregacji: Zrekonstruowana seria danych nie zawiera poprawnych punktów rynkowych.");
        }

        console.log(`[SUCCESS] Koniec wykresu zidentyfikowany pomyślnie!`);
        console.log(`[SUCCESS] Najnowszy dzień w sieci: ${latestDate} | Wartość STH-SOPR = ${latestValue}`);

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
                console.log(`[LOG] Zaktualizowano odczyt dla dnia ${latestDate}.`);
            } else {
                console.log(`[LOG] Wpis dla daty ${latestDate} jest aktualny. Brak zmian.`);
            }
        } else {
            localDatabase.push({
                date: latestDate,
                value: latestValue,
                updatedAt: new Date().toISOString()
            });
            console.log(`[LOG] Pomyślnie dopisano nowy rekord historyczny dla dnia: ${latestDate}`);
        }

        fs.writeFileSync(DATA_PATH, JSON.stringify(localDatabase, null, 2), 'utf-8');
        console.log(`[SUCCESS] Plik bazy danych JSON został zaktualizowany.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    }
}

main();
