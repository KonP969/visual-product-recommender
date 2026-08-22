# Buduje opublikowalna wersje wizytowki z docs/case-study.html.
#
# Po co: zrodlo trzyma obrazek jako sciezke wzgledna (assets/screenshot.jpg),
# zeby dalo sie je wygodnie edytowac i otwierac wprost w przegladarce.
# Opublikowana strona musi byc samowystarczalna - CSP po stronie hostingu
# blokuje odwolania do zewnetrznych plikow - wiec przed wyslaniem obrazek
# trzeba wkleic do HTML-a jako data URI.
#
# Uruchomienie:
#   python scripts/build_case_study.py
# Wynik:
#   docs/case-study.build.html  (plik tymczasowy, jest w .gitignore)

import base64
import pathlib
import re
import sys

KORZEN = pathlib.Path(__file__).resolve().parent.parent
ZRODLO = KORZEN / "docs" / "case-study.html"
WYNIK = KORZEN / "docs" / "case-study.build.html"


def main() -> int:
    if not ZRODLO.exists():
        print(f"[BUILD] Brak zrodla: {ZRODLO}")
        return 1

    html = ZRODLO.read_text(encoding="utf-8")

    # Kazde odwolanie do assets/<plik> zamieniamy na data URI.
    def wklej(dopasowanie: re.Match) -> str:
        nazwa = dopasowanie.group(1)
        plik = ZRODLO.parent / "assets" / nazwa
        if not plik.exists():
            print(f"[BUILD] UWAGA: brak pliku {plik}, zostawiam sciezke bez zmian")
            return dopasowanie.group(0)
        typ = "image/jpeg" if plik.suffix.lower() in (".jpg", ".jpeg") else "image/png"
        dane = base64.b64encode(plik.read_bytes()).decode()
        print(f"[BUILD] Wklejono {nazwa} ({plik.stat().st_size // 1024} KB)")
        return f"data:{typ};base64,{dane}"

    html, ile = re.subn(r'assets/([A-Za-z0-9_.-]+\.(?:jpg|jpeg|png))', wklej, html)

    WYNIK.write_text(html, encoding="utf-8")
    print(f"[BUILD] Obrazkow wklejonych: {ile}")
    print(f"[BUILD] Gotowe: {WYNIK} ({len(html.encode('utf-8')) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
