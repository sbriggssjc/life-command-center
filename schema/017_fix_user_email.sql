-- ============================================================================
-- 017: Fix user email — correct to work email (sabriggs@northmarq.com)
-- Life Command Center — Patch for already-run 014 bootstrap
-- ============================================================================

update users
set email = 'sabriggs@northmarq.com',
    updated_at = now()
where id = 'b0000000-0000-0000-0000-000000000001';

-- Verify
select id, email, display_name from users
where id = 'b0000000-0000-0000-0000-000000000001';
