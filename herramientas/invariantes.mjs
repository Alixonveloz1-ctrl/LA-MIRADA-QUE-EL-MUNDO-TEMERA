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
function soloCodigo(fuente, { tambienCadenas = false, tambienRegex = false } = {}) {
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
      // Lo de dentro de una regex no es código: «/audio\/l(\d+)/» no llama a
      // ninguna función «l()», y «/\B(?=(\d{3})+)/» no llama a ninguna «B()».
      // Se vacía con `tambienRegex` porque hay comprobaciones que buscan
      // llamadas y se creerían esas.
      if (tambienRegex) borrar(i + 1, j);
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

bloque('El README, al día');

{
  // El README se queda viejo solo, y un README viejo es peor que ninguno: manda
  // a quien lo lee a buscar cosas que ya no están y a no enterarse de las que
  // sí. Así que no se confía en acordarse: se comprueba.
  //
  // No se comprueba la prosa —eso no se puede— sino que NOMBRE lo que existe:
  // cada pieza, cada carpeta, cada pantalla y cada herramienta. Si mañana se
  // añade una pieza y el README no la nombra, esto falla y hay que escribirla.
  const readme = textoDe('README.md') || '';
  const faltan = [];

  const nombra = (aguja) => readme.includes(aguja);

  // La pieza tiene que aparecer como `id` entre comillas invertidas, no suelta
  // dentro de otra palabra: buscar «ending» a secas casaría con
  // «opening-ending.json» y la comprobación no valdría para nada.
  for (const idPieza of Object.keys(serie.piezas || {})) {
    if (!nombra(`\`${idPieza}\``)) faltan.push(`la pieza «${idPieza}»`);
  }

  for (const carpeta of ['app/', 'api/', 'datos/', 'docs/', 'herramientas/', 'montador/', 'despliegue/']) {
    if (!nombra(carpeta)) faltan.push(`la carpeta «${carpeta}»`);
  }

  for (const pantalla of ['Salud', 'Voces', 'Banco', 'Desglose', 'Tomas', 'Audio', 'Cola', 'Montaje']) {
    if (!nombra(`**${pantalla}**`)) faltan.push(`la pantalla «${pantalla}»`);
  }

  for (const orden of ['npm run comprobar', 'instalar.sh']) {
    if (!nombra(orden)) faltan.push(`«${orden}»`);
  }

  comprobar(
    'El README nombra todo lo que existe',
    faltan.length
      ? [
          `README.md no nombra ${listaCorta(faltan, 6)}. El README se actualiza con CADA cambio: ` +
            'uno viejo manda a buscar cosas que ya no están y esconde las que sí.',
        ]
      : [],
  );

  // Y que no nombre lo que ya no existe.
  const fantasmas = [];
  for (const idPieza of ['ep01', 'ep02']) {
    if (nombra(`\`${idPieza}\``) && !serie.piezas[idPieza]) {
      fantasmas.push(`la pieza «${idPieza}», que el README nombra y no existe todavía`);
    }
  }
  comprobar(
    'El README no promete lo que no hay',
    fantasmas.length ? [`README.md nombra ${listaCorta(fantasmas, 4)}.`] : [],
  );
}

bloque('Datos · lo que se ve en pantalla');

{
  // Rangos de japonés y de chino: kana, kanji, formas compatibles y la
  // puntuación de anchura completa. Si algo de esto aparece en un campo que se
  // pinta, el montador necesitaría una fuente CJK que no tiene y saldría en
  // pantalla un idioma que la serie solo usa para el oído.
  const CJK =
    /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;

  /**
   * Los únicos sitios donde el japonés es lo correcto: lo que se OYE.
   *
   *   · `audio.voz[].ja`  — lo que dice un personaje.
   *   · `letra[].ja`      — lo que se CANTA en el opening y en el ending.
   *   · el encargo a Lyria — la letra viaja dentro del encargo para que la
   *     cante; el encargo en sí va en inglés porque Lyria rechaza la petición
   *     entera en cualquier otro idioma, pero la letra que va dentro es japonés
   *     y tiene que serlo.
   *
   * En los tres casos, lo que se PINTA es el campo `es` de al lado. En pantalla
   * no hay japonés en ningún momento.
   */
  const esCampoDeAudio = (ruta) =>
    /^piezas\.[^.]+\.audio\.voz\[\d+\]\.ja$/.test(ruta) ||
    /^piezas\.[^.]+\.letra\[\d+\]\.ja$/.test(ruta) ||
    /^musica\.piezas\[\d+\]\.encargo$/.test(ruta);

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

  // ─────────────────────────────────────────────────────────────────────────
  // NINGUNA MÚSICA SE QUEDA SIN DUEÑO.
  //
  // La pantalla de Audio empareja cada pieza de música con una pieza de la serie
  // por su campo `pieza`. Una entrada que no lo lleve y que tampoco sea del
  // banco de la temporada no se pinta en ninguna parte: está escrita, cuesta lo
  // mismo de mantener, y nadie puede generarla. Eso pasó de verdad y por eso se
  // comprueba: el emparejamiento iba por el prefijo del id y funcionaba solo
  // mientras la única pieza fuera el teaser.
  // ─────────────────────────────────────────────────────────────────────────
  const idsDePieza = new Set(Object.keys(serie.piezas || {}));
  const huerfanas = [];
  for (const pieza of piezasDeMusica) {
    const id = String((pieza && pieza.id) || '');
    if (pieza && pieza.temporada === true) continue;
    const dicha = typeof pieza.pieza === 'string' ? pieza.pieza.trim() : '';
    if (dicha) {
      if (!idsDePieza.has(dicha)) {
        huerfanas.push(
          `«${id}» dice ser de la pieza «${dicha}», y esa pieza no existe en ` +
            '`piezas` de datos/serie.json.'
        );
      }
      continue;
    }
    const porPrefijo = [...idsDePieza].some((p) => id === p || id.startsWith(`${p}-`));
    if (!porPrefijo) {
      huerfanas.push(
        `«${id}» no dice de qué pieza es (campo «pieza») ni su id empieza por ` +
          'el de ninguna, y tampoco está marcada «temporada». Así no sale en ' +
          'ninguna pantalla y no hay manera de generarla.'
      );
    }
  }
  comprobar('Ninguna pieza de música se queda sin dueño', huerfanas);

  // ─────────────────────────────────────────────────────────────────────────
  // EL BANCO DE LA TEMPORADA ESTÁ COMPLETO.
  //
  // Es la música que suena DENTRO de los episodios: 289 escenas. Se compone una
  // vez y se reutiliza en los doce, como el opening y el ending. Cada pieza
  // tiene que decir para qué sirve y dónde suena, o dentro de tres meses nadie
  // —ni quien la escribió— sabrá cuál de las quince poner en una escena.
  // ─────────────────────────────────────────────────────────────────────────
  const banco = piezasDeMusica.filter((p) => p && p.temporada === true);
  const delBanco = [];
  if (!banco.length) {
    delBanco.push(
      'No hay ninguna pieza marcada «temporada». Sin banco, los doce ' +
        'episodios se montarían sin más música que el opening y el ending.'
    );
  }
  for (const pieza of banco) {
    const id = String(pieza.id || '');
    if (!id.startsWith('bso-')) {
      delBanco.push(
        `«${id}» es del banco y su id no empieza por «bso-». El prefijo importa: ` +
          'la pantalla empareja por él cuando una entrada antigua no dice de qué ' +
          'pieza es, y un id que empiece como una pieza se le colgaría a esa pieza.'
      );
    }
    for (const campo of ['funcion', 'donde', 'encargo', 'negativo']) {
      const valor = pieza[campo];
      if (typeof valor !== 'string' || !valor.trim()) {
        delBanco.push(`«${id}» no tiene escrito su «${campo}».`);
      }
    }
  }
  comprobar('El banco de la temporada dice para qué sirve cada pieza', delBanco);
}

// ===========================================================================
// DATOS · El archivo de planos de ambiente
// ===========================================================================

bloque('Datos · el archivo');

{
  // UN PLANO DE ARCHIVO NO PUEDE CONTAR NADA, Y ESO NO ES UN CAPRICHO.
  //
  // El archivo son planos de ambiente que se generan una vez y se reutilizan en
  // los doce episodios: la cripta sale en 24 escenas de 8 episodios, los túneles
  // en 46 de 11. Reutilizar solo funciona si el plano no dice nada: si en él
  // aparece un personaje, o pasa algo, al repetirlo en el episodio 9 el
  // personaje vuelve a estar ahí y lo que pasó vuelve a pasar. Eso el
  // espectador SÍ lo nota, y entonces el ahorro sale carísimo.
  //
  // Las palabras de abajo son las que delatan a alguien en cuadro. Están en
  // inglés porque los prompts van en inglés. Se admiten dentro de una negación
  // —«no people anywhere in frame» es justamente lo que hay que escribir—, así
  // que lo que se busca es la palabra SIN un «no» delante.
  // Van con límites de palabra a propósito: sin ellos, «man» salta dentro de
  // «many-armed idol» y «he» dentro de «the», y una herramienta que acusa a
  // media biblioteca de tener gente donde no la hay deja de leerse a la tercera
  // vez.
  const PALABRAS_DE_GENTE = [
    'man', 'men', 'woman', 'women', 'boy', 'girl', 'child', 'children',
    'person', 'people', 'figure', 'figures', 'hand', 'hands', 'face', 'faces',
    'he', 'she', 'his', 'her', 'they', 'someone', 'crowd',
  ];

  /** ¿La palabra viene precedida de una negación en la misma frase? */
  const vaNegada = (texto, donde) => {
    const antes = texto.slice(Math.max(0, donde - 40), donde);
    return /\b(no|not|never|without|nobody|none)\b[^.]*$/i.test(antes);
  };

  const delArchivo = [];
  const notasDelArchivo = [];

  for (const [idPieza, pieza] of Object.entries(piezas)) {
    if (!pieza || pieza.archivo !== true) continue;
    const tomas = Array.isArray(pieza.tomas) ? pieza.tomas : [];

    if (!tomas.length) {
      delArchivo.push(`La pieza de archivo «${idPieza}» no tiene ni un plano.`);
      continue;
    }

    for (const toma of tomas) {
      const donde = nombreDeToma(idPieza, toma);

      // Referencias de personaje: aquí no puede haber ninguna, y esto no admite
      // matices ni palabras que interpretar.
      if (Array.isArray(toma.refs) && toma.refs.length) {
        delArchivo.push(
          `${donde} lleva ${toma.refs.length} referencia(s) de personaje ` +
            `(${toma.refs.join(', ')}). Un plano de archivo se repite en varios ` +
            'episodios: un personaje dentro reaparecería cada vez.'
        );
      }

      if (toma.encadena_con) {
        delArchivo.push(
          `${donde} encadena con «${toma.encadena_con}». Un plano de archivo no ` +
            'encadena con nada: se coloca suelto donde haga falta, y encadenar ' +
            'lo ata a un sitio de la línea de tiempo de una pieza concreta.'
        );
      }

      if (toma.boca_visible) {
        delArchivo.push(`${donde} declara boca visible, y en un plano de archivo no hay nadie.`);
      }

      if (typeof toma.uso !== 'string' || !toma.uso.trim()) {
        delArchivo.push(
          `${donde} no dice cuándo se usa. Con 56 planos de ambiente, el que no ` +
            'dice para qué sirve no lo va a poner nadie.'
        );
      }

      // TRES SITIOS SÍ LLEVAN GENTE, Y ES LO CORRECTO.
      //
      // La ciudad trabajando, la cola de carros en la puerta y el campamento no
      // significan nada vacíos: lo que cuentan es que hay gente. Ahí se admiten
      // figurantes a lo lejos —anónimos, demasiado pequeños para leerlos—, y el
      // plano se marca para decir que es a propósito. Lo que sí se exige es que
      // el texto prometa que no se les ve la cara: un figurante reconocible en
      // un plano que sale en cuatro episodios es un personaje sin ficha.
      if (toma.figurantes_lejanos === true) {
        const junto = `${toma.imagen || ''} ${toma.video || ''}`.toLowerCase();
        if (!junto.includes('no faces visible')) {
          delArchivo.push(
            `${donde} admite figurantes a lo lejos pero no promete «no faces ` +
              'visible». Sin esa promesa, un figurante reconocible aparecería ' +
              'igual en cuatro episodios y sería un personaje sin ficha.'
          );
        }
        continue;
      }

      // Y las palabras. Como aviso y no como fallo: la lista es de palabras, no
      // de sentido, y tumbar un plano por decir «hands» en «no hands in frame»
      // sería exactamente el error que esta herramienta dice no cometer.
      for (const campo of ['imagen', 'video']) {
        const texto = String(toma[campo] || '').toLowerCase();
        for (const palabra of PALABRAS_DE_GENTE) {
          const patron = new RegExp(`\\b${palabra}\\b`, 'g');
          let encontrado = null;
          for (const coincidencia of texto.matchAll(patron)) {
            if (!vaNegada(texto, coincidencia.index)) {
              encontrado = coincidencia.index;
              break;
            }
          }
          if (encontrado === null) continue;
          notasDelArchivo.push(
            `${donde}, en «${campo}», dice «${palabra}» sin negarla. Míralo: si ` +
              'de verdad hay alguien en cuadro, este plano no se puede reutilizar.'
          );
          break;
        }
      }
    }
  }

  comprobar(
    'Ningún plano de archivo lleva personajes, encadena ni cuenta nada',
    delArchivo,
    notasDelArchivo
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Y AL REVÉS: QUIEN APUNTA AL ARCHIVO TIENE QUE APUNTAR A ALGO QUE ESTÁ.
  //
  // Un plano de episodio con `de_archivo` no genera nada suyo: lee el material
  // del archivo. Si el id no existe —porque se renombró un sitio, porque el
  // desglose se lo inventó—, ese plano no tiene de dónde sacar el clip y el
  // episodio se monta con un hueco justo ahí. No falla nada, no avisa nadie:
  // sale un salto en el vídeo terminado. Por eso se mira aquí.
  // ─────────────────────────────────────────────────────────────────────────
  const idsDeArchivo = new Set();
  for (const pieza of Object.values(piezas)) {
    if (!pieza || pieza.archivo !== true) continue;
    for (const toma of Array.isArray(pieza.tomas) ? pieza.tomas : []) {
      if (toma && toma.id) idsDeArchivo.add(String(toma.id));
    }
  }

  const punteros = [];
  for (const { idPieza, pieza, toma } of todasLasTomas) {
    if (pieza && pieza.archivo === true) continue;
    const apunta = typeof toma.de_archivo === 'string' ? toma.de_archivo.trim() : '';
    if (!apunta) continue;
    const donde = nombreDeToma(idPieza, toma);

    if (!idsDeArchivo.has(apunta)) {
      punteros.push(
        `${donde} usa «${apunta}» del archivo y ese plano no existe. El ` +
          'episodio se montaría con un hueco ahí, sin avisar de nada.'
      );
      continue;
    }

    const original = [...todasLasTomas].find(
      (otra) => otra.pieza && otra.pieza.archivo === true && otra.toma.id === apunta
    );

    if (Number(toma.dur) > Number(original.toma.dur) + CASI) {
      punteros.push(
        `${donde} pide ${toma.dur} s de «${apunta}», que dura ` +
          `${original.toma.dur} s. No se puede cortar más película de la que hay.`
      );
    }

    if (Array.isArray(toma.refs) && toma.refs.length) {
      punteros.push(`${donde} usa el archivo y además lleva referencias de personaje.`);
    }
    if (toma.boca_visible) {
      punteros.push(`${donde} usa el archivo y declara boca visible: ahí no habla nadie.`);
    }
    if (toma.encadena_con) {
      punteros.push(
        `${donde} usa el archivo y encadena con «${toma.encadena_con}». Un plano ` +
          'que sale igual en varios episodios no puede llevar a un sitio concreto.'
      );
    }
  }

  comprobar('Todo plano que apunta al archivo apunta a uno que existe', punteros);
}

// ===========================================================================
// DATOS · Menores y daño en el mismo prompt
// ===========================================================================

bloque('Datos · menores y daño');

{
  // LO QUE GOOGLE NO VA A GENERAR NUNCA, DICHO ANTES DE PEDIRLO.
  //
  // Esto no es una regla de estilo: es la única cosa que el filtro de contenido
  // bloquea SIEMPRE, sin matices y sin importar cómo esté escrita. Un menor y
  // una palabra de daño en el mismo prompt vuelven con
  // «IMAGE_PROHIBITED_CONTENT» y no hay forma de reintentarlo.
  //
  // Ya ha pasado tres veces en este proyecto: la placa de Saharis a los cinco
  // años («gaunt, filthy, bare feet»), la de saharis-barrio, y el plano C2 del
  // teaser —un recién nacido con la cara salpicada de sangre—. Las tres se
  // descubrieron pagando la llamada y leyendo el error en el móvil.
  //
  // La regla de la serie ya estaba escrita en el README: estas cosas se cuentan
  // sin ponerlas en cuadro. Lo que faltaba era comprobarlo. Un plano que no se
  // puede generar es peor que uno mal escrito: el mal escrito sale feo y se
  // rehace; este no sale, y la primera noticia es un error rojo.
  const DANO = [
    'blood', 'bloody', 'bloodied', 'spatter', 'spattered', 'wound', 'wounded',
    'scar', 'scars', 'scarred', 'bruise', 'bruised', 'bleeding', 'stab',
    'stabbed', 'corpse', 'dead', 'naked', 'nude', 'starving', 'emaciated',
    'gaunt', 'filthy', 'beaten', 'strangled', 'burned', 'mutilated',
  ];

  /**
   * Los personajes que son menores, sacados de su propia identidad. No hay una
   * lista escrita a mano a propósito: una lista se queda vieja en cuanto se
   * añade un personaje, y entonces esta comprobación diría que todo está bien.
   */
  const NUMEROS_DE_MENOR =
    /\b(newborn|infant|baby|toddler|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)\b[^.]{0,24}\b(year|years|old)\b|\b(newborn|infant|baby)\b|\b(boy|girl|child|man|woman) (of|about) (one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)\b|\b(about|aged) (one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)\b/i;

  const menores = new Set();
  for (const [id, ficha] of Object.entries(serie.personajes || {})) {
    if (NUMEROS_DE_MENOR.test(String((ficha && ficha.identidad) || ''))) menores.add(id);
  }

  /** Las placas de esos personajes: es lo que un plano nombra en «refs». */
  const placasDeMenor = new Set(
    placasBanco.filter((p) => p && menores.has(p.personaje)).map((p) => p.id)
  );

  const quejas = [];
  for (const { idPieza, toma } of todasLasTomas) {
    const texto = `${toma.imagen || ''} ${toma.video || ''}`.toLowerCase();
    const palabras = DANO.filter((palabra) => new RegExp(`\\b${palabra}\\b`).test(texto));
    if (!palabras.length) continue;

    // ¿Hay un menor en este plano? Por referencia o dicho en el propio texto.
    const porRef = (toma.refs || []).filter((ref) => placasDeMenor.has(ref));
    const porTexto = NUMEROS_DE_MENOR.test(texto) ||
      /\b(child|children|kid|infant|newborn|baby|boy|girl)\b/.test(texto);
    if (!porRef.length && !porTexto) continue;

    quejas.push(
      `${nombreDeToma(idPieza, toma)} junta a un menor con ${
        palabras.length === 1 ? 'la palabra' : 'las palabras'
      } «${palabras.join('», «')}»` +
        (porRef.length ? ` (referencia ${porRef.join(', ')})` : '') +
        '. Google bloquea eso siempre, así que ese plano no se va a generar: ' +
        'la primera noticia sería un error rojo con la llamada ya pagada. Se ' +
        'cuenta sin ponerlo en cuadro, como el resto de la serie.'
    );
  }

  comprobar(
    `Ningún plano junta a un menor con una palabra de daño (${menores.size} menores)`,
    quejas,
    menores.size
      ? [`Menores detectados por su ficha: ${[...menores].sort().join(', ')}.`]
      : ['No se ha detectado ningún personaje menor, y eso en esta serie sería raro: míralo.']
  );

  // Y LO MISMO EN LAS PLACAS, QUE ES DONDE EMPEZÓ.
  //
  // La primera vez que salió «IMAGE_PROHIBITED_CONTENT» no fue en un plano: fue
  // en la placa de Saharis a los cinco años, cuya identidad decía «gaunt,
  // filthy, bare feet». Una placa bloqueada es peor que un plano bloqueado,
  // porque su ancla es la referencia de todos los planos de ese personaje: sin
  // ella no se puede generar nada suyo en toda la serie.
  //
  // Se mira la identidad del personaje Y el encuadre de la placa, porque el
  // prompt que se manda es los dos juntos.
  const deLasPlacas = [];
  for (const placa of placasBanco) {
    if (!placa || !menores.has(placa.personaje)) continue;
    const ficha = (serie.personajes || {})[placa.personaje] || {};
    const texto = `${ficha.identidad || ''} ${placa.encuadre || ''}`.toLowerCase();
    const palabras = DANO.filter((palabra) => new RegExp(`\\b${palabra}\\b`).test(texto));
    if (!palabras.length) continue;
    deLasPlacas.push(
      `La placa «${placa.id}» es de «${placa.personaje}», que es menor, y su ` +
        `prompt lleva «${palabras.join('», «')}». Eso lo bloquea Google siempre. ` +
        (placa.ancla
          ? 'Y encima es su ANCLA: sin ella no se puede generar ni un plano suyo ' +
            'en toda la serie.'
          : 'La pobreza y el daño se cuentan con la ropa y con la luz, no con el cuerpo.')
    );
  }
  comprobar('Ninguna placa de un menor lleva una palabra de daño', deLasPlacas);
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

{
  // UN ESCENARIO SE GENERA VACÍO, Y SU REFERENCIA IGNORA A QUIEN SE COLARA.
  //
  // La placa del escenario viaja como referencia de objeto en TODOS los planos
  // que ocurren ahí. Si sale con figurantes de relleno —y el modelo los pone
  // solo: a un «plano general de un santuario con antorchas» le salen
  // encapuchados sin que nadie los pida—, esos figurantes se heredan en los once
  // planos de esa localización y no hay forma de quitarlos después sin regenerar
  // la placa Y todo lo hecho contra ella.
  //
  // Son dos frenos y hacen falta los dos: pedir el sitio vacío al generarlo, y
  // decirle al keyframe que ignore a cualquiera que aparezca en la referencia.
  // Esto comprueba que los dos siguen ahí.
  const quejas = [];
  const fuente = fuenteDe(RUTA_PROMPT);

  if (fuente === null) {
    quejas.push(`No se puede leer ${RUTA_PROMPT}.`);
  } else {
    const codigo = soloCodigo(fuente, { tambienRegex: false });

    const abre = codigo.indexOf('promptEscenario');
    const cuerpo = abre < 0 ? null : cuerpoDeLaFuncion(codigo, abre);
    if (!cuerpo) {
      quejas.push(
        `${RUTA_PROMPT} ya no exporta promptEscenario, o ha cambiado de nombre. ` +
          'Es la función que compone el prompt de una localización.'
      );
    } else {
      if (!/SITIO_VACIO/.test(cuerpo)) {
        quejas.push(
          'promptEscenario ya no pide el sitio VACÍO. Sin esa frase el modelo ' +
            'rellena la localización de figurantes por su cuenta, y esa placa viaja ' +
            'como referencia a todos los planos que ocurren ahí: los figurantes ' +
            'inventados acaban al lado del personaje que sí toca, en todos.'
        );
      }
      if (!/NEGATIVO_DE_GENTE/.test(cuerpo)) {
        quejas.push(
          'promptEscenario ya no manda gente en el negativo. Hace falta decirlo por ' +
            'los dos lados: en el prompt y en el negativo, que es donde el modelo hace ' +
            'más caso.'
        );
      }
    }

    if (!/IGNORE THEM COMPLETELY/i.test(codigo)) {
      quejas.push(
        'La instrucción que acompaña a la placa de escenario ya no le dice al ' +
          'keyframe que IGNORE a la gente que aparezca en la referencia. Es el ' +
          'segundo freno: sin él, un figurante que se colara en una placa ya ' +
          'aprobada se seguiría heredando en cada plano de esa localización.'
      );
    }
  }

  comprobar('El escenario se genera vacío y su referencia ignora a los figurantes', quejas);
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
// DOCS · Los enlaces de Cloud Shell
// ===========================================================================

bloque('Docs · los enlaces de Cloud Shell');

{
  // UN ENLACE QUE INSTALA CÓDIGO VIEJO NO SE DISTINGUE DE UNO QUE FUNCIONA.
  //
  // Los enlaces de Cloud Shell llevan dentro la rama que se clona. El trabajo se
  // fusiona en `main`, pero los enlaces se escribieron un día apuntando a una
  // rama de trabajo y ahí se quedaron: pulsarlos instalaba el estudio de
  // entonces. Y no falla nada —clona, instala, funciona—, solo que instala otra
  // cosa. Eso no se ve mirando: se ve cuando algo que se arregló hace un mes
  // sigue roto.
  //
  // Se comprueban también dos cosas más, y las dos son de seguridad: este
  // repositorio es público, así que ningún enlace puede llevar dentro un
  // proyecto ni una cuenta; eso se lo añade quien lo use, en su móvil.
  const CLOUDSHELL = /shell\.cloud\.google\.com\/cloudshell\/open\?[^)\s]+/g;

  const quejas = [];
  const notas = [];
  let cuantos = 0;

  for (const rel of archivos.filter((r) => r.endsWith('.md') || r.endsWith('.sh'))) {
    const fuente = fuenteDe(rel);
    if (!fuente) continue;

    for (const encaje of fuente.matchAll(CLOUDSHELL)) {
      cuantos += 1;
      const enlace = encaje[0];
      const linea = fuente.slice(0, encaje.index).split('\n').length;
      const donde = `${rel}:${linea}`;

      const rama = /cloudshell_git_branch=([^&)\s]+)/.exec(enlace);
      if (!rama) {
        notas.push(
          `${donde} no dice qué rama clona. Cloud Shell cogerá la que sea la ` +
            'principal del repositorio, que hoy es la buena; decirlo quita la duda.'
        );
      } else if (decodeURIComponent(rama[1]) !== 'main') {
        quejas.push(
          `${donde} clona la rama «${decodeURIComponent(rama[1])}» y el trabajo se ` +
            'fusiona en «main». Ese enlace instala el estudio de otro día, y no ' +
            'falla: instala otra cosa, que es peor.'
        );
      }

      if (/[?&]project=/.test(enlace)) {
        quejas.push(`${donde} lleva un proyecto dentro. Este repositorio es público.`);
      }
      if (/[?&]authuser=/.test(enlace)) {
        quejas.push(`${donde} lleva una cuenta dentro. Este repositorio es público.`);
      }

      const tutorial = /cloudshell_tutorial=([^&)\s]+)/.exec(enlace);
      if (tutorial) {
        const ruta = decodeURIComponent(tutorial[1]);
        if (!archivos.includes(ruta)) {
          quejas.push(
            `${donde} abre el tutorial «${ruta}» y ese archivo no está en el ` +
              'repositorio. Cloud Shell abriría el terminal sin ninguna guía, y ' +
              'desde un móvil no se puede pegar en él.'
          );
        }
      } else {
        quejas.push(
          `${donde} no abre ningún tutorial. Sin botones hay que teclear los ` +
            'comandos a mano, y el terminal de Cloud Shell no deja pegar desde el móvil.'
        );
      }
    }
  }

  comprobar(
    `Los ${cuantos} enlaces de Cloud Shell clonan «main», abren su tutorial y no llevan cuenta`,
    quejas,
    notas
  );
}

// ===========================================================================
// DOCS · Los tutoriales no escriben la ruta del clon a mano
// ===========================================================================

bloque('Docs · la ruta del clon');

{
  // LA CARPETA CLONADA NO SIEMPRE SE LLAMA IGUAL.
  //
  // Cloud Shell clona en `~/cloudshell_open/<repo>`, pero si ya había un clon de
  // otra vez lo deja al lado como `<repo>-0`, `<repo>-1`… y abre el terminal
  // DENTRO del nuevo. Un comando del tutorial con la ruta escrita a mano entra
  // entonces en la copia vieja: despliega el estudio de la semana pasada y no
  // falla nada. Pasó, y lo que se vio en pantalla fue «-TEMERA-0».
  //
  // Los comandos del tutorial van sin ruta: el terminal ya está donde tiene que
  // estar.
  const quejas = [];

  for (const rel of archivos.filter((r) => r.startsWith('despliegue/') && r.endsWith('.md'))) {
    const fuente = fuenteDe(rel);
    if (!fuente) continue;
    fuente.split('\n').forEach((linea, i) => {
      if (!linea.includes('cloudshell_open/')) return;
      quejas.push(
        `${rel}:${i + 1} escribe a mano la ruta del clon. Cuando Cloud Shell clona ` +
          'encima de un clon anterior, la carpeta se llama «…-0» y ese comando ' +
          'entra en la copia vieja: despliega lo de otro día y no falla nada. Los ' +
          'comandos del tutorial van sin ruta, que el terminal ya está dentro.'
      );
    });
  }

  comprobar('Ningún tutorial escribe a mano la ruta de la carpeta clonada', quejas);
}

// ===========================================================================
// CÓDIGO · Campos en forma corta que nombran una variable que no existe
// ===========================================================================

bloque('Código · campos en forma corta');

{
  // EL FALLO QUE SOLO APARECE CUANDO YA ESTÁS PAGANDO.
  //
  // En JavaScript, `{ pieza, toma, operacion }` es lo mismo que escribir
  // `operacion: operacion`. Si la variable `operacion` no existe, eso NO es un
  // campo vacío: es un ReferenceError. Y no lo caza `node --check`, porque la
  // sintaxis es perfecta.
  //
  // Pasó de verdad. Cuando se decidió que el nombre de la operación de Veo no
  // viajara al navegador —lleva el project id dentro—, se quitó la variable y se
  // quedó el campo. Resultado: la pantalla de Cola reventaba entera, y solo
  // cuando había un vídeo generándose, que es exactamente cuando hay que
  // mirarla. Con el clip ya lanzado y ya pagado.
  //
  // Esto es un rastreo de texto, no un analizador de ámbitos: mira si el nombre
  // se declara EN ALGÚN SITIO del archivo. No caza una variable de otro ámbito,
  // y no pretende. Caza el caso que ya ha pasado, que es el que importa.
  const FORMA_CORTA = /^\s{2,}([a-zA-Z_$][\w$]*)\s*,\s*$/;

  /**
   * Todos los nombres que el archivo DECLARA en alguna parte.
   *
   * Se recogen una vez por archivo, en vez de preguntar por cada nombre suelto,
   * y es lo que hace que esto funcione: preguntando por «¿aparece este nombre
   * declarado?» con una expresión regular, la propia línea sospechosa —«toma,»
   * seguida de «operacion,»— se parecía a una desestructuración y se daba por
   * buena a sí misma. El primer intento de esta comprobación no cazó el fallo
   * que la motivó, y eso se vio ejecutándola contra el código de antes.
   */
  const declarados = (fuente) => {
    const nombres = new Set();
    const meter = (texto) => {
      for (const trozo of String(texto).matchAll(/[a-zA-Z_$][\w$]*/g)) nombres.add(trozo[0]);
    };

    for (const m of fuente.matchAll(/\b(?:const|let|var|function|class)\s+([a-zA-Z_$][\w$]*)/g)) {
      nombres.add(m[1]);
    }
    // Desestructuraciones: solo las que son de verdad una declaración.
    for (const m of fuente.matchAll(/\b(?:const|let|var)\s*(\{[^}]*\}|\[[^\]]*\])\s*=/g)) meter(m[1]);
    for (const m of fuente.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s*(\{[^}]*\}|\[[^\]]*\]|[a-zA-Z_$][\w$]*)/g)) {
      meter(m[1]);
    }
    // Parámetros: función con nombre, flecha, y método corto de un objeto.
    for (const m of fuente.matchAll(/\bfunction\s*[a-zA-Z_$][\w$]*\s*\(([^)]*)\)/g)) meter(m[1]);
    for (const m of fuente.matchAll(/\(([^)]*)\)\s*=>/g)) meter(m[1]);
    for (const m of fuente.matchAll(/^\s*(?:async\s+)?[a-zA-Z_$][\w$]*\s*\(([^)]*)\)\s*\{/gm)) meter(m[1]);
    for (const m of fuente.matchAll(/([a-zA-Z_$][\w$]*)\s*=>/g)) nombres.add(m[1]);
    for (const m of fuente.matchAll(/\bcatch\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/g)) nombres.add(m[1]);
    for (const m of fuente.matchAll(/\bimport\s+([^;]*?)\s+from\b/g)) meter(m[1]);
    return nombres;
  };

  const PALABRAS = new Set(['true', 'false', 'null', 'undefined', 'return', 'break', 'continue']);

  const quejas = [];
  const deCodigo = archivos.filter(
    (rel) =>
      (rel.startsWith('api/') || rel.startsWith('app/') || rel.startsWith('montador/')) &&
      rel.endsWith('.js')
  );

  for (const rel of deCodigo) {
    const fuente = fuenteDe(rel);
    if (!fuente) continue;
    const nombres = declarados(fuente);
    const lineas = fuente.split('\n');
    lineas.forEach((linea, i) => {
      const encaja = FORMA_CORTA.exec(linea);
      if (!encaja) return;
      const nombre = encaja[1];
      if (PALABRAS.has(nombre)) return;
      if (nombres.has(nombre)) return;
      quejas.push(
        `${rel}:${i + 1} escribe «${nombre},» en forma corta y ese nombre no se ` +
          'declara en ninguna parte del archivo. Eso no deja el campo vacío: ' +
          'revienta la función entera en cuanto se ejecuta esa línea, y ' +
          '`node --check` no lo ve porque la sintaxis está bien.'
      );
    });
  }

  comprobar('Ningún campo en forma corta nombra una variable que no existe', quejas);
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
// DATOS · Todo el que habla tiene frase que decir
// ===========================================================================
//
// POR QUÉ EXISTE. Para elegirle voz a un personaje hay que oírle decir algo, y
// lo que dice sale de `voces.reparto[].muestra`. Once de los veintinueve no la
// traían, y la pantalla —que SÍ les encontraba su línea en el guion y la estaba
// pintando— enseñaba en su sitio un recuadro con un JSON y un botón de «copiar
// para serie.json», con el botón de probar voces apagado. Tener la frase delante
// y aun así mandar a editar un archivo a mano no es una limitación: es un
// callejón sin salida puesto a mano. Lo cierra el parche, y esto lo vigila.

bloque('Datos · todo el que habla tiene frase que decir');

{
  const reparto = (serie.voces && serie.voces.reparto) || [];

  /** Quién habla de verdad en los guiones, y cuántas veces. */
  const hablan = new Map();
  for (const episodio of guiones.guiones || []) {
    for (const escena of (episodio && episodio.escenas) || []) {
      for (const linea of (escena && escena.dialogo) || []) {
        if (!linea || typeof linea.quien !== 'string') continue;
        if (typeof linea.texto !== 'string' || !linea.texto.trim()) continue;
        hablan.set(linea.quien, (hablan.get(linea.quien) || 0) + 1);
      }
    }
  }

  const sinFrase = [];
  const sinMotivo = [];
  let aMano = 0;
  let delGuion = 0;

  for (const ficha of reparto) {
    const id = String(ficha.personaje);
    const muestra = ficha.muestra && typeof ficha.muestra === 'object' ? ficha.muestra : null;
    const texto = muestra && typeof muestra.texto === 'string' ? muestra.texto.trim() : '';

    if (!texto) {
      // Sin frase solo se puede estar por una razón: no hablar nunca. Si habla y
      // no tiene frase, es que el parche no se ha pasado o alguien editó a mano.
      if (hablan.has(id)) {
        sinFrase.push(
          `«${id}» dice ${hablan.get(id)} líneas en los guiones y no tiene frase de muestra en ` +
            'voces.reparto[].muestra. Sin ella no se le puede elegir voz escuchando, que es lo ' +
            'único que decide. La escribe sola «npm run datos».',
        );
      }
      continue;
    }

    if (muestra.del_guion === true) {
      delGuion += 1;
      // La frase sacada por una regla tiene que decir por qué es esa: es lo que
      // permite discutirla en vez de tragársela.
      if (typeof muestra.porque !== 'string' || !muestra.porque.trim()) {
        sinMotivo.push(`«${id}» tiene frase sacada del guion y no dice por qué es esa`);
      }
      // Y tiene que ser una línea que ese personaje dice de verdad.
      if (!hablan.has(id)) {
        sinMotivo.push(`«${id}» tiene frase marcada como sacada del guion, pero no habla en él`);
      }
    } else {
      aMano += 1;
    }
  }

  comprobar('Todo el que habla en los guiones tiene frase de muestra', sinFrase);
  comprobar('Cada frase sacada del guion dice por qué es esa', sinMotivo);

  // UNA FRASE CORTADA ROMPE AL PERSONAJE ENTERO, no solo a esa muestra. Antes de
  // decir nada hay que traducirlo al japonés, y al modelo se le pide la frase
  // «sin notas»; ante un texto que acaba a media palabra contesta avisando de
  // que está incompleta, salta la comprobación de «esto no está en japonés», y
  // ese personaje no puede generar NI UNA voz. Le pasaba a Iven, cuya frase
  // acababa en «y sin un solo»: fallaban las treinta candidatas, siempre.
  //
  // No se falla, se avisa: el guion interrumpe a la gente a propósito, y a quien
  // solo dice una línea y esa está cortada es mejor ponerle esa que ninguna. Al
  // modelo se le pide expresamente que traduzca la interrupción tal cual.
  const cortadas = [];
  for (const ficha of reparto) {
    const texto = ficha.muestra && typeof ficha.muestra.texto === 'string' ? ficha.muestra.texto.trim() : '';
    if (!texto) continue;
    if (/^[.…]/.test(texto) || !/[.!?…»)"']$/.test(texto)) {
      cortadas.push(`«${ficha.personaje}»: ${JSON.stringify(texto)}`);
    }
  }
  if (cortadas.length) {
    avisar(
      `${cortadas.length === 1 ? 'Una frase de muestra está cortada' : `${cortadas.length} frases de muestra están cortadas`} ` +
        `a media frase: ${cortadas.join('; ')}. Se traducen igual —al modelo se le pide que ` +
        'conserve la interrupción— pero es lo que más veces hace que conteste una nota en vez de ' +
        'traducir, y entonces ese personaje no puede generar ninguna voz. Si alguna da problemas, ' +
        'se le escribe una frase entera a mano en «voces.reparto[].muestra» de datos/serie.json.',
    );
  }
  avisar(
    `De ${reparto.length} personajes del reparto, ${aMano} llevan la frase escrita a mano y ` +
      `${delGuion} la llevan sacada del guion por «npm run datos». Ninguno obliga a editar nada: ` +
      'a los dieciocho de siempre se les escribió y a los figurantes se les busca su línea más ' +
      'difícil, pero los dos se oyen igual desde la pantalla.',
  );
}

// ===========================================================================
// DATOS · Hay voces para todos, y cada uno la suya
// ===========================================================================
//
// Una voz es de un solo personaje: dos personajes con el mismo timbre son el
// mismo personaje para el oído, y en doce capítulos eso solo se arregla
// volviendo a grabar. Eso lo impide `comprobarQueNadieComparteVoz` en el
// servidor, pero solo tiene sentido si los números dan. Aquí se comprueba que
// dan, porque el día que no den no se ve hasta el último personaje: se llega con
// todo elegido menos uno y sin ninguna voz que ponerle.
//
// LA CUENTA. Cada personaje con género declarado solo puede coger voces de su
// género; los que no lo tienen declarado pueden coger cualquiera. Para que haya
// un reparto posible hacen falta tres cosas a la vez —es la condición de Hall
// para este caso, que con tres grupos se escribe entera—:
//
//   femeninos ≤ voces femeninas
//   masculinos ≤ voces masculinas
//   todos ≤ todas las voces
//
// Con dos de las tres no basta: doce masculinos y dieciséis voces masculinas
// cumple la segunda, pero si además hay veinte personajes sin género declarado
// no hay reparto y las dos primeras no lo dirían.

bloque('Datos · hay voces para todos, y cada uno la suya');

{
  const catalogo = (serie.voces && serie.voces.catalogo) || [];
  const reparto = (serie.voces && serie.voces.reparto) || [];

  const vocesDe = (g) => catalogo.filter((v) => v && v.genero === g).length;

  // El género se lee del REPARTO, no de serie.personajes. Once de los que hablan
  // no tienen ficha de personaje —son figurantes, y un figurante no necesita
  // identidad visual— pero sí tienen voz, así que su género vive donde vive su
  // voz. Lo pone ahí «npm run datos» para todos, con ficha y sin ella.
  const generoDe = (id) => {
    const ficha = reparto.find((f) => f && f.personaje === id);
    const g = ficha && typeof ficha.genero === 'string' ? ficha.genero.trim() : '';
    return g && g !== 'sin decidir' ? g : null;
  };

  // LA CUENTA VA SOBRE LOS QUE NECESITAN VOZ PROPIA, no sobre todos. Quien dice
  // una o dos líneas y no sale con nadie que también comparta puede repetir
  // timbre, así que no consume una voz para él solo. Sin esa distinción esto
  // fallaría hoy —21 personajes masculinos y 16 voces masculinas— cuando el
  // reparto sí es posible.
  const propios = { femenina: 0, masculina: 0, cualquiera: 0 };
  const comparten = { femenina: 0, masculina: 0, cualquiera: 0 };

  for (const ficha of reparto) {
    const g = generoDe(String(ficha.personaje));
    const casilla = g === 'femenina' || g === 'masculina' ? g : 'cualquiera';
    if (ficha.comparte === true) comparten[casilla] += 1;
    else propios[casilla] += 1;
  }

  // Los que comparten necesitan AL MENOS una voz entre todos los de su género:
  // no salen juntos, pero alguna tienen que decir.
  const conUnaAlMenos = (casilla) => propios[casilla] + (comparten[casilla] > 0 ? 1 : 0);

  const quejas = [];
  const mira = (cuantos, cuantas, quienes, deQue) => {
    if (cuantos > cuantas) {
      quejas.push(
        `Hacen falta ${cuantos} ${deQue} para ${quienes} y solo hay ${cuantas}. Faltan ` +
          `${cuantos - cuantas}. Las voces de Gemini son treinta y son fijas, así que no se ` +
          'pueden añadir: o baja el reparto, o sube «lineas_para_compartir» en ' +
          'herramientas/parche-datos.mjs para que más personajes puedan repetir timbre.',
      );
    }
  };

  mira(conUnaAlMenos('femenina'), vocesDe('femenina'), 'los personajes femeninos', 'voces femeninas');
  mira(conUnaAlMenos('masculina'), vocesDe('masculina'), 'los personajes masculinos', 'voces masculinas');
  mira(
    conUnaAlMenos('femenina') + conUnaAlMenos('masculina') + conUnaAlMenos('cualquiera'),
    catalogo.length,
    'todo el reparto',
    'voces en el catálogo',
  );

  comprobar('Hay voces para repartir sin que se repita un timbre reconocible', quejas);

  // Y los que comparten tienen que poder compartir DE VERDAD: dos que salen
  // juntos no pueden, por muy pocas líneas que digan cada uno.
  const noPueden = [];
  const queComparten = reparto.filter((f) => f.comparte === true);
  for (const uno of queComparten) {
    for (const otro of queComparten) {
      if (uno === otro) continue;
      const con = Array.isArray(uno.con) ? uno.con : [];
      if (con.includes(String(otro.personaje)) && uno.personaje < otro.personaje) {
        noPueden.push(
          `«${uno.personaje}» y «${otro.personaje}» pueden compartir por líneas pero salen juntos ` +
            'en alguna escena, así que entre ellos no. Con pocos así todavía hay reparto; con ' +
            'muchos deja de haberlo y esta cuenta no lo vería.',
        );
      }
    }
  }
  if (noPueden.length) noPueden.forEach((q) => avisar(q));

  avisar(
    `${catalogo.length} voces (${vocesDe('femenina')} femeninas, ${vocesDe('masculina')} ` +
      `masculinas) para ${reparto.length} personajes. Voz propia: ${propios.femenina} femeninos, ` +
      `${propios.masculina} masculinos, ${propios.cualquiera} sin género declarado. ` +
      `Pueden repetir timbre ${queComparten.length}, los de dos líneas o menos que no salen ` +
      'juntos con nadie que también repita. Sin esa regla no habría reparto posible: con el ' +
      `género bien puesto hay ${propios.masculina + comparten.masculina} personajes masculinos y ` +
      `solo ${vocesDe('masculina')} voces masculinas.`,
  );
}

// ===========================================================================
// CÓDIGO · Los tiempos cuadran de arriba abajo
// ===========================================================================
//
// POR QUÉ EXISTE. Cada paso de una generación tenía su límite —45 s para Vertex,
// 45 s para el bucket— y ninguno sabía del techo de la plataforma, que eran 60 s.
// Sumados se pasaban, y cuando eso ocurre no hay error ni excepción ni una línea
// en los registros: la plataforma corta la función y devuelve un 504 en bruto.
// En pantalla se lee «se ha roto algo» y en el servidor no aparece NADA. Se
// comprobó en los registros de producción: siete 504 seguidos y cero errores.
// TODAS las generaciones fallaban, y el sitio donde mirar no existía.
//
// Aquí se atan los tres números que tienen que cuadrar y que viven en archivos
// distintos —uno de ellos ni siquiera es código—, que es exactamente por lo que
// se separaron sin que nadie se diera cuenta.

bloque('Código · los tiempos cuadran de arriba abajo');

{
  const numeroDe = (rel, patron) => {
    const fuente = fuenteDe(rel);
    if (fuente === null) return null;
    const hallado = patron.exec(fuente);
    if (!hallado) return null;
    return Number(String(hallado[1]).replace(/[_\s]/g, ''));
  };

  const enVercel = (() => {
    const crudo = fuenteDe('vercel.json');
    if (crudo === null) return null;
    try {
      const json = JSON.parse(crudo);
      const g = json.functions && json.functions['api/g.js'];
      return g && Number.isFinite(Number(g.maxDuration)) ? Number(g.maxDuration) * 1000 : null;
    } catch {
      return null;
    }
  })();

  const enPuerta = numeroDe('api/g.js', /const PRESUPUESTO_MS = ([\d_]+);/);
  const enNavegador = numeroDe('app/api.js', /const LIMITE_MS = ([\d_]+);/);
  const techoDeVertex = numeroDe('api/_lib/vertex.js', /const LIMITE_MAXIMO_MS = ([\d_]+);/);

  // EL VALOR POR DEFECTO DE VERTEX, que es el que reciben las llamadas que se
  // olvidan de pedir el suyo. Estuvo en 45 s y era una trampa con forma de valor
  // razonable: quien escribía una llamada nueva y no se acordaba no recibía
  // ningún aviso, recibía cuarenta y cinco segundos. Pasó dos veces.
  const porDefectoDeVertex = numeroDe('api/_lib/vertex.js', /const LIMITE_MS = ([\d_]+);/);

  const quejas = [];

  if (enVercel === null || enPuerta === null || enNavegador === null
      || techoDeVertex === null || porDefectoDeVertex === null) {
    quejas.push(
      'No se han podido leer todos los tiempos: maxDuration en vercel.json, PRESUPUESTO_MS en ' +
        'api/g.js, LIMITE_MS en app/api.js, LIMITE_MS y LIMITE_MAXIMO_MS en api/_lib/vertex.js, ' +
        'y LIMITE_MAXIMO_MS en api/_lib/vertex.js. Si se les ha ' +
        'cambiado el nombre, hay que cambiarlo también aquí: sin esta comprobación se vuelven a ' +
        'separar sin que nadie lo vea.',
    );
  } else {
    // El plazo que la función se cree suyo NUNCA puede pasar del que pide
    // vercel.json. Si pasara, volvería a morir cortada sin dejar rastro, que es
    // el fallo que este plazo existe para impedir. Por debajo sí puede ir, y de
    // hecho va: `maxDuration` se PIDE, pero quien concede es la plataforma según
    // el plan, y ese número no se puede apostar.
    if (enPuerta > enVercel) {
      quejas.push(
        `api/g.js se cree con ${enPuerta / 1000} s de plazo y vercel.json solo pide ` +
          `${enVercel / 1000}. Creerse con más tiempo del que se ha pedido es volver al error ` +
          'mudo: la plataforma corta la función y no queda ni rastro de por qué.',
      );
    }

    // Y tampoco puede pasar del techo MEDIDO de la plataforma, porque
    // `maxDuration` puede concederse recortado y aquí no hay forma de enterarse:
    // lo único que se ve es que la función deja de contestar.
    //
    // Este número estuvo en 60 s —el suelo que da cualquier plan— mientras no
    // hubo forma de saber el de verdad. Ahora la hay: el modo `aguante` espera
    // los segundos que se le pidan y contesta cuántos esperó, sin llamar a
    // ningún modelo, y en Salud hay un botón que lo prueba. En la cuenta de este
    // proyecto sobrevivió a 240 s. Si alguien despliega esto donde den menos, ese
    // mismo botón se lo dirá, y este número baja.
    //
    // El margen no es adorno: la función tiene que rendirse ELLA, con su
    // explicación en español, antes de que la plataforma la corte en seco.
    const TECHO_MEDIDO = 240_000;
    const MARGEN_DEL_TECHO = 20_000;
    const TOPE = TECHO_MEDIDO - MARGEN_DEL_TECHO;
    if (enPuerta > TOPE) {
      quejas.push(
        `api/g.js se cree con ${enPuerta / 1000} s, y el techo medido de la plataforma es ` +
          `${TECHO_MEDIDO / 1000} s, así que como mucho puede creerse con ${TOPE / 1000}. ` +
          'La función tiene que rendirse ella, explicándose, antes de que la plataforma la corte ' +
          'en seco: un corte en seco es una generación pagada y perdida sin ni un mensaje. ' +
          'Para subirlo hay que medir otra vez con el botón de Salud, «Cuánto tiempo me da mi ' +
          'plan», y cambiar aquí el techo por lo que salga.',
      );
    }
    // EL TECHO ESCONDIDO DE VERTEX. Este invariante nació mirando tres números y
    // le faltaba el cuarto, que es el que de verdad manda: `vertex.js` recorta
    // TODAS las llamadas a `LIMITE_MAXIMO_MS`, así que da igual lo que pida
    // quien llama. Cuando el plazo subió de 55 a 200 s y la imagen de 45 a 170,
    // ese techo se quedó en 55 y las imágenes siguieron muriendo a los 55
    // segundos exactos — con el resto del código convencido de tener 200.
    //
    // Un tope escondido en otro archivo es peor que no tener tope: el mensaje de
    // error dice un número que no está escrito en ninguna parte que se mire.
    if (techoDeVertex > enPuerta) {
      quejas.push(
        `vertex.js recorta las llamadas a ${techoDeVertex / 1000} s y la función solo se cree con ` +
          `${enPuerta / 1000}. Un techo por encima del plazo no sirve de nada: quien corta antes ` +
          'es el plazo. Sobra, y hace pensar que se puede esperar más de lo que se puede.',
      );
    }
    // NINGÚN MÓDULO QUE GENERA SE ESCRIBE SU PROPIO LÍMITE.
    //
    // Los tres lo tuvieron —imagen, audio y texto— y los tres se quedaron atrás
    // cuando cambió el plazo: la imagen murió a los 55 s y la ficha a los 45,
    // con el resto del código convencido de tener 200. Un número escrito a mano
    // aquí solo puede hacer una cosa: cortar antes de tiempo una generación que
    // ya se está pagando. Fallar rápido SÍ tiene sentido en lo que no genera
    // —comprobar un modelo en Salud, lanzar un montaje—, y esos siguen pidiendo
    // el suyo.
    for (const rel of ['api/_lib/imagen.js', 'api/_lib/audio.js']) {
      const fuente = fuenteDe(rel);
      if (fuente === null) continue;
      if (/limiteMs\s*:/.test(fuente)) {
        quejas.push(
          `${rel} se escribe su propio límite de espera. Los que generan no lo ` +
            'hacen: se quedan atrás cuando cambia el plazo de la función, y lo único que pueden ' +
            'conseguir es cortar antes de tiempo algo que ya se está pagando. Lo pone vertex.js, ' +
            'y es todo el tiempo que hay.',
        );
      }
    }

    // El valor por defecto tiene que ser el techo, no un número «razonable».
    // Cuando era 45 s, olvidarse de poner el límite salía barato de escribir y
    // caro de descubrir: la ficha moría a los 45 con un mensaje que hablaba de
    // la plataforma en vez de este número.
    if (porDefectoDeVertex < techoDeVertex) {
      quejas.push(
        `vertex.js da ${porDefectoDeVertex / 1000} s a quien no pide límite, y su techo es ` +
          `${techoDeVertex / 1000}. Esa diferencia es una trampa con forma de valor razonable: ` +
          'quien escriba una llamada nueva y no se acuerde de su límite no recibe ningún aviso, ' +
          'recibe el número corto. El que se olvida tiene que recibir TODO el tiempo que hay; ' +
          'quien quiera fallar antes, que lo pida.',
      );
    }

    if (enNavegador <= enVercel) {
      quejas.push(
        `El navegador corta a los ${enNavegador / 1000} s y la función tiene ${enVercel / 1000}. ` +
          'Cortar antes que la función no ahorra dinero: la generación sigue viva en Google, se ' +
          'cobra igual, el archivo queda en el bucket y aquí se cuenta como fallo. El navegador ' +
          'tiene que esperar MÁS que la función, para que quien dé la explicación sea ella.',
      );
    }
  }

  comprobar('El plazo de la función, el de la plataforma y el del navegador cuadran', quejas);

  if (!quejas.length) {
    avisar(
      `vercel.json pide ${enVercel / 1000} s, pero la función solo cuenta con ` +
        `${enPuerta / 1000}, que es lo que da el plan gratuito menos un margen: pedir no es ` +
        'obtener, y este número no puede ser una apuesta. Si la plataforma concede más, no se ' +
        `usa y no pasa nada. El navegador espera ${enNavegador / 1000} s, más que cualquiera de ` +
        'los dos, para que quien explique lo ocurrido sea siempre la función y no un 504 mudo.',
    );
  }
}

// ===========================================================================
// CÓDIGO · Nada llama a algo que no existe
// ===========================================================================
//
// POR QUÉ EXISTE. `soloTexto()` se usaba en SIETE sitios de api/_lib/modos.js y
// no estaba escrita en ninguno: existía solo en los archivos del navegador, y de
// ahí no se importa nada. Cada llamada lanzaba «soloTexto is not defined». Como
// leer el estado del bucket pasa por ahí, se caían las ocho pantallas a la vez,
// y el mensaje que salía era el genérico —«se ha roto algo que no estaba
// previsto»—, que no dice dónde.
//
// Nada lo cazaba. `node --check` mira la sintaxis y esto es sintaxis válida;
// los invariantes miraban los datos y el estilo; y desplegado no se ve hasta que
// alguien abre la pantalla. Aquí se mira lo único que importa: que todo lo que
// se LLAMA esté escrito o importado EN ESE MISMO ARCHIVO.
//
// No es un analizador de JavaScript y no pretende serlo. Se equivoca hacia el
// lado seguro: si un nombre aparece definido de cualquier forma reconocible en
// el archivo, se calla. Prefiere no cazar una de más que cantar una falsa.

bloque('Código · nada llama a algo que no existe');

{
  /** Lo que trae el propio JavaScript y no hace falta escribir. */
  const DEL_LENGUAJE = new Set([
    'Array', 'Boolean', 'Number', 'String', 'Object', 'Symbol', 'BigInt', 'Function',
    'JSON', 'Math', 'Date', 'RegExp', 'Promise', 'Proxy', 'Reflect', 'Intl',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
    'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError',
    'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array',
    'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'ArrayBuffer', 'DataView',
    'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal',
    'Buffer', 'Blob', 'File', 'FormData', 'Headers', 'Request', 'Response', 'Event', 'EventTarget',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
    'encodeURI', 'decodeURI', 'btoa', 'atob', 'fetch', 'structuredClone', 'queueMicrotask',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
    'cancelAnimationFrame', 'require', 'import', 'console', 'process', 'globalThis',
    // El navegador. Solo lo de app/; en api/ no se usa ninguno y no estorba.
    'document', 'window', 'navigator', 'location', 'history', 'alert', 'confirm', 'prompt',
    'Audio', 'Image', 'Node', 'Element', 'HTMLElement', 'CustomEvent', 'MutationObserver',
    'IntersectionObserver', 'ResizeObserver', 'localStorage', 'sessionStorage', 'getComputedStyle',
    'crypto', 'performance', 'matchMedia', 'FileReader', 'AbortError', 'createImageBitmap',
    'OffscreenCanvas', 'ImageData', 'DOMParser', 'MediaRecorder', 'AudioContext',
  ]);

  /** Palabras del idioma que van seguidas de un paréntesis y no son llamadas. */
  const NO_SON_LLAMADAS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'instanceof', 'void', 'delete',
    'function', 'async', 'await', 'new', 'do', 'else', 'of', 'in', 'yield', 'super', 'this',
    'case', 'with', 'throw', 'constructor', 'get', 'set', 'static', 'export', 'default',
  ]);

  /**
   * ¿Este archivo escribe o importa este nombre, de la forma que sea?
   *
   * Se pregunta sobre el archivo entero y con reglas anchas a propósito: una
   * declaración, una desestructuración, un import, un parámetro, una propiedad
   * de objeto o una asignación. Basta cualquiera para callarse.
   */
  const loTiene = (codigo, nombre) => {
    const n = nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (
      new RegExp(`\\b(?:function|class)\\s*\\*?\\s+${n}\\b`).test(codigo) ||
      new RegExp(`\\b(?:const|let|var)\\s+${n}\\b`).test(codigo) ||
      // Desestructuración e imports: { a, nombre } / { nombre: otro } / [a, nombre]
      new RegExp(`[{,[]\\s*${n}\\s*[,}\\]=:]`).test(codigo) ||
      new RegExp(`\\bas\\s+${n}\\b`).test(codigo) ||
      // Parámetros: (a, nombre) / (nombre) => / nombre =>
      new RegExp(`[(,]\\s*\\.{0,3}${n}\\s*[,)=]`).test(codigo) ||
      new RegExp(`\\b${n}\\s*=>`).test(codigo) ||
      // Propiedad, método o asignación: nombre: … / nombre = … / nombre(…) {
      new RegExp(`\\b${n}\\s*[:=][^=]`).test(codigo) ||
      new RegExp(`^\\s*(?:async\\s+)?\\*?\\s*${n}\\s*\\([^)]*\\)\\s*\\{`, 'm').test(codigo)
    );
  };

  const quejas = [];
  const mirados = [];

  for (const rel of archivos) {
    if (!esJavaScript(rel)) continue;
    if (!rel.startsWith('api/') && !rel.startsWith('app/') && !rel.startsWith('montador/')) continue;

    const fuente = fuenteDe(rel);
    if (fuente === null) continue;

    // Sin comentarios, sin cadenas y sin lo de dentro de las expresiones
    // regulares. Las tres cosas se parecen a una llamada y no lo son: un nombre
    // escrito en un mensaje en español no llama a nada, y «/audio\/l(\d+)/» no
    // llama a ninguna función «l()».
    const codigo = soloCodigo(fuente, { tambienCadenas: true, tambienRegex: true });
    mirados.push(rel);

    const yaDicho = new Set();
    codigo.split('\n').forEach((linea, i) => {
      // Un nombre seguido de «(» que no venga detrás de un punto —eso sería un
      // método de otro objeto, y de esos no se responde aquí— ni de «function».
      const patron = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
      let hallazgo;
      while ((hallazgo = patron.exec(linea))) {
        const nombre = hallazgo[2];
        if (NO_SON_LLAMADAS.has(nombre) || DEL_LENGUAJE.has(nombre)) continue;
        if (yaDicho.has(nombre)) continue;
        if (loTiene(codigo, nombre)) continue;
        yaDicho.add(nombre);
        quejas.push(
          `${rel}:${i + 1} llama a «${nombre}()» y en ese archivo no está escrita ni importada. ` +
            'Es sintaxis válida, así que ni «node --check» ni el despliegue dicen nada: revienta ' +
            'la primera vez que se ejecuta esa línea, con un «is not defined» que no dice dónde.',
        );
      }
    });
  }

  comprobar('Todo lo que se llama está escrito o importado', quejas);
  avisar(
    `Se han mirado ${mirados.length} archivos de api/, app/ y montador/. Lo que se comprueba es ` +
      'que cada nombre que se LLAMA esté escrito o importado en su propio archivo. No es un ' +
      'analizador de JavaScript: se equivoca hacia el lado seguro, así que caza lo que falta del ' +
      'todo y se calla ante cualquier definición reconocible.',
  );
}

// ===========================================================================
// CÓDIGO · Todas las grafías se prueban
// ===========================================================================
//
// POR QUÉ EXISTE ESTA COMPROBACIÓN. Vertex publica el mismo modelo con dos
// nombres —el de preview y el definitivo— y cuál contesta depende del proyecto.
// `datos/serie.json` los declara los dos en `ids` y `conGrafias()` los prueba en
// orden. Pero durante un despliegue entero eso no sirvió de nada: `entorno()`
// armaba cada modelo como `{ id, region, variable }` y tiraba `ids` por el
// camino, así que `conGrafias()` recibía la lista vacía, se caía al único id y
// probaba un solo nombre. Y encima Salud, voz, texto y Veo ni siquiera pasaban
// por `conGrafias()`. El 404 que se veía en pantalla nombraba una sola grafía;
// eso fue lo que lo delató, y es lo que se comprueba aquí para que no vuelva.

bloque('Código · todas las grafías se prueban');

{
  // 1. NINGÚN MÓDULO LLAMA A UN MODELO POR UN SOLO NOMBRE. Quien compone una URL
  // de modelo tiene que saber de grafías. `vertex.js` queda fuera porque es
  // quien las implementa.
  const quejas = [];
  for (const rel of archivos) {
    if (!rel.startsWith('api/') || !esJavaScript(rel)) continue;
    if (rel.endsWith('_lib/vertex.js')) continue;
    const fuente = fuenteDe(rel);
    if (fuente === null) continue;
    const codigo = soloCodigo(fuente);
    if (!codigo.includes('urlModelo(')) continue;
    if (codigo.includes('conGrafias(')) continue;
    quejas.push(
      `${rel} compone la URL de un modelo con urlModelo() y no pasa nunca por ` +
        'conGrafias(), así que prueba un solo nombre. Si Google publica ese modelo ' +
        'con el otro, el 404 que vuelve dice «tu cuenta no tiene este modelo» y es ' +
        'mentira: lo tiene con el nombre que no se ha probado.'
    );
  }
  comprobar('Ningún modelo se llama por un solo nombre', quejas);

  // 2. LA TABLA DE `entorno()` ENTREGA LAS GRAFÍAS. Esto no se mira leyendo el
  // código: se arma la tabla de verdad y se comprueba lo que trae. Es el fallo
  // que hubo, y leer el archivo no lo habría enseñado.
  process.env.GCP_SERVICE_ACCOUNT ||= JSON.stringify({
    project_id: 'proyecto-de-mentira',
    // Ni el correo ni la clave se parecen a los de verdad, y es a propósito: la
    // comprobación de más arriba —«sin correos de service account en el código»—
    // no distingue un ejemplo de un descuido, y hace bien en no distinguirlo.
    client_email: 'nadie@ejemplo.invalid',
    // La cabecera va porque `entorno()` la exige; detrás no hay material ninguno.
    private_key: '-----BEGIN PRIVATE KEY-----\nno-es-una-clave\n-----END PRIVATE KEY-----\n',
  });
  process.env.GCS_BUCKET ||= 'bucket-de-mentira';

  const { entorno } = await import('../api/_lib/entorno.js');
  const tabla = entorno().modelos;

  /** Cada casilla de la tabla, con el camino por el que se llega a ella. */
  const casillas = [];
  for (const [familia, valor] of Object.entries(tabla)) {
    if (valor && typeof valor.variable === 'string') casillas.push([familia, valor]);
    else if (valor) {
      for (const [nivel, hoja] of Object.entries(valor)) casillas.push([`${familia}.${nivel}`, hoja]);
    }
  }

  const sinGrafias = [];
  const sinRegion = [];
  for (const [camino, modelo] of casillas) {
    // Speech-to-Text va sin id a propósito: la v1 elige el suyo.
    if (!modelo.id) continue;

    if (!Array.isArray(modelo.ids) || !modelo.ids.includes(modelo.id)) {
      sinGrafias.push(
        `entorno().modelos.${camino} entrega «${modelo.id}» sin su lista de grafías. ` +
          'conGrafias() se caería a ese único nombre y probaría uno solo.'
      );
      continue;
    }

    // Y cada grafía con SU región: una lista puede mezclar generaciones, y un
    // Gemini 3.x solo se sirve desde «global» mientras que un 2.5 no.
    for (const grafia of modelo.ids) {
      if (!modelo.regiones || !modelo.regiones[grafia]) {
        sinRegion.push(`entorno().modelos.${camino} no dice a qué región pedir «${grafia}»`);
      }
    }
  }

  comprobar('Cada modelo llega con todas sus grafías', sinGrafias);
  comprobar('Cada grafía llega con su región', sinRegion);

  const cuantas = casillas
    .filter(([, m]) => m.id)
    .reduce((suma, [, m]) => suma + (m.ids ? m.ids.length : 1), 0);
  avisar(
    `Hoy se probarían ${cuantas} grafías repartidas en ${casillas.filter(([, m]) => m.id).length} ` +
      'modelos. Un nombre que no contesta cuesta un 404 y no genera nada, así que probarlos ' +
      'todos es gratis; el que sí contesta se recuerda y se prueba primero la próxima vez.'
  );
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
// DATOS · Los pósters y las miniaturas
// ===========================================================================

bloque('Datos · los pósters y las miniaturas');

{
  const posters = (serie.difusion && serie.difusion.posters) || {};
  const piezas = Array.isArray(posters.piezas) ? posters.piezas : [];
  const placas = new Set(((serie.banco && serie.banco.placas) || []).map((una) => una && una.id));

  // 1. Cada póster se genera contra placas que EXISTEN. Una referencia con un
  //    nombre mal escrito no se nota hasta que se pulsa generar y la función
  //    contesta, y para entonces ya se ha ido a buscar el botón tres veces.
  {
    const quejas = [];
    for (const uno of piezas) {
      if (!uno || !uno.id) continue;
      const refs = Array.isArray(uno.refs) ? uno.refs : [];
      if (!refs.length) {
        quejas.push(
          `El póster «${uno.id}» no tiene ni una placa de referencia. Sin una cara ` +
            'aprobada delante, el modelo se inventa el personaje y no se parece a la serie.'
        );
        continue;
      }
      for (const ref of refs) {
        if (!placas.has(ref)) {
          quejas.push(
            `El póster «${uno.id}» dice usar la placa «${ref}», que no está en ` +
              'banco.placas de datos/serie.json.'
          );
        }
      }
    }
    comprobar('Cada póster se genera contra placas del banco que existen', quejas);
  }

  // 1.b El SITIO también es una referencia, y es el que faltaba. Un póster que
  //     dibuja «una cripta» y no LA cripta no es de esta serie. La placa de un
  //     escenario trae dentro sus objetos —la de la cripta lleva escrito el
  //     ídolo colosal de muchos brazos con cabeza de calavera de cabra—, así que
  //     adjuntarla es la única manera de que salgan ESOS y no unos parecidos.
  {
    const quejas = [];
    const sitios = new Set(
      ((serie.escenarios && serie.escenarios.placas) || []).map((una) => una && una.id)
    );
    for (const uno of piezas) {
      if (!uno || !uno.id) continue;
      for (const ref of Array.isArray(uno.escenarios) ? uno.escenarios : []) {
        if (!sitios.has(ref)) {
          quejas.push(
            `El póster «${uno.id}» dice ocurrir en «${ref}», que no está en escenarios.placas ` +
              'de datos/serie.json. Eso no falla al guardarlo: falla al pulsar generar.'
          );
        }
      }
    }
    comprobar('Los sitios que referencia cada póster existen', quejas);
  }

  // 1.c Cuánto cuesta encender cada botón. NO es un fallo: es el precio, y se
  //     enseña para que sea una decisión y no una sorpresa.
  //
  //     Cada referencia obliga a tener esa placa APROBADA antes de generar, y
  //     una placa de personaje que no es ancla necesita además su ancla: son dos
  //     aprobaciones en vez de una. A veces vale la pena —la máscara del
  //     celebrante ES su identidad visual, y su ancla es el mismo hombre sin
  //     ella—, y a veces no. Por eso esto avisa y no tumba nada.
  {
    const porId = new Map(((serie.banco && serie.banco.placas) || []).map((una) => [una.id, una]));
    const caros = [];
    for (const uno of piezas) {
      if (!uno || !uno.id) continue;
      const sinAncla = (Array.isArray(uno.refs) ? uno.refs : []).filter((ref) => {
        const laPlaca = porId.get(ref);
        return laPlaca && laPlaca.ancla !== true;
      });
      if (sinAncla.length) caros.push(`${uno.id} (${sinAncla.join(', ')})`);
    }
    comprobar('Se sabe lo que cuesta encender cada póster', []);
    if (caros.length) {
      avisar(
        `${caros.length} póster${caros.length === 1 ? '' : 's'} referencia${caros.length === 1 ? '' : 'n'} ` +
          'placas que no son anclas, y cada una obliga a aprobar también el ancla de su ' +
          `personaje: ${listaCorta(caros, 4)}. Está bien si ese diseño es lo que se ve —una ` +
          'máscara no se hereda de una cara—, pero es una aprobación más antes de generar.'
      );
    }
  }

  // 1.c Trece composiciones, no una plantilla repetida trece veces. Este es el
  //     fallo que había: las doce miniaturas tenían el MISMO encargo genérico
  //     («un sujeto claro descentrado, espacio oscuro al otro lado») y salían
  //     doce imágenes intercambiables. No da error: da doce miniaturas que no
  //     dicen de qué va su episodio.
  {
    const quejas = [];
    const vistos = new Map();
    for (const uno of piezas) {
      if (!uno || typeof uno.encargo !== 'string') continue;
      const arranque = uno.encargo.trim().slice(0, 60);
      if (vistos.has(arranque)) {
        quejas.push(
          `«${uno.id}» y «${vistos.get(arranque)}» empiezan con el mismo texto. Si dos ` +
            'miniaturas se pueden intercambiar, ninguna de las dos cuenta su episodio.'
        );
      } else {
        vistos.set(arranque, uno.id);
      }
      const palabras = uno.encargo.trim().split(/\s+/).length;
      if (palabras < 80) {
        quejas.push(
          `El encargo de «${uno.id}» tiene ${palabras} palabras. Un encargo corto no compone: ` +
            'sale un retrato de catálogo con el título flotando encima.'
        );
      }
    }
    comprobar('Los pósters son trece composiciones distintas, no una plantilla', quejas);
  }

  // 2. Los formatos escritos tienen que ser de los que el modelo de imagen
  //    acepta. Uno inventado no falla al escribirlo: falla al generar, ya
  //    encolado, y entonces hay que venir aquí a mirar por qué.
  {
    const quejas = [];
    const fuente = fuenteDe('api/_lib/imagen.js');
    const lista = fuente ? fuente.match(/const PROPORCIONES\s*=\s*\[([^\]]*)\]/) : null;
    const aceptadas = lista
      ? lista[1].split(',').map((uno) => uno.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
      : [];

    if (!aceptadas.length) {
      quejas.push(
        'api/_lib/imagen.js ya no declara PROPORCIONES, así que no se puede comprobar que ' +
          'los formatos de los pósters sean de los que el modelo acepta.'
      );
    } else {
      for (const forma of Array.isArray(posters.formatos) ? posters.formatos : []) {
        if (!aceptadas.includes(forma)) {
          quejas.push(
            `«${forma}» está escrito en difusion.posters.formatos y no es una de las ` +
              `proporciones que acepta el modelo de imagen (${aceptadas.join(', ')}).`
          );
        }
      }
      const porDefecto = posters.formato_por_defecto;
      if (porDefecto && !(posters.formatos || []).includes(porDefecto)) {
        quejas.push(
          `El formato por defecto de los pósters es «${porDefecto}» y no está en la lista ` +
            'de formatos. Al abrir la pantalla no habría ninguno elegido.'
        );
      }
    }
    comprobar('Los formatos de los pósters son proporciones que el modelo acepta', quejas);
  }

  // 3. Si el título va DENTRO de la imagen, tiene que estar escrito. Un título
  //    vacío no da un error: da una imagen sin título, pagada, que hay que
  //    mirar dos veces para darse cuenta.
  {
    const quejas = [];
    const notas = [];
    if (posters.titulo_en_la_imagen === true) {
      const titulo = typeof posters.titulo === 'string' ? posters.titulo.trim() : '';
      if (!titulo) {
        quejas.push(
          'difusion.posters.titulo_en_la_imagen está en true pero difusion.posters.titulo ' +
            'está vacío: se pediría una imagen con un título en blanco.'
        );
      } else if (titulo !== String((serie.meta && serie.meta.titulo_es) || '').trim()) {
        quejas.push(
          `El título que se pide dentro del póster («${titulo}») no es el título de la ` +
            `serie («${serie.meta && serie.meta.titulo_es}»). Uno de los dos está mal escrito.`
        );
      }
      const fuente = fuenteDe(RUTA_PROMPT);
      if (fuente && !/promptPoster/.test(fuente)) {
        quejas.push(`${RUTA_PROMPT} ya no exporta promptPoster, o ha cambiado de nombre.`);
      }
      notas.push(
        'El título va dentro de la imagen porque así se pidió, a sabiendas de que los ' +
          'modelos escriben mal las tildes. Cada intento cuesta una generación y el botón ' +
          'de rehacer está a mano: es la excepción aceptada, no un descuido.'
      );
    }
    comprobar('El título que va dentro del póster es el título de la serie', quejas, notas);
  }

  // 4. Una miniatura por GUION, ni una más ni una menos. Los episodios se
  //    cuentan donde de verdad están —datos/guiones.json—, no en un número
  //    escrito aparte que nadie actualizaría. Si se escribe un guion trece y
  //    nadie añade su miniatura, ese capítulo se subiría sin portada.
  {
    const quejas = [];
    const losGuiones = Array.isArray(guiones.guiones) ? guiones.guiones : [];
    const miniaturas = piezas.filter((uno) => uno && /^miniatura-/.test(uno.id));

    if (miniaturas.length !== losGuiones.length) {
      quejas.push(
        `Hay ${losGuiones.length} guiones escritos y ${miniaturas.length} miniaturas. Al ` +
          'episodio que se quede sin la suya se le sube sin portada.'
      );
    }
    for (const unGuion of losGuiones) {
      const numero = String((unGuion && unGuion.episodio) || '').padStart(2, '0');
      if (numero && !miniaturas.some((una) => una.id === `miniatura-ep${numero}`)) {
        quejas.push(`El episodio ${numero} no tiene miniatura escrita (miniatura-ep${numero}).`);
      }
    }
    comprobar('Hay una miniatura por cada guion escrito', quejas);
  }
}

// ===========================================================================
// DATOS Y CÓDIGO · Los reels
// ===========================================================================

bloque('Datos y código · los reels');

{
  const reels = (serie.difusion && serie.difusion.reels) || {};

  // 1. Los números del corte. Un mínimo por encima del máximo no da un error:
  //    da un reel vacío, porque ningún plano cabe entre los dos.
  {
    const quejas = [];
    const duracion = Number(reels.duracion_s);
    const minimo = Number(reels.minimo_plano_s);
    const maximo = Number(reels.maximo_plano_s);

    if (!(duracion > 0)) {
      quejas.push('difusion.reels.duracion_s no es un número de segundos mayor que cero.');
    }
    if (!(minimo > 0) || !(maximo > minimo)) {
      quejas.push(
        `El mínimo de plano (${reels.minimo_plano_s}) y el máximo (${reels.maximo_plano_s}) no ` +
          'tienen sentido juntos. Con el mínimo por encima del máximo no cabe ningún plano y el ' +
          'reel saldría vacío, sin dar ningún error.'
      );
    }
    if (duracion > 0 && maximo > 0 && maximo > duracion) {
      quejas.push(
        `Un plano puede durar hasta ${maximo} s y el reel entero dura ${duracion} s: el primer ` +
          'plano se comería el reel.'
      );
    }
    comprobar('Los números del corte del reel tienen sentido', quejas);
  }

  // 2. El formato. Un lado impar lo rechaza el códec, y un formato apaisado
  //    haría un «reel» que ninguna plataforma de móvil pone a pantalla completa.
  {
    const quejas = [];
    const formato = (reels.formato && typeof reels.formato === 'object') ? reels.formato : {};
    const ancho = Number(formato.ancho);
    const alto = Number(formato.alto);
    const fps = Number(formato.fps);

    if (!Number.isInteger(ancho) || !Number.isInteger(alto) || !(fps > 0)) {
      quejas.push('difusion.reels.formato no dice ancho, alto y fps como números enteros.');
    } else {
      if (alto <= ancho) {
        quejas.push(
          `El formato del reel es ${ancho} × ${alto}, que no es vertical. Un reel apaisado no lo ` +
            'pone a pantalla completa ninguna plataforma de móvil.'
        );
      }
      if (ancho % 2 !== 0 || alto % 2 !== 0) {
        quejas.push(
          `El formato del reel es ${ancho} × ${alto} y los códecs de vídeo no aceptan un lado ` +
            'impar: ffmpeg fallaría en el montador, después de los minutos de espera.'
        );
      }
    }
    comprobar('El formato del reel es vertical y lo acepta un códec', quejas);
  }

  // 3. LA CAPA. Este es el que de verdad importa. El reel se le encarga al
  //    montador con una capa, y el montador que ESTÁ DESPLEGADO la comprueba
  //    contra su propia lista. Una capa que él no conozca no da un error aquí:
  //    da un trabajo que falla en la nube diez minutos después, y obliga a
  //    volver a desplegar el montador desde un móvil.
  {
    const quejas = [];
    const fuente = fuenteDe('app/reel.js');
    const dicha = fuente ? fuente.match(/CAPA_DEL_REEL\s*=\s*'([^']+)'/) : null;
    const capa = dicha ? dicha[1] : null;

    if (!capa) {
      quejas.push('app/reel.js ya no declara CAPA_DEL_REEL, o ha cambiado de forma.');
    } else {
      for (const rel of ['api/_lib/montaje.js', 'montador/montador.mjs']) {
        const texto = fuenteDe(rel);
        const lista = texto ? texto.match(/const CAPAS\s*=\s*\[([^\]]*)\]/) : null;
        if (!lista) {
          quejas.push(`${rel} ya no declara CAPAS, así que no se puede comprobar la capa del reel.`);
          continue;
        }
        const capas = lista[1]
          .split(',')
          .map((una) => una.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
        if (!capas.includes(capa)) {
          quejas.push(
            `El reel se encarga con la capa «${capa}» y ${rel} solo conoce ${capas.join(', ')}. ` +
              'Eso no falla aquí: falla en la nube, minutos después de encargarlo.'
          );
        }
      }
    }
    comprobar('La capa con la que se encarga el reel la entiende el montador', quejas);
  }

  // 4. Un reel no lleva voz ni subtítulos, y eso está escrito en el código, no
  //    solo en un comentario: si algún día se le pusieran, treinta segundos de
  //    diálogo contarían el capítulo entero.
  {
    const quejas = [];
    const fuente = fuenteDe('app/reel.js');
    if (fuente && !/subtitulos:\s*\[\]/.test(fuente)) {
      quejas.push(
        'app/reel.js ya no pide el manifiesto con «subtitulos: []». Un reel con subtítulos de ' +
          'treinta segundos cuenta el capítulo entero antes de que nadie lo vea.'
      );
    }
    if (fuente && !/agacha:\s*false/.test(fuente)) {
      quejas.push(
        'La música del reel ya no va con «agacha: false». Agacharse es dejarle sitio a una voz, ' +
          'y en el reel no hay ninguna: la música bajaría de volumen sola y sin motivo.'
      );
    }
    comprobar('El reel no lleva voz ni subtítulos, y está escrito en el código', quejas);
  }
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
