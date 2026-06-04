export type ProviderSort =
  | "price"
  | "throughput"
  | "latency"
  | {
      by: "price" | "throughput" | "latency";
      partition?: "model" | "none";
    };

export type ProviderPercentileThresholds = {
  p50?: number;
  p75?: number;
  p90?: number;
  p99?: number;
};

export type ProviderPriceLimit = {
  prompt?: number;
  completion?: number;
  request?: number;
  image?: number;
};

export type ProviderPreferences = {
  order?: string[];
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_collection?: "allow" | "deny";
  zdr?: boolean;
  enforce_distillable_text?: boolean;
  only?: string[];
  ignore?: string[];
  quantizations?: string[];
  sort?: ProviderSort;
  preferred_min_throughput?: number | ProviderPercentileThresholds;
  preferred_max_latency?: number | ProviderPercentileThresholds;
  max_price?: ProviderPriceLimit;
};
