const fs = require('fs');
const path = require('path');
const zlib = require('zlib'); // Natywny moduł Node.js do obsługi binarnej kompresji

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
        
        let html = await response.text();
        console.log(`[LOG] Pomyślnie pobrano kod HTML (${html.length} znaków).`);

        // KROK 1: Wyciągamy z pliku wszystkie tekstowe tablice dat (oś X)
        console.log("[LOG] Wyodrębnianie tekstowych osi czasu...");
        const dateSegments = [];
        let dPos = 0;
        while (true) {
            let start = html.indexOf('[', dPos);
            if (start === -1) break;
            let end = html.indexOf(']', start);
            if (end === -1) break;
            
            let content = html.substring(start + 1, end);
            if (content.length > 1000 && content.includes('-')) {
                let items = content.replace(/[\s"'\\]/g, '').split(',');
                if (items.slice(0, 10).some(v => /^\d{4}-\d{2}-\d{2}/.test(v))) {
                    dateSegments.push(items.map(v => v.substring(0, 10)));
                }
            }
            dPos = end + 1;
        }

        let btcDates = dateSegments.sort((a, b) => b.length - a.length)[0];
        if (!btcDates) {
            throw new Error("Nie udało się zlokalizować tekstowej osi dat na stronie.");
        }
        console.log(`[LOG] Sukces! Zabezpieczono główną oś czasu. Liczba dni: ${btcDates.length}`);

        // KROK 2: Skanowanie i dekodowanie binarnych strumieni Base64 (oś Y)
        console.log("[LOG] Uruchamianie dekodera strumieni binarnych Base64...");
        let soprValues = null;
        let pos = 0;

        while (pos < html.length) {
            let yIdx = html.indexOf('"y"', pos);
            if (yIdx === -1) yIdx = html.indexOf('y:', pos);
            if (yIdx === -1) break;

            let colonIdx = html.indexOf(':', yIdx);
            if (colonIdx !== -1 && colonIdx - yIdx < 15) {
                let quoteIdx = -1;
                for (let i = colonIdx + 1; i < colonIdx + 30; i++) {
                    if (html[i] === '"' || html[i] === "'") {
                        quoteIdx = i;
                        break;
                    }
                }
                
                if (quoteIdx !== -1) {
                    let quoteChar = html[quoteIdx];
                    let closeQuoteIdx = html.indexOf(quoteChar, quoteIdx + 1);
                    if (closeQuoteIdx !== -1) {
                        let b64Str = html.substring(quoteIdx + 1, closeQuoteIdx).trim();
                        
                        // Czyścimy znaki ucieczki Unicode jeśli występują (np. \u002f)
                        b64Str = b64Str.replace(/\\u002f/g, '/').replace(/\\/g, '');

                        if (b64Str.length > 500) {
                            try {
                                let buf = Buffer.from(b64Str, 'base64');
                                
                                // Próba automatycznej dekompresji bufora (zlib / gzip)
                                let uncompressed = buf;
                                try { uncompressed = zlib.inflateSync(buf); } catch(e) {
                                    try { uncompressed = zlib.gunzipSync(buf); } catch(err) {}
                                }

                                // Próba odczytu jako Float64Array (standard Plotly Python)
                                let f64 = new Float64Array(uncompressed.buffer, uncompressed.byteOffset, uncompressed.byteLength / 8);
                                let valid64 = Array.from(f64).filter(v => !isNaN(v) && v !== 0);
                                
                                if (valid64.length > 1000) {
                                    let avg = valid64.reduce((a, b) => a + b, 0) / valid64.length;
                                    if (avg > 0.85 && avg < 1.15) {
                                        soprValues = Array.from(f64).map(v => isNaN(v) ? null : v);
                                        console.log(`[SUCCESS] Zidentyfikowano wskaźnik STH-SOPR w strumieniu Float64! Średnia: ${avg.toFixed(4)}`);
                                        break;
                                    }
                                }

                                // Alternatywna próba odczytu jako Float32Array
                                let f32 = new Float32Array(uncompressed.buffer, uncompressed.byteOffset, uncompressed.byteLength / 4);
                                let valid32 = Array.from(f32).filter(v => !isNaN(v) && v !== 0);
                                
                                if (valid32.length > 1000) {
                                    let avg = valid32.reduce((a, b) => a + b, 0) / valid32.length;
                                    if (avg > 0.85 && avg < 1.15) {
                                        soprValues = Array.from(f32).map(v => isNaN(v) ? null : v);
                                        console.log(`[SUCCESS] Zidentyfikowano wskaźnik STH-SOPR w strumieniu Float32! Średnia: ${avg.toFixed(4)}`);
                                        break;
                                    }
                                }
                            } catch (err) {}
                        }
                        pos = closeQuoteIdx + 1;
                        continue;
                    }
                }
            }
            pos = yIdx + 1;
        }

        // KROK 3: Globalny fallback na wypadek specyficznego zagnieżdżenia obiektów Plotly
        if (!soprValues) {
            console.log("[LOG] Tradycyjne przypisanie zawiodło. Uruchamianie skanera globalnego Base64...");
            let b64Regex = /"([A-Za-z0-9+/={},\\]{1000,})"/g;
            let matches = html.matchAll(b64Regex);
            
            for (let match of matches) {
                let cleanStr = match[1].replace(/\\u002f/g, '/').replace(/\\/g, '');
                try {
                    let buf = Buffer.from(cleanStr, 'base64');
                    let uncompressed = buf;
                    try { uncompressed = zlib.inflateSync(buf); } catch(e) {
                        try { uncompressed = zlib.gunzipSync(buf); } catch(err) {}
                    }
                    
                    let f64 = new Float64Array(uncompressed.buffer, uncompressed.byteOffset, uncompressed.byteLength / 8);
                    let valid64 = Array.from(f64).filter(v => !isNaN(v) && v !== 0);
                    
                    if (valid64.length > 1000) {
                        let avg = valid64.reduce((a, b) => a + b, 0) / valid64.length;
                        if (avg > 0.85 && avg < 1.15) {
                            soprValues = Array.from(f64).map(v => isNaN(v) ? null : v);
                            console.log(`[SUCCESS] Zlokalizowano SOPR przez skaner globalny! Średnia: ${avg.toFixed(4)}`);
                            break;
                        }
                    }
                } catch(e) {}
            }
        }

        if (!soprValues) {
            throw new Error("Dekoder binarny nie wyodrębnił serii odpowiadającej profilowi STH-SOPR.");
        }

        // KROK 4: Pobieranie najświeższego punktu (od tyłu pętli, omijając nulle z przyszłości)
        let latestDate = null;
        let latestValue = null;

        for (let idx = soprValues.length - 1; idx >= 0; idx--) {
            let val = soprValues[idx];
            if (val !== null && !isNaN(val) && val !== 0) {
                latestValue = val;
                latestDate = btcDates[idx] || btcDates[btcDates.length - 1];
                break;
            }
        }

        if (!latestDate || latestValue === null) {
            throw new Error("Zdekodowana seria binarnej osi Y nie zawiera prawidłowych liczb końcowych.");
        }

        console.log(`[SUCCESS] Odczyt udany! Dzień = ${latestDate} | Wartość STH-SOPR = ${latestValue}`);

        // KROK 5: Zapis struktury do pliku bazy danych JSON
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
                console.log(`[LOG] Brak zmian dla dnia ${latestDate}. Dane aktualne.`);
            }
        } else {
            localDatabase.push({
                date: latestDate,
                value: latestValue,
                updatedAt: new Date().toISOString()
            });
            console.log(`[LOG] Dodano nowy rekord historyczny dla dnia ${latestDate}`);
        }

        fs.writeFileSync(DATA_PATH, JSON.stringify(localDatabase, null, 2), 'utf-8');
        console.log(`[SUCCESS] Baza danych JSON została pomyślnie zaktualizowana.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    }
}

main();
