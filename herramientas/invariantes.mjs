#!/usr/bin/env node
// herramientas/invariantes.mjs
//
// Las comprobaciones que tienen que ser ciertas SIEMPRE, sobre `datos/serie.json`
// y sobre el árbol de código. Sin red, sin credenciales, sin ejecutar nada del
// estudio: lee archivos y mira.
//
//   node herramientas/invariantes.mjs        (o: npm run invariantes)
//
// Sale con 0 y un resumen si todo está bien. Sale con 1 y la lista en español de
// lo que falla, con el archivo y la línea cuando se puede decir.
//
// De dónde salen: docs/plan-de-construccion.md §13 y docs/contrato.md §6, más
// las enmiendas del contrato §13.1, §13.2 y §13.3, que encargan expresamente a
// este archivo comprobarlas.
//
// CÓMO SE LEE LA SALIDA. Está pensada para caber en la pantalla de un móvil
// desde Cloud Shell: bloques con título, una línea por comprobación con ✓ o ✗,
// y debajo, sangrado, el detalle de lo que falla o el razonamiento de por qué se
// acepta algo que parece un fallo y no lo es.
//
// LA REGLA QUE GOBIERNA LOS PATRONES DE TEXTO. Un patrón vale como fallo cuando
// lo que encuentra **es** la cosa prohibida, no cuando solo la nombra. Una clave
// privada es la cabecera Y el material que va detrás; un id de modelo es el id
// completo, no el prefijo de la familia. Lo que solo nombra —una frase de ayuda
// que explica por dónde empieza la clave de la service account, o una expresión
// regular que reconoce la familia Gemini 3.x para mandarla a «global»— se enseña
// como AVISO, con su archivo y su línea, para que nadie tenga que fiarse de la
// palabra de esta herramienta; pero no tumba la comprobación, porque ahí no hay
// ninguna credencial ni ningún modelo elegido a mano. Un aviso que se enseña no
// es un fallo que se esconde.
//
// POR QUÉ ESTE ARCHIVO SE MIRA A SÍ MISMO. La herramienta busca por todo el
// repositorio y no se salta su propia carpeta. Los patrones están escritos con
// clases de caracteres a propósito (`[-]{5}BEGIN`, `\.iam\.…`) para que el texto
// de esta misma página no se dispare solo. Si algún día uno de ellos se reescribe
// «más legible» y la herramienta empieza a acusarse a sí misma, la culpa es del
// patrón, no del archivo.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Ancho útil del texto. Un móvil en vertical con Cloud Shell da poco más. */
const ANCHO = 46;

/** Margen para comparar segundos: los datos traen decimales. */
const CASI = 1e-6;

/** Nada de leer un binario ni un archivo enorme buscando una frase. */
const TOPE_DE_ARCHIVO = 4 * 1024 * 1024;

/** Carpetas que no son código del proyecto y no se miran nunca. */
const CARPETAS_QUE_NO_SE_MIRAN = new Set([
  '.git',
  '.vercel',
  '.next',
  'node_modules',
  'dist',
  'build',
]);

// ===========================================================================
// El informe
// ===========================================================================

const cuenta = { bien: 0, mal: 0, avisos: 0 };

/**
 * Parte un texto en líneas que caben a lo ancho, con sangría.
 * @param {string} texto
 * @param {number} ancho
 * @param {string} sangria
 * @returns {string[]}
 */
function envolver(texto, ancho, sangria) {
  const palabras = String(texto).split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';
  for (const palabra of palabras) {
    if (!actual) actual = palabra;
    else if (actual.length + 1 + palabra.length <= ancho) actual += ` ${palabra}`;
    else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) lineas.push(actual);
  if (!lineas.length) lineas.push('');
  return lineas.map((linea) => sangria + linea);
}

/** Título de bloque, con una línea en blanco por delante. */
function bloque(titulo) {
  console.log('');
  console.log(titulo.toUpperCase());
}

/**
 * Una comprobación. `quejas` vacío es que está bien; cada queja es una frase en
 * español, ya con su archivo y su línea si aplica. `notas` son razonamientos que
 * se enseñan siempre, tanto si pasa como si no: son las excepciones aceptadas a
 * propósito, y esconderlas sería peor que el fallo.
 *
 * @param {string} titulo
 * @param {string[]} quejas
 * @param {string[]} [notas]
 */
function comprobar(titulo, quejas, notas = []) {
  const bien = quejas.length === 0;
  if (bien) cuenta.bien += 1;
  else cuenta.mal += 1;

  // La marca solo en la primera línea; lo que siga va sangrado debajo de ella,
  // para que de un vistazo se cuenten las marcas y no las líneas.
  const lineas = envolver(titulo, ANCHO - 4, '');
  console.log(`  ${bien ? '✓' : '✗'} ${lineas[0]}`);
  for (const linea of lineas.slice(1)) console.log(`    ${linea}`);
  for (const queja of quejas) {
    for (const linea of envolver(queja, ANCHO - 4, '      ')) console.log(linea);
  }
  for (const nota of notas) {
    for (const linea of envolver(`· ${nota}`, ANCHO - 4, '      ')) console.log(linea);
  }
}

/** Algo que hay que ver pero que no tumba nada. Se cuenta aparte. */
function avisar(texto) {
  cuenta.avisos += 1;
  const lineas = envolver(`! ${texto}`, ANCHO - 4, '');
  console.log(`    ${lineas[0]}`);
  for (const linea of lineas.slice(1)) console.log(`      ${linea}`);
}

/**
 * Una lista de sitios, corta. En un móvil no cabe una columna de doce rutas y
 * tampoco hace falta: se enseñan las primeras y se dice cuántas quedan, que es
 * lo que decide si hay que ir a mirarlas.
 * @param {string[]} sitios
 * @param {number} [cuantos]
 * @returns {string}
 */
function listaCorta(sitios, cuantos = 4) {
  if (sitios.length <= cuantos) return sitios.join(', ');
  const restantes = sitios.length - cuantos;
  return `${sitios.slice(0, cuantos).join(', ')} y ${restantes} sitio${
    restantes === 1 ? '' : 's'
  } más`;
}

/**
 * Fallo que impide seguir comprobando: falta un archivo de datos, o no parsea.
 * Se explica con palabras y se sale con 1, como cualquier otro fallo.
 * @param {string} mensaje
 * @returns {never}
 */
function rendirse(mensaje) {
  console.log('');
  for (const linea of envolver(`✗ ${mensaje}`, ANCHO, '')) console.log(linea);
  console.log('');
  process.exit(1);
}

// ===========================================================================
// Leer los datos
// ===========================================================================

/**
 * @param {string} rutaRelativa
 * @returns {any}
 */
function leerJson(rutaRelativa) {
  let crudo;
  try {
    crudo = readFileSync(join(raiz, rutaRelativa), 'utf8');
  } catch {
    rendirse(
      `No se encuentra ${rutaRelativa}, y sin ese archivo no hay nada que ` +
        'comprobar. Es uno de los dos archivos de datos del proyecto y vive en el ' +
        'repositorio; si se ha borrado, se recupera con git.'
    );
  }
  try {
    return JSON.parse(crudo);
  } catch (err) {
    rendirse(
      `${rutaRelativa} no es JSON válido, así que no se puede leer nada de ` +
        `dentro. Lo que dice el lector de JSON: ${err.message}`
    );
  }
  return null;
}

const serie = leerJson('datos/serie.json');
const guiones = leerJson('datos/guiones.json');

const piezas =
  serie.piezas && typeof serie.piezas === 'object' && !Array.isArray(serie.piezas)
    ? serie.piezas
    : {};
const placasBanco = Array.isArray(serie.banco && serie.banco.placas) ? serie.banco.placas : [];
const placasEscenario = Array.isArray(serie.escenarios && serie.escenarios.placas)
  ? serie.escenarios.placas
  : [];

const placaPorId = new Map(placasBanco.filter((p) => p && p.id).map((p) => [p.id, p]));
const escenarioPorId = new Map(placasEscenario.filter((e) => e && e.id).map((e) => [e.id, e]));

/** Personajes con ficha, más los figurantes, que también son personajes. */
const personajesConocidos = new Set([
  ...Object.keys(serie.personajes || {}),
  ...((serie.personajes_figurantes && serie.personajes_figurantes.ids) || []),
]);

/** Las tomas de todas las piezas, cada una con la pieza a la que pertenece. */
const todasLasTomas = [];
for (const [idPieza, pieza] of Object.entries(piezas)) {
  const tomas = Array.isArray(pieza && pieza.tomas) ? pieza.tomas : [];
  for (const toma of tomas) todasLasTomas.push({ idPieza, pieza, toma });
}

/** Cómo se nombra una toma en un mensaje: pieza y toma, nunca solo la toma. */
function nombreDeToma(idPieza, toma) {
  return `${idPieza}/${(toma && toma.id) || '(sin id)'}`;
}

// ===========================================================================
// Leer el código
// ===========================================================================

/**
 * Todos los archivos del repositorio, en rutas relativas con «/», ordenados.
 * @returns {string[]}
 */
function archivosDelRepositorio() {
  const salida = [];
  const anda = (dirRelativo) => {
    let entradas;
    try {
      entradas = readdirSync(dirRelativo ? join(raiz, dirRelativo) : raiz, {
        withFileTypes: true,
      });
    } catch {
      return;
    }
    for (const entrada of entradas) {
      const relativo = dirRelativo ? `${dirRelativo}/${entrada.name}` : entrada.name;
      if (entrada.isDirectory()) {
        if (CARPETAS_QUE_NO_SE_MIRAN.has(entrada.name)) continue;
        anda(relativo);
      } else if (entrada.isFile()) {
        salida.push(relativo);
      }
    }
  };
  anda('');
  salida.sort();
  return salida;
}

const archivos = archivosDelRepositorio();

/**
 * El texto de un archivo, o null si es binario o demasiado grande para mirarlo.
 * @param {string} relativo
 * @returns {string|null}
 */
function textoDe(relativo) {
  const absoluto = join(raiz, relativo);
  let tamano;
  try {
    tamano = statSync(absoluto).size;
  } catch {
    return null;
  }
  if (tamano > TOPE_DE_ARCHIVO) return null;
  let bruto;
  try {
    bruto = readFileSync(absoluto);
  } catch {
    return null;
  }
  if (bruto.includes(0)) return null; // un cero por medio: es binario
  return bruto.toString('utf8');
}

/** Memoria de lo leído: los mismos archivos se miran en varias comprobaciones. */
const textos = new Map();

/**
 * @param {string} relativo
 * @returns {string|null}
 */
function fuenteDe(relativo) {
  if (!textos.has(relativo)) textos.set(relativo, textoDe(relativo));
  return textos.get(relativo);
}

/** ¿Es un archivo de JavaScript, del servidor o del navegador? */
function esJavaScript(relativo) {
  return /\.(?:js|mjs|cjs)$/.test(relativo);
}

/**
 * Deja el código y borra los comentarios, poniendo espacios en su sitio para no
 * mover ni una línea ni una columna: los números de línea siguen valiendo.
 *
 * Con `tambienCadenas`, vacía además el contenido de las cadenas de texto —pero
 * no lo que va dentro de `${…}` de una plantilla, que es código—. Sirve para
 * distinguir «el archivo PEGA estilo.bloque» de «el archivo NOMBRA estilo.bloque
 * dentro de un mensaje de error en español», que son cosas muy distintas.
 *
 * No es un analizador de JavaScript completo y no pretende serlo: reconoce
 * comentarios, cadenas, plantillas y expresiones regulares, que es todo lo que
 * hace falta para no confundir un `//` de dentro de una cadena con un comentario.
 *
 * @param {string} fuente
 * @param {{ tambienCadenas?: boolean }} [opciones]
 * @returns {string}
 */
function soloCodigo(fuente, { tambienCadenas = false } = {}) {
  const salida = fuente.split('');
  const n = fuente.length;
  const pila = [{ tipo: 'codigo', llaves: 0 }];
  let i = 0;
  let previo = ''; // último carácter de código que no es espacio
  let palabra = ''; // última palabra completa, para saber si un / abre regex

  const borrar = (desde, hasta) => {
    for (let k = desde; k < hasta && k < n; k += 1) {
      if (salida[k] !== '\n') salida[k] = ' ';
    }
  };

  while (i < n) {
    const contexto = pila[pila.length - 1];
    const c = fuente[i];
    const d = fuente[i + 1];

    // Dentro de una plantilla: solo importan el cierre, el escape y el `${`.
    if (contexto.tipo === 'plantilla') {
      if (c === '\\') {
        if (tambienCadenas) borrar(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '`') {
        pila.pop();
        previo = '`';
        palabra = '';
        i += 1;
        continue;
      }
      if (c === '$' && d === '{') {
        pila.push({ tipo: 'codigo', llaves: 0 });
        previo = '{';
        palabra = '';
        i += 2;
        continue;
      }
      if (tambienCadenas) borrar(i, i + 1);
      i += 1;
      continue;
    }

    // Comentario de línea.
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && fuente[j] !== '\n') j += 1;
      borrar(i, j);
      i = j;
      continue;
    }

    // Comentario de bloque.
    if (c === '/' && d === '*') {
      let j = i + 2;
      while (j < n && !(fuente[j] === '*' && fuente[j + 1] === '/')) j += 1;
      const fin = Math.min(n, j + 2);
      borrar(i, fin);
      i = fin;
      continue;
    }

    // Cadena con comillas simples o dobles.
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (fuente[j] === '\\') {
          j += 2;
          continue;
        }
        if (fuente[j] === c || fuente[j] === '\n') break;
        j += 1;
      }
      if (tambienCadenas) borrar(i + 1, j);
      i = Math.min(n, j + 1);
      previo = '"';
      palabra = '';
      continue;
    }

    // Plantilla.
    if (c === '`') {
      pila.push({ tipo: 'plantilla' });
      i += 1;
      continue;
    }

    // Expresión regular, si el carácter anterior deja que ahí empiece una.
    if (c === '/' && empiezaUnaRegex(previo, palabra)) {
      let j = i + 1;
      let dentroDeClase = false;
      while (j < n) {
        const e = fuente[j];
        if (e === '\\') {
          j += 2;
          continue;
        }
        if (e === '\n') break;
        if (e === '[') dentroDeClase = true;
        else if (e === ']') dentroDeClase = false;
        else if (e === '/' && !dentroDeClase) break;
        j += 1;
      }
      i = Math.min(n, j + 1);
      while (i < n && /[a-z]/.test(fuente[i])) i += 1; // banderas: g, i, m…
      previo = '/';
      palabra = '';
      continue;
    }

    if (c === '{') {
      contexto.llaves += 1;
    } else if (c === '}') {
      if (contexto.llaves === 0 && pila.length > 1) {
        pila.pop(); // se cierra el `${…}` y se vuelve a la plantilla
        i += 1;
        previo = '}';
        palabra = '';
        continue;
      }
      contexto.llaves = Math.max(0, contexto.llaves - 1);
    }

    if (/[A-Za-z0-9_$]/.test(c)) palabra += c;
    else if (!/\s/.test(c)) palabra = '';

    if (!/\s/.test(c)) previo = c;
    i += 1;
  }

  return salida.join('');
}

/** Palabras tras las que una barra abre una expresión regular, no una división. */
const ANTES_DE_UNA_REGEX = new Set([
  'return',
  'typeof',
  'case',
  'in',
  'of',
  'do',
  'else',
  'void',
  'delete',
  'instanceof',
  'new',
  'throw',
  'yield',
  'await',
]);

/**
 * @param {string} previo último carácter de código
 * @param {string} palabra última palabra completa
 * @returns {boolean}
 */
function empiezaUnaRegex(previo, palabra) {
  if (!previo) return true;
  if (ANTES_DE_UNA_REGEX.has(palabra)) return true;
  if (/[A-Za-z0-9_$)\]"'`]/.test(previo)) return false;
  return true;
}

/**
 * Busca un patrón en un texto y devuelve dónde cae, con su línea y su recorte.
 * @param {string} texto
 * @param {RegExp} patron con la bandera g
 * @returns {{ linea:number, cita:string, encontrado:string }[]}
 */
function buscar(texto, patron) {
  const hallazgos = [];
  const lineas = texto.split('\n');
  for (let i = 0; i < lineas.length; i += 1) {
    const linea = lineas[i];
    patron.lastIndex = 0;
    let m;
    while ((m = patron.exec(linea)) !== null) {
      hallazgos.push({
        linea: i + 1,
        cita: linea.trim().slice(0, 90),
        encontrado: m[0],
      });
      if (m.index === patron.lastIndex) patron.lastIndex += 1;
    }
  }
  return hallazgos;
}

// ===========================================================================
// DATOS · Tomas, escenarios y banco
// ===========================================================================

console.log('INVARIANTES · LA MIRADA QUE EL MUNDO TEMERÁ');
for (const linea of envolver(
  'Sobre datos/serie.json y el árbol de código. Sin red.',
  ANCHO,
  ''
)) {
  console.log(linea);
}

bloque('Datos · tomas, escenarios y banco');

{
  // FALTA EN EL CONTRATO: el contrato §6.9 dice «todo plano tiene escenario» sin
  // excepciones, pero `cartela.toma` (hoy E3) es un fotograma negro con el título
  // compuesto en el montaje —`cartela.compuesta_en_montaje: true`, `generada:
  // false`—: no ocurre en ningún sitio y exigirle una placa de escenario sería
  // pagar una imagen de la nada. Se acepta solo esa toma, se dice por pantalla
  // cuál es y por qué, y se rechaza cualquier otra sin escenario. Si el contrato
  // se enmienda, esta excepción se escribe allí y aquí se deja de razonar.
  const idCartela = (serie.cartela && serie.cartela.toma) || null;
  const cartelaSeCompone = Boolean(serie.cartela && serie.cartela.compuesta_en_montaje);

  const quejas = [];
  const notas = [];
  for (const { idPieza, toma } of todasLasTomas) {
    const donde = nombreDeToma(idPieza, toma);
    const escenario = toma.escenario;
    if (escenario === null || escenario === undefined || escenario === '') {
      // Cada pieza puede traer su propia cartela marcando la toma con
      // `cartela: true`. La serie tiene tres —el teaser, el opening y el
      // ending— y todas son lo mismo: un fotograma negro con el título
      // compuesto en el montaje, que no es un sitio que se genere.
      if (toma.cartela === true || (toma.id === idCartela && cartelaSeCompone)) {
        notas.push(
          `${donde} no tiene escenario y se acepta: es la cartela ` +
            'de su pieza, un fotograma negro con el título compuesto en el ' +
            'montaje, no un sitio que se genere.'
        );
      } else {
        quejas.push(`${donde} no declara escenario.`);
      }
      continue;
    }
    if (!escenarioPorId.has(escenario)) {
      quejas.push(
        `${donde} dice ocurrir en «${escenario}», que no es ninguna de las ` +
          `${placasEscenario.length} placas de escenarios.placas.`
      );
    }
  }
  comprobar('Toda toma tiene escenario y ese escenario existe', quejas, notas);
}

{
  const quejas = [];
  for (const { idPieza, toma } of todasLasTomas) {
    const refs = Array.isArray(toma.refs) ? toma.refs : [];
    for (const ref of refs) {
      if (!placaPorId.has(ref)) {
        quejas.push(
          `${nombreDeToma(idPieza, toma)} pide la referencia «${ref}», que no ` +
            'existe en banco.placas.'
        );
      }
    }
  }
  comprobar('Toda referencia de una toma existe en el banco', quejas);
}

{
  const quejas = [];
  for (const placa of placasBanco) {
    if (!placa || !placa.id) {
      quejas.push('Hay una placa del banco sin id.');
      continue;
    }
    if (!placa.personaje) {
      quejas.push(`La placa «${placa.id}» no dice de qué personaje es.`);
    } else if (!personajesConocidos.has(placa.personaje)) {
      quejas.push(
        `La placa «${placa.id}» es del personaje «${placa.personaje}», que no ` +
          'está en personajes ni en personajes_figurantes.'
      );
    }
  }
  comprobar('Toda placa apunta a un personaje que existe', quejas);
}

{
  const quejas = [];
  for (const placa of placasBanco) {
    if (!placa || !placa.encadena_a) continue;
    if (!placaPorId.has(placa.encadena_a)) {
      quejas.push(
        `La placa «${placa.id}» encadena a «${placa.encadena_a}», que no existe ` +
          'en el banco: esa cadena se rompe y el personaje saldría distinto.'
      );
    } else if (placa.encadena_a === placa.id) {
      quejas.push(`La placa «${placa.id}» se encadena a sí misma.`);
    }
  }
  comprobar('Todo encadena_a apunta a una placa que existe', quejas);
}

{
  const anclasPorPersonaje = new Map();
  for (const placa of placasBanco) {
    if (!placa || !placa.personaje) continue;
    if (!anclasPorPersonaje.has(placa.personaje)) anclasPorPersonaje.set(placa.personaje, []);
    if (placa.ancla) anclasPorPersonaje.get(placa.personaje).push(placa.id);
  }
  const quejas = [];
  for (const [personaje, anclas] of anclasPorPersonaje) {
    if (anclas.length === 0) {
      quejas.push(
        `«${personaje}» tiene placas en el banco pero ninguna ancla, y sin ancla ` +
          'las demás no se pueden generar: no hay a quién parecerse.'
      );
    } else if (anclas.length > 1) {
      quejas.push(
        `«${personaje}» tiene ${anclas.length} anclas (${anclas.join(', ')}), y ` +
          'dos anclas del mismo personaje son dos personas distintas.'
      );
    }
  }
  comprobar('Cada personaje con placas tiene exactamente un ancla', quejas);
}

// ===========================================================================
// DATOS · Duraciones y línea de tiempo
// ===========================================================================

bloque('Datos · duraciones y línea de tiempo');

{
  const quejas = [];
  for (const { idPieza, toma } of todasLasTomas) {
    if (![4, 6, 8].includes(toma.dur_gen)) {
      quejas.push(
        `${nombreDeToma(idPieza, toma)} pide ${toma.dur_gen} s de generación, y ` +
          'Veo solo hace 4, 6 u 8. Los 2 y los 3 segundos no existen.'
      );
    }
  }
  comprobar('Las duraciones de generación son 4, 6 u 8', quejas);
}

{
  const quejas = [];
  for (const { idPieza, toma } of todasLasTomas) {
    if (!toma.encadena_con) continue;
    if (Math.abs(Number(toma.dur) - Number(toma.dur_gen)) > CASI) {
      quejas.push(
        `${nombreDeToma(idPieza, toma)} encadena con «${toma.encadena_con}» pero ` +
          `se recorta a ${toma.dur} s de ${toma.dur_gen} s generados: la ` +
          'interpolación de Veo no llega al corte y el encadenado se pierde.'
      );
    }
  }
  comprobar('Los encadenados se usan enteros (dur == dur_gen)', quejas);
}

{
  const quejas = [];
  for (const { idPieza, toma } of todasLasTomas) {
    const donde = nombreDeToma(idPieza, toma);
    const recorte = toma.recorte;
    if (!Array.isArray(recorte) || recorte.length !== 2) {
      quejas.push(`${donde} no trae un recorte de dos números.`);
      continue;
    }
    if (Math.abs(Number(recorte[0])) > CASI) {
      quejas.push(`${donde} recorta desde ${recorte[0]} s y tiene que empezar en 0.`);
    }
    if (Math.abs(Number(recorte[1]) - Number(toma.dur)) > CASI) {
      quejas.push(
        `${donde} recorta hasta ${recorte[1]} s pero dura ${toma.dur} s: el ` +
          'recorte es [0, dur] y aquí no coinciden.'
      );
    }
    if (Number(toma.dur) - Number(toma.dur_gen) > CASI) {
      quejas.push(
        `${donde} dura ${toma.dur} s y solo se generan ${toma.dur_gen} s: no se ` +
          'puede recortar más de lo que hay.'
      );
    }
  }
  comprobar('El recorte es [0, dur] y dur no pasa de dur_gen', quejas);
}

{
  const quejas = [];
  for (const { idPieza, toma } of todasLasTomas) {
    if (Number(toma.dur) - 8 > CASI) {
      quejas.push(
        `${nombreDeToma(idPieza, toma)} dura ${toma.dur} s. Ningún plano pasa de 8.`
      );
    }
  }
  comprobar('Ningún plano dura más de 8 s', quejas);
}

{
  const quejas = [];
  for (const { idPieza, toma } of todasLasTomas) {
    if (!toma.boca_visible) continue;
    const dur = Number(toma.dur);
    if (dur < 2 - CASI || dur > 4 + CASI) {
      quejas.push(
        `${nombreDeToma(idPieza, toma)} enseña la boca de «${toma.boca_visible}» ` +
          `durante ${toma.dur} s. Un plano con boca visible dura entre 2 y 4 s: ` +
          'más tiempo y se ve que no está sincronizada.'
      );
    }
  }
  comprobar('Un plano con boca visible dura entre 2 y 4 s', quejas);
}

{
  const quejas = [];
  for (const [idPieza, pieza] of Object.entries(piezas)) {
    const tomas = Array.isArray(pieza && pieza.tomas) ? pieza.tomas : [];
    if (!tomas.length) {
      quejas.push(`La pieza «${idPieza}» no tiene ni una toma.`);
      continue;
    }
    const ordenadas = [...tomas].sort((a, b) => Number(a.inicio) - Number(b.inicio));
    let reloj = 0;
    for (const toma of ordenadas) {
      const inicio = Number(toma.inicio);
      const diferencia = inicio - reloj;
      if (diferencia > CASI) {
        quejas.push(
          `Hueco de ${redondear(diferencia)} s en «${idPieza}» antes de ` +
            `${toma.id}: la anterior acaba en ${redondear(reloj)} s y esta ` +
            `empieza en ${redondear(inicio)} s.`
        );
      } else if (diferencia < -CASI) {
        quejas.push(
          `Solape de ${redondear(-diferencia)} s en «${idPieza}» en ${toma.id}: ` +
            `empieza en ${redondear(inicio)} s y la anterior no acaba hasta ` +
            `${redondear(reloj)} s.`
        );
      }
      reloj = inicio + Number(toma.dur);
    }
  }
  comprobar('La línea de tiempo no tiene huecos ni solapes', quejas);
}

{
  const quejas = [];
  for (const [idPieza, pieza] of Object.entries(piezas)) {
    const tomas = Array.isArray(pieza && pieza.tomas) ? pieza.tomas : [];
    const suma = tomas.reduce((total, toma) => total + Number(toma.dur || 0), 0);
    const declarada = Number(pieza && pieza.duracion_s);
    if (!Number.isFinite(declarada)) {
      quejas.push(`La pieza «${idPieza}» no declara duracion_s.`);
    } else if (Math.abs(suma - declarada) > CASI) {
      quejas.push(
        `«${idPieza}» declara ${declarada} s y sus tomas suman ` +
          `${redondear(suma)} s.`
      );
    }
  }
  comprobar('Cada pieza suma la duracion_s que declara', quejas);
}

/** Un número corto para un mensaje: sin decimales si no hacen falta. */
function redondear(n) {
  const valor = Math.round(Number(n) * 1000) / 1000;
  return String(valor);
}

// ===========================================================================
// DATOS · La regla de la boca
// ===========================================================================

bloque('Datos · la regla de la boca');

{
  // La excepción está escrita en el contrato §6.6 y en el plan §7: una línea SÍ
  // puede caer sobre un plano con la boca de quien habla si ese plano lo muestra
  // hablando, y eso se sabe leyendo el prompt de vídeo, que es lo que Veo va a
  // animar. Estas tres palabras son las que lo piden en inglés, que es el idioma
  // en el que están escritos los prompts.
  const PALABRAS_DE_BOCA = ['mouth', 'speaking', 'lips'];

  /**
   * @param {string} video prompt de vídeo de la toma, en inglés
   * @returns {{ palabra:string, cita:string }|null}
   */
  const pideQueLaBocaSeMueva = (video) => {
    const texto = String(video || '');
    const enMinusculas = texto.toLowerCase();
    for (const palabra of PALABRAS_DE_BOCA) {
      const donde = enMinusculas.indexOf(palabra);
      if (donde < 0) continue;
      const desde = Math.max(0, donde - 24);
      const hasta = Math.min(texto.length, donde + palabra.length + 46);
      const cita =
        (desde > 0 ? '…' : '') + texto.slice(desde, hasta).trim() + (hasta < texto.length ? '…' : '');
      return { palabra, cita };
    }
    return null;
  };

  const quejas = [];
  const notas = [];
  for (const [idPieza, pieza] of Object.entries(piezas)) {
    const lineas = Array.isArray(pieza && pieza.audio && pieza.audio.voz) ? pieza.audio.voz : [];
    const tomas = Array.isArray(pieza && pieza.tomas) ? pieza.tomas : [];
    for (const linea of lineas) {
      const entra = Number(linea.t);
      const sale = Number(linea.hasta);
      for (const toma of tomas) {
        if (toma.boca_visible !== linea.quien) continue;
        const empieza = Number(toma.inicio);
        const acaba = empieza + Number(toma.dur);
        const solapa = entra < acaba - CASI && sale > empieza + CASI;
        if (!solapa) continue;

        const permiso = pideQueLaBocaSeMueva(toma.video);
        const donde = nombreDeToma(idPieza, toma);
        if (permiso) {
          notas.push(
            `«${linea.es}» (${redondear(entra)}–${redondear(sale)} s, ` +
              `${linea.quien}) cae sobre ${donde}, que enseña esa boca, y se ` +
              `acepta: su prompt de vídeo pide que se mueva —«${permiso.cita}»—, ` +
              `así que el plano ya está pensado para sonar hablado.`
          );
        } else {
          quejas.push(
            `«${linea.es}» (${redondear(entra)}–${redondear(sale)} s) la dice ` +
              `${linea.quien} sobre ${donde} (${redondear(empieza)}–` +
              `${redondear(acaba)} s), que enseña su boca quieta: el prompt de ` +
              'vídeo no pide en ningún momento que se mueva. O se cambia el ' +
              'plano, o se mueve la línea, o el prompt tiene que decirlo.'
          );
        }
      }
    }
  }
  comprobar('Ninguna línea de voz cae sobre una boca quieta', quejas, notas);
}

// ===========================================================================
// DATOS · Lo que se ve en pantalla
// ===========================================================================

bloque('Datos · lo que se ve en pantalla');

{
  // Rangos de japonés y de chino: kana, kanji, formas compatibles y la
  // puntuación de anchura completa. Si algo de esto aparece en un campo que se
  // pinta, el montador necesitaría una fuente CJK que no tiene y saldría en
  // pantalla un idioma que la serie solo usa para el oído.
  const CJK =
    /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;

  /** Los únicos sitios donde el japonés es lo correcto: lo que se oye. */
  const esCampoDeAudio = (ruta) => /^piezas\.[^.]+\.audio\.voz\[\d+\]\.ja$/.test(ruta);

  /** El campo que existe, no es un fallo, y no puede llegar a pantalla. */
  const esCartelaFinalJa = (ruta) => /^piezas\.[^.]+\.cartela_final\.ja$/.test(ruta);

  const quejas = [];
  const sospechosos = [];

  const recorrer = (valor, ruta, archivo) => {
    if (typeof valor === 'string') {
      if (CJK.test(valor)) sospechosos.push({ archivo, ruta, valor });
      return;
    }
    if (Array.isArray(valor)) {
      valor.forEach((v, i) => recorrer(v, `${ruta}[${i}]`, archivo));
      return;
    }
    if (valor && typeof valor === 'object') {
      for (const [clave, v] of Object.entries(valor)) {
        if (CJK.test(clave)) {
          quejas.push(`En ${archivo} hay una clave escrita en japonés: «${clave}».`);
        }
        recorrer(v, ruta ? `${ruta}.${clave}` : clave, archivo);
      }
    }
  };

  recorrer(serie, '', 'datos/serie.json');
  recorrer(guiones, '', 'datos/guiones.json');

  for (const { archivo, ruta, valor } of sospechosos) {
    if (archivo === 'datos/serie.json' && esCampoDeAudio(ruta)) continue;
    if (archivo === 'datos/serie.json' && esCartelaFinalJa(ruta)) continue;
    // En los guiones, el japonés solo cabe en un campo que se oye.
    if (archivo === 'datos/guiones.json' && /\.ja$/.test(ruta)) continue;
    quejas.push(
      `${archivo} · ${ruta} lleva japonés («${valor.slice(0, 24)}») y ese campo ` +
        'acaba en pantalla. En pantalla solo hay español: el japonés únicamente ' +
        'se oye.'
    );
  }

  comprobar('Sin japonés en ningún campo que se pinte', quejas);

  for (const { archivo, ruta, valor } of sospechosos) {
    if (archivo === 'datos/serie.json' && esCartelaFinalJa(ruta)) {
      avisar(
        `${ruta} existe y está en japonés («${valor}»). No es un fallo, pero ese ` +
          'campo NO debe llegar a pantalla: el título que se pinta es ' +
          'cartela.texto, en español. Si algún día alguien lo usa por error, ' +
          'el montador pediría una fuente CJK que el contenedor no lleva.'
      );
    }
  }
}

// ===========================================================================
// DATOS · Música
// ===========================================================================

bloque('Datos · música');

{
  const modelo = (serie.musica && serie.musica.modelo) || {};
  const maximo = Number.isFinite(Number(modelo.maximo_s)) && Number(modelo.maximo_s) > 0
    ? Number(modelo.maximo_s)
    : 180;
  const piezasDeMusica = Array.isArray(serie.musica && serie.musica.piezas)
    ? serie.musica.piezas
    : [];

  const quejas = [];
  for (const pieza of piezasDeMusica) {
    const dur = Number(pieza && pieza.duracion_s);
    if (!Number.isFinite(dur)) {
      quejas.push(`La pieza de música «${(pieza && pieza.id) || '(sin id)'}» no dice cuánto dura.`);
      continue;
    }
    if (dur - maximo > CASI) {
      quejas.push(
        `«${pieza.id}» pide ${dur} s y Lyria no pasa de ${maximo} s por pieza. ` +
          'Un tramo más largo se parte en varias piezas y se unen en el montaje ' +
          'con fundidos de 2,5 s.'
      );
    }
  }
  comprobar(`Toda pieza de música cabe en los ${maximo} s de Lyria`, quejas);
}

// ===========================================================================
// DATOS · Enmiendas del contrato §13
// ===========================================================================

bloque('Datos · enmiendas del contrato §13');

{
  const detalles = placasBanco.filter((p) => p && p.detalle);
  const quejas = [];
  for (const placa of detalles) {
    if (placa.ancla) {
      quejas.push(
        `«${placa.id}» es placa de detalle y además ancla. Un ancla es una cara ` +
          'de frente; unas manos o una nuca no pueden serlo de nadie.'
      );
    }
  }
  comprobar('Ninguna placa de detalle es ancla (§13.1)', quejas);
}

{
  const detalles = placasBanco.filter((p) => p && p.detalle);
  const quejas = [];
  for (const placa of detalles) {
    const instruccion = placa.instruccion_referencia;
    if (typeof instruccion !== 'string' || !instruccion.trim()) {
      quejas.push(
        `«${placa.id}» es de detalle y no trae instruccion_referencia propia. La ` +
          'genérica del banco habla de cara, pelo y ojos, y aquí la cara no está ' +
          'en cuadro: sin decir qué copiar, el modelo copia el encuadre.'
      );
    }
  }
  comprobar('Toda placa de detalle dice qué copiar (§13.1)', quejas);
}

{
  const detalles = placasBanco.filter((p) => p && p.detalle);
  const conAncla = new Set(placasBanco.filter((p) => p && p.ancla).map((p) => p.personaje));
  const quejas = [];
  for (const placa of detalles) {
    if (!conAncla.has(placa.personaje)) {
      quejas.push(
        `«${placa.id}» es de detalle y su personaje «${placa.personaje}» no tiene ` +
          'ancla: esas manos no serían las mismas manos.'
      );
    }
  }
  comprobar('El personaje de cada placa de detalle tiene ancla (§13.1)', quejas);
}

{
  // §13.2: dos sitios distintos con nombres casi iguales. El fallo que esta
  // comprobación existe para evitar es que alguien los «unifique» por parecerse.
  const quejas = [];
  const tunel = escenarioPorId.get('tunel');
  const tuneles = escenarioPorId.get('tuneles');

  if (!tunel) {
    quejas.push(
      '«tunel» ha desaparecido de escenarios.placas. Es el canal inundado por el ' +
        'que Saharis escapa a los diez años, y sin él la toma C4 del teaser no ' +
        'tiene sitio donde ocurrir.'
    );
  }
  if (!tuneles) {
    quejas.push(
      '«tuneles» ha desaparecido de escenarios.placas. Es la habitación de ' +
        'Saharis bajo la ciudad, donde ocurren 46 escenas de la serie.'
    );
  }
  if (tunel && tuneles) {
    const a = String(tunel.descripcion || '').trim();
    const b = String(tuneles.descripcion || '').trim();
    if (!a || !b) {
      quejas.push('«tunel» o «tuneles» se ha quedado sin descripción.');
    } else if (a === b) {
      quejas.push(
        '«tunel» y «tuneles» tienen la misma descripción, así que en pantalla ' +
          'serían el mismo sitio. Uno es un canal inundado que se cruza ' +
          'corriendo; el otro, una habitación seca que se habita.'
      );
    }
    if (tunel.no_fusionar_con !== 'tuneles' || tuneles.no_fusionar_con !== 'tunel') {
      quejas.push(
        'Se ha perdido el aviso no_fusionar_con que cada uno lleva apuntando al ' +
          'otro: quien lea uno solo ya no verá que existe el gemelo.'
      );
    }
  }
  comprobar('«tunel» y «tuneles» siguen siendo dos sitios (§13.2)', quejas);
}

// ===========================================================================
// CÓDIGO · Nada de la cuenta escrito
// ===========================================================================

bloque('Código · nada de la cuenta escrito');

/** Los archivos que se miran buscando datos de la cuenta: todos menos los datos. */
const archivosDeCodigo = archivos.filter(
  (rel) => !rel.startsWith('datos/') && !rel.startsWith('docs/')
);

{
  // Un correo de service account de verdad: algo, arroba, el proyecto y el
  // sufijo de Google. Escrito con clases de caracteres para que la línea de esta
  // misma página no se dispare a sí misma.
  const PATRON = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.iam\.gserviceaccount\.com/g;
  const quejas = [];
  for (const rel of archivosDeCodigo) {
    const fuente = fuenteDe(rel);
    if (fuente === null) continue;
    for (const hallazgo of buscar(fuente, PATRON)) {
      quejas.push(
        `${rel}:${hallazgo.linea} lleva escrito un correo de service account. ` +
          'Sale de GCP_SERVICE_ACCOUNT y no se escribe nunca: el repositorio es ' +
          'público.'
      );
    }
  }
  comprobar('Sin correos de service account en el código', quejas);
}

{
  // La cabecera de una clave, y detrás material de verdad. La cabecera sola,
  // dentro de una frase que explica al usuario por dónde empieza el JSON que
  // tiene que pegar, no es una clave: eso se avisa, no se suspende.
  const CABECERA = /[-]{5}BEGIN (?:[A-Z]+ )?PRIVATE KEY[-]{5}/g;
  const MATERIAL = /(?:\\n|\s)*[A-Za-z0-9+/]{40,}/;
  const quejas = [];
  const mencionan = [];
  for (const rel of archivosDeCodigo) {
    const fuente = fuenteDe(rel);
    if (fuente === null) continue;
    CABECERA.lastIndex = 0;
    let m;
    while ((m = CABECERA.exec(fuente)) !== null) {
      const linea = fuente.slice(0, m.index).split('\n').length;
      const detras = fuente.slice(m.index + m[0].length, m.index + m[0].length + 300);
      if (MATERIAL.test(detras)) {
        quejas.push(
          `${rel}:${linea} tiene una clave privada escrita, con su material ` +
            'detrás. Eso es la credencial entera: se borra del repositorio y se ' +
            'rota la clave en Google, porque ya no es secreta.'
        );
      } else {
        mencionan.push(`${rel}:${linea}`);
      }
      if (m.index === CABECERA.lastIndex) CABECERA.lastIndex += 1;
    }
  }
  comprobar('Sin claves privadas escritas en el código', quejas);
  if (mencionan.length) {
    avisar(
      `La cabecera de una clave se nombra, sin material detrás, en ` +
        `${mencionan.join(', ')}. Ahí no hay ninguna clave: es la frase que le ` +
        'explica al usuario por dónde empieza el JSON que tiene que pegar. Se ' +
        'enseña para que se vea y se pueda comprobar a mano.'
    );
  }
}

{
  // La forma de clave de JSON, que es como aparece dentro de una service
  // account. La palabra suelta dentro de una frase en español no cuenta.
  const PATRON = /"project_id"\s*:/g;
  const quejas = [];
  for (const rel of archivosDeCodigo) {
    const fuente = fuenteDe(rel);
    if (fuente === null) continue;
    for (const hallazgo of buscar(fuente, PATRON)) {
      quejas.push(
        `${rel}:${hallazgo.linea} escribe un campo "project_id" con su valor. El ` +
          'project id sale siempre de sa.project_id, nunca de una constante.'
      );
    }
  }
  comprobar('Sin ningún project id escrito en el código', quejas);
}

{
  // Una URI de bucket con un nombre concreto delante. Los ejemplos con un hueco
  // —llaves, mayúsculas de variable, o la palabra genérica— no nombran nada.
  const PATRON = /gs:\/\/([^\s"'`)\]},]+)/g;
  const GENERICOS = new Set([
    'bucket',
    'mibucket',
    'mi-bucket',
    'tu-bucket',
    'el-bucket',
    'nombre-del-bucket',
    'ejemplo',
    'xxx',
  ]);
  /** ¿Es un hueco de ejemplo en vez del nombre de un bucket de verdad? */
  const esUnHueco = (nombre) => {
    if (!nombre) return true;
    if (/[{}$<>%…«»‹›]/.test(nombre)) return true;
    if (/^[A-Z0-9_]+$/.test(nombre)) return true;
    return GENERICOS.has(nombre.toLowerCase());
  };

  const quejas = [];
  const huecos = [];
  for (const rel of archivosDeCodigo) {
    const fuente = fuenteDe(rel);
    if (fuente === null) continue;
    for (const hallazgo of buscar(fuente, PATRON)) {
      const nombre = hallazgo.encontrado.replace(/^gs:\/\//, '').split('/')[0];
      if (esUnHueco(nombre)) huecos.push(`${rel}:${hallazgo.linea}`);
      else {
        quejas.push(
          `${rel}:${hallazgo.linea} nombra el bucket «${nombre}». El nombre sale ` +
            'de GCS_BUCKET y lo pone _lib/gcs.js; escrito aquí identifica el ' +
            'almacén de la cuenta en un repositorio público.'
        );
      }
    }
  }
  comprobar('Sin ningún bucket concreto escrito en el código', quejas);
  if (huecos.length) {
    avisar(
      `Hay ${huecos.length} ejemplos de ruta de bucket con el nombre en hueco: ` +
        `${listaCorta(huecos)}. No identifican nada, pero ahí están.`
    );
  }
}

// ===========================================================================
// CÓDIGO · El estilo y el sello
// ===========================================================================

bloque('Código · el estilo y el sello');

const RUTA_PROMPT = 'api/_lib/prompt.js';

{
  // Quién PEGA estilo.bloque, que no es lo mismo que quién lo nombra. Con las
  // cadenas vaciadas, un mensaje de error en español que diga «estilo.bloque»
  // desaparece y solo queda el código de verdad. Lo que se busca es que el valor
  // acabe dentro de un texto: una suma de cadenas, un `${…}` de plantilla o un
  // join/concat/push.
  const MENCION = /\bestilo\s*(?:\.\s*bloque\b|\[\s*['"]bloque['"]\s*\])/;
  const quejas = [];

  for (const rel of archivosDeCodigo) {
    if (rel === RUTA_PROMPT) continue; // el único que puede pegarlo
    if (!esJavaScript(rel)) continue;
    const fuente = fuenteDe(rel);
    if (fuente === null) continue;

    const codigo = soloCodigo(fuente, { tambienCadenas: true });
    if (!MENCION.test(codigo)) continue;

    // Los nombres a los que se le ha dado el bloque, y los nombres a los que se
    // ha dado uno de esos: la cadena de alias, hasta que deja de crecer.
    const lineas = codigo.split('\n');
    const alias = new Set();
    for (let vuelta = 0; vuelta < 4; vuelta += 1) {
      const antes = alias.size;
      for (const linea of lineas) {
        const declara = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=([^;]*)/.exec(linea);
        if (!declara) continue;
        const derecha = declara[2];
        const traeElBloque =
          MENCION.test(derecha) ||
          [...alias].some((a) => new RegExp(`\\b${a}\\b`).test(derecha));
        if (traeElBloque) alias.add(declara[1]);
      }
      if (alias.size === antes) break;
    }

    const nombres = ['estilo\\s*\\.\\s*bloque', ...[...alias].map((a) => `\\b${a}\\b`)];
    for (let i = 0; i < lineas.length; i += 1) {
      const linea = lineas[i];
      for (const nombre of nombres) {
        const pega =
          new RegExp(`\\+\\s*[^;+]{0,80}${nombre}`).test(linea) ||
          new RegExp(`${nombre}[^;+]{0,80}\\+`).test(linea) ||
          new RegExp(`\\$\\{[^}]*${nombre}[^}]*\\}`).test(linea) ||
          new RegExp(`\\.(?:join|concat|push|unshift)\\s*\\([^)]*${nombre}`).test(linea);
        if (!pega) continue;
        quejas.push(
          `${rel}:${i + 1} pega el bloque de estilo a un texto. El único sitio ` +
            `donde se pega es sellar(), en ${RUTA_PROMPT}: si se pega en dos ` +
            'sitios, tarde o temprano uno de los dos se queda atrás y esa ' +
            'generación sale con otro aspecto.'
        );
        break;
      }
    }
  }
  comprobar(`Solo ${RUTA_PROMPT} pega estilo.bloque`, quejas);
}

{
  // Toda función exportada de prompt.js que devuelva un prompt de imagen o de
  // vídeo termina en sellar(). Las que no lo son están fuera a propósito y por
  // escrito: encargoMusica() va a Lyria y guionDeVoz() a Gemini TTS, y
  // estilo.bloque describe cómo se DIBUJA un fotograma, no cómo suena.
  const quejas = [];
  const fuente = fuenteDe(RUTA_PROMPT);
  if (fuente === null) {
    quejas.push(
      `No se puede leer ${RUTA_PROMPT}, que es el archivo donde se componen ` +
        'todos los prompts. Sin él no hay estudio.'
    );
  } else {
    const codigo = soloCodigo(fuente);
    const DECLARA = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    let encontradas = 0;
    while ((m = DECLARA.exec(codigo)) !== null) {
      const nombre = m[1];
      if (!/^prompt/i.test(nombre)) continue;
      encontradas += 1;
      const cuerpo = cuerpoDeLaFuncion(codigo, DECLARA.lastIndex - 1);
      if (cuerpo === null) {
        quejas.push(`No se puede leer el cuerpo de ${nombre}() en ${RUTA_PROMPT}.`);
      } else if (!/\bsellar\s*\(/.test(cuerpo)) {
        const linea = codigo.slice(0, m.index).split('\n').length;
        quejas.push(
          `${RUTA_PROMPT}:${linea} · ${nombre}() devuelve un prompt sin pasar ` +
            'por sellar(), así que saldría sin estilo.bloque pegado y esa ' +
            'generación habría que tirarla después de pagarla.'
        );
      }
    }
    if (!encontradas) {
      quejas.push(
        `${RUTA_PROMPT} no exporta ninguna función de prompt (promptPlaca, ` +
          'promptEscenario, promptKeyframe, promptVideo). O ha cambiado de ' +
          'nombre, o el archivo ya no hace lo que dice el contrato §12.'
      );
    }
  }
  comprobar('Todo prompt de prompt.js pasa por sellar()', quejas);
}

/**
 * El texto entre las llaves de una función, contando llaves. `desde` apunta al
 * paréntesis de apertura de los argumentos.
 * @param {string} codigo ya sin comentarios
 * @param {number} desde
 * @returns {string|null}
 */
function cuerpoDeLaFuncion(codigo, desde) {
  const abre = codigo.indexOf('{', desde);
  if (abre < 0) return null;
  let profundidad = 0;
  for (let i = abre; i < codigo.length; i += 1) {
    if (codigo[i] === '{') profundidad += 1;
    else if (codigo[i] === '}') {
      profundidad -= 1;
      if (profundidad === 0) return codigo.slice(abre + 1, i);
    }
  }
  return null;
}

// ===========================================================================
// CÓDIGO · El orden de la puerta
// ===========================================================================

bloque('Código · el orden de la puerta');

{
  const RUTA_G = 'api/g.js';
  const quejas = [];
  const fuente = fuenteDe(RUTA_G);
  if (fuente === null) {
    quejas.push(`No se puede leer ${RUTA_G}, que es el único endpoint del estudio.`);
  } else {
    const codigo = soloCodigo(fuente);
    const cabecera = /export\s+default\s+(?:async\s+)?function\s+\w*\s*\([^)]*\)\s*\{/.exec(codigo);
    if (!cabecera) {
      quejas.push(
        `${RUTA_G} no exporta por defecto el handler que dice el contrato §12: ` +
          'export default async function handler(req, res).'
      );
    } else {
      const cuerpo = codigo.slice(cabecera.index + cabecera[0].length);
      // La primera llamada del cuerpo, sea cual sea, tiene que ser esta.
      const primera = /([A-Za-z_$][\w$.]*)\s*\(/.exec(cuerpo);
      if (!primera) {
        quejas.push(`El handler de ${RUTA_G} no llama a nada, ni siquiera al censor.`);
      } else if (primera[1] !== 'instalarCensor') {
        const linea =
          codigo.slice(0, cabecera.index + cabecera[0].length + primera.index).split('\n').length;
        quejas.push(
          `${RUTA_G}:${linea} · lo primero que llama el handler es ` +
            `${primera[1]}(), no instalarCensor(). El censor sobrescribe ` +
            'res.json y res.end: lo que salga antes de instalarlo sale sin ' +
            'vigilar, y ahí es justo donde aparece el JSON de la service account.'
        );
      }
      const antes = cuerpo.slice(0, primera ? primera.index : 0);
      if (/\bawait\b/.test(antes)) {
        quejas.push(
          `${RUTA_G} hace un await antes de instalar el censor. Tiene que ir ` +
            'antes de cualquier await, sin excepción.'
        );
      }
      if (!/\bimport\b[^\n]*instalarCensor/.test(codigo)) {
        quejas.push(`${RUTA_G} no importa instalarCensor de _lib/censor.js.`);
      }
    }
  }
  comprobar('api/g.js llama a instalarCensor lo primero', quejas);
}

// ===========================================================================
// CÓDIGO · Ningún id de modelo escrito a mano
// ===========================================================================

bloque('Código · ningún id de modelo a mano');

{
  /** Solo el código que se ejecuta: api/, app/ y montador/. */
  const archivosDelEstudio = archivos.filter(
    (rel) => rel.startsWith('api/') || rel.startsWith('app/') || rel.startsWith('montador/')
  );

  /**
   * Un id de modelo completo: familia, versión y variante. «gemini-3-pro-image»
   * o «veo-3.1-generate-001» lo son; «gemini-3» a secas no es ningún modelo, es
   * el nombre de una familia.
   */
  const ID_COMPLETO = /\b(?:gemini|veo|lyria|imagen|chirp)-[a-z0-9]+(?:\.[0-9]+)?(?:-[a-z0-9]+)+\b/gi;

  /** Los tres prefijos que pide el encargo, para el aviso. */
  const FAMILIAS = { 'gemini-': /gemini-/gi, 'veo-3': /veo-3/gi, 'lyria-': /lyria-/gi };

  /** Los ids que serie.json declara: si uno aparece en el código, está a mano. */
  const idsDeclarados = new Set();
  const recogerIds = (valor) => {
    if (typeof valor === 'string') {
      ID_COMPLETO.lastIndex = 0;
      const m = ID_COMPLETO.exec(valor);
      if (m && m[0] === valor.trim()) idsDeclarados.add(valor.trim().toLowerCase());
      return;
    }
    if (Array.isArray(valor)) valor.forEach(recogerIds);
    else if (valor && typeof valor === 'object') Object.values(valor).forEach(recogerIds);
  };
  recogerIds(serie.modelos);
  recogerIds(serie.musica && serie.musica.modelo);
  recogerIds(serie.voces && serie.voces.modelo);

  // Se mira el código con los comentarios borrados: un ejemplo escrito en un
  // comentario documenta, no elige un modelo.
  const codigos = new Map();
  for (const rel of archivosDelEstudio) {
    const fuente = fuenteDe(rel);
    if (fuente === null) continue;
    codigos.set(rel, esJavaScript(rel) ? soloCodigo(fuente) : fuente);
  }

  const completos = [];
  for (const [rel, codigo] of codigos) {
    for (const hallazgo of buscar(codigo, ID_COMPLETO)) {
      completos.push({ rel, ...hallazgo });
    }
  }

  for (const [nombre, patron] of Object.entries(FAMILIAS)) {
    const quejas = [];
    const soloLaFamilia = [];
    for (const [rel, codigo] of codigos) {
      for (const hallazgo of buscar(codigo, patron)) {
        const completo = completos.find(
          (c) =>
            c.rel === rel &&
            c.linea === hallazgo.linea &&
            c.encontrado.toLowerCase().includes(nombre.toLowerCase())
        );
        if (completo) {
          const declarado = idsDeclarados.has(completo.encontrado.toLowerCase());
          quejas.push(
            `${rel}:${completo.linea} escribe el id «${completo.encontrado}»` +
              (declarado
                ? ', que ya está en datos/serie.json. Los ids salen de ahí por ' +
                  '_lib/datos.js y se sustituyen por variable de entorno; ' +
                  'escritos aquí, cambiarlos obliga a tocar código.'
                : '. Ningún id de modelo se escribe a mano: van en ' +
                  'datos/serie.json y se sustituyen por variable de entorno.')
          );
        } else if (!soloLaFamilia.some((x) => x === `${rel}:${hallazgo.linea}`)) {
          soloLaFamilia.push(`${rel}:${hallazgo.linea}`);
        }
      }
    }
    comprobar(`Sin «${nombre}» escrito a mano fuera de datos/`, quejas);
    if (soloLaFamilia.length) {
      avisar(
        `«${nombre}» aparece nombrando la familia, sin ser ningún id completo, ` +
          `en ${listaCorta(soloLaFamilia)}. No elige ningún modelo —son reglas ` +
          'de familia, como que los Gemini 3.x solo se sirven desde «global», y ' +
          'texto de mensajes— pero se enseña para que se pueda mirar.'
      );
    }
  }
}

// ===========================================================================
// CÓDIGO · Una llamada de texto por escena (§13.3)
// ===========================================================================

bloque('Código · una llamada por escena');

{
  const archivosDelEstudio = archivos.filter(
    (rel) =>
      (rel.startsWith('api/') || rel.startsWith('app/') || rel.startsWith('montador/')) &&
      esJavaScript(rel)
  );
  const PATRON = /desglosarEpisodio|desglosar-episodio|desglosar_episodio/g;
  const quejas = [];
  for (const rel of archivosDelEstudio) {
    const fuente = fuenteDe(rel);
    if (fuente === null) continue;
    for (const hallazgo of buscar(soloCodigo(fuente), PATRON)) {
      quejas.push(
        `${rel}:${hallazgo.linea} tiene un desglose por episodio ` +
          `(«${hallazgo.encontrado}»). El desglose es una llamada de texto POR ` +
          'ESCENA: una por episodio no cabe en la ventana ni en los 60 s de la ' +
          'función, y cuando falla se pierden las 24 escenas en vez de una.'
      );
    }
  }
  comprobar('No existe ningún desglose por episodio (§13.3)', quejas);
}

{
  const RUTA_TEXTO = 'api/_lib/texto.js';
  const quejas = [];
  const fuente = fuenteDe(RUTA_TEXTO);
  if (fuente === null) {
    quejas.push(`No se puede leer ${RUTA_TEXTO}, donde vive desglosarEscena().`);
  } else {
    const codigo = soloCodigo(fuente);
    const declara = /export\s+(?:async\s+)?function\s+desglosarEscena\s*\(([^)]*)\)/.exec(codigo);
    if (!declara) {
      quejas.push(
        `${RUTA_TEXTO} no exporta desglosarEscena(episodio, escena), que es la ` +
          'firma del contrato §12.'
      );
    } else {
      const argumentos = declara[1]
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      const linea = codigo.slice(0, declara.index).split('\n').length;
      if (argumentos.length !== 2) {
        quejas.push(
          `${RUTA_TEXTO}:${linea} · desglosarEscena recibe ` +
            `${argumentos.length} argumentos y tiene que recibir dos: el ` +
            'episodio y UNA escena.'
        );
      }
      if (argumentos.some((a) => a.startsWith('...') || a.startsWith('['))) {
        quejas.push(
          `${RUTA_TEXTO}:${linea} · desglosarEscena acepta una lista de escenas. ` +
            'Recibe una escena y solo una: si acepta varias, alguien acabará ' +
            'mandándole el episodio entero.'
        );
      }
    }
  }
  comprobar('desglosarEscena recibe una escena, no una lista', quejas);
}

// ===========================================================================
// Resumen
// ===========================================================================

const total = cuenta.bien + cuenta.mal;
console.log('');
console.log('─'.repeat(ANCHO));
const partes = [`${total} comprobaciones`, `${cuenta.bien} bien`];
if (cuenta.mal) partes.push(`${cuenta.mal} mal`);
if (cuenta.avisos) partes.push(`${cuenta.avisos} aviso${cuenta.avisos === 1 ? '' : 's'}`);
console.log(partes.join(', '));

if (cuenta.mal) {
  for (const linea of envolver(
    'Arriba, cada ✗ dice qué falla y dónde. Nada de esto se ' +
      'arregla desde la aplicación: se corrige en datos/serie.json o en el ' +
      'código y se vuelve a pasar esta herramienta.',
    ANCHO,
    ''
  )) {
    console.log(linea);
  }
} else {
  for (const linea of envolver(
    'Los datos y el código cumplen lo que el plan §13 y el contrato §6 y §13 ' +
      'dan por cierto. Lo que esto NO mide es el peso de las respuestas: eso ' +
      'se pesa con herramientas/pesar.mjs, y se mide, no se razona.',
    ANCHO,
    ''
  )) {
    console.log(linea);
  }
}
console.log('');

process.exitCode = cuenta.mal ? 1 : 0;
