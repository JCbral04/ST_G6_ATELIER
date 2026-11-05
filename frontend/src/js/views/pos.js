/* =============================================================
   Vista principal: Punto de venta en mostrador.
   Cada producto es una muestra de tela de su color, con la prenda trazada
   como molde; el empleado elige color y talla en la cinta métrica y la
   prenda pasa a la venta actual (ticket).
   La venta se registra con POST /api/pedidos; sin API se simula.
   ============================================================= */
(function (A) {
  'use strict';
  const esc = A.esc, fmt = A.fmt;

  const ORDEN_TALLAS = ['XS', 'S', 'M', 'L', 'XL'];
  let query = '';
  let categoria = '';
  const colorElegido = {};   // id_producto -> color seleccionado
  let recienAgregada = null; // id_variante que acaba de entrar a la venta (para animarla)
  const sinMovimiento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function venta() { return A.store.venta; }
  function variante(id) { return A.store.variantes.find(function (v) { return v.id_variante === id; }); }
  function enVenta(id) {
    const l = venta().find(function (x) { return x.id_variante === id; });
    return l ? l.cantidad : 0;
  }
  function total() {
    return venta().reduce(function (t, l) { return t + variante(l.id_variante).precio * l.cantidad; }, 0);
  }
  function unidades() {
    return venta().reduce(function (t, l) { return t + l.cantidad; }, 0);
  }

  // Agrupa las variantes por producto, aplicando búsqueda y categoría
  function productos() {
    const q = query.trim().toLowerCase();
    const grupos = {};
    A.store.variantes.forEach(function (v) {
      if (categoria && v.categoria !== categoria) return;
      if (q && (v.producto + ' ' + v.sku + ' ' + v.color).toLowerCase().indexOf(q) === -1) return;
      const g = grupos[v.id_producto] || (grupos[v.id_producto] = {
        id: v.id_producto, nombre: v.producto, categoria: v.categoria, precio: v.precio, vars: [],
      });
      g.vars.push(v);
    });
    return Object.keys(grupos).map(function (k) { return grupos[k]; });
  }

  function colores(g) {
    const vistos = [];
    g.vars.forEach(function (v) {
      if (!vistos.some(function (c) { return c.nombre === v.color; })) vistos.push({ nombre: v.color, hex: v.codigo_hex });
    });
    return vistos;
  }

  function tarjetaHtml(g) {
    const cs = colores(g);
    const elegido = cs.some(function (c) { return c.nombre === colorElegido[g.id]; }) ? colorElegido[g.id] : cs[0].nombre;
    const delColor = g.vars
      .filter(function (v) { return v.color === elegido; })
      .sort(function (a, b) { return ORDEN_TALLAS.indexOf(a.talla) - ORDEN_TALLAS.indexOf(b.talla); });
    const muestra = delColor[0];
    const tallasProducto = g.vars.map(function (v) { return v.talla; })
      .filter(function (t, i, arr) { return arr.indexOf(t) === i; })
      .sort(function (a, b) { return ORDEN_TALLAS.indexOf(a) - ORDEN_TALLAS.indexOf(b); });
    const hex = muestra.codigo_hex || '#B9B9C3';
    const tela = muestra.imagen
      ? A.prenda.de(muestra, 'tela-foto')
      : A.prenda.molde(g.categoria, hex, g.nombre + ', ' + String(elegido).toLowerCase());

    return `<article class="prenda-card">
      <span class="alfiler" aria-hidden="true"></span>
      <div class="tela-wrap">
        <div class="tela ${muestra.imagen ? 'con-foto' : 'tela-' + A.prenda.hilo(hex)}" style="--tela:${esc(hex)}">${tela}</div>
        <span class="precio-tag"><span>${fmt(g.precio)}</span></span>
      </div>
      <h3>${esc(g.nombre)}</h3>
      <div class="colores" role="group" aria-label="Color">
        ${cs.map(function (c) {
          const on = c.nombre === elegido;
          return `<button type="button" class="color-btn" data-prod="${esc(g.id)}" data-color="${esc(c.nombre)}"
            aria-pressed="${on}" title="${esc(c.nombre)}"><span class="swatch" style="background:${esc(c.hex || '#ccc')}"></span></button>`;
        }).join('')}
        <span class="color-nombre">${esc(elegido)}</span>
      </div>
      <div class="cinta" role="group" aria-label="Agregar talla">
        ${tallasProducto.map(function (talla) {
          const v = delColor.find(function (x) { return x.talla === talla; });
          if (!v) {
            return `<button type="button" class="talla-btn" disabled title="No hay talla ${esc(talla)} en ${esc(String(elegido).toLowerCase())}">
              <b>${esc(talla)}</b><small>no hay</small></button>`;
          }
          const libre = v.stock - enVenta(v.id_variante);
          const titulo = v.stock <= 0 ? 'Agotada' : libre + ' disponibles';
          return `<button type="button" class="talla-btn ${A.isLow(v) ? 'low' : ''}" data-add="${esc(v.id_variante)}"
            ${libre <= 0 ? 'disabled' : ''} title="${esc(v.sku)}: ${esc(titulo)}">
            <b>${esc(talla)}</b><small>${v.stock <= 0 ? 'agotada' : esc(libre)}</small></button>`;
        }).join('')}
      </div>
    </article>`;
  }

  function muestrarioHtml() {
    const list = productos();
    if (!list.length) return '<div class="empty">No hay prendas que coincidan con la búsqueda.</div>';
    return `<div class="muestrario">${list.map(tarjetaHtml).join('')}</div>`;
  }

  function ticketHtml() {
    if (!venta().length) {
      return '<div class="venta-empty">Elige una talla en cualquier prenda para empezar la venta.</div>';
    }
    return venta().map(function (l) {
      const v = variante(l.id_variante);
      return `<div class="venta-line ${l.id_variante === recienAgregada ? 'nueva' : ''}">
        ${A.prenda.de(v, 'venta-thumb')}
        <div class="venta-info">
          <div>${esc(v.producto)}</div>
          <div class="sub">Talla ${esc(v.talla)}, ${esc(String(v.color).toLowerCase())}. ${fmt(v.precio)} c/u</div>
          <div class="q">
            <button class="qty-btn" data-dec="${esc(v.id_variante)}" aria-label="Quitar una unidad">−</button>
            <b>${esc(l.cantidad)}</b>
            <button class="qty-btn" data-inc="${esc(v.id_variante)}" aria-label="Agregar una unidad">+</button>
            <button class="qty-btn del" data-del="${esc(v.id_variante)}">Quitar</button>
          </div>
        </div>
        <div class="price">${fmt(v.precio * l.cantidad)}</div>
      </div>`;
    }).join('');
  }

  A.views.pos = {
    title: 'Punto de venta',
    nav: 'Vender',
    roles: ['administrador', 'vendedor'],

    render() {
      const cats = A.store.variantes.map(function (v) { return v.categoria; })
        .filter(function (c, i, arr) { return c && arr.indexOf(c) === i; });
      return `
      <div class="pos">
        <section class="pos-prendas" aria-label="Prendas">
          <div class="pos-tools">
            <input class="search" id="pos-search" type="search" placeholder="Busca por nombre, SKU o color" value="${esc(query)}" aria-label="Buscar prenda">
            <div class="cat-chips" role="group" aria-label="Categoría">
              ${[''].concat(cats).map(function (c) {
                return `<button type="button" class="chip-btn" data-cat="${esc(c)}" aria-pressed="${c === categoria}">${c ? esc(c) : 'Todo'}</button>`;
              }).join('')}
            </div>
          </div>
          <div id="muestrario">${muestrarioHtml()}</div>
        </section>

        <aside class="venta" id="venta" aria-label="Venta actual">
          <h3>Venta actual</h3>
          <div id="venta-lines">${ticketHtml()}</div>
          <div class="venta-total"><span>Total</span><span id="venta-total">${fmt(total())}</span></div>
          <button class="btn btn-block" id="checkout" ${venta().length ? '' : 'disabled'}>Confirmar venta</button>
        </aside>

        <a href="#venta" class="venta-mini" id="venta-mini" ${venta().length ? '' : 'hidden'}>
          <span id="venta-mini-n">${unidades()} prendas</span><b id="venta-mini-t">${fmt(total())}</b>
        </a>
      </div>`;
    },

    bind(root) {
      function repaint() {
        root.querySelector('#muestrario').innerHTML = muestrarioHtml();
        root.querySelector('#venta-lines').innerHTML = ticketHtml();
        root.querySelector('#venta-total').textContent = fmt(total());
        root.querySelector('#checkout').disabled = !venta().length;
        const mini = root.querySelector('#venta-mini');
        mini.hidden = !venta().length;
        root.querySelector('#venta-mini-n').textContent = unidades() === 1 ? '1 prenda' : unidades() + ' prendas';
        root.querySelector('#venta-mini-t').textContent = fmt(total());
      }

      // En celular, la barra con el total se esconde cuando el ticket ya está en pantalla
      if ('IntersectionObserver' in window) {
        const mini = root.querySelector('#venta-mini');
        new IntersectionObserver(function (entries) {
          mini.classList.toggle('oculto', entries[0].isIntersecting);
        }, { threshold: 0.15 }).observe(root.querySelector('#venta'));
      }

      root.querySelector('#pos-search').addEventListener('input', function (e) {
        query = e.target.value;
        root.querySelector('#muestrario').innerHTML = muestrarioHtml();
      });

      root.addEventListener('click', async function (e) {
        const t = e.target.closest('button');
        if (!t) return;

        if (t.dataset.cat !== undefined) {
          categoria = t.dataset.cat;
          root.querySelectorAll('.chip-btn').forEach(function (b) { b.setAttribute('aria-pressed', String(b === t)); });
          root.querySelector('#muestrario').innerHTML = muestrarioHtml();
          return;
        }
        if (t.dataset.color) {
          colorElegido[t.dataset.prod] = t.dataset.color;
          root.querySelector('#muestrario').innerHTML = muestrarioHtml();
          return;
        }

        const id = Number(t.dataset.add || t.dataset.inc || t.dataset.dec || t.dataset.del);
        const items = venta();
        const line = items.find(function (l) { return l.id_variante === id; });

        if (t.dataset.add || t.dataset.inc) {
          const v = variante(id);
          if (enVenta(id) + 1 > v.stock) {   // RN-01: no vender más del stock
            A.toast('<b>No hay más unidades.</b> ' + esc(v.sku) + ' tiene ' + esc(v.stock) + ' disponibles.');
            return;
          }
          line ? line.cantidad++ : items.push({ id_variante: id, cantidad: 1 });
          recienAgregada = id;
          repaint();
          recienAgregada = null;
          const tot = root.querySelector('#venta-total');
          tot.classList.remove('sube'); void tot.offsetWidth; tot.classList.add('sube');
        } else if (t.dataset.dec) {
          line.cantidad--;
          if (line.cantidad <= 0) items.splice(items.indexOf(line), 1);
          repaint();
        } else if (t.dataset.del) {
          items.splice(items.indexOf(line), 1);
          repaint();
        } else if (t.id === 'checkout') {
          t.disabled = true;
          try {
            const r = await A.api.registrarVenta(A.session.id_usuario, items);
            A.store.venta = [];
            // El ticket se "corta" y sale volando antes de empezar una venta nueva
            if (!sinMovimiento) {
              root.querySelector('#venta').classList.add('cortado');
              await new Promise(function (ok) { setTimeout(ok, 520); });
            }
            A.toast('<b>Venta confirmada.</b> Pedido ' + esc(r.id_pedido) + ' por ' + fmt(r.total) + '. El stock ya se descontó.');
            A.app.refresh();
          } catch (err) {
            t.disabled = false;
            A.toast('<b>No se confirmó la venta.</b> ' + esc(err.message) + '. El inventario no cambió.');
          }
        }
      });
    },
  };
})(window.Atelier);
