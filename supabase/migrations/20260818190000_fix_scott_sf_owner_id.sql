-- ROOT-CAUSE FIX (data): Scott Briggs' lcc_users.salesforce_owner_id was a stale id from an
-- old SF org (0051I000001vHJbQAM — owned 0 deals), which silently broke ALL Salesforce-sourced
-- owner attribution for him (SF Task owner_in filter excluded him; deal/opportunity owner never
-- mapped). Corrected to his live org id 0058W00000FDlFWQA1 (337 deals / 144 closed-won — the
-- lead-broker footprint; same 0058W org prefix as the rest of the team). APPLIED LIVE 2026-07-31.
-- Reversible: old id retained in lcc_users.notes. After this, re-run lcc_reconcile_owners_run().
update public.lcc_users
set salesforce_owner_id = '0058W00000FDlFWQA1',
    updated_at = now()
where lcc_user_id = '1d3f7321-a4ad-4f83-9c7b-489554fc1c51'
  and salesforce_owner_id = '0051I000001vHJbQAM';
