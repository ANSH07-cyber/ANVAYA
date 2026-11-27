import { useEffect, useState } from "react";
import type { PaginatedResponse } from "../../types/patient";
import { HISTORY_PAGE_SIZE, patientReadError, readPatientPage, uniqueById, type PatientPageLoader } from "../../services/patientReliability";

export function usePatientHistoryPage<T extends { id: string }>(
  owner: string | undefined, load: PatientPageLoader<T>, subject: string,
) {
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    owner: string; offset: number; revision: number; page?: PaginatedResponse<T>; error: string;
  }>();

  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    const identity = { owner, offset, revision };
    void readPatientPage(load, { limit: HISTORY_PAGE_SIZE, offset, signal: controller.signal })
      .then((page) => {
        if (!controller.signal.aborted) setResult({ ...identity, page, error: "" });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ ...identity, error: patientReadError(error, subject) });
      });
    return () => controller.abort();
  }, [owner, load, subject, offset, revision]);

  const current = result?.owner === owner && result?.offset === offset && result?.revision === revision ? result : undefined;
  const page = current?.page;
  const items = page ? uniqueById(page.items) : [];
  return {
    items,
    page,
    offset,
    error: current?.error ?? "",
    loading: !current,
    setOffset,
    reload: () => setRevision((value) => value + 1),
    updateItem: (updated: T) => setResult((previous) => (
      previous === current && previous?.page
        ? { ...previous, page: { ...previous.page, items: previous.page.items.map((item) => item.id === updated.id ? updated : item) } }
        : previous
    )),
  };
}
