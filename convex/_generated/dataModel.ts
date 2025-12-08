import type { DataModelFromSchemaDefinition } from "convex/schema";
import schema from "../schema";

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const dataModel = {} as unknown as DataModel;
export default dataModel;

