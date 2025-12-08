import type { DataModel } from "./dataModel";
import type {
  GenericActionCtx,
  GenericDatabaseReader,
  GenericDatabaseWriter,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric,
} from "convex/server";

export const query = queryGeneric<DataModel>;
export const mutation = mutationGeneric<DataModel>;
export const action = actionGeneric<DataModel>;
export const internalQuery = internalQueryGeneric<DataModel>;
export const internalMutation = internalMutationGeneric<DataModel>;
export const internalAction = internalActionGeneric<DataModel>;

export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export type ActionCtx = GenericActionCtx<DataModel>;
export type DatabaseReader = GenericDatabaseReader<DataModel>;
export type DatabaseWriter = GenericDatabaseWriter<DataModel>;

