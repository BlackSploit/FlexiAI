import { createLoader, parseAsBoolean, parseAsInteger, parseAsString } from "nuqs/server";

import { DEFAULT_PAGE } from "@/constants";

export const filtersSearchParams = {
  search: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
  page: parseAsInteger.withDefault(DEFAULT_PAGE).withOptions({ clearOnDefault: true }),
  patientId: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
  exerciseId: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
  active: parseAsBoolean,
};

export const loadSearchParams = createLoader(filtersSearchParams);
