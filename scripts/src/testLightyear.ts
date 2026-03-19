import Papa from "papaparse";

const content = `"Date","Reference","Ticker","ISIN","Type","Quantity","CCY","Price/share","Gross Amount","FX Rate","Fee","Net Amt.","Tax Amt."
"21/01/2026 14:31:30","OR-JHFE3Y68FE","DAWN","US23954D1090","Buy","4.000000000","USD","12.660000000","50.74","","0.10","50.64",""
"20/01/2026 19:26:58","OR-SX9YSVKRYV","APPS","US25400W1027","Buy","5.000000000","USD","5.459500000","27.40","","0.10","27.30",""`;

const result = Papa.parse(content, {
  header: true,
  skipEmptyLines: true,
  transformHeader: (h) => h.trim().replace(/^"|"$/g, ""),
});

console.log("Headers:", result.meta.fields);
console.log("Row 0 keys:", Object.keys(result.data[0] as object));
console.log("Row 0 Type:", (result.data[0] as Record<string,string>)["Type"]);
console.log("Row 0 Ticker:", (result.data[0] as Record<string,string>)["Ticker"]);
