-- SALE-PROMOTER1 (2026-09-25): record of the live dia runs. Every statement here was run live, in
-- this order, and each is safe to re-run (a re-run writes nothing).
--
-- 1. Stage the CoStar-sidebar sales the domain did not have. Source: LCC Opps entities.metadata.sales_history
--    for every dia asset with an open listing (437 properties), rows dated on/after 2024-09-25 that carry a
--    price, a party or a recording fact (17 of 58; the other 41 were date-only and would be refused anyway).
--    The loader query is in docs/audits/SALE_PROMOTER1_2026-09-25.md §4.
insert into dia_sidebar_sale_candidate (entity_id,row_key,property_id,sale_date,sale_price,buyer,seller,sale_type,deed_type,document_number,recordation_date,comp_status,price_status,raw) values
('671e79cc-0fa4-42ee-81b2-28e16d9fac32'::uuid,'2:e641b5a70adf02de18ed1875886e8cea',23313,'2024-11-27'::date,null,'MARLO FREDERICKSBURG LLC; CF FREDERICKSBURG LLC','150 SPEAR STREET ASSOCIATES LP','Arms Length / Resale','Special Warranty Deed','2024.451527','2024-12-04'::date,'Research Complete',null,jsonb_build_object('sale_condition',null,'transaction_type','Resale','source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('671e79cc-0fa4-42ee-81b2-28e16d9fac32'::uuid,'4:9637c0d5cf623fc4ecd11faaa0b26ed5',23313,'2024-12-10'::date,null,'Undisclosed','IRFGST-FREDERICKSBURG LLC','Arms Length / Resale','Special Warranty Deed','2025.6327','2025-01-07'::date,null,null,jsonb_build_object('sale_condition',null,'transaction_type','Resale','source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('21efe145-5237-416c-a24f-d1664251d464'::uuid,'1:4a7c2fffe2a5faf3ebd8aeee63f47f7d',26865,'2025-07-10'::date,5000000,'NSP WEST POINT LLC','WEST POINT SQUARE LLC','Investment / Resale w/Financing','Bargain & Sale Deed','2025.1526','2025-07-10'::date,'Research Complete','Confirmed',jsonb_build_object('sale_condition',null,'transaction_type','Resale w/Financing','source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('88e414e8-32d8-40c9-921b-98bb694ac943'::uuid,'1:cc33cb012709bd412aa0e8033ae2c2f8',27823,'2026-07-29'::date,1600000,null,null,'Owner User',null,null,null::date,'In Progress','Confirmed',jsonb_build_object('sale_condition',null,'transaction_type',null,'source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('146dd426-e3dd-474a-a480-8c2904fe8248'::uuid,'1:52918abe31e7a95157ad0675bccc1765',28981,'2026-03-06'::date,2200000,'LAKE COMO INVESTMENT LLC','SALTER PATH CAMP GROUND INC','Investment / Resale w/Financing','Warranty Deed','2026.1965','2026-03-11'::date,'Research Complete','Confirmed',jsonb_build_object('sale_condition',null,'transaction_type','Resale w/Financing','source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('146dd426-e3dd-474a-a480-8c2904fe8248'::uuid,'2:d3857e44fe8a40eb73f5199ae36b241e',28981,'2026-03-06'::date,1326851,'SALTER PATH CAMP GROUND INC','NRA DEVELOPMENT LLC','Arms Length / Resale','Deed',null,'2006-05-24'::date,null,null,jsonb_build_object('sale_condition',null,'transaction_type','Resale','source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('a1b4b12f-07dc-4518-9696-aa2fd3a86002'::uuid,'1:e4aa69e048e6ed72ab9c0404f9c01a6f',35803,'2025-07-16'::date,4300000,null,null,'Investment',null,null,null::date,'Research Complete','Confirmed',jsonb_build_object('sale_condition',null,'transaction_type',null,'source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('a1b4b12f-07dc-4518-9696-aa2fd3a86002'::uuid,'3:9cf8f54ad7e05457855dabf87ea1d7ef',35803,'2025-07-10'::date,4200000,'EASTCHESTER OWNER LLC; EASTCHESTER POP LLC','FRAN-ANG REALTY CORP','Arms Length / Resale w/Financing','Deed','2025.195301','2025-07-24'::date,'Research Complete','Confirmed',jsonb_build_object('sale_condition',null,'transaction_type','Resale w/Financing','source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('647da67e-a8ba-4884-ae24-512ea822cc2d'::uuid,'1:baf96ec719ba8ec9041bd001ae46734c',35815,'2024-10-10'::date,1500000,'CASH MEMORIAL ASSOCIATES LLC','NINETEEN TWENTY NINE 32ND AVENUE LLC','Investment / Resale','Warranty Deed','2024.97385','2024-10-11'::date,'Research Complete','Full Value',jsonb_build_object('sale_condition',null,'transaction_type','Resale','source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('932d0350-b206-4508-95e6-661697a9c802'::uuid,'1:0801f8560cd119ba5715ca7d9db9fc5e',37696,'2026-08-10'::date,4100000,null,null,'Investment / Investment Triple Net',null,null,null::date,'Research Complete','Confirmed',jsonb_build_object('sale_condition','Investment Triple Net','transaction_type',null,'source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('4aeffe5a-8ba6-4b43-90b8-3391c9d44975'::uuid,'1:07aceb8c170d195db7cd128772269cb1',44545,'2025-04-24'::date,null,'Undisclosed','R & J FIMMEL FAMILY TRUST','Non-Arms Length/Purchase / Nominal','Deed','2025.220967','2025-05-01'::date,'Public Record',null,jsonb_build_object('sale_condition',null,'transaction_type','Nominal','source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('4aa4dc0d-ead2-4d8e-9cfd-d714e76fd656'::uuid,'1:fcd9b074b5aee9dc359b191b8f3d6c32',44713,'2025-01-02'::date,null,'ME ASSOCIATES LP','2019 MK & ASSOCIATES LLC','Investment / Resale w/Financing','Special Warranty Deed','2025.240','2025-01-03'::date,'Research Complete',null,jsonb_build_object('sale_condition',null,'transaction_type','Resale w/Financing','source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('4aa4dc0d-ead2-4d8e-9cfd-d714e76fd656'::uuid,'2:745c414cef887cf74903dc4e49711059',44713,'2024-10-31'::date,null,'2019 M K & ASSOCIATES LLC','2017 GK ASSOCIATES LLC','Arms Length / Resale','Warranty Deed','2024.30041','2024-11-01'::date,'Research Complete',null,jsonb_build_object('sale_condition',null,'transaction_type','Resale','source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('6799d78c-501f-46de-b638-27a6438253ff'::uuid,'1:e110843fd9e30511c05c4e62dcc86f34',45366,'2026-06-11'::date,null,'SG MORTGAGE FINANCE CORP','MM MONA LLC','Arms Length / Resale w/Financing','Special Warranty Deed','2026.2609','2026-06-15'::date,'Public Record',null,jsonb_build_object('sale_condition',null,'transaction_type','Resale w/Financing','source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('ed127bd4-539c-4d99-ab37-59ddd261b92f'::uuid,'1:7a18ec7107e57b49136d26ffa49985d1',51216,'2026-06-08'::date,9750000,null,null,'Investment',null,null,null::date,'Research Complete','Confirmed',jsonb_build_object('sale_condition',null,'transaction_type',null,'source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('ed127bd4-539c-4d99-ab37-59ddd261b92f'::uuid,'6:be096b96c761b56db7f8310c9a4876e8',51216,'2026-05-22'::date,9750000,'BREP 16TH STREET LLC','CENTRES SF LLC','Arms Length / Resale w/Financing','Grant Deed','2026.55208','2026-06-08'::date,null,null,jsonb_build_object('sale_condition',null,'transaction_type','Resale w/Financing','source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25')),
('1aa34371-4b36-4048-b130-f3f7f5dcd5e1'::uuid,'1:ab1c022b3af48489ae6223769374a911',51247,'2026-09-10'::date,null,'SG MORTGAGE FINANCE CORP','HOMESTRETCH PROPERTIES LLC','Arms Length / Resale w/Financing','Special Warranty Deed',null,'2026-09-11'::date,'Public Record',null,jsonb_build_object('sale_condition',null,'transaction_type','Resale w/Financing','source','lcc_entities.metadata.sales_history','loaded_by','SALE-PROMOTER1 2026-09-25'))
on conflict (entity_id,row_key) do nothing;
-- 2. Promotion run:  select * from dia_promote_market_sales(false, null, null, 'sale_promoter1_20260925');
--    promoted_market      24483 (SF, 2026-09-02 $2,175,000)          -> listing 9016 closed (close_sold_after_seen)
--    promoted_market      25203 (SF, 2026-04-21 $4,375,000)          -> no open listing
--    promoted_market      28981 Manchester (SF, 2026-03-06 $2.2M)    -> listing 14319 closed (close_sold_shortly_before_capture)
--    promoted_market      35803 Bronx (sidebar deed, 2025-07-10 $4.2M) -> listing 11949 has no capture date
--                         (keep_undated) -> review_promoted_sale_listing_open
--    promoted_non_market  27823 Durham (sidebar owner-user 2026-07-29 $1.6M) -> excluded from market metrics;
--                         listing 14756 -> review_non_market_sale
--    refuse_sale_on_other_property (review queued for the open listing):
--                         25570 Oak Forest -> sale 14875 on 38853 "5340 159th St"
--                         37696 Kissimmee  -> sale 14880 on 37624 "802 N John Young Pky"
--                         24669 (SF, same Kissimmee sale 14880)
--                         35815 -> sale 15136
--    refuse_priceless_transfer 8, refuse_existing_sale_within_30d 16, refuse_date_only 6,
--    refuse_date_inconsistent 1 (Manchester's second sidebar row: sale 2026-03-06, recorded 2006-05-24),
--    refuse_existing_same_price 1, refuse_property_unmatched 1.
--    Undo: select dia_restore_sale_promote('sale_promoter1_20260925');
--
-- 3. Second run: 0 promoted; two sibling candidates relabelled refuse_duplicate_candidate ->
--    refuse_existing_sale_within_30d (the sale they duplicated now exists). Third run: 0 promoted, 0 log changes.
--
-- 4. Stale-rule release: select count(*) from dia_release_stale_listings_rekeyed(false);  -> 39 released.
--    Listings in the stale lane: 65 -> 26 (all listed_over_2y). Dia's restore branches on action, so
--    status was untouched (NULL status 0; active 438).
