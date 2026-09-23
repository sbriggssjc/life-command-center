// api/_shared/own-firm-addresses.js
//
// Guard against creating property records at the firm's OWN office /
// signature addresses (the 6120 S Yale Ave case: 11 dia properties + 3 active
// listings in May, an LCC asset entity in June, a gov Available listing on
// 2026-09-22 — GOV-AVAIL1). The list and the matcher now live in
// intake-address-guard.js so the sidebar writer and the OM intake chain share
// ONE list; add an office there (BUILTIN_BROKERAGE_OFFICES), or add another
// brokerage's office to LCC Opps lcc_brokerage_office_address.
export { OWN_FIRM_ADDRESSES, isOwnFirmAddress } from './intake-address-guard.js';
