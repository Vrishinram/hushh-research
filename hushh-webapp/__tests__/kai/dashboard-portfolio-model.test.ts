import { describe, expect, it } from "vitest";

import { buildDashboardPortfolioModel } from "@/components/kai/views/dashboard-portfolio-model";
import type { PortfolioData } from "@/components/kai/types/portfolio";

describe("dashboard portfolio model asset bucket classification", () => {
  it("classifies ticker-like common equity holdings as equity even with generic asset_type", () => {
    const portfolio: PortfolioData = {
      total_value: 1000,
      account_summary: { ending_value: 1000 },
      holdings: [
        {
          symbol: "TSLA",
          name: "Tesla Inc",
          quantity: 2,
          price: 500,
          market_value: 1000,
          asset_type: "Other",
          is_investable: true,
        },
      ],
    };

    const model = buildDashboardPortfolioModel(portfolio);
    expect(model.positions).toHaveLength(1);
    expect(model.positions[0]?.assetBucket).toBe("equity");
    expect(model.counts.equityPositions).toBe(1);
  });

  it("keeps fixed-income instruments out of equity when bond hints are present", () => {
    const portfolio: PortfolioData = {
      total_value: 1000,
      account_summary: { ending_value: 1000 },
      holdings: [
        {
          symbol: "BND",
          name: "Total Bond Market ETF",
          quantity: 10,
          price: 100,
          market_value: 1000,
          asset_type: "Other",
          is_investable: true,
        },
      ],
    };

    const model = buildDashboardPortfolioModel(portfolio);
    expect(model.positions).toHaveLength(1);
    expect(model.positions[0]?.assetBucket).toBe("fixed_income");
    expect(model.counts.fixedIncomePositions).toBe(1);
  });
});
