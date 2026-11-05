/* =============================================================
   ATELIER — imágenes de las prendas
   Mientras la base de datos no tenga fotos, cada variante se dibuja
   como una ilustración de su tipo de prenda pintada con su color
   (codigo_hex). Si una variante trae `imagen` (URL), se usa esa foto.
   ============================================================= */
(function (A) {
  'use strict';

  // Siluetas en un lienzo de 120 × 120
  const FORMAS = {
    Camisetas: {
      cuerpo: 'M40 20 L51 14 Q60 24 69 14 L80 20 L103 36 L93 52 L84 46 L84 106 L36 106 L36 46 L27 52 L17 36 Z',
      detalles: 'M51 14 Q60 26 69 14 M36 52 L36 46 M84 46 L84 52',
    },
    Pantalones: {
      cuerpo: 'M36 12 H84 L91 108 H67 L60 48 L53 108 H29 Z',
      detalles: 'M36 22 H84 M60 22 V42 M42 22 Q44 32 52 30 M78 22 Q76 32 68 30',
    },
    Chaquetas: {
      cuerpo: 'M42 16 L53 12 L60 24 L67 12 L78 16 L99 30 L105 94 L93 96 L87 52 L86 108 L34 108 L33 52 L27 96 L15 94 L21 30 Z',
      detalles: 'M60 24 V108 M53 12 L60 42 L67 12 M40 74 H52 M68 74 H80',
    },
    Accesorios: {
      cuerpo: 'M30 44 H90 L96 106 H24 Z',
      detalles: 'M46 44 Q46 20 60 20 Q74 20 74 44',
    },
  };

  // Un color claro necesita contorno oscuro para verse sobre fondo blanco
  function esClaro(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return false;
    const n = parseInt(m[1], 16);
    const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 170;
  }

  function color(hex) {
    return /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#B9B9C3';
  }

  A.prenda = {
    // SVG de la prenda; `etiqueta` describe la imagen para lectores de pantalla
    svg(categoria, hex, etiqueta) {
      const f = FORMAS[categoria] || FORMAS.Camisetas;
      const fill = color(hex);
      const claro = esClaro(fill);
      const borde = claro ? '#5F5F68' : 'rgba(0,0,0,.35)';
      const linea = claro ? 'rgba(0,0,0,.28)' : 'rgba(255,255,255,.38)';
      return `<svg class="prenda-svg" viewBox="0 0 120 120" role="img" aria-label="${A.esc(etiqueta || categoria)}">
        <path d="${f.cuerpo}" fill="${fill}" stroke="${borde}" stroke-width="2" stroke-linejoin="round"/>
        <path d="${f.detalles}" fill="none" stroke="${linea}" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
    },

    // Molde: la prenda trazada como costura punteada, para dibujar sobre la tela
    molde(categoria, hex, etiqueta) {
      const f = FORMAS[categoria] || FORMAS.Camisetas;
      const hilo = esClaro(color(hex)) ? '#000000' : '#FFFFFF';
      return `<svg class="molde-svg" viewBox="0 0 120 120" role="img" aria-label="${A.esc(etiqueta || categoria)}">
        <path d="${f.cuerpo}" fill="none" stroke="${hilo}" stroke-width="2.4" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${f.detalles}" fill="none" stroke="${hilo}" stroke-opacity=".7" stroke-width="1.8" stroke-dasharray="3 4" stroke-linecap="round"/>
      </svg>`;
    },

    hilo(hex) { return esClaro(color(hex)) ? 'claro' : 'oscuro'; },

    // HTML de la imagen de una variante (foto si existe, ilustración si no)
    de(v, clase) {
      const alt = v.producto + ', ' + String(v.color || '').toLowerCase();
      if (v.imagen) {
        return `<img class="${clase || ''}" src="${A.esc(v.imagen)}" alt="${A.esc(alt)}" loading="lazy">`;
      }
      return `<span class="${clase || ''}">${A.prenda.svg(v.categoria, v.codigo_hex, alt)}</span>`;
    },
  };
})(window.Atelier);
