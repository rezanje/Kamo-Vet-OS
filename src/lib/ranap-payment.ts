export type RanapPaymentAccount = { method: string; code: string; name: string; bank: string | null; number: string | null };
export type RanapPaymentQuote = { token: string; remaining: number; amount: number; excess: number; credit: number; pending: number; debt: number; subtotal: number; tax: number; accounts: RanapPaymentAccount[] };
export type RanapPaymentState = { status: "SAVED"; href: string } | { status: "ERROR"; error: string } | { status: "OVERPAYMENT_CONFIRM_REQUIRED"; quote: RanapPaymentQuote };
