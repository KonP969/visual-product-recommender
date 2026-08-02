// Polska liczba mnoga ma trzy formy, a "nastki" są wyjątkiem: 4 warianty,
// ale 14 wariantów. Zwijanie wariantów potrafi dać dowolną liczbę, więc
// reguła musi być pełna, nie "do czterech".
export function warianty(n: number): string {
  const ostatnia = n % 10
  const dwieOstatnie = n % 100
  const forma =
    ostatnia >= 2 && ostatnia <= 4 && !(dwieOstatnie >= 12 && dwieOstatnie <= 14)
      ? 'warianty'
      : 'wariantów'
  return `${n} ${forma}`
}
