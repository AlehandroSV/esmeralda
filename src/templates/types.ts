/**
 * Shared interfaces for the template system.
 */

export type TemplateId = "api-rest" | "microservice" | "cli-app" | "blog";

export interface FeaturePrompt {
  key: string;
  label: string;
  default?: boolean;
}

export interface TemplateFile {
  path: string;
  content: string;
}

export interface TemplateDefinition {
  id: TemplateId;
  displayName: string;
  description: string;
  files: TemplateFile[];
  features?: FeaturePrompt[];
  defaultDriver?: "postgresql" | "mysql" | "sqlite";
}
