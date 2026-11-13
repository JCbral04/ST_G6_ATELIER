-- Issue #25: Cancelación de venta con devolución de stock
-- Al pasar un pedido a estado 'cancelado', el stock de cada
-- variante vuelve a su valor previo a la venta.
CREATE OR REPLACE FUNCTION fn_stock_cancelacion() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.estado <> 'cancelado' AND NEW.estado = 'cancelado' THEN
        UPDATE variante_producto v
        SET stock = stock + dp.cantidad
        FROM detalle_pedido dp
        WHERE dp.id_pedido = NEW.id_pedido
          AND v.id_variante = dp.id_variante;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_cancelacion
    AFTER UPDATE OF estado ON pedido
    FOR EACH ROW EXECUTE FUNCTION fn_stock_cancelacion();