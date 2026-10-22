const archivedRefinementStatuses = new Set(["done", "skipped"]);

function isArchivedRefinement(run, currentMapSource) {
  return (
    run.type === "refinement" &&
    run.id !== currentMapSource &&
    archivedRefinementStatuses.has(String(run.status).toLowerCase())
  );
}

export function runHistoryView({
  runs,
  currentMapSource,
  filter = "all",
  showArchivedRefinements = false,
}) {
  const matching = runs.filter(
    (run) => filter === "all" || run.type === filter,
  );
  const archivedRefinements = matching.filter((run) =>
    isArchivedRefinement(run, currentMapSource),
  );
  // “blocked” remains in the default list: it still needs a human decision.
  // A direct refinement filter is an explicit request to inspect all history.
  const showArchived =
    filter === "refinement" || showArchivedRefinements;
  return {
    runs: showArchived
      ? matching
      : matching.filter(
          (run) => !isArchivedRefinement(run, currentMapSource),
        ),
    archivedRefinementCount: archivedRefinements.length,
  };
}
