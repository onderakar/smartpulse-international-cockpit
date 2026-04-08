import { ComponentType } from './assetMapping.types';

/** Which entity level an attribute applies to */
export type EntityScope = 'GCP' | 'COMPONENT' | 'SUBCOMPONENT';

/** Supported data types for attribute values */
export type AttributeDataType = 'number' | 'string' | 'boolean' | 'enum' | 'date';

/** Whether the definition is shipped with the system or created by an admin */
export type AttributeSource = 'system' | 'admin';

/** Runtime attribute value — always a primitive or null */
export type AttributeValue = string | number | boolean | null;

/** Extension bag stored on entities */
export type ExtensionAttributes = Record<string, AttributeValue>;

/** Describes a valid attribute key, its type, scope, and how it maps to external sources */
export interface AttributeDefinition {
  /** Internal identifier, e.g. 'bess_max_charge_mw' */
  key: string;
  /** Translation key for display label, e.g. 'attr.bess_max_charge_mw' */
  labelKey: string;
  /** Data type for validation */
  dataType: AttributeDataType;
  /** Display unit, e.g. 'MW', 'MWh', '%' */
  unit?: string;
  /** Which entity levels this attribute applies to */
  entityScopes: EntityScope[];
  /** If set, restricts to specific ComponentType values. null/undefined = all types */
  componentTypes?: ComponentType[];
  /** Whether absence should warn during validation */
  required: boolean;
  /** For dataType 'enum', the allowed values */
  enumValues?: string[];
  /** Category for UI grouping: 'electrical', 'capacity', 'identification' */
  group: string;
  /** Whether system-shipped or admin-created */
  source: AttributeSource;
  /** Soft-delete flag */
  deprecated?: boolean;
  /** CSV column names that map to this attribute (case-insensitive matching) */
  csvColumnAliases?: string[];
}
