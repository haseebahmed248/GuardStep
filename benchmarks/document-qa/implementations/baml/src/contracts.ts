import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";

import { benchmarkRoot } from "./paths.js";
import type { Answer, PortableEvent, QuestionInput } from "./types.js";

const loadSchema = (name: string): object =>
  JSON.parse(readFileSync(join(benchmarkRoot, "schemas", name), "utf8")) as object;

const loadRepositorySchema = (name: string): object =>
  JSON.parse(readFileSync(join(benchmarkRoot, "..", "..", "schemas", name), "utf8")) as object;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const addFormats = formatsModule.default as unknown as FormatsPlugin;
addFormats(ajv);

export const inputSchema = loadSchema("input.schema.json");
export const outputSchema = loadSchema("output.schema.json");
export const eventSchema = loadRepositorySchema("execution-event.v1.schema.json");

const inputValidator = ajv.compile<QuestionInput>(inputSchema);
const outputValidator = ajv.compile<Answer>(outputSchema);
const eventValidator = ajv.compile<PortableEvent>(eventSchema);

export interface ContractValidation<T> {
  valid: boolean;
  value?: T;
  errors: ErrorObject[];
}

const validate = <T>(validator: ValidateFunction<T>, value: unknown): ContractValidation<T> => {
  const valid = validator(value);
  return {
    valid,
    ...(valid ? { value } : {}),
    errors: validator.errors ? [...validator.errors] : [],
  };
};

export const validateInput = (value: unknown): ContractValidation<QuestionInput> =>
  validate(inputValidator, value);

export const validateOutput = (value: unknown): ContractValidation<Answer> =>
  validate(outputValidator, value);

export const validateEvent = (value: unknown): ContractValidation<PortableEvent> =>
  validate(eventValidator, value);
