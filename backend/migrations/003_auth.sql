-- Autenticación de transportistas: PIN (con hash), bloqueo por intentos fallidos y tokens de sesión.

-- NULL = el transportista aún no tiene PIN y no puede iniciar sesión (se asigna con el seed).
ALTER TABLE carriers ADD COLUMN pin_hash TEXT;
ALTER TABLE carriers ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE carriers ADD COLUMN locked_until TEXT;

CREATE TABLE carrier_tokens (
    token_hash  TEXT    PRIMARY KEY,              -- SHA-256 del token; el token en claro nunca se guarda
    carrier_id  INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at  TEXT    NOT NULL
);

CREATE INDEX idx_carrier_tokens_carrier_id ON carrier_tokens(carrier_id);
