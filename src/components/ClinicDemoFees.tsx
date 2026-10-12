const rp = (value: number) => `Rp ${Math.round(value).toLocaleString("id-ID")}`;
export type DemoFeeSnapshot = {
  fee_bearer: string; fee_amount: number;
  payments: {method: string;amount: number;fee: number;gross: number;net: number}[];
};
export function ClinicDemoFees({snapshot}: {snapshot: DemoFeeSnapshot | null}) {
  if (!snapshot) return null;
  return <div style={{marginTop:8,fontSize:11}}>
    <b>Rincian admin DEMO</b>
    <div>Admin {snapshot.fee_bearer === "customer" ? "pelanggan" : "ditanggung perusahaan"}: {rp(Number(snapshot.fee_amount))}</div>
    {snapshot.payments.map((part,index)=><div key={index}>{snapshot.fee_bearer==="customer"
      ? `${part.method}: dasar ${rp(Number(part.amount))} + admin pelanggan ${rp(Number(part.fee))} = ${rp(Number(part.gross))}`
      : `${part.method}: pelanggan ${rp(Number(part.gross))}, admin perusahaan ${rp(Number(part.fee))}, penerimaan bersih ${rp(Number(part.net))}`}</div>)}
  </div>;
}
