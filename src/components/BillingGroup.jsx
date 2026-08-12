export default function BillingGroup({ title, items, isStaff }) {
  const groupTotal = isStaff ? items.reduce((sum, item) => sum + (item.total_inc_gst ?? 0), 0) : null

  return (
    <details open>
      <summary>
        {title}
        {isStaff && ` — $${groupTotal.toFixed(2)}`}
      </summary>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            {isStaff && <th>Markup %</th>}
            {isStaff && <th>Price (inc. GST)</th>}
            {isStaff && <th>Total (inc. GST)</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.item_name_snapshot}</td>
              <td>{item.qty}</td>
              {isStaff && <td>{item.markup_pct}</td>}
              {isStaff && <td>${item.price_inc_gst.toFixed(2)}</td>}
              {isStaff && <td>${item.total_inc_gst.toFixed(2)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
