// Liczba wariantów na karcie liczy tylko te w TYM katalogu — a katalog bywa
// niepełnym podzbiorem prawdziwej oferty na porta.com.pl (konfigurator
// potrafi mieć wielokrotnie więcej kolorów niż zaimportowaliśmy z feedu).
// Dokładna liczba więc czasem kłamie i nie zgadza się z konfiguratorem;
// opisowe kubełki ("kilka"/"wiele") nie obiecują precyzji, której nie mamy.
export function wariantyOpisowo(n: number): string {
  return n >= 5 ? 'wiele wariantów' : 'kilka wariantów'
}
