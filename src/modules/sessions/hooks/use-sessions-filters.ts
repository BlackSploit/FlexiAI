import { parseAsInteger, parseAsString, parseAsStringEnum, useQueryStates } from "nuqs";

import { DEFAULT_PAGE } from "@/constants";

import { CallSessionStatus } from "../types";

export const useSessionsFilters = () => {
  return useQueryStates({
    search: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
    page: parseAsInteger.withDefault(DEFAULT_PAGE).withOptions({ clearOnDefault: true }),
    status: parseAsStringEnum(Object.values(CallSessionStatus)),
    patientId: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
    prescriptionId: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
  });
};
