import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serie, pieza, toma, bloquesDeVoz } from '../api/_lib/datos.js';
import { promptKeyframe, promptVideo, guionDeVoz } from '../api/_lib/prompt.js';
import { asegurar } from '../api/_lib/estado.js';

const base = serie.piezas.teaser;
assert.ok(base, 'La prueba necesita la pieza teaser preexistente');
const tomaBase = base.tomas.find((una) => una && una.imagen && una.video);
assert.ok(tomaBase, 'La prueba necesita una toma del teaser con imagen y vídeo');

const dinamica = {
  id: 'ep99',
  titulo: 'Episodio de prueba',
  duracion_s: Number(tomaBase.dur) || 4,
  tomas: [{ ...tomaBase, id: '1-1', escena: '1', inicio: 0 }],
  audio: {
    voz: [{
      quien: 'madre',
      es: 'No mires atrás.',
      ja: '振り返らないで。',
      intencion: 'susurro urgente',
      escena: '1',
      t: 0,
      hasta: Math.max(1, Number(tomaBase.dur) || 4)
    }]
  }
};

assert.equal(pieza('ep99', dinamica), dinamica);
assert.equal(toma('ep99', '1-1', dinamica).id, '1-1');
assert.ok(promptKeyframe('ep99', '1-1', dinamica).texto.length > 20);
assert.ok(promptVideo('ep99', '1-1', dinamica).texto.length > 20);

const bloques = bloquesDeVoz('ep99', dinamica);
assert.equal(bloques.length, 1);
assert.equal(bloques[0].id, 'esc-1');
const guion = guionDeVoz('ep99', 'esc-1', dinamica);
assert.equal(guion.partes.length, 1);
assert.equal(guion.partes[0].texto_ja, '振り返らないで。');

const tomasUi = readFileSync(new URL('../app/pantallas/tomas.js', import.meta.url), 'utf8');
const audioUi = readFileSync(new URL('../app/pantallas/audio.js', import.meta.url), 'utf8');
const desgloseUi = readFileSync(new URL('../app/pantallas/desglose.js', import.meta.url), 'utf8');
assert.match(tomasUi, /const dinamicas = .*estado\.piezas/);
assert.match(tomasUi, /modelo = construirModelo\(datos, leerEstado\(\)\)/);
assert.match(audioUi, /const dinamicas = .*estado\.piezas/);
assert.match(desgloseUi, /audio: \{ voz: vozDelEpisodio\(episodio, tomas\) \}/);

for (let ep=1;ep<=12;ep++) {
  const id=`ep${String(ep).padStart(2,'0')}`;
  const estado=asegurar({pieza_activa:id,piezas:{[id]:{...dinamica,id}},
    tomas:{[`${id}/1-1`]:{keyframe_aprobado:'aprobada.png',intentos_keyframe:['aprobada.png','nueva.png']}}});
  // La lectura tras generar no cambia de capítulo ni sustituye su aprobación.
  assert.equal(asegurar(estado).pieza_activa,id);
  assert.equal(estado.tomas[`${id}/1-1`].keyframe_aprobado,'aprobada.png');
  assert.deepEqual(estado.tomas[`${id}/1-1`].intentos_keyframe,['aprobada.png','nueva.png']);
}
assert.equal(asegurar({pieza_activa:'inexistente'}).pieza_activa,Object.keys(serie.piezas)[0]);
console.log('✓ Los doce capítulos conservan la selección y sus imágenes al volver a leer el estado');

console.log('✓ Desglose → Tomas → Imagen → Vídeo → Audio/Voz acepta piezas de estado.json');
