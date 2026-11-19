-- Synthetic history. Only for an isolated database named atelier_demo.
-- Not real sales data; never execute against a production database.
BEGIN;
DO $$
DECLARE
  vendedor integer;
  r record;
  dia integer;
  qty integer;
  total_unidades integer;
  pedido_id integer;
BEGIN
  IF current_database() <> 'atelier_demo' THEN
    RAISE EXCEPTION 'Fixture restringido a atelier_demo';
  END IF;
  IF EXISTS (SELECT 1 FROM movimiento_inventario WHERE motivo='IA DEMO: abastecimiento sintetico') THEN
    RAISE EXCEPTION 'Fixture ya aplicado; use una base demo nueva';
  END IF;
  SELECT id_usuario INTO STRICT vendedor FROM usuario WHERE correo='vendedor@atelier.com' AND rol='vendedor';
  FOR r IN SELECT v.id_variante,p.precio FROM variante_producto v JOIN producto p ON p.id_producto=v.id_producto WHERE p.activo ORDER BY v.id_variante LIMIT 4 LOOP
    -- Deterministic demand per SKU and day; 35 complete historical days.
    SELECT SUM(1+((g+r.id_variante)%4)) INTO total_unidades FROM generate_series(1,35) g;
    UPDATE variante_producto SET stock=stock+total_unidades WHERE id_variante=r.id_variante;
    INSERT INTO movimiento_inventario(tipo,cantidad,motivo,fecha,id_variante,id_usuario)
      VALUES('entrada',total_unidades,'IA DEMO: abastecimiento sintetico',CURRENT_DATE-36,r.id_variante,vendedor);
    FOR dia IN REVERSE 35..1 LOOP
      qty:=1+((dia+r.id_variante)%4);
      INSERT INTO pedido(fecha,estado,total,id_usuario) VALUES(CURRENT_DATE-dia,'confirmado',qty*r.precio,vendedor) RETURNING id_pedido INTO pedido_id;
      INSERT INTO detalle_pedido(cantidad,precio_unitario,subtotal,id_pedido,id_variante) VALUES(qty,r.precio,qty*r.precio,pedido_id,r.id_variante);
      INSERT INTO movimiento_inventario(tipo,cantidad,motivo,fecha,id_variante,id_usuario)
        VALUES('salida',qty,'IA DEMO: venta sintetica #'||pedido_id,CURRENT_DATE-dia,r.id_variante,vendedor);
    END LOOP;
  END LOOP;
END $$;
COMMIT;
