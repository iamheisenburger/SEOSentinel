import { apiFromModules } from "convex/api";
import type { ApiFromModules } from "convex/api";
import * as articles from "../articles";
import * as jobs from "../jobs";
import * as pages from "../pages";
import * as sites from "../sites";
import * as topics from "../topics";
import * as pipeline from "../actions/pipeline";
import * as scheduler from "../actions/scheduler";

const modules = {
  articles,
  jobs,
  pages,
  sites,
  topics,
  "actions/pipeline": pipeline,
  "actions/scheduler": scheduler,
};

export const api = apiFromModules(modules) as ApiFromModules<typeof modules>;
export type Api = typeof api;
export default api;

