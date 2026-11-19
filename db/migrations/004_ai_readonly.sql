-- Run as administrator, against the selected development database.
-- Set the password separately with psql \password ai_readonly.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ai_readonly') THEN
    CREATE ROLE ai_readonly LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
SELECT format('GRANT CONNECT ON DATABASE %I TO ai_readonly',current_database()) \gexec
GRANT USAGE ON SCHEMA public TO ai_readonly;
GRANT SELECT ON variante_producto,producto,categoria,pedido,detalle_pedido,compra,detalle_compra TO ai_readonly;
GRANT SELECT (id_usuario,rol) ON usuario TO ai_readonly;
ALTER ROLE ai_readonly SET default_transaction_read_only=on;
