import { EasyAiApi } from "./api.js";
import { readDataFile } from "./load-data.js";
import { taskRows } from "./submission.js";

export interface CatalogModel {
  alias: string;
  display: string;
  upstream: string;
  upstreams: string[];
  types: string[];
  provider: string;
}

export interface StaticCatalog { schemaVersion: string; source: string; models: CatalogModel[]; }

export function staticCatalog(): StaticCatalog {
  return readDataFile<StaticCatalog>("model-catalog.json");
}

export function staticCatalogResponse(): { data: Array<Record<string, unknown>>; source: "static" } {
  return {
    source: "static",
    data: staticCatalog().models.map(row => ({
      id: row.alias, model: row.upstream, name: row.display, displayName: row.display,
      modelAlias: row.alias, modelType: row.types, provider: row.provider, enabled: true, upstreams: row.upstreams,
    })),
  };
}

export async function loadModelCatalog(api?: EasyAiApi): Promise<{ source: "live" | "static"; catalog: unknown }> {
  if (api) {
    for (const path of ["/v1/models/list", "/v1/models"]) {
      try {
        const catalog = await api.get(path);
        if (taskRows(catalog).length) return { source: "live", catalog };
      } catch { /* static fallback */ }
    }
  }
  return { source: "static", catalog: staticCatalogResponse() };
}
