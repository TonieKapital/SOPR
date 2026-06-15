/**
 * Skrypt automatycznie pobierający najnowszą wartość wskaźnika STH-SOPR ze strony CheckOnChain.
 * Wersja V7: Parser oparty na wyszukiwaniu tokenów i precyzyjnym dopasowaniu głębokości nawiasów.
 */

const fs = require('fs');
const path = require('path');

const URL = 'https://charts.checkonchain.com/btconchain/realised/sthsopr_indicator/sthsopr_indicator_light.html';
const DATA_PATH = path.join(__dirname, '../data/sth-sopr.json');

// Funkcja precyzyjnie wycinająca zawartość tablicy z uwzględnieniem zagnieżdżeń
function extractArrayAt(html, startPos) {
    let startBracket = html.indexOf('[', startPos);
    if (startBracket === -1) return null;
    
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
    
    if (endBracket !== -1) {
        return html.substring(startBracket + 1, endBracket);
    }
    return null;
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
        console.log(`[LOG] Pomyślnie pobrano kod HTML (Długość dokumentu: ${html.length} znaków).`);

        console.log("[LOG] Skanowanie semantyczne w poszukiwaniu serii wartości (oś Y)...");
        
        let pos = 0;
        const discoveredY = [];

        // KROK 1: Lokalizujemy wszystkie właściwości wykresu odpowiadające za oś Y
        while (pos < html.length) {
            let idx = html.indexOf('y', pos);
            if (idx === -1) break;
            
            // Pobieramy kontekst wokół znaku 'y' (5 znaków przed, 20 po)
            let slice = html.substring(Math.max(0, idx - 5), Math.min(html.length, idx + 20));
            let cleanSlice = slice.replace(/[\s"'\\]/g, '');
            
            // Sprawdzamy czy to deklaracja serii danych Plotly np. y: [ lub "y": [
            if (cleanSlice.includes('y:')) {
                let content = extractArrayAt(html, idx);
                if (content && content.length > 1000) { // Interesują nas tylko duże serie danych
                    discoveredY.push({ content, startPos: idx });
                }
            }
            pos = idx + 1;
        }

        console.log(`[LOG] Zlokalizowano ${discoveredY.length} czystych serii liczbowych. Filtrowanie wskaźnika STH-SOPR...`);

        let winningY = null;
        let soprValues = null;

        // KROK 2: Analizujemy wartości serii, szukając profilu SOPR (średnia bliska 1.0)
        for (let yData of discoveredY) {
            let cleanRaw = yData.content.replace(/[\s\\"']/g, '');
            let items = cleanRaw.split(',');
            let validNumbers = items.map(v => parseFloat(v)).filter(v => !isNaN(v));
            
            if (validNumbers.length > 500) {
                let avg = validNumbers.reduce((sum, val) => sum + val, 0) / validNumbers.length;
                if (avg > 0.5 && avg < 2.0) {
                    winningY = yData;
                    soprValues = items.map(v => v === 'null' ? null : parseFloat(v));
                    console.log(`[LOG] Sukces! Seria na pozycji ${yData.startPos} to STH-SOPR (Globalna średnia: ${avg.toFixed(4)})`);
                    break;
                }
            }
        }

        if (!winningY || !soprValues) {
            throw new Error("Nie znaleziono serii liczbowej odpowiadającej profilowi wskaźnika SOPR.");
        }

        // KROK 3: Szukamy dopasowanej serii dat (oś X) w otoczeniu (okienko 10k znaków) zidentyfikowanego SOPR
        console.log("[LOG] Poszukiwanie powiązanej osi czasu (X)...");
        let searchStart = Math.max(0, winningY.startPos - 10000);
        let searchEnd = Math.min(html.length, winningY.startPos + 10000);
        let windowText = html.substring(searchStart, searchEnd);
        
        let localPos = 0;
        let soprDates = null;

        while (localPos < windowText.length) {
            let xIdx = windowText.indexOf('x', localPos);
            if (xIdx === -1) break;
            
            let slice = windowText.substring(Math.max(0, xIdx - 5), Math.min(windowText.length, xIdx + 20));
            let cleanSlice = slice.replace(/[\s"'\\]/g, '');
            
            if (cleanSlice.includes('x:')) {
                let absoluteXIdx = searchStart + xIdx;
                let xContent = extractArrayAt(html, absoluteXIdx);
                if (xContent) {
                    let items = xContent.replace(/[\s\\"']/g, '').split(',').filter(i => i.length > 0);
                    // Oś czasu musi mieć dokładnie tę samą długość co wskaźnik
                    if (items.length === soprValues.length) {
                        soprDates = items;
                        console.log(`[LOG] Sukces! Zsynchronizowano oś czasu (Liczba rekordów: ${soprDates.length})`);
                        break;
                    }
                }
            }
            localPos = xIdx + 1;
        }

        if (!soprDates) {
            throw new Error("Błąd krytyczny: Nie udało się odnaleźć dopasowanej osi dat dla tego wykresu.");
        }

        // KROK 4: Odwrócona pętla (Backward Scan) - bierzemy ostatni dzień pomijając przyszłe nulle (padding)
        let latestDate = null;
        let latestValue = null;

        for (let i = soprValues.length - 1; i >= 0; i--) {
            let val = soprValues[i];
            if (val !== null && !isNaN(val)) {
                latestValue = val;
                latestDate = soprDates[i];
                break;
            }
        }

        if (!latestDate || latestValue === null) {
            throw new Error("Seria danych nie zawiera żadnej poprawnej wartości rynkowej.");
        }

        console.log(`[SUCCESS] Najnowszy realny odczyt z rynku: Dzień = ${latestDate} | Wartość STH-SOPR = ${latestValue}`);

        // KROK 5: Zapis do bazy danych JSON
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
            console.log(`[LOG] Dodano nowy rekord historyczny dla daty: ${latestDate}`);
        }

        fs.writeFileSync(DATA_PATH, JSON.stringify(localDatabase, null, 2), 'utf-8');
        console.log(`[SUCCESS] Pl
