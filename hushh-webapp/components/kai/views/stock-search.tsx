"use client";

import * as React from "react";
import { ChevronsUpDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMediaQuery } from "@/lib/morphy-ux/use-media-query";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { ApiService } from "@/lib/services/api-service";

// Top 50 popular stocks for instant suggestion (offline fallback)
const TOP_STOCKS = [
  { value: "AAPL", label: "Apple Inc." },
  { value: "MSFT", label: "Microsoft Corp." },
  { value: "GOOGL", label: "Alphabet Inc." },
  { value: "AMZN", label: "Amazon.com Inc." },
  { value: "NVDA", label: "NVIDIA Corp." },
  { value: "TSLA", label: "Tesla Inc." },
  { value: "META", label: "Meta Platforms Inc." },
  { value: "BRK.B", label: "Berkshire Hathaway" },
  { value: "LLY", label: "Eli Lilly & Co." },
  { value: "V", label: "Visa Inc." },
  { value: "TSM", label: "Taiwan Semiconductor" },
  { value: "AVGO", label: "Broadcom Inc." },
  { value: "JPM", label: "JPMorgan Chase" },
  { value: "WMT", label: "Walmart Inc." },
  { value: "XOM", label: "Exxon Mobil Corp." },
  { value: "MA", label: "Mastercard Inc." },
  { value: "UNH", label: "UnitedHealth Group" },
  { value: "PG", label: "Procter & Gamble" },
  { value: "JNJ", label: "Johnson & Johnson" },
  { value: "HD", label: "Home Depot Inc." },
  { value: "MRK", label: "Merck & Co." },
  { value: "COST", label: "Costco Wholesale" },
  { value: "ABBV", label: "AbbVie Inc." },
  { value: "CVX", label: "Chevron Corp." },
  { value: "CRM", label: "Salesforce Inc." },
  { value: "BAC", label: "Bank of America" },
  { value: "AMD", label: "Advanced Micro Devices" },
  { value: "NFLX", label: "Netflix Inc." },
  { value: "PEP", label: "PepsiCo Inc." },
  { value: "KO", label: "Coca-Cola Co." },
  { value: "TMO", label: "Thermo Fisher" },
  { value: "ADBE", label: "Adobe Inc." },
  { value: "DIS", label: "Walt Disney Co." },
  { value: "MCD", label: "McDonald's Corp." },
  { value: "CSCO", label: "Cisco Systems" },
  { value: "ABT", label: "Abbott Labs" },
  { value: "DHR", label: "Danaher Corp." },
  { value: "INTC", label: "Intel Corp." },
  { value: "NKE", label: "Nike Inc." },
  { value: "VZ", label: "Verizon Comm." },
  { value: "CMCSA", label: "Comcast Corp." },
  { value: "INTU", label: "Intuit Inc." },
  { value: "QCOM", label: "Qualcomm Inc." },
  { value: "IBM", label: "IBM Corp." },
  { value: "TXN", label: "Texas Instruments" },
  { value: "AMGN", label: "Amgen Inc." },
  { value: "SPY", label: "S&P 500 ETF" },
  { value: "QQQ", label: "Nasdaq 100 ETF" },
  { value: "IWM", label: "Russell 2000 ETF" },
  { value: "GLD", label: "Gold Trust" },
];

/** Set of known ticker values for fast lookup */
const TOP_STOCKS_SET = new Set(TOP_STOCKS.map((s) => s.value));

/** Returns true when `text` looks like a valid 1-5 letter ticker */
function isTickerLike(text: string): boolean {
  return /^[A-Z]{1,5}$/.test(text);
}

type TickerSearchResult = {
  ticker: string;
  title?: string | null;
  cik?: string | number | null;
  exchange?: string | null;
};

export function StockSearch({
  onSelect,
  className,
}: {
  onSelect: (ticker: string) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [remoteResults, setRemoteResults] = React.useState<TickerSearchResult[]>([]);
  const [remoteLoading, setRemoteLoading] = React.useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // Measure trigger width so popover content matches exactly.
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const [triggerWidth, setTriggerWidth] = React.useState<number>(288);

  React.useEffect(() => {
    if (!isDesktop) return;
    const el = triggerRef.current;
    if (!el) return;
    const measure = () => setTriggerWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isDesktop]);

  // Fetch tickers from backend (Supabase-backed) for real SEC-wide search.
  // Debounced to avoid hammering the API while typing.
  React.useEffect(() => {
    const q = search.trim();
    if (!q) {
      setRemoteResults([]);
      setRemoteLoading(false);
      return;
    }

    const handle = setTimeout(async () => {
      try {
        setRemoteLoading(true);
        const resp = await ApiService.apiFetch(`/api/tickers/search?q=${encodeURIComponent(q)}&limit=25`, {
          method: "GET",
        });
        if (!resp.ok) {
          setRemoteResults([]);
          return;
        }
        const json = (await resp.json()) as TickerSearchResult[];
        setRemoteResults(Array.isArray(json) ? json : []);
      } catch {
        setRemoteResults([]);
      } finally {
        setRemoteLoading(false);
      }
    }, 200);

    return () => clearTimeout(handle);
  }, [search]);

  // Derive escape-hatch ticker: show when typed value is a valid ticker
  // that doesn't exactly match any entry in TOP_STOCKS
  const escapeTicker = React.useMemo(() => {
    const upper = search.trim().toUpperCase();
    if (!upper || !isTickerLike(upper)) return null;
    if (TOP_STOCKS_SET.has(upper)) return null;
    return upper;
  }, [search]);

  // Handle selection logic
  const handleSelect = (value: string) => {
    setOpen(false);
    setSearch("");
    onSelect(value);
  };

  // Shared content for Popover (Desktop) and Drawer (Mobile)
  const SearchContent = (
    <Command
      className="rounded-xl border shadow-md"
      // We rely on our own backend search results, so avoid client filtering that
      // can hide results when value strings differ.
      shouldFilter={false}
    >
      <CommandInput
        placeholder="Search ticker (e.g. AAPL)..."
        value={search}
        onValueChange={setSearch}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const trimmed = search.trim().toUpperCase();
            if (trimmed && isTickerLike(trimmed)) {
              handleSelect(trimmed);
            }
          }
        }}
      />
      <CommandList className="max-h-72 overflow-y-auto">
        <CommandEmpty>{remoteLoading ? "Searching…" : "No results found."}</CommandEmpty>

        {/* Remote results (SEC-wide). Shown when user types anything. */}
        {remoteResults.length > 0 && (
          <CommandGroup heading="All SEC tickers">
            {remoteResults.map((r) => (
              <CommandItem
                key={`${r.ticker}-${r.cik ?? ""}`}
                value={`${r.ticker} ${r.title ?? ""}`}
                onSelect={() => handleSelect(r.ticker)}
                className="cursor-pointer"
              >
                <span className="font-bold w-16">{r.ticker}</span>
                <span className="mx-2 text-muted-foreground/40">—</span>
                <span className="text-muted-foreground truncate">{r.title ?? ""}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Escape hatch: type any ticker not in the list */}
        {escapeTicker && (
          <CommandGroup heading="Type any ticker">
            <CommandItem
              value={`custom-${escapeTicker}`}
              onSelect={() => handleSelect(escapeTicker)}
              className="cursor-pointer"
              forceMount
            >
              <span className="font-bold">Analyze {escapeTicker}</span>
            </CommandItem>
          </CommandGroup>
        )}

        <CommandGroup heading="Popular Stocks">
          {TOP_STOCKS.map((stock) => (
            <CommandItem
              key={stock.value}
              value={`${stock.value} ${stock.label}`} // Allow searching by name or ticker
              onSelect={() => handleSelect(stock.value)}
              className="cursor-pointer"
            >
              <span className="font-bold w-12">{stock.value}</span>
              <span className="mx-2 text-muted-foreground/40">—</span>
              <span className="text-muted-foreground truncate">{stock.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("w-full max-w-md lg:max-w-lg justify-between text-muted-foreground", className)}
          >
            <span className="flex items-center">
                <Search className="mr-2 h-4 w-4" />
                Analyze a stock...
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          style={{ ['--stock-search-width' as any]: `${triggerWidth}px` }}
          className="w-[var(--stock-search-width)] p-0"
          align="start"
        >
          {SearchContent}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full max-w-md lg:max-w-lg justify-between text-muted-foreground", className)}
        >
          <span className="flex items-center">
            <Search className="mr-2 h-4 w-4" />
            Analyze a stock...
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <div className="mt-4 border-t h-[60vh]">
          {SearchContent}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
