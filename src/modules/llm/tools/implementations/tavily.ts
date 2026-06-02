import { getTavilyClient } from "../../../tavily/client.js";

export const tavilyToolImplementations: Record<
  string,
  (args: any) => Promise<any>
> = {
  tavily_search: async (opts: any) => {
    const client = getTavilyClient();

    const res = await client.search(opts.query, {
      searchDepth: opts.searchDepth,
      topic: opts.topic,
      maxResults: opts.maxResults,
      timeRange: opts.timeRange,
      includeDomains: opts.includeDomains,
      excludeDomains: opts.excludeDomains,
      includeAnswer: opts.includeAnswer,
    });

    return {
      query: res.query,
      answer: res.answer,
      results: res.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
        publishedDate: r.publishedDate,
      })),
    };
  },

  tavily_extract: async (opts: any) => {
    const client = getTavilyClient();

    const res = await client.extract(opts.urls, {
      extractDepth: opts.extractDepth,
      format: opts.format,
      query: opts.query,
    });

    return {
      results: res.results.map((r) => ({
        url: r.url,
        title: r.title,
        content: r.rawContent,
      })),
      failed: res.failedResults,
    };
  },

  tavily_crawl: async (opts: any) => {
    const client = getTavilyClient();

    const res = await client.crawl(opts.url, {
      maxDepth: opts.maxDepth,
      maxBreadth: opts.maxBreadth,
      limit: opts.limit,
      instructions: opts.instructions,
      selectDomains: opts.selectDomains,
      excludeDomains: opts.excludeDomains,
      format: opts.format,
    });

    return {
      baseUrl: res.baseUrl,
      pages: res.results.map((r) => ({ url: r.url, content: r.rawContent })),
    };
  },

  tavily_research: async (opts: any) => {
    const client = getTavilyClient();

    const res = await client.research(opts.query, { model: opts.model });

    if (Symbol.asyncIterator in Object(res)) {
      throw new Error("Unexpected streaming response from research");
    }

    const report = res as Awaited<ReturnType<typeof client.research>> & {
      requestId: string;
      status: string;
    };
    return {
      requestId: report.requestId,
      status: report.status,
    };
  },
};
