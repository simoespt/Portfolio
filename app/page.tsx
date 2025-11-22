"use client";

import React, { useMemo, useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Loader2, AlertTriangle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

const stooqHistUrl = (sym: string) =>
  `/api/stooq?path=${encodeURIComponent(`/q/d/l/?s=${sym.toLowerCase()}&i=d`)}`;

const stooqQuoteUrl = (syms: string[]) =>
  `/api/stooq?path=${encodeURIComponent(
    `/q/l/?s=${syms.map((s) => s.toLowerCase()).join(",")}&f=sd2t2ohlcv&h=e`
  )}`;

const STQUOTES_COLS = ["Symbol", "Date", "Time", "Open", "High", "Low", "Close", "Volume"] as const;

const asNum = (v: any) => {
  if (v == null) return NaN;
  const s = String(v).trim();
  if (!s || s === "N/D" || s.toUpperCase() === "NAN") return NaN;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

type QuoteRow = Record<string, string>;
type DailyRow = { Date: string; Open: string; High: string; Low: string; Close: string; Volume: string };

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",");
  return lines
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(",");
      const row: Record<string, string> = {};
      headers.forEach((h, i) => (row[h] = cells[i]));
      return row;
    });
}

function fmt(n: number | string | undefined, d = 2) {
  if (n == null || Number.isNaN(n as any)) return "–";
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function pct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n as any)) return "–";
  return `${((n as number) * 100).toFixed(2)}%`;
}

function normalizeTicker(t: string) {
  const sym = (t || "").trim().toUpperCase();
  return sym.includes(".") ? sym : `${sym}.US`;
}

// eventos de mercado para educar as pessoas
const MARKET_EVENTS = [
  {
    id: "dotcom",
    name: "Bolha dot-com",
    startMonth: "2000-03",
    endMonth: "2002-10",
  },
  {
    id: "gfc",
    name: "Crise financeira 2008",
    startMonth: "2007-10",
    endMonth: "2009-03",
  },
  {
    id: "covid",
    name: "Crash COVID-19",
    startMonth: "2020-02",
    endMonth: "2020-04",
  },
  {
    id: "inflation2022",
    name: "Bear market inflação 2022",
    startMonth: "2021-11",
    endMonth: "2022-10",
  },
] as const;

type MarketEventPerf = {
  id: string;
  name: string;
  startMonth: string;
  endMonth: string;
  startValue: number | null;
  endValue: number | null;
  absChange: number | null;
  pctChange: number | null;
  maxDrawdown: number | null;
  troughMonth: string | null;
  recoveryMonth: string | null;
  monthsToRecoveryFromStart: number | null;
  monthsToRecoveryFromTrough: number | null;
};

function monthsBetween(a: string, b: string) {
  // a e b no formato "YYYY-MM"
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

// Debounce simples para autocomplete
function useDebouncedCallback<T extends (...args: any[]) => any>(fn: T, delay = 250) {
  const [t, setT] = React.useState<any>(null);
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    const id = setTimeout(() => fn(...args), delay);
    setT(id);
  };
}

async function fetchHistoricalCloseOnOrAfter(symbol: string, ymd: string) {
  const res = await fetch(stooqHistUrl(symbol));
  if (!res.ok) throw new Error(`Hist fetch failed for ${symbol}`);
  const rows = parseCSV(await res.text()) as unknown as DailyRow[];
  const target = rows.find((r) => r.Date >= ymd);
  if (!target) throw new Error(`No trading day on/after ${ymd} for ${symbol}`);
  return { dateUsed: target.Date, close: parseFloat(target.Close), allRows: rows };
}

async function fetchLatestQuotes(symbols: string[]) {
  const res = await fetch(stooqQuoteUrl(symbols));
  if (!res.ok) throw new Error("Quote fetch failed");
  const rows = parseCSV(await res.text()) as QuoteRow[];
  const map = new Map<string, { close: number; raw: QuoteRow }>();
  rows.forEach((r) => {
    const sym = (r[STQUOTES_COLS[0]] || "").toUpperCase();
    const close = asNum(r[STQUOTES_COLS[6]]);
    map.set(sym, { close, raw: r });
  });
  return map;
}

async function fetchEURUSD() {
  const res = await fetch(stooqQuoteUrl(["EURUSD"]));
  if (!res.ok) throw new Error("FX fetch failed");
  const rows = parseCSV(await res.text());
  const close = parseFloat(rows[0][STQUOTES_COLS[6]]);
  return close; // USD por EUR
}

function groupByMonthEnd(rows: DailyRow[], startDateYmd?: string) {
  const byMonth = new Map<string, DailyRow>();
  for (const r of rows) {
    if (startDateYmd && r.Date < startDateYmd) continue;
    const m = r.Date.slice(0, 7);
    byMonth.set(m, r); // último dia desse mês
  }
  return Array.from(byMonth.entries()).map(([m, r]) => ({ month: m, close: parseFloat(r.Close) }));
}

type Row = { id: number; ticker: string; amount: number; currency: "USD" | "EUR"; date: string };
type Suggestion = { symbol: string; name: string; exchange: string; type: string };

export default function Page() {
  const [rows, setRows] = useState<Row[]>([
    { id: 1, ticker: "NVDA", amount: 1000, currency: "EUR", date: "2000-01-05" },
    { id: 2, ticker: "MSFT", amount: 1000, currency: "EUR", date: "2000-01-05" },
    { id: 3, ticker: "GOOGL", amount: 1000, currency: "EUR", date: "2004-08-19" },
  ]);
  const [useEur, setUseEur] = useState(true);
  const [fx, setFx] = useState<number | null>(null); // USD por EUR
  const [calc, setCalc] = useState<{ loading: boolean; results: any[] }>({ loading: false, results: [] });
  const [error, setError] = useState("");
  const [dropThresholdPct, setDropThresholdPct] = useState<number>(15);
  const [dropsLoading, setDropsLoading] = useState(false);
  const [monthlySeries, setMonthlySeries] = useState<{ month: string; valueUSD: number; mom: number | null }[]>([]);
  const [bigDrops, setBigDrops] = useState<{ month: string; valueUSD: number; mom: number }[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [showAll, setShowAll] = useState(false);

  // Autocomplete
  const [suggestions, setSuggestions] = useState<Record<number, Suggestion[]>>({});
  const [openSugFor, setOpenSugFor] = useState<number | null>(null);

  const fetchSuggestions = useDebouncedCallback(async (id: number, q: string) => {
    if (!q || q.trim().length < 2) {
      setSuggestions((s) => ({ ...s, [id]: [] }));
      return;
    }
    try {
      const r = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`);
      const data: Suggestion[] = await r.json();
      setSuggestions((s) => ({ ...s, [id]: data || [] }));
      setOpenSugFor(id);
    } catch {
      setSuggestions((s) => ({ ...s, [id]: [] }));
    }
  }, 250);

  useEffect(() => {
    setPage(1);
    setShowAll(false);
  }, [bigDrops, dropThresholdPct]);

  const symbols = useMemo(() => rows.map((r) => normalizeTicker(r.ticker)), [rows]);

  const handleChange = (id: number, key: keyof Row, val: any) => {
    setRows((old) =>
      old.map((r) => (r.id === id ? { ...r, [key]: key === "amount" ? Number(val) : val } : r))
    );
  };

  const addRow = () => {
    const nextId = (rows.at(-1)?.id ?? 0) + 1;
    setRows((old) => [
      ...old,
      { id: nextId, ticker: "", amount: 1000, currency: "EUR", date: "2015-01-02" },
    ]);
  };

  const removeRow = (id: number) => setRows((old) => old.filter((r) => r.id !== id));

  const calculate = async () => {
    setError("");
    setCalc({ loading: true, results: [] });
    try {
      const needFx = useEur || rows.some((x) => x.currency === "EUR");
      const [quoteMap, eurusd] = await Promise.all([
        fetchLatestQuotes(symbols),
        needFx ? fetchEURUSD() : Promise.resolve(null),
      ]);
      if (useEur && eurusd) setFx(eurusd);

      const results: any[] = [];
      for (const r of rows) {
        const symbol = normalizeTicker(r.ticker);
        if (!r.ticker || !r.amount || !r.date) throw new Error("Preenche todos os campos.");

        const hist = await fetchHistoricalCloseOnOrAfter(symbol, r.date);

        const eurusdNow = eurusd ?? (useEur ? fx : null);
        const amountUSD =
          r.currency === "EUR"
            ? eurusdNow
              ? Number(r.amount) * eurusdNow
              : Number(r.amount)
            : Number(r.amount);
        const shares = amountUSD / hist.close;

        const last = quoteMap.get(symbol.toUpperCase());
        let curPrice = last?.close;
        if (!Number.isFinite(curPrice)) {
          const lastRow = (hist.allRows as any[]).at(-1);
          curPrice = asNum(lastRow?.Close);
        }
        const curValueUSD = shares * (curPrice ?? NaN);

        results.push({
          id: r.id,
          symbol,
          purchaseDateUsed: hist.dateUsed,
          purchaseClose: hist.close,
          amountInvested: amountUSD,
          amountOriginal: r.amount,
          currency: r.currency,
          shares,
          latestPrice: curPrice,
          currentValueUSD: curValueUSD,
        });
      }
      setCalc({ loading: false, results });
    } catch (e: any) {
      setCalc({ loading: false, results: [] });
      setError(e.message || String(e));
    }
  };

  const totals = useMemo(() => {
    const investedUSD = calc.results.reduce((s, r) => s + r.amountInvested, 0);
    const curUSD = calc.results.reduce((s, r) => s + r.currentValueUSD, 0);
    const investedOriginalEUR = calc.results.reduce(
      (s, r) => s + (r.currency === "EUR" ? Number(r.amountOriginal) : 0),
      0
    );
    const investedOriginalUSD = calc.results.reduce(
      (s, r) => s + (r.currency === "USD" ? Number(r.amountOriginal) : 0),
      0
    );
    const eurusd = fx;
    const curEUR = useEur && eurusd ? curUSD / eurusd : null;
    const plUSD = curUSD - investedUSD;
    const plPct = investedUSD > 0 ? (plUSD / investedUSD) * 100 : 0;
    return { investedUSD, investedOriginalEUR, investedOriginalUSD, curUSD, curEUR, plUSD, plPct };
  }, [calc.results, useEur, fx]);

  const yearExtremes = useMemo(() => {
    if (!monthlySeries || monthlySeries.length === 0) return [];

    const rate = fx; // USD por EUR
    const map = new Map<
      string,
      {
        year: string;
        minUSD: number;
        maxUSD: number;
        minMonth: string;
        maxMonth: string;
        minEUR: number | null;
        maxEUR: number | null;
      }
    >();

    for (const p of monthlySeries) {
      const year = p.month.slice(0, 4);
      const current = map.get(year);
      if (!current) {
        const minEUR = rate ? p.valueUSD / rate : null;
        const maxEUR = rate ? p.valueUSD / rate : null;
        map.set(year, {
          year,
          minUSD: p.valueUSD,
          maxUSD: p.valueUSD,
          minMonth: p.month,
          maxMonth: p.month,
          minEUR,
          maxEUR,
        });
      } else {
        if (p.valueUSD < current.minUSD) {
          current.minUSD = p.valueUSD;
          current.minMonth = p.month;
          current.minEUR = rate ? p.valueUSD / rate : current.minEUR;
        }
        if (p.valueUSD > current.maxUSD) {
          current.maxUSD = p.valueUSD;
          current.maxMonth = p.month;
          current.maxEUR = rate ? p.valueUSD / rate : current.maxEUR;
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => a.year.localeCompare(b.year));
  }, [monthlySeries, fx]);

  const eventPerformances = useMemo<MarketEventPerf[]>(() => {
    if (!monthlySeries || monthlySeries.length === 0) return [];

    return MARKET_EVENTS.map((ev) => {
      const inRange = monthlySeries.filter(
        (p) => p.month >= ev.startMonth && p.month <= ev.endMonth
      );

      if (inRange.length === 0) {
        return {
          id: ev.id,
          name: ev.name,
          startMonth: ev.startMonth,
          endMonth: ev.endMonth,
          startValue: null,
          endValue: null,
          absChange: null,
          pctChange: null,
          maxDrawdown: null,
          troughMonth: null,
          recoveryMonth: null,
          monthsToRecoveryFromStart: null,
          monthsToRecoveryFromTrough: null,
        };
      }

      const startValue = inRange[0].valueUSD;
      const endValue = inRange[inRange.length - 1].valueUSD;
      const absChange = endValue - startValue;
      const pctChange = startValue > 0 ? absChange / startValue : null;

      // max drawdown dentro do evento
      let peak = inRange[0].valueUSD;
      let peakMonth = inRange[0].month;
      let troughValue = inRange[0].valueUSD;
      let troughMonth = inRange[0].month;
      let worstDD = 0; // negativo

      for (const p of inRange) {
        if (p.valueUSD > peak) {
          peak = p.valueUSD;
          peakMonth = p.month;
        }
        if (peak > 0) {
          const dd = p.valueUSD / peak - 1;
          if (dd < worstDD) {
            worstDD = dd;
            troughValue = p.valueUSD;
            troughMonth = p.month;
          }
        }
      }

      // procurar recuperação depois do fundo, na série completa
      let recoveryMonth: string | null = null;
      const idxTrough = monthlySeries.findIndex((m) => m.month === troughMonth);
      if (idxTrough >= 0) {
        for (let i = idxTrough + 1; i < monthlySeries.length; i++) {
          if (monthlySeries[i].valueUSD >= peak) {
            recoveryMonth = monthlySeries[i].month;
            break;
          }
        }
      }

      let monthsFromStart: number | null = null;
      let monthsFromTrough: number | null = null;
      if (recoveryMonth != null) {
        monthsFromStart = monthsBetween(ev.startMonth, recoveryMonth);
        monthsFromTrough = monthsBetween(troughMonth, recoveryMonth);
      }

      return {
        id: ev.id,
        name: ev.name,
        startMonth: ev.startMonth,
        endMonth: ev.endMonth,
        startValue,
        endValue,
        absChange,
        pctChange,
        maxDrawdown: worstDD,
        troughMonth,
        recoveryMonth,
        monthsToRecoveryFromStart: monthsFromStart,
        monthsToRecoveryFromTrough: monthsFromTrough,
      };
    });
  }, [monthlySeries]);

  const computeMonthlyDrops = async () => {
    setError("");
    setDropsLoading(true);
    try {
      const perSymbol: {
        symbol: string;
        shares: number;
        monthSeries: { month: string; close: number }[];
      }[] = [];
      for (const r of rows) {
        const symbol = normalizeTicker(r.ticker);
        if (!r.ticker || !r.amount || !r.date) throw new Error("Preenche todos os campos.");
        const hist = await fetchHistoricalCloseOnOrAfter(symbol, r.date);
        const eurusdNow = fx;
        const amountUSD =
          r.currency === "EUR"
            ? eurusdNow
              ? Number(r.amount) * eurusdNow
              : Number(r.amount)
            : Number(r.amount);
        const shares = amountUSD / hist.close;
        const monthSeries = groupByMonthEnd(hist.allRows as any, r.date);
        perSymbol.push({ symbol, shares, monthSeries });
      }

      const allMonths = new Set<string>();
      perSymbol.forEach(({ monthSeries }) =>
        monthSeries.forEach((m) => allMonths.add(m.month))
      );
      const monthsSorted = Array.from(allMonths).sort();

      const portfolioSeries = monthsSorted
        .map((m) => {
          let v = 0;
          for (const s of perSymbol) {
            const rec = s.monthSeries.find((x) => x.month === m);
            if (rec) v += s.shares * rec.close;
          }
          return { month: m, valueUSD: v };
        })
        .filter((p) => p.valueUSD > 0);

      const withMoM = portfolioSeries.map((p, i) => {
        if (i === 0) return { ...p, mom: null as number | null };
        const prev = portfolioSeries[i - 1].valueUSD;
        const mom = prev > 0 ? p.valueUSD / prev - 1 : null;
        return { ...p, mom };
      });

      const threshold = -Math.abs(dropThresholdPct) / 100;
      const drops = withMoM.filter(
        (p) => p.mom != null && (p.mom as number) <= threshold
      ) as {
        month: string;
        valueUSD: number;
        mom: number;
      }[];

      setMonthlySeries(withMoM as any);
      setBigDrops(drops);
    } catch (e: any) {
      setError(e.message || String(e));
      setMonthlySeries([]);
      setBigDrops([]);
    } finally {
      setDropsLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(bigDrops.length / pageSize));
  const start = (page - 1) * pageSize;
  const end = Math.min(bigDrops.length, start + pageSize);

  return (
    <div className="min-h-screen w-full bg-white p-6">
      <div className="max-w-6xl mx-auto grid gap-6">
        <h1 className="text-3xl font-bold">Portfolio Valuator</h1>
        <p className="text-sm opacity-80">
          Insere tickers, montante investido (USD/EUR) e a data de compra. Vês o crescimento ao longo dos anos,
          as quedas grandes, os extremos anuais e o comportamento em grandes crises de mercado.
          A mensagem é simples:{" "}
          <strong>time in the market &gt; timing the market</strong>. Quedas de curto prazo não são sinal para fugir.
        </p>

        {/* INPUTS */}

        <Card className="shadow-lg rounded-2xl">
          <CardContent className="p-4">
            <div className="grid grid-cols-12 gap-3 items-center font-semibold text-sm pb-2 border-b">
              <div className="col-span-3">Ticker</div>
              <div className="col-span-2">Montante</div>
              <div className="col-span-1">Moeda</div>
              <div className="col-span-4">Data de Compra (YYYY-MM-DD)</div>
              <div className="col-span-2 text-right">
                <Button variant="secondary" onClick={addRow} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Adicionar
                </Button>
              </div>
            </div>

            {rows.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-12 gap-3 items-center py-2 border-b last:border-b-0"
              >
                <div className="col-span-3 relative">
                  <Label className="sr-only">Ticker</Label>
                  <Input
                    value={r.ticker}
                    onChange={(e) => {
                      const v = e.target.value;
                      handleChange(r.id, "ticker", v);
                      fetchSuggestions(r.id, v);
                    }}
                    onFocus={() => {
                      if ((suggestions[r.id]?.length || 0) > 0) setOpenSugFor(r.id);
                    }}
                    onBlur={() => setTimeout(() => setOpenSugFor(null), 150)}
                    placeholder="NVDA ou 'NVIDIA'"
                  />
                  {openSugFor === r.id && (suggestions[r.id]?.length || 0) > 0 && (
                    <div className="absolute z-20 mt-1 w-full rounded-xl border bg-white shadow-lg overflow-hidden">
                      {suggestions[r.id]!.map((sug) => (
                        <button
                          key={sug.symbol}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            handleChange(r.id, "ticker", sug.symbol);
                            setOpenSugFor(null);
                          }}
                        >
                          <div className="font-medium">
                            {sug.symbol}{" "}
                            <span className="opacity-60">• {sug.exchange}</span>
                          </div>
                          <div className="opacity-70">{sug.name}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="col-span-2">
                  <Label className="sr-only">Montante</Label>
                  <Input
                    type="number"
                    value={r.amount}
                    onChange={(e) => handleChange(r.id, "amount", e.target.value)}
                  />
                </div>

                <div className="col-span-1">
                  <Label className="sr-only">Moeda</Label>
                  <select
                    className="h-10 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                    value={r.currency}
                    onChange={(e) =>
                      handleChange(r.id, "currency", e.target.value as "USD" | "EUR")
                    }
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>

                <div className="col-span-4">
                  <Label className="sr-only">Data</Label>
                  <Input
                    value={r.date}
                    onChange={(e) => handleChange(r.id, "date", e.target.value)}
                    placeholder="YYYY-MM-DD"
                  />
                </div>

                <div className="col-span-2 flex justify-end">
                  <Button
                    variant="ghost"
                    onClick={() => removeRow(r.id)}
                    className="text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}

            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pt-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <input
                    id="eur"
                    type="checkbox"
                    checked={useEur}
                    onChange={(e) => setUseEur(e.target.checked)}
                  />
                  <Label htmlFor="eur">
                    Mostrar total também em EUR (taxa atual)
                  </Label>
                  {useEur && fx && (
                    <span className="text-xs opacity-70">
                      EURUSD (USD por EUR): {fmt(fx, 4)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Label htmlFor="thr" className="opacity-80 text-sm">
                    Limiar de queda
                  </Label>
                  <Input
                    id="thr"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={dropThresholdPct}
                    onChange={(e) =>
                      setDropThresholdPct(
                        Math.max(1, Math.min(100, Number(e.target.value)))
                      )
                    }
                    className="w-24"
                  />
                  <span className="text-sm opacity-70">%</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={calculate} disabled={calc.loading} className="gap-2">
                  {calc.loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      A calcular valor atual...
                    </>
                  ) : (
                    "Calcular valor atual"
                  )}
                </Button>

                <Button
                  onClick={computeMonthlyDrops}
                  disabled={dropsLoading}
                  variant="outline"
                  className="gap-2"
                >
                  {dropsLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      A analisar quedas...
                    </>
                  ) : (
                    <>Encontrar meses com queda ≥ {dropThresholdPct}%</>
                  )}
                </Button>
              </div>
            </div>

            {error && (
              <div className="mt-4 text-sm text-red-600 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* RESULTADOS POR POSIÇÃO */}

        {calc.results.length > 0 && (
          <Card className="shadow-lg rounded-2xl">
            <CardContent className="p-4">
              <h2 className="text-xl font-semibold mb-3">Resultados por posição</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2">Ticker</th>
                      <th>Data usada</th>
                      <th className="text-right">Fecho da compra (USD)</th>
                      <th className="text-right">Montante investido (USD)</th>
                      <th className="text-right">Ações</th>
                      <th className="text-right">Preço atual (USD)</th>
                      <th className="text-right">Valor atual (USD)</th>
                      <th className="text-right">P/L (USD)</th>
                      <th className="text-right">P/L %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calc.results.map((r: any) => {
                      const pl = r.currentValueUSD - r.amountInvested;
                      const plPct = (pl / r.amountInvested) * 100;
                      return (
                        <tr key={r.id} className="border-b last:border-b-0">
                          <td className="py-2 font-medium">{r.symbol}</td>
                          <td>{r.purchaseDateUsed}</td>
                          <td className="text-right">{fmt(r.purchaseClose)}</td>
                          <td className="text-right">{fmt(r.amountInvested)}</td>
                          <td className="text-right">{fmt(r.shares, 6)}</td>
                          <td className="text-right">{fmt(r.latestPrice)}</td>
                          <td className="text-right">{fmt(r.currentValueUSD)}</td>
                          <td className="text-right">{fmt(pl)}</td>
                          <td
                            className={`text-right ${
                              plPct >= 0 ? "text-green-700" : "text-red-700"
                            }`}
                          >
                            {fmt(plPct)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 grid md:grid-cols-4 gap-4">
                <div className="p-4 rounded-2xl bg-gray-50">
                  <div className="text-sm opacity-70">Total investido (USD)</div>
                  <div className="text-2xl font-bold">
                    ${fmt(totals.investedUSD)}
                  </div>
                  <div className="text-xs opacity-60 mt-1">
                    * USD após converter linhas em EUR com a taxa atual
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-gray-50">
                  <div className="text-sm opacity-70">
                    Total investido original (EUR)
                  </div>
                  <div className="text-2xl font-bold">
                    €{fmt(totals.investedOriginalEUR)}
                  </div>
                  <div className="text-xs opacity-60 mt-1">
                    * Soma apenas de linhas em EUR (sem conversão)
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-gray-50">
                  <div className="text-sm opacity-70">Valor atual (USD)</div>
                  <div className="text-2xl font-bold">
                    ${fmt(totals.curUSD)}
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-gray-50">
                  <div className="text-sm opacity-70">P/L total</div>
                  <div
                    className={`text-2xl font-bold ${
                      totals.plUSD >= 0 ? "text-green-700" : "text-red-700"
                    }`}
                  >
                    ${fmt(totals.plUSD)} ({fmt(totals.plPct)}%)
                  </div>
                </div>
              </div>

              {useEur && totals.curEUR != null && (
                <div className="mt-4 p-4 rounded-2xl bg-gray-50">
                  <div className="text-sm opacity-70">
                    Valor atual (EUR) — usando EURUSD atual (aprox.)
                  </div>
                  <div className="text-xl font-bold">
                    €{fmt(totals.curEUR)}
                  </div>
                </div>
              )}

              <p className="mt-2 text-xs opacity-60">
                * Se introduzires montantes em EUR, converto para USD com a taxa EURUSD
                atual para calcular as ações (aproximação).
              </p>

              <p className="mt-4 text-xs opacity-70">
                Fontes: stooq.com (histórico diário e últimas cotações). Valores informativos;
                não consideram dividendos, adjusted close ou câmbio histórico.
              </p>
            </CardContent>
          </Card>
        )}

        {/* GRÁFICO MENSAL, QUEDAS, EXTREMOS, CRISES */}

        {monthlySeries.length > 0 && (
          <Card className="shadow-lg rounded-2xl">
            <CardContent className="p-4 space-y-4">
              <h2 className="text-xl font-semibold">
                Valor mensal do portfólio, quedas & extremos anuais
              </h2>

              <div className="h-64 w-full">
                <ResponsiveContainer>
                  <LineChart
                    data={monthlySeries}
                    margin={{ top: 16, right: 24, bottom: 0, left: 0 }}
                  >
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10 }}
                      interval={Math.ceil(monthlySeries.length / 12)}
                    />
                    <YAxis
                      tickFormatter={(v) => `$${fmt(v)}`}
                      width={96}
                      domain={["dataMin", "auto"]}
                    />
                    <Tooltip
                      formatter={(value: any, _name: string, props: any) => {
                        const dk = props?.dataKey;
                        return dk === "valueUSD" ? `$${fmt(value)}` : pct(value);
                      }}
                      labelFormatter={(l) => `Mês: ${l}`}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="valueUSD"
                      name="Valor (USD)"
                      dot={false}
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Tabela de meses com quedas ≥ X% */}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2">Mês</th>
                      <th className="text-right">Valor (USD)</th>
                      <th className="text-right">MoM %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAll ? bigDrops : bigDrops.slice(start, end)).map((d) => (
                      <tr key={d.month} className="border-b last:border-b-0">
                        <td className="py-2 font-medium text-red-700">{d.month}</td>
                        <td className="text-right">${fmt(d.valueUSD)}</td>
                        <td className="text-right text-red-700">{pct(d.mom)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex flex-col md:flex-row items-center justify-between gap-3 mt-3">
                  <div className="text-sm opacity-70">
                    {showAll ? (
                      <>
                        A mostrar <strong>todos</strong> ({bigDrops.length})
                      </>
                    ) : (
                      <>
                        A mostrar{" "}
                        <strong>
                          {bigDrops.length
                            ? `${start + 1}–${Math.min(
                                bigDrops.length,
                                start + pageSize
                              )}`
                            : 0}
                        </strong>{" "}
                        de <strong>{bigDrops.length}</strong>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Label className="text-sm opacity-80">
                      Linhas por página
                    </Label>
                    <select
                      className="h-9 rounded-xl border border-gray-300 bg-white px-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-black/20"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                      disabled={showAll}
                    >
                      {[10, 20, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>

                    <Button
                      variant="outline"
                      onClick={() => setShowAll((v) => !v)}
                    >
                      {showAll ? "Mostrar paginado" : "Carregar tudo"}
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={showAll || page <= 1}
                    >
                      Anterior
                    </Button>
                    <span className="text-sm w-16 text-center">
                      {showAll
                        ? "—"
                        : `${page} / ${Math.max(
                            1,
                            Math.ceil(bigDrops.length / pageSize)
                          )}`}
                    </span>
                    <Button
                      variant="outline"
                      onClick={() =>
                        setPage((p) =>
                          Math.min(
                            Math.max(1, Math.ceil(bigDrops.length / pageSize)),
                            p + 1
                          )
                        )
                      }
                      disabled={showAll || page >= totalPages}
                    >
                      Seguinte
                    </Button>
                  </div>
                </div>
              </div>

              {/* Extremos anuais */}

              {yearExtremes.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-semibold mb-2">
                    Extremos anuais do portfólio
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left border-b">
                          <th className="py-2">Ano</th>
                          <th className="text-right">Mínimo (USD)</th>
                          <th className="text-right">Mínimo (EUR)</th>
                          <th className="text-right">Mês do mínimo</th>
                          <th className="text-right">Máximo (USD)</th>
                          <th className="text-right">Máximo (EUR)</th>
                          <th className="text-right">Mês do máximo</th>
                          <th className="text-right">Amplitude %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {yearExtremes.map((y) => {
                          const rangePct =
                            y.maxUSD > 0 ? (y.maxUSD - y.minUSD) / y.maxUSD : 0;
                          return (
                            <tr key={y.year} className="border-b last:border-b-0">
                              <td className="py-2 font-medium">{y.year}</td>
                              <td className="text-right">
                                ${fmt(y.minUSD)}
                              </td>
                              <td className="text-right">
                                {y.minEUR != null ? `€${fmt(y.minEUR)}` : "–"}
                              </td>
                              <td className="text-right">{y.minMonth}</td>
                              <td className="text-right">
                                ${fmt(y.maxUSD)}
                              </td>
                              <td className="text-right">
                                {y.maxEUR != null ? `€${fmt(y.maxEUR)}` : "–"}
                              </td>
                              <td className="text-right">{y.maxMonth}</td>
                              <td className="text-right">{pct(rangePct)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Crises de mercado */}

              {eventPerformances.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-semibold mb-2">
                    Comportamento do portfólio em grandes crises
                  </h3>
                  <p className="text-xs opacity-70 mb-2">
                    Quanto o portfólio caiu em cada crise e quanto tempo demorou a recuperar.
                    A ideia é mostrar que grandes quedas são desconfortáveis, mas a recuperação
                    costuma acontecer para quem não foge ao primeiro -5%.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left border-b">
                          <th className="py-2">Evento</th>
                          <th className="text-right">Período</th>
                          <th className="text-right">Valor início (USD)</th>
                          <th className="text-right">Valor fim (USD)</th>
                          <th className="text-right">Variação %</th>
                          <th className="text-right">Máx. drawdown</th>
                          <th className="text-right">Pior mês</th>
                          <th className="text-right">Mês de recuperação</th>
                          <th className="text-right">Meses até recuperar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {eventPerformances.map((ev) => {
                          if (ev.startValue == null || ev.endValue == null) {
                            return (
                              <tr
                                key={ev.id}
                                className="border-b last:border-b-0"
                              >
                                <td className="py-2 font-medium">{ev.name}</td>
                                <td className="text-right">
                                  {ev.startMonth} → {ev.endMonth}
                                </td>
                                <td className="text-right" colSpan={7}>
                                  <span className="opacity-70">
                                    Sem dados para este período (o portfólio ainda
                                    não existia ou não tinha valor).
                                  </span>
                                </td>
                              </tr>
                            );
                          }

                          const ddClass =
                            ev.maxDrawdown != null && ev.maxDrawdown < 0
                              ? "text-red-700"
                              : "";

                          return (
                            <tr
                              key={ev.id}
                              className="border-b last:border-b-0"
                            >
                              <td className="py-2 font-medium">{ev.name}</td>
                              <td className="text-right">
                                {ev.startMonth} → {ev.endMonth}
                              </td>
                              <td className="text-right">
                                ${fmt(ev.startValue)}
                              </td>
                              <td className="text-right">
                                ${fmt(ev.endValue)}
                              </td>
                              <td
                                className={`text-right ${
                                  ev.pctChange != null && ev.pctChange >= 0
                                    ? "text-green-700"
                                    : "text-red-700"
                                }`}
                              >
                                {ev.pctChange != null ? pct(ev.pctChange) : "–"}
                              </td>
                              <td className={`text-right ${ddClass}`}>
                                {ev.maxDrawdown != null
                                  ? pct(ev.maxDrawdown)
                                  : "–"}
                              </td>
                              <td className="text-right">
                                {ev.troughMonth ?? "–"}
                              </td>
                              <td className="text-right">
                                {ev.recoveryMonth ?? "Não recuperou (ainda)"}
                              </td>
                              <td className="text-right">
                                {ev.recoveryMonth == null
                                  ? "–"
                                  : `${ev.monthsToRecoveryFromStart}m desde início / ${ev.monthsToRecoveryFromTrough}m desde o pior mês`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <p className="text-xs opacity-70">
                Metodologia: mês = último fecho disponível de cada mês (Stooq). Eventos
                são janelas aproximadas, servem para ilustrar o comportamento em crises.
                O objetivo é mostrar que grandes quedas fazem parte do caminho, mas que
                quem se mantém investido tende a beneficiar da recuperação.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
