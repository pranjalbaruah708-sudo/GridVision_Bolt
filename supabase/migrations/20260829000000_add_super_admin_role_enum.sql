-- Kept separate because PostgreSQL only permits use of a newly added enum value
-- after the transaction that adds it has committed.
ALTER TYPE public.app_user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN' AFTER 'ADMIN';
