export async function fetchWnbaModel() {
  const response = await fetch("/api/wnba-model");
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return response.json();
}

export async function fetchWnbaResultsTracker() {
  const response = await fetch("/api/wnba-results-tracker");
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return response.json();
}

export async function saveWnbaResultsEntry(entry) {
  const response = await fetch("/api/wnba-results-tracker/entries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(entry),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return response.json();
}

export async function deleteWnbaResultsEntry(entryId) {
  const response = await fetch("/api/wnba-results-tracker/entries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ deleteEntryId: entryId, action: "delete" }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }

  return response.json();
}
