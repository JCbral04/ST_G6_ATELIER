/* =============================================================
   Vista: Punto de venta (interfaz). La lógica transaccional
   vive en POST /api/pedidos (issue #9 / PR #11); sin API se simula.
   ============================================================= */
(function (A) {
  'use strict';
  const esc = A.esc, fmt = A.fmt;

  let query = '';

  function cart() { return A.store.cart; }
  function variante(id) { return A.store.variantes.find(function (v) { return v.id_variante === id; }); }
  function total() {
    return cart().reduce(function (t, l) { return t + variante(l.id_variante).precio * l.cantidad; }, 0);
  }
  function enCarrito(id) {
    const l = cart().find(function (x) { return x.id_variante === id; });
    return l ? l.cantidad : 0;
  }

  function listHtml() {
    const q = query.trim().toLowerCase();
    const rows = A.store.variantes.filter(function (v) {
      return !q || (v.producto + ' ' + v.sku).toLowerCase().indexOf(q) !== -1;
    });
    if (!rows.length) return '<div class="empty">Sin resultados para la búsqueda.</div>';
    return rows.map(function (v) {
      const libre = v.stock - enCarrito(v.id_variante);
      return `<div class="prod-row">
        <div><div class="nm">${esc(v.producto)}</div>
          <div class="vr">${esc(v.sku)} · Talla ${esc(v.talla)} · ${esc(v.color)} ·
            <span class="${A.isLow(v) ? 'pill pill-warn' : ''}">${esc(v.stock)} en stock</span></div></div>
        <div class="act">
          <span class="pr">${fmt(v.precio)}</span>
          <button class="btn-mini" data-add="${esc(v.id_variante)}" ${libre <= 0 ? 'disabled' : ''}>
            ${v.stock <= 0 ? 'Agotado' : '+ Agregar'}</button>
        </div>
      </div>`;
    }).join('');
  }

  function cartHtml() {
    if (!cart().length) return '<div class="cart-empty">El carrito está vacío. Agrega prendas desde la lista.</div>';
    return cart().map(function (l) {
      const v = variante(l.id_variante);
      return `<div class="cart-line">
        <span>${esc(v.producto)}<br><small style="color:var(--muted)">${esc(v.sku)}</small></span>
        <span class="q">
          <button class="qty-btn" data-dec="${esc(v.id_variante)}" aria-label="Quitar una unidad">−</button>
          <b>${esc(l.cantidad)}</b>
          <button class="qty-btn" data-inc="${esc(v.id_variante)}" aria-label="Agregar una unidad">+</button>
          <button class="qty-btn" data-del="${esc(v.id_variante)}" aria-label="Eliminar del carrito">×</button>
        </span>
        <span>${fmt(v.precio * l.cantidad)}</span>
      </div>`;
    }).join('');
  }

  A.views.pos = {
    title: 'Punto de venta',
    icon: '🛒',
    roles: ['administrador', 'vendedor'],

    render() {
      return `
      <div class="pos">
        <div>
          <input class="search" id="pos-search" type="search" placeholder="Buscar producto o SKU…" value="${esc(query)}" aria-label="Buscar producto">
          <div id="prod-list">${listHtml()}</div>
        </div>
        <div class="cart">
          <h3>CARRITO DE COMPRA</h3>
          <div id="cart-lines">${cartHtml()}</div>
          <div class="cart-total"><span>Total</span><span id="cart-total">${fmt(total())}</span></div>
          <button class="btn btn-accent btn-block" id="checkout" ${cart().length ? '' : 'disabled'}>Confirmar venta</button>
        </div>
      </div>`;
    },

    bind(root) {
      function repaint() {
        root.querySelector('#prod-list').innerHTML = listHtml();
        root.querySelector('#cart-lines').innerHTML = cartHtml();
        root.querySelector('#cart-total').textContent = fmt(total());
        root.querySelector('#checkout').disabled = !cart().length;
      }

      root.querySelector('#pos-search').addEventListener('input', function (e) {
        query = e.target.value;
        root.querySelector('#prod-list').innerHTML = listHtml();
      });

      root.addEventListener('click', async function (e) {
        const t = e.target.closest('button');
        if (!t) return;
        const id = Number(t.dataset.add || t.dataset.inc || t.dataset.dec || t.dataset.del);
        const items = cart();
        const line = items.find(function (l) { return l.id_variante === id; });

        if (t.dataset.add || t.dataset.inc) {
          const v = variante(id);
          if (enCarrito(id) + 1 > v.stock) {   // RN-01: no vender más del stock
            A.toast('<b>Stock insuficiente:</b> ' + esc(v.sku) + ' tiene ' + esc(v.stock) + ' uds.');
            return;
          }
          line ? line.cantidad++ : items.push({ id_variante: id, cantidad: 1 });
          repaint();
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
            A.store.cart = [];
            A.toast('<b>Venta #' + esc(r.id_pedido) + ' registrada por ' + fmt(r.total) + '.</b><br>Stock descontado (trg_stock_venta).');
            A.app.refresh();
          } catch (err) {
            t.disabled = false;
            A.toast('<b>Venta rechazada:</b> ' + esc(err.message) + '. El inventario no se modificó.');
          }
        }
      });
    },
  };
})(window.Atelier);
