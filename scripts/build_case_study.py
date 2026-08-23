# Buduje opublikowalne wersje wizytowki z docs/case-study*.html.
#
# Po co: zrodla trzymaja obrazek jako sciezke wzgledna (assets/screenshot.jpg),
# zeby dalo sie je wygodnie edytowac i otwierac wprost w przegladarce.
# Opublikowana strona musi byc samowystarczalna - CSP po stronie hostingu
# blokuje odwolania do zewnetrznych plikow - wiec przed wyslaniem obrazek
# trzeba wkleic do HTML-a jako data URI.
#
# Dwie wersje jezykowe:
#   docs/case-study.html      polska, zrodlo tresci
#   docs/case-study.en.html   angielska, ta idzie na LinkedIn
#
# Uruchomienie:
#   python scripts/build_case_study.py           # obie wersje
#   python scripts/build_case_study.py en        # tylko angielska
# Wynik:
#   docs/case-study.build.html
#   docs/case-study.en.build.html
# (pliki tymczasowe, sa w .gitignore)

import base64
import pathlib
import re
import sys

KORZEN = pathlib.Path(__file__).resolve().parent.parent
DOCS = KORZEN / "docs"

WERSJE = {
    "pl": (DOCS / "case-study.html", DOCS / "case-study.build.html"),
    "en": (DOCS / "case-study.en.html", DOCS / "case-study.en.build.html"),
}


def wklej_obrazki(html: str, katalog: pathlib.Path) -> tuple[str, int]:
    """Zamienia kazde odwolanie do assets/<plik> na data URI."""

    def podmien(dopasowanie: re.Match) -> str:
        nazwa = dopasowanie.group(1)
        plik = katalog / "assets" / nazwa
        if not plik.exists():
            print(f"[BUILD] UWAGA: brak pliku {plik}, zostawiam sciezke bez zmian")
            return dopasowanie.group(0)
        typ = "image/jpeg" if plik.suffix.lower() in (".jpg", ".jpeg") else "image/png"
        dane = base64.b64encode(plik.read_bytes()).decode()
        print(f"[BUILD]   wklejono {nazwa} ({plik.stat().st_size // 1024} KB)")
        return f"data:{typ};base64,{dane}"

    return re.subn(r"assets/([A-Za-z0-9_.-]+\.(?:jpg|jpeg|png))", podmien, html)


def main() -> int:
    wybrane = sys.argv[1:] or list(WERSJE)
    nieznane = [w for w in wybrane if w not in WERSJE]
    if nieznane:
        print(f"[BUILD] Nieznana wersja: {', '.join(nieznane)}. Dostepne: {', '.join(WERSJE)}")
        return 1

    blad = 0
    for jezyk in wybrane:
        zrodlo, wynik = WERSJE[jezyk]
        if not zrodlo.exists():
            print(f"[BUILD] {jezyk}: brak zrodla {zrodlo}")
            blad = 1
            continue
        print(f"[BUILD] {jezyk}: {zrodlo.name}")
        html, ile = wklej_obrazki(zrodlo.read_text(encoding="utf-8"), DOCS)
        wynik.write_text(html, encoding="utf-8")
        print(f"[BUILD]   gotowe: {wynik.name} ({len(html.encode('utf-8')) // 1024} KB, obrazkow: {ile})")

    return blad


if __name__ == "__main__":
    sys.exit(main())
