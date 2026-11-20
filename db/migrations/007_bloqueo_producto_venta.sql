-- Issue #47: Bloqueo de productos con mínimo privilegio.
--
-- Permite consultar el precio de un producto activo y
-- conservar un bloqueo compartido hasta finalizar la
-- transacción, sin conceder UPDATE sobre producto.

CREATE OR REPLACE FUNCTION public.precio_producto_activo(
    p_id_producto INTEGER
)
RETURNS NUMERIC
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT p.precio
    FROM public.producto p
    WHERE p.id_producto = p_id_producto
      AND p.activo IS TRUE
    FOR SHARE OF p;
$$;

REVOKE ALL ON FUNCTION
    public.precio_producto_activo(INTEGER)
FROM PUBLIC;

-- En bases existentes el usuario puede estar creado.
-- En instalaciones nuevas de Compose se autoriza
-- posteriormente desde infrastructure/postgres/init.sh.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = 'atelier_app'
    ) THEN
        GRANT EXECUTE ON FUNCTION
            public.precio_producto_activo(INTEGER)
        TO atelier_app;
    END IF;
END;
$$;
