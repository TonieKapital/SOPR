/**
 * Skrypt automatycznie pobierający najnowszą wartość wskaźnika STH-SOPR ze strony CheckOnChain.
 * Wykorzystuje wyrażenia regularne (Regex) do wyciągnięcia danych wstrzykniętych w wykres Plotly.
 * Działa w czystym środowisku Node.js (18+) bez zewnętrznych zależności npm.
 */

const fs = require('fs');
const path = require('path');

const URL = 'https://charts.checkonchain.com/btconchain/realised/sthsopr_indicator/sthsopr_indicator_light.html';
const DATA_PATH = path.join(__dirname, '../data/sth-sopr.json');

async function main() {
    try {
        console.log(`[LOG] Rozpoczynanie pobierania danych z: ${URL}`);
        
        // Pobieranie kodu źródłowego HTML za pomocą natywnego fetch() dostępnego w Node.js 18+
        const response = await fetch(URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Nie udało się pobrać strony. Status HTTP: ${response.status} ${response.statusText}`);
        }
        
        const html = await response.text();
        console.log("[LOG] Pomyślnie pobrano kod HTML. Rozpoczynanie parsowania wyrażeniami regularnymi...");

        // Regex dopasowujący tablice Plotly dla osi x (daty) oraz y (wartości)
        const xMatches = [...html.matchAll(/(?:"x"|x)\s*:\s*\[([^\]]+)\]/g)];
        const yMatches = [...html.matchAll(/(?:"y"|y)\s*:\s*\[([^\]]+)\]/g)];

        if (xMatches.length === 0 || yMatches.length === 0) {
            throw new Error("Krytyczny błąd: Nie odnaleziono tablic danych x lub y w strukturze Plotly w kodzie HTML.");
        }

        console.log(`[LOG] Wykryto ${xMatches.length} serii danych w kodzie źródłowym.`);

        let selectedIndex = -1;

        for (let i = 0; i < xMatches.length; i++) {
            const rawY = yMatches[i] ? yMatches[i][1] : '';
            const sampleValues = rawY.split(',')
                .slice(-10)
                .map(v => parseFloat(v.trim()))
                .filter(v => !isNaN(v));

            if (sampleValues.length > 0) {
                const avg = sampleValues.reduce((sum, val) => sum + val, 0) / sampleValues.length;
                if (avg > 0.5 && avg < 2.0) {
                    selectedIndex = i;
                    console.log(`[LOG] Dopasowano serię danych wskaźnika STH-SOPR na indeksie: ${i} (średnia próbek: ${avg.toFixed(4)})`);
                    break;
                }
            }
        }

        if (selectedIndex === -1) {
            console.warn("[WARN] Heurystyka wartości zawiodła. Wybieranie serii z największą liczbą punktów danych.");
            let maxElements = 0;
            for (let i = 0; i < xMatches.length; i++) {
                const count = xMatches[i][1].split(',').length;
                if (count > maxElements) {
                    maxElements = count;
                    selectedIndex = i;
                }
            }
        }

        const rawX = xMatches[selectedIndex][1];
        const rawY = yMatches[selectedIndex][1];

        const dates = rawX.split(',').map(d => d.replace(/["'\s]/g, ''));
        const values = rawY.split(',').map(v => {
            const trimmed = v.trim();
            return trimmed === 'null' ? null : parseFloat(trimmed);
        });

        if (dates.length === 0 || values.length === 0 || dates.length !== values.length) {
            throw new Error(`Niezgodność danych: Liczba dat (${dates.length}) nie odpowiada liczbie wartości (${values.length}).`);
        }

        const latestDate = dates[dates.length - 1];
        const latestValue = values[values.length - 1];

        if (!latestDate || latestValue === null || isNaN(latestValue)) {
            throw new Error("Najnowszy punkt danych zawiera nieprawidłowe lub puste wartości (null/NaN).");
        }

        console.log(`[SUCCESS] Pomyślnie sparsowano najnowszy odczyt: Dzień = ${latestDate} | Wartość STH-SOPR = ${latestValue}`);

        const targetDir = path.dirname(DATA_PATH);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        let localDatabase = [];
        if (fs.existsSync(DATA_PATH)) {
            try {
                const fileContent = fs.readFileSync(DATA_PATH, 'utf-8');
                localDatabase = JSON.parse(fileContent);
            } catch (e) {
                console.warn("[WARN] Baza danych JSON była uszkodzona lub pusta. Nadpisywanie nową strukturą.");
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
                console.log(`[LOG] Dane dla dnia ${latestDate} są już identyczne w bazie. Brak zmian.`);
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
        console.log(`[SUCCESS] Plik bazy danych '${DATA_PATH}' został pomyślnie zapisany.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    }
}

main();