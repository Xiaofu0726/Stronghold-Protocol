// Optional mode configuration; no global/default change to ordinary band drafts.
export function fixedModeBand(mode, bands) {
  const id = mode?.bandDraft?.fixedBandId;
  const band = typeof id === 'string' ? bands?.[id] : null;
  return band && (!Array.isArray(band.modeTypeList) || band.modeTypeList.includes(mode.type)) ? id : null;
}

export function validateModeBand(mode, bands, bad) {
  if (!Object.hasOwn(mode.bandDraft ?? {}, 'fixedBandId')) return;
  if (!fixedModeBand(mode, bands)) {
    bad(`modes.${mode.modeId}.bandDraft.fixedBandId`, 'fixedBandId must name a band allowed in this mode type', 'PLUGIN_DATA_REFERENCE');
  }
}
