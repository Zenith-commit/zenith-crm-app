export function calcPriceIncGst(costIncGst, markupPct) {
  return costIncGst * (1 + markupPct / 100)
}

export function calcTotalIncGst(costIncGst, markupPct, qty) {
  return calcPriceIncGst(costIncGst, markupPct) * qty
}

export function calcBundleTotals(items) {
  const totalCost = items.reduce((sum, item) => sum + (item.purchase_cost ?? 0) * item.default_qty, 0)
  const totalPrice = items.reduce(
    (sum, item) =>
      sum + calcTotalIncGst(item.purchase_cost ?? 0, item.default_markup_pct, item.default_qty),
    0
  )
  const totalMarkupDollar = totalPrice - totalCost
  const totalMarkupPct = totalCost === 0 ? 0 : (totalMarkupDollar / totalCost) * 100
  return { totalCost, totalPrice, totalMarkupDollar, totalMarkupPct }
}
