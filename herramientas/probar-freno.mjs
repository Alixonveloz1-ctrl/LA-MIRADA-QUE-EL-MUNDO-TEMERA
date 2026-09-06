#!/usr/bin/env node
// ¿ABSORBE EL FRENO LA CUOTA ANTES DE QUE LLEGUE A LA PANTALLA?
//
// Portado de un proyecto del mismo autor que lleva meses generando tandas de
// cientos de imágenes sin que el usuario vea un solo error de cuota. La idea es
// suya y funciona; esto comprueba que aquí funciona igual.
//
// Lo que se exige, y es lo que el usuario pidió con estas palabras: «aunque haya
// error de la cuota, igualmente todo se genera».
//
//   1. Un 429 NO llega a quien llamó: se frena, se espera y se reintenta solo.
//   2. Al frenar, la pausa entre llamadas SUBE, para que la siguiente no choque.
//   3. Con aciertos seguidos, la pausa BAJA — pero despacio, no de golpe.
//   4. Leer o escribir el estado NO se frena: eso habla con el bucket, no con un
//      modelo, y frenarlo dejaría la aplicación arrastrándose sin ganar cuota.
//   5. Y si la ventana no se abre nunca, el error sale TAL CUAL lo dijo Google.

import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = new URL('../', import.meta.url).pathname;

// El reloj de mentira: las esperas del freno son de minutos y aquí no se puede
// esperar minutos. Se sustituye setTimeout por uno que apunta cuánto se pidió y
// sigue al instante, así se comprueba CUÁNTO se habría esperado sin esperarlo.
const dormido = [];
const RELOJ_DE_ABORTO = 320000;   // LIMITE_MS: es el corte de cada llamada, no una espera
globalThis.setTimeout = (fn, ms) => {
  const n = Number(ms) || 0;
  if (n !== RELOJ_DE_ABORTO) dormido.push(n);
  Promise.resolve().then(fn);
  return 0;
};
globalThis.clearTimeout = () => {};

// El Google de mentira: contesta lo que diga la lista, en orden.
let respuestas = [];
const pedidas = [];
globalThis.fetch = async (_ruta, opciones) => {
  const modo = JSON.parse(opciones.body).modo;
  pedidas.push(modo);
  const toca = respuestas.shift() || { http: 200 };
  const cuerpo = toca.http === 200
    ? JSON.stringify({ ok: true, ruta: 'x' })
    : JSON.stringify({ ok: false, error: toca.error || 'Resource has been exhausted (e.g. check quota).' });
  return {
    ok: toca.http === 200,
    status: toca.http,
    headers: { get: (k) => (k === 'retry-after' ? toca.retryAfter || null : null) },
    text: async () => cuerpo,
  };
};
globalThis.window = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
                      dispatchEvent: () => {}, addEventListener: () => {} };
globalThis.CustomEvent = class { constructor(t, o) { Object.assign(this, o); this.type = t; } };
globalThis.AbortController = class { constructor() { this.signal = {}; } abort() {} };

const codigo = readFileSync(RAIZ + 'app/api.js', 'utf8')
  .replace(/^import[\s\S]*?from\s+'[^']*';$/gm, '');
const carpeta = mkdtempSync(join(tmpdir(), 'mirada-freno-'));
const archivo = join(carpeta, 'api.mjs');
writeFileSync(archivo, `const porcentaje = () => '';\n${codigo}\n`);
const api = await import(pathToFileURL(archivo).href);

let mal = 0;
const di = (bien, que, extra = '') => {
  if (!bien) mal++;
  console.log(`  ${bien ? '✓' : '✗'} ${que}${extra ? ` — ${extra}` : ''}`);
};

console.log('\nEL FRENO QUE SE AJUSTA SOLO\n');

// 1 y 2. Un 429 y luego bien: quien llamó no ve el error.
respuestas = [{ http: 429 }, { http: 200 }];
dormido.length = 0;
let salio = null;
try { salio = await api.llamar('imagen', { id: 'x' }); } catch (e) { salio = e; }
di(salio && salio.ruta === 'x', 'Un 429 seguido de un acierto NO llega a quien llamó',
  salio && salio.mensaje ? `salió el error «${salio.mensaje.slice(0, 40)}…»` : 'devolvió el resultado');
di(pedidas.length === 2, 'Se ha reintentado la misma llamada', `${pedidas.length} llamadas`);
di(dormido.includes(30000), 'Y la primera espera fue de 30 s', `esperas: ${dormido.join(', ')}`);
di(api.ritmoActual() === 8000, 'El freno se apretó a 8 s para la siguiente',
  `ritmo = ${api.ritmoActual()} ms`);

// 3. Aciertos seguidos aflojan, pero despacio.
respuestas = Array.from({ length: 5 }, () => ({ http: 200 }));
for (let i = 0; i < 5; i++) await api.llamar('imagen', { id: 'x' });
di(api.ritmoActual() === 6000, 'Cinco aciertos aflojan un cuarto, no de golpe a cero',
  `ritmo = ${api.ritmoActual()} ms`);

// 4. El estado no se frena.
respuestas = [{ http: 200 }];
dormido.length = 0;
await api.llamar('estado-leer', {});
di(!dormido.includes(6000), 'Leer el estado NO paga el freno', `esperas: ${dormido.join(', ') || 'ninguna'}`);

// 5. Si la ventana no se abre nunca, sale el error de Google tal cual.
respuestas = Array.from({ length: 6 }, () => ({ http: 429 }));
dormido.length = 0;
let fallo = null;
try { await api.llamar('imagen', { id: 'x' }); } catch (e) { fallo = e; }
di(Boolean(fallo), 'Con la ventana cerrada del todo, acaba fallando');
di(fallo && [30000, 60000, 90000].every((n) => dormido.includes(n)),
  'Y antes probó las tres esperas: 30 s, 60 y 90', `esperas: ${dormido.join(', ')}`);
di(fallo && /exhausted|cuota/i.test(`${fallo.mensaje} ${fallo.detalle}`),
  'El mensaje sigue siendo el de Google, no una suposición');

// 6. Y con retry-after enorme, se le hace caso pero con techo.
api.ponerRitmoMinimo(0);
respuestas = [{ http: 429, retryAfter: '40000' }, { http: 200 }];
dormido.length = 0;
await api.llamar('imagen', { id: 'x' }).catch(() => {});
di(!dormido.some((n) => n > 120000), 'Un «vuelve en 40.000 s» se recorta al techo de 2 min',
  `la mayor espera fue ${Math.max(...dormido, 0)} ms`);

// 7. EL RITMO GUARDADO SALVA LA PRIMERA LLAMADA DE LA SESIÓN.
//
// Sin esto el freno arranca en cero cada vez que se recarga la página: la primera
// generación se pierde contra la cuota, se aprende, y a partir de ahí va bien.
// Y esa primera es justo la que el usuario está mirando.
// Módulo nuevo, porque el freno de arriba quedó apretado de las pruebas
// anteriores y aquí se comprueba precisamente cómo ARRANCA una sesión.
const otro = join(mkdtempSync(join(tmpdir(), 'mirada-freno2-')), 'api.mjs');
writeFileSync(otro, `const porcentaje = () => '';\n${codigo}\n`);
const recien = await import(pathToFileURL(otro).href);

di(recien.ritmoActual() === 0, 'Una sesión nueva arranca sin freno…');

recien.ponerRitmoMinimo(30000);          // «mi cuenta aguanta dos por minuto»
respuestas = [{ http: 200 }];
dormido.length = 0;
await recien.llamar('imagen', { id: 'x' });
di(dormido.includes(30000), '…y con el ritmo guardado, la PRIMERA llamada ya va frenada',
  `esperas: ${dormido.join(', ') || 'ninguna'}`);

respuestas = Array.from({ length: 10 }, () => ({ http: 200 }));
for (let i = 0; i < 10; i++) await recien.llamar('imagen', { id: 'x' });
di(recien.ritmoActual() === 30000, 'Y diez aciertos no lo bajan del suelo que dijo el usuario',
  `ritmo = ${recien.ritmoActual()} ms`);

console.log(mal === 0 ? '\nTodo bien.\n' : `\n${mal} MAL.\n`);
process.exit(mal ? 1 : 0);
