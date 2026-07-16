"""BOV MOB — Tab 11: Amortization Schedule.

Identical structure to the NNN version — all debt parameters come from
the same right-column Assumptions & Flags cell addresses (I8, I10, I11, I13, I14, I15).
"""
# Re-use the NNN amortization builder; both templates reference the same cell addresses.
from bov_tabs_10_amortization import build_amortization_tab as _build_amort


def build_mob_amortization_tab(wb):
    _build_amort(wb)
