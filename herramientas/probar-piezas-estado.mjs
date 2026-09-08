import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serie, pieza, toma, bloquesDeVoz } from '../api/_lib/datos.js';
import { promptKeyframe, promptVideo, guionDeVoz } from '../api/_lib/prompt.js';

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

console.log('✓ Desglose → Tomas → Imagen → Vídeo → Audio/Voz acepta piezas de estado.json');
