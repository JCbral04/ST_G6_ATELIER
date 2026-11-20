-- Issue #47: Integridad transaccional en cancelaciones.
--
-- Agrupa los detalles históricos por variante para restituir
-- la totalidad de las unidades vendidas.
--
-- Adquiere los bloqueos de variantes en orden ascendente
-- para reducir el riesgo de interbloqueos.
--
-- No modifica pedidos históricos ni recalcula stock existente.

CREATE OR REPLACE FUNCTION fn_stock_cancelacion()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.estado <> 'cancelado'
       AND NEW.estado = 'cancelado' THEN

        -- Bloquear las variantes en un orden determinista.
        PERFORM v.id_variante
        FROM variante_producto v
        JOIN (
            SELECT DISTINCT id_variante
            FROM detalle_pedido
            WHERE id_pedido = NEW.id_pedido
        ) d ON d.id_variante = v.id_variante
        ORDER BY v.id_variante
        FOR UPDATE OF v;

        -- Restituir la cantidad acumulada de cada variante.
        UPDATE variante_producto v
        SET stock = v.stock + d.cantidad_total
        FROM (
            SELECT
                id_variante,
                SUM(cantidad) AS cantidad_total
            FROM detalle_pedido
            WHERE id_pedido = NEW.id_pedido
            GROUP BY id_variante
        ) d
        WHERE v.id_variante = d.id_variante;

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
