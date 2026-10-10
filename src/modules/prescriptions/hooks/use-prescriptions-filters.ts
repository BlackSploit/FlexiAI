import { parseAsBoolean, parseAsInteger, parseAsString, useQueryStates } from "nuqs";

import { DEFAULT_PAGE } from "@/constants";

export const usePrescriptionsFilters = () => {
  return useQueryStates({
    search: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
    page: parseAsInteger.withDefault(DEFAULT_PAGE).withOptions({ clearOnDefault: true }),
    patientId: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
    exerciseId: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
    active: parseAsBoolean,
  });
};
