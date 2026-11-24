export function normalizeBrazilianPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0") && [11, 12].includes(digits.length))
    digits = digits.slice(1);
  if ([10, 11].includes(digits.length)) digits = "55" + digits;
  if (!/^55[1-9]\d{9,10}$/.test(digits)) return null;
  return digits;
}

export function whatsappLink(value) {
  const phone = normalizeBrazilianPhone(value);
  return phone ? `https://wa.me/${phone}` : null;
}

export function phoneLink(value) {
  const phone = normalizeBrazilianPhone(value);
  return phone ? `tel:+${phone}` : null;
}
