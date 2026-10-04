"""The 30 countries local news starts with: regional spread and strong national press.

Each entry: ISO3 → (name, awesome-rss-feeds file name or None). Countries without an
awesome-rss file wait for another directory (Media Cloud / Wikidata).
"""

COUNTRIES: dict[str, tuple[str, str | None]] = {
    # Americas
    "USA": ("United States", "United States"),
    "CAN": ("Canada", "Canada"),
    "MEX": ("Mexico", "Mexico"),
    "BRA": ("Brazil", "Brazil"),
    "ARG": ("Argentina", None),
    "COL": ("Colombia", None),
    "CHL": ("Chile", None),
    # Europe
    "GBR": ("United Kingdom", "United Kingdom"),
    "IRL": ("Ireland", "Ireland"),
    "FRA": ("France", "France"),
    "DEU": ("Germany", "Germany"),
    "ESP": ("Spain", "Spain"),
    "ITA": ("Italy", "Italy"),
    "NLD": ("Netherlands", None),
    "POL": ("Poland", "Poland"),
    "UKR": ("Ukraine", "Ukraine"),
    "TUR": ("Turkey", None),
    # Africa
    "NGA": ("Nigeria", "Nigeria"),
    "ZAF": ("South Africa", "South Africa"),
    "KEN": ("Kenya", None),
    "EGY": ("Egypt", None),
    # Asia and the Middle East
    "IND": ("India", "India"),
    "PAK": ("Pakistan", "Pakistan"),
    "PHL": ("Philippines", "Philippines"),
    "IDN": ("Indonesia", "Indonesia"),
    "JPN": ("Japan", "Japan"),
    "KOR": ("South Korea", None),
    "ISR": ("Israel", None),
    # Oceania
    "AUS": ("Australia", "Australia"),
    "NZL": ("New Zealand", None),
}

PUBLISHERS_PER_COUNTRY = 10
