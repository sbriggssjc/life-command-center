-- 20260725120000_lcc_boyd_watterson_owner_reconciliation.sql
-- ============================================================================
-- Boyd Watterson owner reconciliation  (LCC Opps / xengecqvemvfknjvbvrq)
-- ONE transactional, reversible migration. Nothing applies until merged/deployed.
-- Supabase runs each migration inside a transaction; do NOT add BEGIN/COMMIT.
--
-- CORRECTION v2 (Scott, 2026-07-23) — the SINGLE corrected parent:
--   Canonical parent = 78bc96e4 "Boyd Watterson Global" (already an organization,
--   already the SF-mapped (0018W00002X08rlQAB) gov true_owner the 162 SPEs point
--   to). RENAMED to "Boyd Watterson Asset Management, LLC"; KEEPS its SF Account +
--   gov true_owner registration (NOTHING moved/dropped). The old candidate
--   7a193b01 "Boyd Watterson" (RCA owns-hub) is now a MERGE SOURCE -> merged INTO
--   78bc96e4. "Boyd Watterson Global" is NOT a JV; its person-dup 74e0b0a3 also
--   merges into 78bc96e4. Only 3 real JVs remain related-party.
--
-- MECHANISM (grounded live 2026-07-23): parent 78bc96e4 is ALREADY registered in
--   lcc_buyer_parents (the app's real SPE->parent consumer). 112/155 attach SPEs
--   already roll up to it; 43 roll up to no parent. Per correction #3 ("ensure the
--   linkage; no re-pointing") this ADDS per-SPE EXACT buyer_parent patterns on
--   78bc96e4 for the attach set (additive; ONE parent -> no double-count). The
--   parent's existing broad patterns are KEPT. Cluster decisions -> reviewed.
--
-- REVERSIBILITY: every write is logged to public.lcc_boyd_reconcile_2026_07 and
--   reversed by public.lcc_boyd_reconcile_rollback(). Merges are SOFT
--   (entities.merged_into_entity_id); moved backrefs are snapshotted to
--   public.r40_merge_reconcile_backup (deep-reversal source). See the rollback fn.
-- ============================================================================

-- 0. Widen the reviewed-disposition CHECK to accept 'attach'
ALTER TABLE public.lcc_owner_parent_reviewed
  DROP CONSTRAINT IF EXISTS lcc_owner_parent_reviewed_disposition_check;
ALTER TABLE public.lcc_owner_parent_reviewed
  ADD  CONSTRAINT lcc_owner_parent_reviewed_disposition_check
  CHECK (disposition = ANY (ARRAY['confirmed'::text,'set_manual'::text,'independent'::text,'attach'::text]));

-- 1. Reversible audit/undo log
CREATE TABLE IF NOT EXISTS public.lcc_boyd_reconcile_2026_07 (
  id bigserial PRIMARY KEY,
  batch_tag text NOT NULL DEFAULT 'boyd_owner_reconcile_2026_07_25',
  op text NOT NULL, entity_id uuid, target_id uuid, prior jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Snapshot prior state of every touched entity + parent (reversal anchor)
INSERT INTO public.lcc_boyd_reconcile_2026_07(op, entity_id, prior)
SELECT 'pre_state', e.id,
       jsonb_build_object('name',e.name,'canonical_name',e.canonical_name,
         'entity_type',e.entity_type::text,'owner_role',e.owner_role,
         'merged_into_entity_id',e.merged_into_entity_id,'metadata',e.metadata)
FROM public.entities e WHERE e.id = ANY (string_to_array('045a51bb-2eae-4b5e-96e0-20405ccfc24f,0463f140-d810-4b7e-b619-aacb86b2617f,06a30aec-0d1b-468b-b857-70371cee0c88,07afb8ea-f1bc-4189-8aa6-a3f03c0a17ec,07bb7638-8aba-4ded-8ea5-9b818c91142f,0a162988-db84-4310-af34-01d130c0fa46,0b0cb8e6-5eb5-443b-8c6f-2e4fb7a355dd,0bdc462e-d9d4-4732-a84b-51dd38c0f8f2,0fcf1deb-c99d-4f2f-bad4-f70915455531,1042a811-e3fc-44e0-afa2-ca06541c350a,104d5a48-d2b2-4486-8125-f99f836c4e74,10a12b3a-af93-4480-a65f-43aeb75727b0,11674e71-a70b-4685-9664-ba7f9ac09abe,13c392de-ef25-47b6-98f7-19a1792fac7a,145d525d-050b-4b59-9c3a-29a6796d858f,15f1ed28-6038-46f8-9377-195faa46a36e,16385fb7-78fe-4015-8e80-007f1ab06fbf,16bc1816-4507-4797-bedf-78e027074ebc,1835b002-74a5-48b1-b313-3e4ce81a3850,18c0d685-028a-4959-a44b-7f461c81adf7,19253c65-9dae-461a-8249-dda1d5c67427,1c433242-f680-4431-9e8f-468af32e7c58,218add7c-0103-4416-b90a-d0e2bbe0d5b3,2472617e-2b3d-4f6b-88a5-7a77777bf5b9,250ebbab-9c84-4aca-9cdc-34025446d078,26cc8ed8-aae2-465f-b5bc-174d89e366ea,2900689d-4ab3-4caf-810e-070599d656fc,294a967e-2d6a-490a-856b-d79ae58383b0,2ec1da56-fc8b-42e8-84c5-ad81c1f61853,2f0e5fcb-fc0e-471e-9da1-da6e67f357ce,2f10c3b3-f0df-4438-a405-8bff495de4d7,321bc594-dd17-47d7-9ace-7b17a4e2f010,32b8b9fb-2dd2-44e6-b6d1-06094f267409,32f0571a-33e4-4c43-8c4f-dad5be2a0cb9,38351f0b-b8a8-44f0-9278-021008a7d01d,3cfd77a0-738f-4be9-9747-ff25c5f8eeb7,3eaa7062-aee3-4058-b2f5-164b00dcf131,3fac4952-38d1-4379-b82c-8e2f87aff35b,4336ceef-ba2a-48c7-aeea-77c98f345144,4351c5be-8c0e-43ad-8280-521b4944b82d,457d6c1d-3e50-46c3-ba90-f96c3e832900,45b60bbd-a5b6-4b31-889b-c1ade03a237b,47632a93-fab9-4b4a-99e3-ae701aa5c8a3,48157962-1b88-44b0-a7ad-26dcf6186d4e,48da7015-34db-4e7c-92bd-bf4816ce538e,49bf2049-a682-4163-85e8-cb07c2be6a1a,4c3c7cc6-57d1-4e32-92de-e6eb5c4361d5,4d097a6f-61c5-4f58-820c-68ce4c5387b5,4f6aed02-1a36-4be2-9fc0-999dec2b33d7,546e4ac0-9c01-4cdd-8381-4e426f07ca09,55afaf73-0fc5-4aed-bad5-c646a3a9d389,5a190e0b-7003-4ebf-875c-857f37d67006,5b5ab84e-bd2d-4e88-a4aa-ae2cac50f7d1,5ca65f32-f656-47c6-8050-1c299a7782ee,5d5458f3-a4f6-4ec8-83c8-03aa899ca1bb,5d6ec526-acba-4f53-9e24-bf1f3ea881d1,5efe33c4-6839-4be4-a972-d8c506dffdb6,5f0812ec-de04-40c1-b4f8-b7408600b57e,5fc0e2ed-69f0-4016-9fa8-45dfdbf1f305,5ff5659d-115e-4a43-abe1-1ad2dafcfcac,61423218-acb6-4622-aee1-8c3c4aa3e083,62186b90-7a2e-4e9f-96b5-4b4b6e67288b,62fdb5ba-df06-4beb-8393-4480fed3af0c,6567cb06-9bc5-4662-bfd4-588b751f6c65,656aa7a7-e07e-4724-90d2-72bac498a059,6571adff-b3de-44c2-a145-898ce194d2a2,65ac6307-5bd2-404b-993a-5646f1da3f0b,667f776b-e088-4ab4-bade-bc4885b3f7eb,67eeff27-a8f9-4288-bc96-fb29a484f694,6d4ee75b-a29d-41fc-b953-91cc6cf1c4ec,6e97578f-ec8d-4b42-9fe1-214f48971ff7,6f50f1a2-afe0-411a-8408-07c52e47bd4f,70225465-b6e0-46c7-b344-683b14f216e9,7246ca33-30a1-4652-b338-3fb7b1749d2e,72dbe76c-4baf-4c56-976d-fdde68ed2078,73593941-5693-437a-804e-180b34ddd3be,73c8655e-6ff5-4958-af29-ee4f8c0c0c2c,749580ec-81ea-42b9-815d-bacf78a1ae01,74e0b0a3-52fe-4e96-b697-fb3e86879a58,75129fe7-3791-4bc9-9f44-b5b7d30ced33,755beaf3-65be-4c52-bed5-8d088c70e312,78bc96e4-e719-4b56-8656-ed7bb4797012,7955d5db-b7bd-42a5-a545-a302e0464d17,7a193b01-c4c2-4d3c-8bca-5404163df34c,7a3e811e-41cb-4e4b-a1e5-56308b8b7e3e,7c46c372-901c-41c4-a9b6-9005d862022d,7d6c96b6-65fc-4124-afe0-427922df7fea,7e4feff7-2588-4f13-a3f2-cadf271cd6af,7ef2fe69-fb42-42f0-b8db-f6ed537ce130,81e0179e-ce65-43c2-8dac-6f9c0949dca7,8277a2d6-680a-4a34-9363-e93e69f7c061,85a9f3c5-fb7d-41ff-bc92-d50c6e456308,8747c5dd-3dfe-4f40-baea-7566a43f950b,88f3cfcf-96aa-4cbe-81f1-19750b9a490d,8b304910-0491-40b5-8770-af2ac6460d67,8dc6b192-22df-4ff7-8468-7f9676d9c6b2,8f31f15c-9358-4b0b-bdbd-f63631cbf6fa,90db1869-bfa8-4da0-9b36-d14d264f9e90,90eb9909-e252-472a-b42c-946af47c7a59,9261975a-ea1a-4465-b1dc-4a83bd71b900,9406a1ef-4846-48d7-84ac-4640c34a88e2,95d03ada-cd86-4321-b1c0-8ac5967986f3,9605d128-e06d-483e-8398-44eb67b2ad4c,9658a9bf-d9a7-4431-aede-bb558895306b,966ecfe2-6b6b-4b3f-a9fc-706492e83d18,98dce87e-6cc8-4b95-8b5e-2b0f782569fc,9a4a089f-8fbb-43a9-8f69-f4bbdaee87b8,9b17da68-cc4f-42ab-9626-6969676d5156,9bea6e0b-5f5b-476f-a5b5-0c44f27101df,9c0202be-7533-48e5-b3b6-8e39586ca4e3,9c8ce7ba-8dfb-4887-a687-d4bac6460bdb,9d8e128e-fadd-48f7-b172-2c9ca2136a72,a2296bc1-0d89-43e0-b92d-0ca3927db1d4,a22abcd0-663a-4c40-9505-a8000f6d8987,a29c363d-3abf-441d-a12d-8bed1879dca9,a2c9a3c9-453f-48c1-af62-546f3f4ec06c,a37f028e-1c86-480f-ad45-669eb38690bb,a37f1ba2-7c7a-420f-9222-8f4b8174f720,a5939834-acfe-4232-b561-19b9e4a229d7,a66d4e42-a1d8-4eb0-b66b-6033ae4ea87e,a6e5b1c0-8be6-4a94-bfef-a0971abb9c4b,a76c2485-f96f-41db-9995-246fb59d98c8,a7b1a529-e19c-44d0-a7e0-608db7f60222,a8855dc2-f6d5-40a0-9933-c47dd8c7fc48,aa3fddc4-d923-40b7-8884-f1c0fe5eec11,ac6b495d-679f-4474-9832-90edaf99c233,adcb4673-9997-435d-80c7-8c540762acb6,af14f539-68e5-4bb1-8086-714182f76bc2,b0c0a041-a670-4b98-94b2-16ef0f77bdf7,b12a0ac1-6f2f-459e-b91a-e35d7114effd,b1621d7b-9997-42a8-8927-cd37e53dcf34,b2ce6186-d5d8-4e2d-a9a6-9e17c40e5b5e,b2e06c17-354e-4eed-ab59-e78178a8de6b,b47d17e8-74c7-498a-a69a-98be9b8fd1a3,b4b362bf-56df-4dc7-9ccf-1b6d10fcf715,b69c926a-edc4-42b0-b944-f08015ec0311,b6fd5beb-1194-4f2e-a421-67adce62a356,b77a9253-a106-44a3-a17a-9a5a109c5210,b79b8fc7-941c-4a3e-adeb-7933a57a6349,bb8a9f3e-f31c-40c7-b275-45bce9259899,bd111a88-d8b9-48c8-97bb-113310c6c499,bddfc634-e6b2-4229-b80f-902ac4496b24,bde45497-71ea-4996-bcce-e7e69fca98e4,c275b346-a8c2-4eca-a269-c0254fc21310,c2ad3733-f232-448c-8b6b-3a86a086b993,c3e5aa17-1284-4859-9eb4-a4aad712b631,c8ac99be-0ef2-4f9b-86e6-8bf3591604f9,c9b0b77d-ec58-4146-97af-ecfb9dd85dc1,ca60339e-767d-4209-9c4f-1b49f8bf0c1c,ca7540bf-e0b6-4458-ac04-2f723cef01b0,cae43f5c-bf64-40e2-9cfc-74f34a9a4753,cce0adb3-e5c4-4f61-84df-93fd91fa3eab,cd3c43a6-fbd3-470c-a3cf-34107035947f,cdd43f38-b68e-443d-b8c3-3bc302d609cf,cedde66c-eecf-495b-80f4-a08fb4cb9fc7,cf80a49d-e367-47c9-902e-b34138017af3,d051eaa0-55fa-409a-9e44-87053703a2fe,d05d86aa-b8d1-4e76-95fe-7ecab930986e,d4448152-e0a3-491d-ab1f-437e795ec60f,d4d45439-e58e-437d-b01c-77bcd86b59f4,d7021ddb-814f-4818-9955-050069673518,d75ce0cd-53e8-41f6-b184-fd479a60e386,dc56ad8e-38ce-452a-a567-c9996d4614d9,dc6b8602-d9bb-49c3-ad3c-e92e3ff2b5ef,dcf50520-dc91-4b00-aef8-282d9ab4f8fd,dd997705-23d5-492e-8dec-b68c1e7e315b,def50dab-db4d-4805-8d68-668fab12cc6c,dfed9f78-f7f5-41d5-a6ec-6376b31a8408,e20e38d5-ea06-447d-b88a-d16e283795b7,e298d940-9f2a-4f73-b8f5-68ea1eecd6e8,e43672f4-d4ec-46ca-867d-e5c38015dfaa,e44358ba-c8f3-43b7-8d16-ca1fa9cc3e7e,e4fb5f4f-2cea-48a0-984c-3772c325d62e,e513e8da-7e10-4266-a35b-7134f60389c9,e54737cc-a1f7-4917-8648-ddad87458b3b,e6bf64f7-2410-4a14-906f-977bfccf3747,e75aeae4-6f73-47c3-85a8-5dafd5850bb5,e81d712c-1e86-4f73-ab2d-8561a71bda42,eaf559a5-9a1f-47c9-aa5c-6890003ac188,ec9fd2b5-adc6-4846-aeb1-daed830952f9,ed002762-13c2-4351-8669-b15888ff8630,ed1a3c96-4a4c-49c0-ab0d-2e47b37a2e32,ed2c7971-fab6-4d27-b02f-3aa4babef21b,edd6f69f-c430-4f1f-85f6-0be6e0e4bdd6,eeb6f127-82f3-47ce-a47a-fc6130b340b6,eefc063f-90aa-4c44-9f95-7b2c3810d107,efd0ab99-efb8-45fd-8fcb-1086f29b6e31,f01c2891-50df-4bde-ad63-e01c2144ce8d,f092dcd6-4bbf-4b36-8d45-e507064e08c2,f159a6c5-29ce-4cad-88a6-672e018b5125,f1a93f12-a22c-4059-a28a-40f25e536a4e,f4343899-87de-4b9c-961d-77a3748983d6,f4dadf10-be1c-4f5e-947b-65382b4f5655,f4ea1a9a-5b92-440f-922e-f44947f1c724,f4f453b1-3fbd-4c38-af6f-1b73c3e78c8a,f5c31597-5542-4f21-9f5d-27cc11d7b623,f6deb6d1-24ac-446c-9812-ae4444d12bbc,fa74e7ff-9b69-4100-a0c4-c09cd1eeb0cc,fc6f0882-5420-48c3-b2cb-d80057f69447,fcf9e501-08ea-40ab-96c2-9c2f89f60c6b,fd79f8b8-8582-4d84-b595-f84c369d06f7,fd7ccc3a-9d1d-4c17-9106-b5cbd5c9b479,fe17c2d1-47ea-4383-a352-a391f2f218de,ff2c994c-7433-4285-8fe9-7b40979d069f',',')::uuid[]);

-- 3. Rename the canonical parent (SF Account + gov true_owner untouched)
INSERT INTO public.lcc_boyd_reconcile_2026_07(op, entity_id, prior)
SELECT 'parent_rename', id, jsonb_build_object('name',name,'canonical_name',canonical_name,
         'entity_type',entity_type::text,'owner_role',owner_role)
FROM public.entities WHERE id='78bc96e4-e719-4b56-8656-ed7bb4797012';
UPDATE public.entities
SET name='Boyd Watterson Asset Management, LLC',
    canonical_name='boyd watterson asset management, llc',
    entity_type='organization'
WHERE id='78bc96e4-e719-4b56-8656-ed7bb4797012';

-- 4. Aliases on the parent
WITH ins AS (
  INSERT INTO public.entity_aliases(workspace_id, entity_id, alias_name, alias_canonical, source)
  VALUES ('a0000000-0000-0000-0000-000000000001','78bc96e4-e719-4b56-8656-ed7bb4797012','Boyd Watterson Global','boyd watterson global','boyd_owner_reconcile_2026_07_25'),
         ('a0000000-0000-0000-0000-000000000001','78bc96e4-e719-4b56-8656-ed7bb4797012','Boyd Watterson','boyd watterson','boyd_owner_reconcile_2026_07_25')
  ON CONFLICT (workspace_id, alias_canonical) DO NOTHING
  RETURNING id, alias_canonical )
INSERT INTO public.lcc_boyd_reconcile_2026_07(op, entity_id, target_id, prior)
SELECT 'alias_add','78bc96e4-e719-4b56-8656-ed7bb4797012',NULL, jsonb_build_object('alias_id',id,'alias_canonical',alias_canonical) FROM ins;

-- 5. Merges: (a) 8 dedupe twins  (b) 17 merge-into-parent (15 variants + 7a193b01 + 74e0b0a3)
DO $$
DECLARE
  v_loser uuid; v_winner uuid;
  v_parent constant uuid := '78bc96e4-e719-4b56-8656-ed7bb4797012';
  v_pmerge uuid[] := string_to_array('045a51bb-2eae-4b5e-96e0-20405ccfc24f,5ca65f32-f656-47c6-8050-1c299a7782ee,6567cb06-9bc5-4662-bfd4-588b751f6c65,65ac6307-5bd2-404b-993a-5646f1da3f0b,74e0b0a3-52fe-4e96-b697-fb3e86879a58,7a193b01-c4c2-4d3c-8bca-5404163df34c,7c46c372-901c-41c4-a9b6-9005d862022d,7e4feff7-2588-4f13-a3f2-cadf271cd6af,966ecfe2-6b6b-4b3f-a9fc-706492e83d18,a2c9a3c9-453f-48c1-af62-546f3f4ec06c,af14f539-68e5-4bb1-8086-714182f76bc2,b2e06c17-354e-4eed-ab59-e78178a8de6b,bddfc634-e6b2-4229-b80f-902ac4496b24,d4448152-e0a3-491d-ab1f-437e795ec60f,e44358ba-c8f3-43b7-8d16-ca1fa9cc3e7e,f092dcd6-4bbf-4b36-8d45-e507064e08c2,f159a6c5-29ce-4cad-88a6-672e018b5125',',')::uuid[];
BEGIN
  FOR v_loser, v_winner IN
    SELECT loser, winner FROM (VALUES
      ('f1a93f12-a22c-4059-a28a-40f25e536a4e'::uuid,'b1621d7b-9997-42a8-8927-cd37e53dcf34'::uuid),
      ('a37f1ba2-7c7a-420f-9222-8f4b8174f720'::uuid,'755beaf3-65be-4c52-bed5-8d088c70e312'::uuid),
      ('7246ca33-30a1-4652-b338-3fb7b1749d2e'::uuid,'ac6b495d-679f-4474-9832-90edaf99c233'::uuid),
      ('5ff5659d-115e-4a43-abe1-1ad2dafcfcac'::uuid,'9b17da68-cc4f-42ab-9626-6969676d5156'::uuid),
      ('9d8e128e-fadd-48f7-b172-2c9ca2136a72'::uuid,'cedde66c-eecf-495b-80f4-a08fb4cb9fc7'::uuid),
      ('f4f453b1-3fbd-4c38-af6f-1b73c3e78c8a'::uuid,'d75ce0cd-53e8-41f6-b184-fd479a60e386'::uuid),
      ('adcb4673-9997-435d-80c7-8c540762acb6'::uuid,'16bc1816-4507-4797-bedf-78e027074ebc'::uuid),
      ('3cfd77a0-738f-4be9-9747-ff25c5f8eeb7'::uuid,'b77a9253-a106-44a3-a17a-9a5a109c5210'::uuid)
    ) AS d(loser, winner)
  LOOP
    CONTINUE WHEN v_loser = v_winner;
    PERFORM 1 FROM public.entities WHERE id=v_loser AND merged_into_entity_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    PERFORM 1 FROM public.entities WHERE id=v_winner AND merged_into_entity_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'dedupe winner % missing/merged', v_winner; END IF;
    PERFORM public.lcc_reconcile_tombstone_backrefs(v_loser, v_winner, TRUE);
    UPDATE public.entities SET merged_into_entity_id=v_winner WHERE id=v_loser;
    INSERT INTO public.lcc_boyd_reconcile_2026_07(op,entity_id,target_id) VALUES ('dedupe',v_loser,v_winner);
  END LOOP;
  FOREACH v_loser IN ARRAY v_pmerge LOOP
    CONTINUE WHEN v_loser = v_parent;
    PERFORM 1 FROM public.entities WHERE id=v_loser AND merged_into_entity_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    PERFORM 1 FROM public.entities WHERE id=v_parent AND merged_into_entity_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'parent % missing/merged', v_parent; END IF;
    PERFORM public.lcc_reconcile_tombstone_backrefs(v_loser, v_parent, TRUE);
    UPDATE public.entities SET merged_into_entity_id=v_parent WHERE id=v_loser;
    INSERT INTO public.lcc_boyd_reconcile_2026_07(op,entity_id,target_id) VALUES ('merge_parent',v_loser,v_parent);
  END LOOP;
END $$;

-- 6. ENSURE ATTACH LINKAGE: per-SPE EXACT buyer_parent patterns (idempotent; broad patterns KEPT)
WITH ins AS (
  INSERT INTO public.lcc_operator_affiliate_patterns
    (parent_entity_id, pattern_name, pattern_type, relationship, notes)
  SELECT '78bc96e4-e719-4b56-8656-ed7bb4797012', lower(e.name), 'exact', 'buyer_parent', 'boyd_owner_reconcile_2026_07_25'
  FROM public.entities e
  WHERE e.id = ANY (string_to_array('06a30aec-0d1b-468b-b857-70371cee0c88,07afb8ea-f1bc-4189-8aa6-a3f03c0a17ec,07bb7638-8aba-4ded-8ea5-9b818c91142f,0a162988-db84-4310-af34-01d130c0fa46,0b0cb8e6-5eb5-443b-8c6f-2e4fb7a355dd,0bdc462e-d9d4-4732-a84b-51dd38c0f8f2,0fcf1deb-c99d-4f2f-bad4-f70915455531,1042a811-e3fc-44e0-afa2-ca06541c350a,104d5a48-d2b2-4486-8125-f99f836c4e74,10a12b3a-af93-4480-a65f-43aeb75727b0,11674e71-a70b-4685-9664-ba7f9ac09abe,13c392de-ef25-47b6-98f7-19a1792fac7a,15f1ed28-6038-46f8-9377-195faa46a36e,16385fb7-78fe-4015-8e80-007f1ab06fbf,16bc1816-4507-4797-bedf-78e027074ebc,1835b002-74a5-48b1-b313-3e4ce81a3850,19253c65-9dae-461a-8249-dda1d5c67427,1c433242-f680-4431-9e8f-468af32e7c58,218add7c-0103-4416-b90a-d0e2bbe0d5b3,2472617e-2b3d-4f6b-88a5-7a77777bf5b9,250ebbab-9c84-4aca-9cdc-34025446d078,26cc8ed8-aae2-465f-b5bc-174d89e366ea,2900689d-4ab3-4caf-810e-070599d656fc,294a967e-2d6a-490a-856b-d79ae58383b0,2ec1da56-fc8b-42e8-84c5-ad81c1f61853,2f0e5fcb-fc0e-471e-9da1-da6e67f357ce,321bc594-dd17-47d7-9ace-7b17a4e2f010,32b8b9fb-2dd2-44e6-b6d1-06094f267409,32f0571a-33e4-4c43-8c4f-dad5be2a0cb9,38351f0b-b8a8-44f0-9278-021008a7d01d,3eaa7062-aee3-4058-b2f5-164b00dcf131,4336ceef-ba2a-48c7-aeea-77c98f345144,457d6c1d-3e50-46c3-ba90-f96c3e832900,45b60bbd-a5b6-4b31-889b-c1ade03a237b,48157962-1b88-44b0-a7ad-26dcf6186d4e,48da7015-34db-4e7c-92bd-bf4816ce538e,49bf2049-a682-4163-85e8-cb07c2be6a1a,4c3c7cc6-57d1-4e32-92de-e6eb5c4361d5,4d097a6f-61c5-4f58-820c-68ce4c5387b5,4f6aed02-1a36-4be2-9fc0-999dec2b33d7,546e4ac0-9c01-4cdd-8381-4e426f07ca09,55afaf73-0fc5-4aed-bad5-c646a3a9d389,5a190e0b-7003-4ebf-875c-857f37d67006,5d5458f3-a4f6-4ec8-83c8-03aa899ca1bb,5d6ec526-acba-4f53-9e24-bf1f3ea881d1,5efe33c4-6839-4be4-a972-d8c506dffdb6,5f0812ec-de04-40c1-b4f8-b7408600b57e,5fc0e2ed-69f0-4016-9fa8-45dfdbf1f305,61423218-acb6-4622-aee1-8c3c4aa3e083,62186b90-7a2e-4e9f-96b5-4b4b6e67288b,656aa7a7-e07e-4724-90d2-72bac498a059,6571adff-b3de-44c2-a145-898ce194d2a2,67eeff27-a8f9-4288-bc96-fb29a484f694,6d4ee75b-a29d-41fc-b953-91cc6cf1c4ec,6e97578f-ec8d-4b42-9fe1-214f48971ff7,6f50f1a2-afe0-411a-8408-07c52e47bd4f,70225465-b6e0-46c7-b344-683b14f216e9,72dbe76c-4baf-4c56-976d-fdde68ed2078,73593941-5693-437a-804e-180b34ddd3be,73c8655e-6ff5-4958-af29-ee4f8c0c0c2c,749580ec-81ea-42b9-815d-bacf78a1ae01,75129fe7-3791-4bc9-9f44-b5b7d30ced33,755beaf3-65be-4c52-bed5-8d088c70e312,7955d5db-b7bd-42a5-a545-a302e0464d17,7a3e811e-41cb-4e4b-a1e5-56308b8b7e3e,7d6c96b6-65fc-4124-afe0-427922df7fea,7ef2fe69-fb42-42f0-b8db-f6ed537ce130,81e0179e-ce65-43c2-8dac-6f9c0949dca7,8277a2d6-680a-4a34-9363-e93e69f7c061,85a9f3c5-fb7d-41ff-bc92-d50c6e456308,88f3cfcf-96aa-4cbe-81f1-19750b9a490d,8b304910-0491-40b5-8770-af2ac6460d67,8dc6b192-22df-4ff7-8468-7f9676d9c6b2,8f31f15c-9358-4b0b-bdbd-f63631cbf6fa,90db1869-bfa8-4da0-9b36-d14d264f9e90,90eb9909-e252-472a-b42c-946af47c7a59,9261975a-ea1a-4465-b1dc-4a83bd71b900,95d03ada-cd86-4321-b1c0-8ac5967986f3,9605d128-e06d-483e-8398-44eb67b2ad4c,9658a9bf-d9a7-4431-aede-bb558895306b,98dce87e-6cc8-4b95-8b5e-2b0f782569fc,9a4a089f-8fbb-43a9-8f69-f4bbdaee87b8,9b17da68-cc4f-42ab-9626-6969676d5156,9bea6e0b-5f5b-476f-a5b5-0c44f27101df,9c0202be-7533-48e5-b3b6-8e39586ca4e3,9c8ce7ba-8dfb-4887-a687-d4bac6460bdb,a2296bc1-0d89-43e0-b92d-0ca3927db1d4,a22abcd0-663a-4c40-9505-a8000f6d8987,a29c363d-3abf-441d-a12d-8bed1879dca9,a37f028e-1c86-480f-ad45-669eb38690bb,a6e5b1c0-8be6-4a94-bfef-a0971abb9c4b,a76c2485-f96f-41db-9995-246fb59d98c8,a8855dc2-f6d5-40a0-9933-c47dd8c7fc48,aa3fddc4-d923-40b7-8884-f1c0fe5eec11,ac6b495d-679f-4474-9832-90edaf99c233,b0c0a041-a670-4b98-94b2-16ef0f77bdf7,b12a0ac1-6f2f-459e-b91a-e35d7114effd,b1621d7b-9997-42a8-8927-cd37e53dcf34,b2ce6186-d5d8-4e2d-a9a6-9e17c40e5b5e,b47d17e8-74c7-498a-a69a-98be9b8fd1a3,b69c926a-edc4-42b0-b944-f08015ec0311,b6fd5beb-1194-4f2e-a421-67adce62a356,b77a9253-a106-44a3-a17a-9a5a109c5210,b79b8fc7-941c-4a3e-adeb-7933a57a6349,bb8a9f3e-f31c-40c7-b275-45bce9259899,bd111a88-d8b9-48c8-97bb-113310c6c499,bde45497-71ea-4996-bcce-e7e69fca98e4,c275b346-a8c2-4eca-a269-c0254fc21310,c2ad3733-f232-448c-8b6b-3a86a086b993,c3e5aa17-1284-4859-9eb4-a4aad712b631,c8ac99be-0ef2-4f9b-86e6-8bf3591604f9,c9b0b77d-ec58-4146-97af-ecfb9dd85dc1,ca7540bf-e0b6-4458-ac04-2f723cef01b0,cce0adb3-e5c4-4f61-84df-93fd91fa3eab,cd3c43a6-fbd3-470c-a3cf-34107035947f,cdd43f38-b68e-443d-b8c3-3bc302d609cf,cedde66c-eecf-495b-80f4-a08fb4cb9fc7,cf80a49d-e367-47c9-902e-b34138017af3,d051eaa0-55fa-409a-9e44-87053703a2fe,d05d86aa-b8d1-4e76-95fe-7ecab930986e,d4d45439-e58e-437d-b01c-77bcd86b59f4,d7021ddb-814f-4818-9955-050069673518,d75ce0cd-53e8-41f6-b184-fd479a60e386,dc56ad8e-38ce-452a-a567-c9996d4614d9,dc6b8602-d9bb-49c3-ad3c-e92e3ff2b5ef,dfed9f78-f7f5-41d5-a6ec-6376b31a8408,e20e38d5-ea06-447d-b88a-d16e283795b7,e43672f4-d4ec-46ca-867d-e5c38015dfaa,e4fb5f4f-2cea-48a0-984c-3772c325d62e,e513e8da-7e10-4266-a35b-7134f60389c9,e54737cc-a1f7-4917-8648-ddad87458b3b,e6bf64f7-2410-4a14-906f-977bfccf3747,e75aeae4-6f73-47c3-85a8-5dafd5850bb5,e81d712c-1e86-4f73-ab2d-8561a71bda42,eaf559a5-9a1f-47c9-aa5c-6890003ac188,ec9fd2b5-adc6-4846-aeb1-daed830952f9,ed002762-13c2-4351-8669-b15888ff8630,ed1a3c96-4a4c-49c0-ab0d-2e47b37a2e32,ed2c7971-fab6-4d27-b02f-3aa4babef21b,edd6f69f-c430-4f1f-85f6-0be6e0e4bdd6,eeb6f127-82f3-47ce-a47a-fc6130b340b6,eefc063f-90aa-4c44-9f95-7b2c3810d107,efd0ab99-efb8-45fd-8fcb-1086f29b6e31,f01c2891-50df-4bde-ad63-e01c2144ce8d,f4343899-87de-4b9c-961d-77a3748983d6,f4dadf10-be1c-4f5e-947b-65382b4f5655,f4ea1a9a-5b92-440f-922e-f44947f1c724,f6deb6d1-24ac-446c-9812-ae4444d12bbc,fa74e7ff-9b69-4100-a0c4-c09cd1eeb0cc,fc6f0882-5420-48c3-b2cb-d80057f69447,fcf9e501-08ea-40ab-96c2-9c2f89f60c6b,fd79f8b8-8582-4d84-b595-f84c369d06f7,fd7ccc3a-9d1d-4c17-9106-b5cbd5c9b479,fe17c2d1-47ea-4383-a352-a391f2f218de,ff2c994c-7433-4285-8fe9-7b40979d069f',',')::uuid[])
    AND e.merged_into_entity_id IS NULL AND e.name IS NOT NULL AND btrim(e.name) <> ''
  ON CONFLICT (parent_entity_id, pattern_name, pattern_type) DO NOTHING
  RETURNING pattern_id, pattern_name )
INSERT INTO public.lcc_boyd_reconcile_2026_07(op, entity_id, target_id, prior)
SELECT 'attach_pattern', NULL, NULL, jsonb_build_object('pattern_id',pattern_id,'pattern_name',pattern_name) FROM ins;

-- 7. Cluster decisions -> lcc_owner_parent_reviewed (disposition='attach')
INSERT INTO public.lcc_owner_parent_reviewed(source_domain, cluster_token, disposition, parent_entity_id, reviewed_by, reviewed_at)
VALUES ('gov','fgf','attach','78bc96e4-e719-4b56-8656-ed7bb4797012',NULL,now()),
       ('gov','sgf','attach','78bc96e4-e719-4b56-8656-ed7bb4797012',NULL,now()),
       ('gov','boyd_gsa','attach','78bc96e4-e719-4b56-8656-ed7bb4797012',NULL,now()),
       ('gov','boyd_named','attach','78bc96e4-e719-4b56-8656-ed7bb4797012',NULL,now())
ON CONFLICT (source_domain, cluster_token) DO UPDATE
  SET disposition=EXCLUDED.disposition, parent_entity_id=EXCLUDED.parent_entity_id, reviewed_at=EXCLUDED.reviewed_at;
INSERT INTO public.lcc_boyd_reconcile_2026_07(op, entity_id, prior)
SELECT 'reviewed_add', NULL, jsonb_build_object('tokens', jsonb_build_array('fgf','sgf','boyd_gsa','boyd_named'));

-- 8. Relate the 3 real JVs to the parent (associated_with, role='jv'; NOT merged)
WITH ins AS (
  INSERT INTO public.entity_relationships(workspace_id, from_entity_id, to_entity_id, relationship_type, metadata)
  SELECT 'a0000000-0000-0000-0000-000000000001', j.id, '78bc96e4-e719-4b56-8656-ed7bb4797012', 'associated_with', jsonb_build_object('role','jv','via','boyd_owner_reconcile_2026_07_25')
  FROM (VALUES ('def50dab-db4d-4805-8d68-668fab12cc6c'::uuid), ('9406a1ef-4846-48d7-84ac-4640c34a88e2'::uuid), ('a66d4e42-a1d8-4eb0-b66b-6033ae4ea87e'::uuid)) j(id)
  WHERE j.id <> '78bc96e4-e719-4b56-8656-ed7bb4797012'
    AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r
      WHERE r.from_entity_id=j.id AND r.to_entity_id='78bc96e4-e719-4b56-8656-ed7bb4797012' AND r.relationship_type='associated_with')
  RETURNING id, from_entity_id )
INSERT INTO public.lcc_boyd_reconcile_2026_07(op, entity_id, target_id, prior)
SELECT 'jv_edge', from_entity_id, '78bc96e4-e719-4b56-8656-ed7bb4797012', jsonb_build_object('rel_id',id) FROM ins;

-- 9. LEAVE-UNTOUCHED tagging: quarantine (17) + exclude (3)
UPDATE public.entities
SET metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('boyd_quarantine',true,'boyd_reconcile_tag','boyd_owner_reconcile_2026_07_25')
WHERE id = ANY (string_to_array('145d525d-050b-4b59-9c3a-29a6796d858f,18c0d685-028a-4959-a44b-7f461c81adf7,2f10c3b3-f0df-4438-a405-8bff495de4d7,3fac4952-38d1-4379-b82c-8e2f87aff35b,4351c5be-8c0e-43ad-8280-521b4944b82d,47632a93-fab9-4b4a-99e3-ae701aa5c8a3,62fdb5ba-df06-4beb-8393-4480fed3af0c,667f776b-e088-4ab4-bade-bc4885b3f7eb,8747c5dd-3dfe-4f40-baea-7566a43f950b,a7b1a529-e19c-44d0-a7e0-608db7f60222,b4b362bf-56df-4dc7-9ccf-1b6d10fcf715,ca60339e-767d-4209-9c4f-1b49f8bf0c1c,cae43f5c-bf64-40e2-9cfc-74f34a9a4753,dcf50520-dc91-4b00-aef8-282d9ab4f8fd,dd997705-23d5-492e-8dec-b68c1e7e315b,e298d940-9f2a-4f73-b8f5-68ea1eecd6e8,f5c31597-5542-4f21-9f5d-27cc11d7b623',',')::uuid[]);
UPDATE public.entities
SET metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('boyd_excluded',true,'boyd_reconcile_tag','boyd_owner_reconcile_2026_07_25')
WHERE id = ANY (string_to_array('0463f140-d810-4b7e-b619-aacb86b2617f,5b5ab84e-bd2d-4e88-a4aa-ae2cac50f7d1,a5939834-acfe-4232-b561-19b9e4a229d7',',')::uuid[]);

-- 10. Refresh the load-bearing caches
SELECT public.lcc_refresh_buyer_spe_resolved();
SELECT public.lcc_refresh_priority_queue_resolved();

-- 11. Inverse rollback (soft-merge model; deep backref reversal via r40_merge_reconcile_backup)
CREATE OR REPLACE FUNCTION public.lcc_boyd_reconcile_rollback(p_batch_tag text DEFAULT 'boyd_owner_reconcile_2026_07_25')
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v_unmerged int:=0; v_pat int:=0; v_edge int:=0; v_alias int:=0; v_reviewed int:=0; v_meta int:=0; v_parent_restored int:=0;
BEGIN
  UPDATE public.entities e SET merged_into_entity_id=NULL
  FROM public.lcc_boyd_reconcile_2026_07 l
  WHERE l.batch_tag=p_batch_tag AND l.op IN ('dedupe','merge_parent') AND e.id=l.entity_id;
  GET DIAGNOSTICS v_unmerged = ROW_COUNT;
  DELETE FROM public.lcc_operator_affiliate_patterns p USING public.lcc_boyd_reconcile_2026_07 l
  WHERE l.batch_tag=p_batch_tag AND l.op='attach_pattern' AND p.pattern_id=(l.prior->>'pattern_id')::uuid;
  GET DIAGNOSTICS v_pat = ROW_COUNT;
  DELETE FROM public.entity_relationships r USING public.lcc_boyd_reconcile_2026_07 l
  WHERE l.batch_tag=p_batch_tag AND l.op='jv_edge' AND r.id=(l.prior->>'rel_id')::uuid;
  GET DIAGNOSTICS v_edge = ROW_COUNT;
  DELETE FROM public.entity_aliases a USING public.lcc_boyd_reconcile_2026_07 l
  WHERE l.batch_tag=p_batch_tag AND l.op='alias_add' AND a.id=(l.prior->>'alias_id')::uuid;
  GET DIAGNOSTICS v_alias = ROW_COUNT;
  DELETE FROM public.lcc_owner_parent_reviewed
  WHERE source_domain='gov' AND cluster_token IN ('fgf','sgf','boyd_gsa','boyd_named')
    AND disposition='attach' AND parent_entity_id='78bc96e4-e719-4b56-8656-ed7bb4797012';
  GET DIAGNOSTICS v_reviewed = ROW_COUNT;
  UPDATE public.entities e SET metadata = coalesce((l.prior->'metadata')::jsonb,'{}'::jsonb)
  FROM public.lcc_boyd_reconcile_2026_07 l
  WHERE l.batch_tag=p_batch_tag AND l.op='pre_state' AND e.id=l.entity_id
    AND (e.metadata ? 'boyd_quarantine' OR e.metadata ? 'boyd_excluded');
  GET DIAGNOSTICS v_meta = ROW_COUNT;
  UPDATE public.entities e
  SET name=l.prior->>'name', canonical_name=l.prior->>'canonical_name',
      entity_type=(l.prior->>'entity_type')::public.entity_type, owner_role=l.prior->>'owner_role'
  FROM public.lcc_boyd_reconcile_2026_07 l
  WHERE l.batch_tag=p_batch_tag AND l.op='parent_rename' AND e.id=l.entity_id;
  GET DIAGNOSTICS v_parent_restored = ROW_COUNT;
  PERFORM public.lcc_refresh_buyer_spe_resolved();
  PERFORM public.lcc_refresh_priority_queue_resolved();
  RETURN jsonb_build_object('unmerged',v_unmerged,'patterns_deleted',v_pat,'jv_edges_deleted',v_edge,
    'aliases_deleted',v_alias,'reviewed_deleted',v_reviewed,'metadata_restored',v_meta,'parent_restored',v_parent_restored,
    'note','moved backrefs remain in r40_merge_reconcile_backup for deep restoration');
END; $fn$;
